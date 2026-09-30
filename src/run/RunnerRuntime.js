/**
 * 执行「伪编译产物」的沙箱运行时，**纯 JavaScript**。
 *
 * 为什么单独放一个 .js（与 agent/sandboxRuntime.js 同一个理由）：这段代码会以字符串
 * 形式被塞进 Blob 再交给 Worker，浏览器是按 JS 解析它的，混进任何 TypeScript 语法
 * 都会让 Worker 一启动就抛 SyntaxError，而且报错位置指向别处，极难自查。
 *
 * 它和 agent 那个沙箱是**两回事**：agent 的沙箱跑的是「编排」（能调 api 操作文档），
 * 这个沙箱跑的是用户在文档里看见的那段代码编译出来的东西——它的能力只有
 * 「打印」与「联网」两件：
 * - 没有 DOM（Worker 里本来就没有 window/document）；
 * - 拿不到 window.mojiNative（那是主世界的东西，跨不进 Worker）；
 * - 读不到 localStorage / indexedDB / caches（下面逐个收走）：这个 Worker 与页面同源，
 *   留着它们就等于把应用自己的存储开放给一段模型写的代码；
 * - 联网只有一条路：fetch → 问宿主 → 宿主问用户 → 主进程代发（见 electron/runner.ts）。
 *
 * 通信协议：
 *   宿主 → { kind: 'run', code, timeoutMs }
 *   Worker → { kind: 'out', level: 'log'|'info'|'warn'|'error'|'return', text }
 *   Worker → { kind: 'net-ask', id, url }        想联网，请宿主问用户
 *   宿主 → { kind: 'net-ask-reply', id, ok }     用户同不同意（同意即**本次运行**内一直有效）
 *   Worker → { kind: 'net', id, url, init }      实际请求，请宿主代发
 *   宿主 → { kind: 'net-reply', id, ok, ... }    主进程发回来的结果
 *   Worker → { kind: 'done', ok, error?, ms }    跑完了
 */
var MAX_OUT_CHARS = 200000

var seq = 0
var pending = {}
var outChars = 0
var running = false

function post(msg) {
  self.postMessage(msg)
}

/* ---------- 值的展示 ---------- */

function show(v, depth) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  var t = typeof v
  if (t === 'string') return v
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v)
  if (t === 'symbol') return String(v)
  if (t === 'function') return '[函数 ' + (v.name || '匿名') + ']'
  if (v instanceof Error) {
    var at = v.stack ? String(v.stack).split('\n')[1] : ''
    return v.message + (at ? '  ' + at.trim() : '')
  }
  if (depth <= 0) return Array.isArray(v) ? '[…]' : '{…}'
  var tag = Object.prototype.toString.call(v)
  try {
    if (Array.isArray(v)) {
      return '[' + v.map(function (x) { return show(x, depth - 1) }).join(', ') + ']'
    }
    if (tag === '[object Map]' || tag === '[object Set]') return String(v)
    if (tag !== '[object Object]') return tag.slice(8, -1) + ' ' + String(v)
    var parts = Object.keys(v).slice(0, 50).map(function (k) {
      return k + ': ' + show(v[k], depth - 1)
    })
    if (Object.keys(v).length > 50) parts.push('…')
    return '{' + parts.join(', ') + '}'
  } catch {
    return String(v)
  }
}

function line(args) {
  var out = []
  for (var i = 0; i < args.length; i++) out.push(show(args[i], 3))
  return out.join(' ')
}

/** 打印一行。输出总量有上限：一段 while(true) console.log 的代码不该把内存吃光 */
function emit(level, args) {
  var text = line(args)
  outChars += text.length
  if (outChars > MAX_OUT_CHARS) {
    throw new Error('输出太多了（超过 ' + MAX_OUT_CHARS + ' 个字符），已中止本次运行')
  }
  post({ kind: 'out', level: level, text: text })
}

/* ---------- 收走不该有的东西 ---------- */

self.console = {
  log: function () { emit('log', arguments) },
  info: function () { emit('info', arguments) },
  warn: function () { emit('warn', arguments) },
  error: function () { emit('error', arguments) },
  debug: function () { emit('log', arguments) },
  trace: function () { emit('log', arguments) },
  table: function () { emit('log', arguments) },
  dir: function () { emit('log', arguments) },
}
self.XMLHttpRequest = undefined
self.WebSocket = undefined
self.EventSource = undefined
self.importScripts = undefined
self.indexedDB = undefined
self.caches = undefined
if (self.navigator) {
  try { self.navigator.sendBeacon = undefined } catch { /* 只读属性，改不动就算了 */ }
}

