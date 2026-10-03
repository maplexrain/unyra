/**
 * 这个文件负责什么：**沙箱里能调到的全部 api 的定义**。buildApi 把 SandboxOptions 上的宿主能力
 * 逐个包成 api 方法（doc / node / state / tmp / exam / mind / method / sdoc / wf / code /
 * reading / attention / checkin / pomodoro / compact / web / userInfo / wait / ask /
 * tiktok / ui / res），wrapApi 负责记账与失败判定；每个 api 都是调用时才读 opts，不持有快照。
 */
import { needleForDoc } from '../../lib/docDom'
import { TmpVars, type TmpInfo } from '../../lib/tmpStore'
import type { MessageImage } from '../types'
import { normalizeAskForm } from './askForm'
import { compileBody } from './body'
import { MAX_LOGGED_CALLS, MAX_RESULT_CHARS } from './limits'
import { asExamPayload, asIndex, asOptionalPath, asRecord, asText } from './refs'
import type { DocRef, NodeRef } from './refs'
import type { SandboxCall, SandboxOptions } from './types'

/** 把结果裁到上限：宁可给模型一段被截断的内容，也不要它被 413 顶回来 */
export function clip(text: string, limit = MAX_RESULT_CHARS): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\n…（结果过长已截断，共 ' + text.length + ' 字符；可改用临时变量分段处理）'
}

/* ---------- 沙箱 api ---------- */

interface BuiltApi {
  api: Record<string, unknown>
  tmp: TmpVars | null
}

/**
 * api 的失败有两种表达方式：
 * - 抛异常：api 不存在、参数根本没法用；
 * - 返回 `{ ok:false }` 或 `{ error }`：路径找不到、位置校验失败这类「正常的失败」——
 *   它们必须当成值回给模型（它要读那句话才知道怎么改），所以不能抛。
 *
 * 因此这里两种都要认，否则失败计数只会数到抛异常那一类，
 * 「改了但没改成」会被当成一次成功的编排。
 */
function isFailedValue(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const r = v as { ok?: unknown; error?: unknown }
  return r.ok === false || typeof r.error === 'string'
}

/** api 返回值里夹带的图片引用（如 res.read 看了一张图）：见 ResourceOps 的说明 */
export function imagesOf(value: unknown): MessageImage[] {
  if (!value || typeof value !== 'object') return []
  const imgs = (value as { images?: unknown }).images
  return Array.isArray(imgs) ? (imgs as MessageImage[]) : []
}/**
 * 这次调用失败了吗——失败的话把那句话记进 record（供结果顶部那份清单用）。
 * `{ok:false}` 与 `{error}` 两种写法都认，见 isFailedValue。
 */
