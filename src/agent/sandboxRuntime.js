/**
 * 沙箱的运行时代码，**纯 JavaScript**。
 *
 * 为什么单独放一个 .js：这段代码会以字符串形式被塞进 Blob 再交给 Worker，
 * 浏览器是按 JS 解析它的，任何 TypeScript 语法（类型标注、as、接口）都会让
 * Worker 一启动就抛 SyntaxError——而且报错位置指向别处，极难自查。
 * 单独成文件后，构建器会像编译其它 .js 一样检查它的语法，写错立刻发现。
 *
 * 通信：宿主 postMessage({ kind: 'run', body, timeoutMs }) 起跑；
 * Worker 需要 api 时回 { kind: 'call', id, name, args }，宿主回 { kind: 'reply', id, ok, value/message }；
 * 跑完发 { kind: 'done', ok, value/error }。
 */
const API_NAMES = __API_NAMES__
const API_HELP = __API_HELP__

/**
 * 只给编排能力：网络与定时器统统收走。
 * 与外界交互的唯一通道是 api——否则沙箱就成了绕开应用逻辑的后门。
 */
globalThis.fetch = undefined
globalThis.XMLHttpRequest = undefined
globalThis.WebSocket = undefined
globalThis.importScripts = undefined

let seq = 0
const pending = new Map()
/** 本次 run 的超时定时器；收到任何活动（回复 / 心跳）都续命（见 run 里的 armTimer） */
let runTimer = null

self.onmessage = (ev) => {
  const msg = ev.data || {}
  if (msg.kind === 'reply') {
    const slot = pending.get(msg.id)
    if (!slot) return
    pending.delete(msg.id)
    armTimer()
    if (msg.ok) slot.resolve(msg.value)
    else slot.reject(new Error(msg.message))
    return
  }
  if (msg.kind === 'heartbeat') {
    // 宿主在等一个 api 调用（ask 等用户、wait 在睡）时会持续发心跳：
    // 「合法的慢」不该被自家的超时杀掉；超时只管「真的没进展」
    armTimer()
    return
  }
  if (msg.kind !== 'run') return
  run(msg.body, msg.timeoutMs)
}

function armTimer() {
  if (runTimer) clearTimeout(runTimer)
  // 只在已经在跑时续命；armTimer 被复用为「重设」而不是「新建」
  if (timerMs > 0) runTimer = setTimeout(onTimeout, timerMs)
}

let timerMs = 0

function onTimeout() {
  runTimer = null
  timerMs = 0
  self.postMessage({
    kind: 'done',
    ok: false,
    error: '沙箱超时：这段代码疑似死循环或太慢，请拆小重试',
  })
}

/*
 * 参数回传也要折：toWire 只覆盖节点门面自己方法的参数，普通 api 调用的 args 没人管——
 * 模型把节点对象、没 await 的 Promise（n.content 是 getter）或函数塞进参数，结构化克隆
 * 就在 postMessage 上炸，整批调用报废且报错指不到位置。这里深折一遍：
 * - 节点对象 → 只带 uuid（按身份传，与 toWire 的 connect 语义一致）；
 * - Promise / 函数 → 人话占位（调用照常发出，由各 api 自己的校验给「缺字段」的回执）。
 */
function foldArg(v, seen) {
  if (!v || typeof v !== 'object') {
    if (typeof v === 'function') return '［函数不能作为参数：把要传的值先算出来］'
    return v
  }
  if (v.__node === true) return v.uuid
  if (typeof v.then === 'function') return '［这是个没 await 的 Promise：先 await 拿到值再传］'
  if (seen.has(v)) return '［循环引用］'
  seen.add(v)
  if (Array.isArray(v)) {
    const out = v.map((x) => foldArg(x, seen))
    seen.delete(v)
    return out
  }
  const out = {}
  for (const k of Object.keys(v)) out[k] = foldArg(v[k], seen)
  seen.delete(v)
  return out
}