/* ---------- 联网：唯一一条对外通道 ---------- */

/**
 * 一次异步往返宿主：发一条消息，等它按 id 回。
 *
 * 注意这里**不保留真的 fetch**：这个沙箱里没有「不经过用户同意」的网络，
 * 请求一律由宿主（进而主进程）代发，见下面的 self.fetch。
 */
function ask(msg) {
  return new Promise(function (resolve) {
    var id = ++seq
    pending[id] = resolve
    msg.id = id
    post(msg)
  })
}

self.fetch = function (input, init) {
  var url = typeof input === 'string' ? input : input && input.url ? String(input.url) : String(input)
  return ask({ kind: 'net-ask', url: url }).then(function (reply) {
    if (!reply || !reply.ok) {
      throw new Error('这次联网没有获得允许：' + url)
    }
    var o = init && typeof init === 'object' ? init : {}
    return ask({
      kind: 'net',
      url: url,
      init: {
        method: typeof o.method === 'string' ? o.method : 'GET',
        headers: plainHeaders(o.headers),
        body: typeof o.body === 'string' ? o.body : undefined,
      },
    })
  }).then(function (res) {
    if (!res || !res.ok) throw new Error((res && res.error) || '请求失败')
    var headers = {}
    for (var i = 0; i < (res.headers || []).length; i++) headers[res.headers[i][0]] = res.headers[i][1]
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: headers })
  })
}

function plainHeaders(h) {
  var out = {}
  if (!h) return out
  try {
    if (typeof h.forEach === 'function') {
      h.forEach(function (v, k) { out[k] = String(v) })
      return out
    }
    var keys = Object.keys(h)
    for (var i = 0; i < keys.length; i++) out[keys[i]] = String(h[keys[i]])
  } catch { /* 读不出来的头就不带 */ }
  return out
}

/* ---------- 跑 ---------- */

function finish(ok, error, ms) {
  if (!running) return
  running = false
  post({ kind: 'done', ok: ok, error: error, ms: ms })
}

function run(msg) {
  running = true
  var started = Date.now()
  var budget = typeof msg.timeoutMs === 'number' && msg.timeoutMs > 0 ? msg.timeoutMs : 15000
  /**
   * 这个定时器只在代码「让出事件循环」时才可能触发（await 一个不会回来的 Promise）。
   * 死循环（while(true){}）连它都跑不到——那种情况由宿主 terminate() 兜底，
   * 两边各管一半，谁先到算谁的。
   */
  setTimeout(function () {
    if (!running) return
    emit('error', ['运行超时（' + Math.round(budget / 1000) + ' 秒）：代码疑似死循环或卡住了'])
    finish(false, '超时', Date.now() - started)
  }, budget + 200)

  var fn
  try {
    /**
     * 包成「async 箭头 + 立即执行」：这样产物里的顶层 await 与 return 都能用，
     * 与 agent 沙箱同一套形状（见 agent/sandboxRuntime.js 里那段解释）。
     */
    fn = new Function('return (async () => {\n' + msg.code + '\n})()')
  } catch (err) {
    emit('error', ['这段代码连语法都没过：' + (err && err.message ? err.message : String(err))])
    finish(false, '语法错误', Date.now() - started)
    return
  }
  Promise.resolve().then(fn).then(
    function (value) {
      if (value !== undefined) emit('return', [value])
      finish(true, undefined, Date.now() - started)
    },
    function (err) {
      emit('error', [err])
      finish(false, err && err.message ? String(err.message) : String(err), Date.now() - started)
    },
  )
}

self.onmessage = function (ev) {
  var msg = ev.data || {}
  if (msg.kind === 'net-ask-reply' || msg.kind === 'net-reply') {
    var slot = pending[msg.id]
    if (slot) {
      delete pending[msg.id]
      slot(msg)
    }
    return
  }
  if (msg.kind === 'run') run(msg)
}

/** 跑完之后才炸的异步错误（一个没接的 setTimeout 里抛了）：也当输出报上去 */
self.onerror = function (event) {
  emit('error', [(event && event.message) || '运行时错误'])
}
self.onunhandledrejection = function (event) {
  emit('error', [event && event.reason ? event.reason : '未处理的 Promise 拒绝'])
}