function markFailed(record: SandboxCall, value: unknown): void {
  if (!isFailedValue(value)) return
  record.ok = false
  const v = value as { content?: unknown; error?: unknown }
  const text = typeof v.content === 'string' ? v.content : typeof v.error === 'string' ? v.error : ''
  // 压成一行再截断：这句话要进结果顶部的清单，太长会把别的调用挤没
  if (text) record.message = text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** 把工具动作包成 api 方法：每次调用记一笔（供界面显示与结果顶部的失败清单），异常转成可读错误 */
function wrapApi(api: Record<string, unknown>, name: string, fn: (args: unknown[]) => unknown, log: SandboxCall[]) {
  const wrapped = (...args: unknown[]): unknown => {
    const record: SandboxCall = { name, ok: true }
    if (log.length < MAX_LOGGED_CALLS) log.push(record)
    try {
      const value = fn(args)
      // 异步 api（res.* 那一组要碰磁盘）：失败判定要等 promise 落地才知道
      if (value instanceof Promise) {
        return value.then(
          (settled) => {
            markFailed(record, settled)
            return settled
          },
          // 异步 api 抛出来的（文件系统出错之类）：也要记账，否则清单会说「全都成功了」
          (err: unknown) => {
            record.ok = false
            record.message = err instanceof Error ? err.message : 'api 调用失败'
            throw err
          },
        )
      }
      markFailed(record, value)
      return value
    } catch (err) {
      record.ok = false
      record.message = err instanceof Error ? err.message : 'api 调用失败'
      throw new Error(record.message)
    }
  }
  const dot = name.indexOf('.')
  if (dot < 0) {
    // 不带点的顶层 api（wait / tiktok…）：直接挂在 api 上，没有组这一层
    api[name] = wrapped
    return
  }
  const [group, method] = name.split('.')
  const bucket = (api[group] as Record<string, unknown>) ?? {}
  bucket[method] = wrapped
  api[group] = bucket
}

/**
 * 组装一次编排可用的 api。
 *
 * 全部按 path 寻址（见 SandboxOptions 的说明）：解析失败不抛异常，而是把「找不到 +
 * 候选清单」当成正常返回值交回去——模型读到就能自己改对，抛异常只会得到一句栈。
 */
export function buildApi(opts: SandboxOptions, log: SandboxCall[]): BuiltApi {  const api: Record<string, unknown> = {}
  const tmpView = opts.tmp?.()
  const tmp = tmpView ? new TmpVars(tmpView) : null

  const docRef = (path: unknown): { ref: DocRef } | { error: string } => {
    const r = opts.resolveDoc(asText(path))
    return r.ok ? { ref: r.ref } : { error: r.message }
  }
  const nodeRef = (path: unknown): { ref: NodeRef } | { error: string } => {
    const r = opts.resolveNode(asText(path))
    return r.ok ? { ref: r.ref } : { error: r.message }
  }
  /**
   * 只有一个参数的写法：模型很容易漏掉 path（尤其旧习惯里的 doc.append('内容')），
   * 这时按「当前节点的教学文档」理解，而不是把它当成一个节点标题去找。
   */
  const splitPathAndValue = (args: unknown[]): { path: string; value: string } =>
    args.length >= 2 ? { path: asText(args[0]), value: args[1] as string } : { path: '', value: args[0] as string }

  wrapApi(api, 'doc.read', (args) => {
    const r = docRef(args[0])
    if ('error' in r) return { error: r.error }
    const content = opts.docOps.read(r.ref.id, r.ref.kind, r.ref.note)
    return { path: r.ref.docLabel, doc: r.ref.kind, chars: content.length, content }
  }, log)

  wrapApi(api, 'doc.readRange', (args) => {
    const r = docRef(args[0])
    if ('error' in r) return { error: r.error }
    const content = opts.docOps.read(r.ref.id, r.ref.kind, r.ref.note)
    const start = asIndex(args[1] ?? (args.length > 1 ? args[1] : undefined)) ?? 0
    const end = asIndex(args[2]) ?? Math.min(content.length, start + 1500)
    return {
      path: r.ref.docLabel,
      text: content.slice(start, end),
      start,
      end: Math.min(end, content.length),
      total: content.length,
    }
  }, log)

  wrapApi(api, 'doc.find', (args) => {
    const r = docRef(args[0])
    if ('error' in r) return { error: r.error }
    const content = opts.docOps.read(r.ref.id, r.ref.kind, r.ref.note)
    const needle = asText(args[1])
    if (!needle) return { error: '要找的内容为空' }
    const opt = asRecord(args[2])
    const from = asIndex(opt.from) ?? 0
    const limit = Math.min(asIndex(opt.limit) ?? 10, 50)
    const hits: Array<{ start: number; end: number; around: string }> = []
    let idx = content.indexOf(needle, from)
    while (idx >= 0 && hits.length < limit) {
      hits.push({
        start: idx,
        end: idx + needle.length,
        around: content.slice(Math.max(0, idx - 40), Math.min(content.length, idx + needle.length + 40)),
      })
      idx = content.indexOf(needle, idx + Math.max(1, needle.length))
    }
    return { path: r.ref.docLabel, query: needle, total: content.length, matches: hits.length, hits }
  }, log)

  wrapApi(api, 'doc.write', (args) => {
    const { path, value } = splitPathAndValue(args)
    const r = docRef(path)
    if ('error' in r) return { error: r.error }
    return opts.docOps.write(r.ref.id, r.ref.kind, r.ref.note, asText(value))
  }, log)

  wrapApi(api, 'doc.replace', (args) => {
    // 文档类 api 的区间写法统一是 (path, { start, end, content, expected })
    const r = docRef(args[0])
    if ('error' in r) return { error: r.error }
    const a = asRecord(args[1])
    return opts.docOps.replace(r.ref.id, r.ref.kind, r.ref.note, {
      start: asIndex(a.start),
      end: asIndex(a.end),
      content: asText(a.content),
      expected: typeof a.expected === 'string' ? a.expected : undefined,
    })
  }, log)

  wrapApi(api, 'doc.append', (args) => {
    const { path, value } = splitPathAndValue(args)
    const r = docRef(path)
    if ('error' in r) return { error: r.error }
    return opts.docOps.append(r.ref.id, r.ref.kind, r.ref.note, asText(value))
  }, log)

  wrapApi(api, 'doc.annotate', (args) => {
    // 两种写法都收：doc.annotate({ term, body }) 与 doc.annotate(path, { term, body })
    const first = args[0]
    const payloadFirst = !!first && typeof first === 'object'
    const r = docRef(payloadFirst ? '' : first)
    if ('error' in r) return { error: r.error }
    const a = asRecord(payloadFirst ? first : args[1])
    return opts.docOps.annotate(r.ref.id, {
      term: asText(a.term),
      occurrence: asIndex(a.occurrence),
      // 正文允许几种写法：模型对字段名的猜测从来不止一种（同 exam.explain）
      body: asText(a.body ?? a.content ?? a.text),
    })
  }, log)

  wrapApi(api, 'node.list', () => opts.nodeOps.list(), log)

  wrapApi(api, 'node.read', (args) => {
    const r = nodeRef(args[0])
    if ('error' in r) return { error: r.error }
    return opts.nodeOps.read(r.ref.id)
  }, log)

  wrapApi(api, 'node.title', (args) => {
    const r = nodeRef(args[0])
    if ('error' in r) return { error: r.error }
    return { path: r.ref.label, id: r.ref.id, title: r.ref.title }
  }, log)

  wrapApi(api, 'node.rename', (args) => {
    const r = nodeRef(args[0])
    if ('error' in r) return { error: r.error }
    const title = asText(args[1]).trim()
    if (!title) return { error: '新标题不能为空' }
    return opts.nodeOps.update(r.ref.id, { title })
  }, log)

  wrapApi(api, 'node.update', (args) => {
    const r = nodeRef(args[0])
    if ('error' in r) return { error: r.error }
    const p = asRecord(args[1])
    const patch: { title?: string; description?: string; status?: 'learning' | 'mastered' } = {}
    if (typeof p.title === 'string' && p.title.trim()) patch.title = p.title.trim()
    if (typeof p.description === 'string') patch.description = p.description
    if (p.status === 'learning' || p.status === 'mastered') patch.status = p.status
    if (!Object.keys(patch).length) return { error: '没有给出要改的字段（title / description / status）' }
    return opts.nodeOps.update(r.ref.id, patch)
  }, log)

  wrapApi(api, 'node.create', (args) => {
    const first = args[0]
    // 两种写法都收：node.create({ title, parent, description }) 与 node.create('标题')
    const a = typeof first === 'string' ? { title: first } : asRecord(first)
    const title = asText(a.title).trim()
    if (!title) return { error: 'node.create 需要一个 title（新节点的标题）' }
    /*
     * parent 是**必填**的（2026-09 的口径收紧）：不再隐式建在「当前节点」之下。
     * 「在哪个节点下就在哪个节点下建」是隐患——上下文是目标级的，模型一轮里同时碰好几个
     * 节点，「当前」到底是哪一个，只有写明白路径才算数。从「当前」出发的写法一并拒掉：
     * 它只是隐式当前节点的另一种拼写。
     */
    const rawParent = typeof a.parent === 'string' ? a.parent.trim() : ''
    if (!rawParent) {
      return {
        error:
          'node.create 必须写明 parent（新建到哪个节点之下）：写一个标题（如 "极限"）、一段路径' +
          '（如 "微积分/极限"）或 #id。不再隐式建在「当前节点」之下——先 api.node.list() 挑准父节点。',
      }
    }
    const head = rawParent.split('/')[0]?.trim().toLowerCase() ?? ''
    if (['当前', '当前节点', '本节点', 'this', 'current', '.', '@'].includes(head)) {
      return {
        error:
          'parent 不要从「当前」出发（那还是隐式的）：写从目标根出发的路径（"父标题" 或 "上级/父标题"）' +
          '或 #id，指明新节点到底挂在哪个节点之下。',
      }
    }
    const pr = nodeRef(rawParent)
    if ('error' in pr) return { error: pr.error }
    return opts.nodeOps.create(pr.ref.id, {
      title,
      description: typeof a.description === 'string' ? a.description : undefined,
    })
  }, log)

  wrapApi(api, 'node.move', (args) => {
    const r = nodeRef(args[0])
    if ('error' in r) return { error: r.error }
    const pr = nodeRef(args[1])
    if ('error' in pr) return { error: pr.error }
    return opts.nodeOps.move(r.ref.id, pr.ref.id)
  }, log)

  wrapApi(api, 'node.delete', (args) => {
    const r = nodeRef(args[0])
    if ('error' in r) return { error: r.error }
    return opts.nodeOps.remove(r.ref.id)
  }, log)

  wrapApi(api, 'description.read', (args) => {
    const r = nodeRef(args[0])
    if ('error' in r) return { error: r.error }
    return { path: r.ref.label, description: (opts.nodeOps.read(r.ref.id) as { description?: string }).description ?? '' }
  }, log)

  wrapApi(api, 'description.update', (args) => {
    // 兼容只有内容的旧写法：description.update(内容) 改的是当前节点
    const hasPath = args.length >= 2
    const r = nodeRef(hasPath ? args[0] : '')
    if ('error' in r) return { error: r.error }
    const content = hasPath ? asText(args[1]) : asText(args[0])
    if (!content.trim()) return { error: '内容为空，未做修改' }
    return opts.nodeOps.update(r.ref.id, { description: content })
  }, log)

  if (opts.outline) {
    const outline = opts.outline
    wrapApi(api, 'outline.read', (args) => {
      const r = nodeRef(args[0])
      if ('error' in r) return { error: r.error }
      return outline.read(r.ref.id)
    }, log)

    wrapApi(api, 'outline.write', (args) => {
      // 两种写法都收：outline.write(path, { intro, children }) 与 outline.write({ intro, children })
      const first = args[0]
      const payloadFirst = !!first && typeof first === 'object'
      const r = nodeRef(payloadFirst ? '' : first)
      if ('error' in r) return { error: r.error }
      const a = asRecord(payloadFirst ? first : args[1])
      return outline.write(r.ref.id, { intro: a.intro, children: a.children })
    }, log)
  }

  if (opts.state) {
    const state = opts.state
    /**
     * path 可省略，与 doc.* 的约定一致；省略时作用在当前节点上。
     * 判据是「有没有第二个参数」——模型写 api.state.mistake('漏乘内部导数') 时
     * 那一个是错误说法，不是节点路径，按参数个数分比按形状猜更稳。
     */
    const target = (args: unknown[]): { id: string } | { error: string } => {
      const r = nodeRef(args.length >= 2 ? args[0] : '')
      return 'error' in r ? { error: r.error } : { id: r.ref.id }
    }
    const payload = (args: unknown[]): Record<string, unknown> => asRecord(args[args.length >= 2 ? 1 : 0])

    wrapApi(api, 'state.read', (args) => {
      const r = nodeRef(args.length ? args[0] : '')
      if ('error' in r) return { error: r.error }
      return state.read(r.ref.id)
    }, log)

    wrapApi(api, 'state.update', (args) => {
      const t = target(args)
      if ('error' in t) return { error: t.error }
      const p = payload(args)
      return state.update(t.id, { self: p.self, by: p.by, mastery: p.mastery, note: p.note })
    }, log)

    wrapApi(api, 'state.mistake', (args) => {
      const t = target(args)
      if ('error' in t) return { error: t.error }
      // 只给一个参数时它就是错误说法本身（最常见的写法），不是节点路径
      const raw = args.length < 2 && typeof args[0] === 'string' ? { pattern: args[0] } : payload(args)
      return state.mistake(t.id, { pattern: raw.pattern, cause: raw.cause, count: raw.count })
    }, log)

    wrapApi(api, 'state.forget', (args) => {
      const t = target(args)
      if ('error' in t) return { error: t.error }
      // 一个参数 = 只说错误说法（路径省略）；两个参数 = 路径 + 说法；不给 = 清空这一个节点的全部错误记忆
      const pattern = args.length >= 2 ? asText(args[1]) : args.length === 1 ? asText(args[0]) : ''
      return state.forget(t.id, pattern)
    }, log)

    wrapApi(api, 'state.check', (args) => {
      const t = target(args)
      if ('error' in t) return { error: t.error }
      return state.check(t.id, payload(args))
    }, log)
  }

  if (tmp) {
    // 局部别名：下面几个闭包里要的是「确定非空」的那一份
    const store = tmp
    wrapApi(api, 'tmp.set', (args) => {
      const a = asRecord(args[0])
      const key = asText(a.key)
      const ttl = typeof a.ttlMs === 'number' ? a.ttlMs : undefined
      store.set(key, a.value, ttl)
      return { ok: true, key, remainingMs: store.list().find((x) => x.key === key)?.remainingMs ?? null }
    }, log)
    wrapApi(api, 'tmp.get', (args) => {
      const key = asText(args[0])
      return { key, found: store.has(key), value: store.get(key) }
    }, log)
    wrapApi(api, 'tmp.has', (args) => ({ key: asText(args[0]), found: store.has(asText(args[0])) }), log)
    wrapApi(api, 'tmp.del', (args) => ({ key: asText(args[0]), deleted: store.del(asText(args[0])) }), log)
    wrapApi(api, 'tmp.list', (): { items: TmpInfo[] } => ({ items: store.list() }), log)
    wrapApi(api, 'tmp.clear', () => ({ removed: store.clear() }), log)
  }

  if (opts.exam) {
    const exam = opts.exam
    wrapApi(api, 'exam.create', (args) => exam.create(asExamPayload(args[0])), log)
    // 读卷可以指名某一次考试（历史记录里的 attemptId）：判分与错题讲解都要看历史
    wrapApi(api, 'exam.read', (args) => exam.read(asText(args[0]).trim() || undefined), log)
    wrapApi(api, 'exam.grade', (args) => exam.grade(asRecord(args[0])), log)
    wrapApi(api, 'exam.explain', (args) => exam.explain(asRecord(args[0])), log)
    // 只认一个可选的 id：省略就是「最新那份」，模型通常不记 id
    wrapApi(api, 'exam.delete', (args) => exam.remove(asRecord(args[0])), log)
  }

  if (opts.mind) {
    const mind = opts.mind
    wrapApi(api, 'mind.list', () => mind.list(), log)
    wrapApi(api, 'mind.read', (args) => mind.read(asText(args[0]).trim()), log)
    wrapApi(api, 'mind.write', (args) => mind.write(args.length && typeof args[0] === 'object' ? args[0] : args[0]), log)
    wrapApi(api, 'mind.delete', (args) => mind.delete(asText(args[0]).trim()), log)
    wrapApi(api, 'mind.clear', () => mind.clear(), log)
  }

  if (opts.methods) {
    const m = opts.methods
    wrapApi(api, 'method.list', () => m.list(), log)
    wrapApi(api, 'method.create', (args) => m.create(asRecord(args[0])), log)
    wrapApi(api, 'method.delete', (args) => m.remove(asText(args[0]).trim()), log)
    wrapApi(api, 'method.call', (args) => {
      const name = asText(args[0]).trim()
      const entry = m.find(name)
      if (!entry) {
        const names = m.list() as { items?: Array<{ name: string }> }
        const have = names.items?.map((x) => x.name).join('、') ?? ''
        return {
          error:
            '没有叫「' + name + '」的函数。' +
            (have ? '现有的：' + have + '。' : '这个目标还一个函数都没有（method.create 先建一个）。'),
        }
      }
      /**
       * 执行就发生在宿主这一侧：编译持久化的源码、把**当前这次编排的 api** 交给它。
       * 函数体里 await api.doc.read(...) 用的就是这份 api——它与编排里的其它调用
       * 看到同一个 store，读写顺序与书写顺序一致。
       */
      const compiled = compileBody(entry.code)
      if (!compiled.ok) return { error: '「' + entry.name + '」的代码编译不过：' + compiled.content }
      try {
        const fn = new Function('api', 'return (' + compiled.body + ')')() as
          | ((...a: unknown[]) => unknown)
          | null
        if (typeof fn !== 'function') return { error: '「' + entry.name + '」不是一段函数源码' }
        return fn(api, ...args.slice(1))
      } catch (err) {
        return { error: '「' + entry.name + '」执行失败：' + (err instanceof Error ? err.message : String(err)) }
      }
    }, log)
  }

  if (opts.superdocs) {
    const sd = opts.superdocs
    wrapApi(api, 'sdoc.list', (args) => {
      const r = nodeRef(args[0])
      if ('error' in r) return { error: r.error }
      return sd.list(r.ref.id)
    }, log)
    wrapApi(api, 'sdoc.read', (args) => {
      const r = nodeRef(args[0])
      if ('error' in r) return { error: r.error }
      return sd.read(r.ref.id, asText(args[1]).trim())
    }, log)
    wrapApi(api, 'sdoc.write', (args) => {
      const r = nodeRef(args[0])
      if ('error' in r) return { error: r.error }
      return sd.write(r.ref.id, asText(args[1]).trim() || undefined, asText(args[2]))
    }, log)
    wrapApi(api, 'sdoc.delete', (args) => {
      const r = nodeRef(args[0])
      if ('error' in r) return { error: r.error }
      return sd.remove(r.ref.id, asText(args[1]).trim())
    }, log)
  }

  if (opts.workflows) {
    const wfs = opts.workflows
    wrapApi(api, 'wf.list', () => wfs.list(), log)
    wrapApi(api, 'wf.create', (args) => wfs.create(asRecord(args[0])), log)
    wrapApi(api, 'wf.remove', (args) => wfs.remove(asText(args[0]).trim()), log)
  }

  // 代码块伪编译：导师把转译好的 JS 交回宿主（见 lib/codeArtifacts）
  if (opts.code) {
    const code = opts.code
    wrapApi(api, 'code.save', (args) => code.save(asRecord(args[0])), log)
    wrapApi(api, 'code.silent', (args) => code.silent(asRecord(args[0])), log)
  }

  // 有效阅读 / 注意力 / 打卡 / 番茄钟：学习过程那一组（见 learn/reading 等）
  if (opts.reading) {
    const reading = opts.reading
    wrapApi(api, 'reading.get', (args) => reading.get(asOptionalPath(args[0])), log)
    wrapApi(api, 'reading.list', () => reading.list(), log)
    wrapApi(api, 'reading.day', (args) => reading.day(asText(args[0]).trim() || undefined), log)
  }
  if (opts.attention) {
    const attention = opts.attention
    wrapApi(api, 'attention.get', (args) => attention.get(asOptionalPath(args[0])), log)
  }
  if (opts.checkin) {
    const checkin = opts.checkin
    wrapApi(api, 'checkin.status', () => checkin.status(), log)
    wrapApi(api, 'checkin.settle', (args) => checkin.settle(asRecord(args[0])), log)
  }
  // 间隔复习：计划是系统建的（节点首次变 mastered），这里只有读计划 / 落账 / 经用户同意的调整
  if (opts.review) {
    const review = opts.review
    wrapApi(api, 'review.read', (args) => review.read(asOptionalPath(args[0])), log)
    wrapApi(api, 'review.record', (args) => review.record(asRecord(args[0])), log)
    wrapApi(api, 'review.merge', (args) => review.merge(asRecord(args[0])), log)
    wrapApi(api, 'review.extend', (args) => review.extend(asRecord(args[0])), log)
    wrapApi(api, 'review.adjust', (args) => review.adjust(asRecord(args[0])), log)
  }
  if (opts.pomodoro) {
    const pomodoro = opts.pomodoro
    wrapApi(api, 'pomodoro.status', () => pomodoro.status(), log)
  }
  // 工作区目录：节点的真实系统目录（见 learn/workspace），只收文本
  if (opts.workspace) {
    const ws = opts.workspace
    wrapApi(api, 'workspace.list', (args) => ws.list(asOptionalPath(args[0])), log)
    wrapApi(api, 'workspace.read', (args) => ws.read(asOptionalPath(args[0])), log)
    wrapApi(api, 'workspace.write', (args) => ws.write(asRecord(args[0])), log)
  }
  // 上下文压缩：摘要由 agent 自己写（见 learn/compact）
  if (opts.compact) {
    const compactOps = opts.compact
    wrapApi(api, 'compact', (args) => compactOps.write(asRecord(args[0])), log)
  }
  // 读网页：抓取与落盘都在界面层（见 learn/webDocs），这里只是几个入口
  if (opts.web) {
    const web = opts.web
    wrapApi(api, 'web.webFetch', (args) => web.fetch(asText(args[0]).trim()), log)
    wrapApi(api, 'web.read', (args) => web.read(asText(args[0]).trim(), asText(args[1]).trim() || undefined), log)
    // 多引擎搜索（见 learn/webSearch）：不注入 search 就没有这一条（子代理按 apiAllow 决定）
    if (web.search) {
      const webSearch = web.search
      wrapApi(api, 'web.search', (args) => {
        const a = asRecord(args[1])
        return webSearch(asText(args[0]).trim(), a)
      }, log)
    }
  }

  // 内置浏览器（browser.*，见 learn/web/browserOps）：界面上开着的网页页签的打开、
  // 管理、快照/阅读与受控 DOM 操作（看=snapshot/read，动手=dom，突出=point）。
  // 依赖界面注入（webview 元素在渲染层），未注入就没有这一组。
  if (opts.browser) {
    const browser = opts.browser
    wrapApi(api, 'browser.open', (args) => browser.open(asText(args[0]).trim()), log)
    wrapApi(api, 'browser.tabs', () => browser.tabs(), log)
    wrapApi(api, 'browser.activate', (args) => browser.activate(asText(args[0]).trim()), log)
    wrapApi(api, 'browser.close', (args) => browser.close(asText(args[0]).trim()), log)
    wrapApi(api, 'browser.snapshot', (args) => browser.snapshot(args.length ? asText(args[0]).trim() || undefined : undefined), log)
    /*
     * 带目标的方法（point）收两种写法：方法(目标) 与 方法(tabId, 目标)。
     * tabId 一定是 tabs() 回的 w: 开头的 id，而 CSS 选择器不可能以 w: 开头，
     * 凭这个区分第一参是不是页签。
     */
    const tabIdOf = (v: unknown): string | undefined =>
      typeof v === 'string' && v.startsWith('w:') ? v : undefined
    const targetOf = (v: unknown): string | { ref: number } => {
      if (typeof v === 'string' && v.trim()) return v.trim()
      const o = asRecord(v)
      if (typeof o.ref === 'number') return { ref: o.ref }
      throw new Error('目标要给 browser.snapshot 清单里的 { ref } 或 CSS 选择器字符串')
    }
    wrapApi(api, 'browser.point', (args) => {
      const tabId = tabIdOf(args[0])
      const rest = tabId ? args.slice(1) : args
      return browser.point(tabId, targetOf(rest[0]))
    }, log)
    // dom 两种写法：dom(ref, op, arg?) 与 dom(tabId, ref, op, arg?)
    wrapApi(api, 'browser.dom', (args) => {
      const tabId = tabIdOf(args[0])
      const rest = tabId ? args.slice(1) : args
      const ref = Number(rest[0])
      if (!Number.isFinite(ref)) throw new Error('ref 要给 browser.snapshot 清单里的编号数字')
      const arg = rest[2] === undefined ? undefined : asText(rest[2])
      return browser.dom(tabId, ref, asText(rest[1]).trim(), arg)
    }, log)
    wrapApi(api, 'browser.read', (args) => browser.read(args.length ? asText(args[0]).trim() || undefined : undefined), log)
    wrapApi(api, 'browser.capture', (args) => browser.capture(args.length ? asText(args[0]).trim() || undefined : undefined), log)
  }

  // 学习者画像：get 回给模型看的那份（不含头像），update 是增量的（只写传进来的字段）
  if (opts.userInfo) {
    const userInfo = opts.userInfo
    wrapApi(api, 'userInfo.get', () => userInfo.get(), log)
    wrapApi(api, 'userInfo.update', (args) => userInfo.update(asRecord(args[0])), log)
  }

  // 阻塞等待：范围收在 0~120000，长睡只会让用户以为卡死了
  if (opts.wait) {
    const wait = opts.wait
    wrapApi(api, 'wait', (args) => {
      const raw = typeof args[0] === 'number' ? args[0] : Number(args[0])
      const ms = Number.isFinite(raw) ? Math.min(120_000, Math.max(0, Math.round(raw))) : 0
      return wait(ms).then(() => ({ ok: true, waited: ms }))
    }, log)
  }

  // 结构化表单：形状先归一化，校验失败把「第几题、哪个字段」说清楚再回给模型
  if (opts.ask) {
    const ask = opts.ask
    wrapApi(api, 'ask', (args) => {
      const parsed = normalizeAskForm(args[0])
      if (!parsed.ok) return parsed
      return ask(parsed.form)
    }, log)
  }

  if (opts.tiktok) {
    const tiktok = opts.tiktok
    wrapApi(api, 'tiktok', () => Promise.resolve(tiktok()).then(() => ({ ok: true, note: '已响铃' })), log)
  }

  if (opts.ui) {
    const ui = opts.ui
    if (ui.switchMain) {
      const switchMain = ui.switchMain
      wrapApi(api, 'ui.switchMain', (args) => {
        const main = asText(args[0])
        if (main !== 'agent' && main !== 'doc') {
          return { error: "main 只认 'agent'（对话栏放主位）或 'doc'（文档栏放主位），收到「" + main + "」" }
        }
        switchMain(main)
        return { ok: true, main, note: main === 'agent' ? '对话栏已换到主位' : '文档栏已换到主位' }
      }, log)
    }
    if (ui.toast) {
      const toast = ui.toast
      wrapApi(api, 'ui.toast', (args) => {
        const message = asText(args[0]).trim()
        if (!message) return { error: '消息不能为空' }
        toast(message.slice(0, 200))
        return { ok: true }
      }, log)
    }
    if (ui.point) {
      const point = ui.point
      wrapApi(api, 'ui.point', async (args) => {
        /**
         * 两种写法都收：ui.point(path, { line, regex }) 与 ui.point({ path, line, regex })。
         * path 省略 = 当前节点的教学文档（与 doc.* 的约定一致）。
         */
        const obj = asRecord(args.length === 1 ? args[0] : args[1])
        const path = args.length === 1 ? asText(obj.path) : asText(args[0])
        const r = docRef(path)
        if ('error' in r) return { error: r.error }
        const ref = r.ref
        const content = opts.docOps.read(ref.id, ref.kind, ref.note)
        // 行号 → 定位文字 + 比例兜底：这一套规则与文档跳转语法（moji:doc/…#L12）共用，
        // 见 lib/docDom 的 needleForDoc
        const byLine = needleForDoc(content, { line: asIndex(obj.line) })
        let needle = byLine.needle ?? ''
        let fallbackRatio: number | undefined = byLine.fallbackRatio
        const pattern = asText(obj.regex)
        if (!needle && pattern) {
          try {
            const flags = asText(obj.flags)
            const m = new RegExp(pattern, flags).exec(content)
            if (m && m[0]) {
              needle = m[0].replace(/\s+/g, ' ').trim().slice(0, 160)
              fallbackRatio = m.index / Math.max(1, content.length)
            }
          } catch (err) {
            return { error: '正则不合法：' + (err instanceof Error ? err.message : String(err)) }
          }
        }
        const res = await point({
          nodeId: ref.id,
          kind: ref.kind,
          ...(ref.note ? { note: ref.note } : {}),
          ...(needle ? { needle } : {}),
          ...(fallbackRatio !== undefined ? { fallbackRatio } : {}),
        })
        return {
          ok: true,
          path: ref.docLabel,
          located: res.located,
          note: res.located
            ? '已在页签里打开并定位，用户看得到。'
            : '文档已打开；没能在正文里精确选中（这一行可能是公式或代码），已按大致位置滚动。要指给用户看，请说明去看什么。',
        }
      }, log)
    }
    if (ui.scroll) {
      const scroll = ui.scroll
      wrapApi(api, 'ui.scroll', (args) => {
        const a = asRecord(args[0])
        const to = a.to === 'top' || a.to === 'bottom' ? a.to : undefined
        const by = typeof a.by === 'number' ? Math.max(-20_000, Math.min(20_000, Math.round(a.by))) : undefined
        if (!to && !by) return { error: "要给出方向：ui.scroll({ to: 'top' | 'bottom' }) 或 ui.scroll({ by: 像素，负数往上 })" }
        scroll({ ...(to ? { to } : {}), ...(by !== undefined ? { by } : {}) })
        return { ok: true }
      }, log)
    }
    if (ui.capture) {
      const capture = ui.capture
      wrapApi(api, 'ui.screenshot', () => capture(), log)
    }
    if (ui.openSuper) {
      const openSuper = ui.openSuper
      wrapApi(api, 'ui.superdoc', async (args) => {
        // 两种写法都收：ui.superdoc(path, name) 与 ui.superdoc({ path, name })
        const obj = asRecord(args.length === 1 ? args[0] : args[1])
        const path = args.length === 1 ? asText(obj.path) : asText(args[0])
        const name = (args.length === 1 ? asText(obj.name) : asText(args[1])).trim()
        if (!name) return { error: '要给出超级文档的名字：ui.superdoc(path?, name)' }
        const r = nodeRef(path)
        if ('error' in r) return { error: r.error }
        const res = await openSuper({ nodeId: r.ref.id, name })
        return {
          ok: true,
          opened: res.opened,
          note: res.opened
            ? '已在页签里打开「' + name + '」，用户看得到。'
            : '这个节点下没有叫「' + name + '」的超级文档，页签没有开。用 api.sdoc.list(path) 核对名字，或先用 sdoc.write 写一份。',
        }
      }, log)
    }
    // ui.dom 不在这里注册：回调函数无法穿过 Worker 边界，Worker 侧特判成
    // 「先建会话、再逐个操作」（见 sandboxRuntime 与 createExecuteTool 的 callApi）
  }

  if (opts.resources) {
    const res = opts.resources
    const uuid = (v: unknown): string => asText(v).trim()
    wrapApi(api, 'res.list', () => res.list(), log)
    wrapApi(api, 'res.info', (args) => res.info(uuid(args[0])), log)
    wrapApi(api, 'res.read', (args) => {
      // 区间写法与 doc.readRange 一致：res.read(uuid, { start, end })
      const a = asRecord(args[1])
      return res.read(uuid(args[0]), { start: asIndex(a.start), end: asIndex(a.end) })
    }, log)
    wrapApi(api, 'res.create', (args) => {
      const a = asRecord(args[0])
      return res.create({ name: asText(a.name), ext: asText(a.ext), content: asText(a.content) })
    }, log)
    wrapApi(api, 'res.update', (args) => {
      const p = asRecord(args[1])
      const patch: { name?: string; description?: string; content?: string } = {}
      if (typeof p.name === 'string') patch.name = p.name
      if (typeof p.description === 'string') patch.description = p.description
      if (typeof p.content === 'string') patch.content = p.content
      return res.update(uuid(args[0]), patch)
    }, log)
    wrapApi(api, 'res.delete', (args) => {
      // res.delete(uuid, { force: true }) 与 res.delete(uuid, true) 都收
      const force = args[1] === true || asRecord(args[1]).force === true
      return res.remove(uuid(args[0]), force)
    }, log)
    wrapApi(api, 'res.refs', (args) => res.refs(args.length ? uuid(args[0]) : undefined), log)
  }

  // 子代理管理（subagent.*）：**导师专用**——SUBAGENT_ALLOWED_GROUPS 里没有这一组，
  // 子代理的 apiAllow 白名单永远放不进来（不递归在通道口硬挡）。实现在 subagent/manager。
  if (opts.subagent) {
    const sa = opts.subagent
    wrapApi(api, 'subagent.create', (args) => sa.create(asRecord(args[0])), log)
    wrapApi(api, 'subagent.run', (args) => sa.run(asRecord(args[0])), log)
    wrapApi(api, 'subagent.resume', (args) => sa.resume(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.intervene', (args) => sa.intervene(asText(args[0]).trim(), asText(args[1])), log)
    wrapApi(api, 'subagent.interrupt', (args) => sa.interrupt(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.view', (args) => sa.view(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.delete', (args) => sa.remove(asText(args[0]).trim()), log)
    wrapApi(api, 'subagent.wait', (args) => sa.wait(asRecord(args[0])), log)
  }

  return { api, tmp }
}