function call(name, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    let wire
    try {
      wire = { kind: 'call', id, name, args: foldArg(args, new Set()) }
      self.postMessage(wire)
    } catch (err) {
      // 仍有漏网的不可克隆值：与其甩一句 DataCloneError，不如点名是哪条调用、该怎么改
      reject(new Error('参数里有发不出去的值（' + (err && err.message ? err.message : '不可克隆') + '）：调用 ' + name + ' 的参数里出现了函数 / Promise / 节点对象。节点只传 uuid 字符串；Promise 先 await；要传内容就取它的纯数据字段。'))
      return
    }
  })
}

function groupHelp(key) {
  return API_HELP.groups[key] || '没有 api.' + key + ' 这一组。先 await api.__help() 看有哪些组。'
}

function apiHelp(full) {
  return API_HELP.apis[full] || '没有登记 api.' + full + '。先 await api.<组>.__help() 看这一组有哪些 api。'
}

function attachGroupHelp(obj, key) {
  if (obj && typeof obj.__help !== 'function') obj.__help = () => groupHelp(key)
  return obj
}

function attachApiHelp(fn, full) {
  fn.__help = () => apiHelp(full)
  return fn
}

function makeApi() {
  const api = {}
  for (const full of API_NAMES) {
    // ui.dom 走下面那条特判通道：它要传回调函数，结构化克隆带不过去
    if (full === 'ui.dom') continue
    const segs = full.split('.')
    if (segs.length === 1) {
      // 不带点的顶层 api（wait / ask / tiktok…）：直接挂在 api 上
      api[full] = attachApiHelp((...callArgs) => call(full, callArgs), full)
      continue
    }
    let cur = api
    for (let i = 0; i < segs.length - 1; i++) {
      cur = cur[segs[i]] || (cur[segs[i]] = {})
    }
    attachGroupHelp(api[segs[0]], segs[0])
    cur[segs[segs.length - 1]] = attachApiHelp((...callArgs) => call(full, callArgs), full)
  }
  // 根 help：组总览。api.<组>.__help() 与 api.<组>.<api>.__help() 都是同步返回的
  api.__help = () => API_HELP.root
  // 暴露全局 files、process 与 skill 变量，使得 await files.read(...) 与 await api.files.read(...) 均可直接调用
  if (api.files) {
    globalThis.files = api.files
  }
  if (api.process) {
    globalThis.process = api.process
  }
  if (api.skill) {
    globalThis.skill = api.skill
  }
  // 别名：api.web.fetch 指向 api.fetch
  if (api.fetch) {
    api.web = attachGroupHelp(api.web || {}, 'web')
    api.web.fetch = attachApiHelp((...callArgs) => api.fetch(...callArgs), 'web.fetch')
  }
  api.ui = attachGroupHelp(api.ui || {}, 'ui')
  /**
   * api.node.get(uuid)：节点对象门面。get 回 manifest（身份 + 关系快照），这里包成真对象：
   * content 是异步 getter（await n.content 每次取最新）；editContent / help / connect /
   * disconnect 走 node.invoke 通道（宿主记账、失败进清单）；connect / disconnect 的
   * 节点对象参数在发送前折成 uuid。与进程内门面（sandbox/nodeObject 的 attachNodeFacade）
   * 行为必须一致。
   */
  if (api.node && typeof api.node.get === 'function' && typeof api.node.invoke === 'function') {
    const channel = api.node
    // 先把宿主侧原始 get 摘下来再替换：channel 就是 api.node 本体，替换之后
    // channel.get 解析到的是包装器自己——每次 node.get 都无限递归（栈溢出）。
    // 与进程内门面（sandbox/nodeObject 的 attachNodeFacade）同一个坑，同一份教训。
    const rawGet = channel.get.bind(channel)
    const toWire = (args) =>
      args.map((a) => (a && typeof a === 'object' && typeof a.uuid === 'string' && a.__node === true ? a.uuid : a))
    const wrapManifest = (m) => {
      const obj = { uuid: m.uuid, kind: m.kind, title: m.title, relations: m.relations, __node: true }
      Object.defineProperty(obj, 'content', {
        get: () => channel.invoke(m.uuid, 'content', []),
        enumerable: true,
      })
      for (const name of ['editContent', 'help', 'connect', 'disconnect', 'getPortData']) {
        obj[name] = (...args) =>
          channel.invoke(m.uuid, name, toWire(args)).then((v) => (v && v.object === true ? wrapManifest(v) : v))
      }
      return obj
    }
    const wrapError = (errObj) => {
      const err = errObj && errObj.error ? String(errObj.error) : '获取节点失败'
      return {
        ok: false,
        error: err,
        __node: true,
        get content() {
          return Promise.resolve({ ok: false, error: err })
        },
        editContent: async () => ({ ok: false, error: err }),
        help: async () => ({ ok: false, error: err }),
        connect: async () => ({ ok: false, error: err }),
        disconnect: async () => ({ ok: false, error: err }),
        getPortData: async () => ({ ok: false, error: err }),
      }
    }
    api.node.get = (uuid) => Promise.resolve(rawGet(uuid)).then((v) => (v && v.object === true ? wrapManifest(v) : wrapError(v)))
  }
  /**
   * api.ui.dom(fn)：宿主先建一个「会话」，回调拿到的是一层**门面**（facade）——
   * 它的每个方法都回到宿主去操作文档区根元素。只暴露选择器级别的读写与点击，
   * 因为 DOM 节点本身同样无法穿过 Worker 边界。
   */
  api.ui.dom = attachApiHelp(async (fn) => {
    if (typeof fn !== 'function') {
      throw new Error('api.ui.dom 需要传入一个回调函数：await api.ui.dom(async (root) => { ... })')
    }
    const session = await call('ui.dom.session', [])
    const op = (name, args) => call('ui.dom.op', [session, name, args])
    const facade = {
      exists: (sel) => op('exists', [sel]),
      count: (sel) => op('count', [sel]),
      query: (sel) => op('query', [sel]),
      text: (sel, i) => op('text', [sel, i]),
      // attr 的参数序统一成 (sel, name, i?)，传给宿主前换成 domOp 的 (sel, i, name)
      attr: (sel, name, i) => op('attr', [sel, i === undefined ? 0 : i, name]),
      html: (sel, i) => op('html', [sel, i]),
      rect: (sel, i) => op('rect', [sel, i]),
      click: (sel, i) => op('click', [sel, i]),
    }
    return await fn(facade)
  }, 'ui.dom')
  api.log = (...args) => {
    const line = args
      .map((a) => {
        try {
          return typeof a === 'string' ? a : JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')
    call('log', [line]).catch(() => {})
  }

  return api
}

/**
 * 报错兜底提示：编排代码里出现了**已退役的组名**时，把「现在该怎么写」直接附在报错后面。
 * 只在真报错时按 body 命中；条目必须指向**当前真实存在**的 api——指向不存在的名字
 * 只会把模型的纠错路径也带偏（api.memory 是正式 api，绝不能出现在这张表里）。
 */
const DEPRECATED_HINTS = {
  docs: '没有 api.docs 这一组：读写内容先 api.node.get(uuid) 取节点对象，await n.content 读、n.editContent(...) 写（先 await n.help() 看这个节点怎么说）。',
  description: 'api.description 已退役：改描述走节点对象 const c = await n.content; c.description = 新描述; await n.editContent(c)。',
  review: '没有 api.review：复习计划写进大纲节点（api.node.get("o:"+文档uuid) 后 editContent），学习状态用 api.state.*。',
  retrieval: '没有 api.retrieval：联网检索请用 api.web.search。',
  note: '没有 api.note 这一组：笔记是节点——api.node.list() 查 uuid，api.node.get(uuid) 后 editContent({ text })。',
  stats: 'api.stats 不存在：阅读事实用 api.reading.*，注意力用 api.attention.get。',
  mind: 'api.mind 不存在：知识结构用 api.node.list() / api.node.get(uuid)，记忆用 api.memory.*。',
  checkin: 'api.checkin 不存在：没有打卡数据这一组。',
  plot: 'api.plot 不存在：图像请写进教学文档（```plot 围栏），静态素材用 api.res.*。',
  methods: 'api.methods 不存在：方法调用请用 api.method.call(name, ...args)。',
}

async function run(body, timeoutMs) {
  const started = Date.now()
  timerMs = timeoutMs
  armTimer()
  const api = makeApi()
  try {
    /*
     * 编译成「async 箭头 + 立即执行」的形状：
     *
     *   ((api)=>{ ... })     → 求值得到函数 → 带着 api 调它；
     *   ((api)=>{...})()     → 自己调过了 → 得到 Promise → 直接等它。
     *
     * 外面这层 async 是关键：model 写的函数体里能不能用 await，**只由这里决定**，
     * 跟它自己写没写 async 无关。早先直接 new Function('api', 'return (' + body + ')')
     * 时，await 能不能用取决于 body 自身的形状——同一句 await 时通时不通，
     * 那种不可预测比报错更糟。现在 await 无条件可用。
     */
    const evaluated = new Function('api', 'files', 'process', 'return (' + body + ')')()
    const raw = typeof evaluated === 'function' ? await evaluated(api, api.files, api.process) : await evaluated
    timerMs = 0
    clearTimeout(runTimer)
    runTimer = null
    /*
     * 结果要能过结构化克隆。两类东西天然过不去，分两步处理：
     * 1. **节点对象（__node 门面）**：content 是 getter（吐 Promise）、方法都是函数，
     *    克隆必炸。返回值里遇到就折成一份纯数据快照（uuid/kind/title/relations）——
     *    回执照样可读，模型要再用这个节点就按 uuid 重新 get。
     * 2. 其余不可克隆的（函数、裸 Promise）：换成一句可读的说明。
     */
    const foldNodes = (v, seen) => {
      if (!v || typeof v !== 'object') return v
      // __node 判定放在 seen 之前：节点对象折成快照就返回（终结点），不进路径也不该挡后面再次出现
      if (v.__node === true) {
        return { __node: true, uuid: v.uuid, kind: v.kind, title: v.title, relations: v.relations }
      }
      if (seen.has(v)) return '［循环引用］'
      seen.add(v)
      // seen 记的是「当前路径」而不是「见过的全部」：同一对象出现两次是重复，不是循环
      if (Array.isArray(v)) {
        const out = v.map((x) => foldNodes(x, seen))
        seen.delete(v)
        return out
      }
      const out = {}
      for (const k of Object.keys(v)) out[k] = foldNodes(v[k], seen)
      seen.delete(v)
      return out
    }
    let value
    try {
      const folded = foldNodes(raw, new Set())
      structuredClone(folded)
      value = folded
    } catch {
      value = typeof raw === 'function' ? '[函数] ' + String(raw).slice(0, 200) : String(raw)
    }
    self.postMessage({ kind: 'done', ok: true, value, ms: Date.now() - started })
  } catch (err) {
    timerMs = 0
    clearTimeout(runTimer)
    runTimer = null
    const e = err || {}
    const stack = typeof e.stack === 'string' ? String(e.stack) : ''
    const where = stack ? stack.split('\n').slice(0, 3).join(' | ') : ''
    let message = e.message ? String(e.message) : String(err)
    for (const [key, hint] of Object.entries(DEPRECATED_HINTS)) {
      const reg = new RegExp(`\\bapi\\.${key}\\b`)
      if (reg.test(body) || message.includes(`'${key}'`) || message.includes(`"${key}"`)) {
        message += `\n［提示：${hint}］`
        break
      }
    }
    self.postMessage({ kind: 'done', ok: false, error: message + (where ? '［' + where + '］' : '') })
  }
}
