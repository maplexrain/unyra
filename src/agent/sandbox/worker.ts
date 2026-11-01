/**
 * 这个文件负责什么：真正跑沙箱的那一侧——起 Worker、把 api 调用转发回宿主、超时与心跳，
 * 外加 ui.dom 的宿主门面（Worker 通道与进程内直调共用同一份方法表）。
 */
import { domOp } from '../../lib/docDom'
import { SANDBOX_SOURCE } from '../sandboxWorker'
import type { SandboxReply, SandboxRequest } from './types'

/**
 * 旧 api 名 → 新写法。
 *
 * 模型照抄历史里的旧名字时会撞上「没有这个 api」，只给这一句它不知道下一步该写什么；
 * 这里把「叫什么」直接翻成「现在怎么写」。**条目必须是当前真不存在的名字**——
 * 还在的兼容 api 轮不到这张表，写了也只是死条目。
 */
export const RENAMED_API_HINT: Record<string, string> = {
  'graph.list': 'api.node.list()',
  'graph.read': 'api.node.get(uuid)（uuid 从 api.node.list() 查）',
  'graph.paths': 'api.node.list()（回执每项带 path，只作显示）',
  'graph.title': 'api.node.get(uuid).title',
  'graph.update': 'const n = await api.node.get(uuid); const c = await n.content; 改字段后 await n.editContent(c)',
  'graph.rename': 'const n = await api.node.get(uuid); const c = await n.content; c.title = 新标题; await n.editContent(c)',
  'graph.annotate': 'const c = await api.node.get(uuid).content; c.annotations 加一条 { term, body }; await n.editContent(c)',
  'graph.create': 'api.node.create({ kind: "doc", title, under: 父文档或其大纲的 uuid })',
  'graph.createTree': '循环调 api.node.create({ kind: "doc", ... }) 逐个建',
  'graph.delete': 'api.node.delete(uuid)',
  'graph.move': '旧大纲.disconnect(文档对象) 再 新大纲.connect(文档对象, "down")',
  'graph.relations': 'const n = await api.node.get(uuid); n.relations（上游 / 下游一目了然）',
  'doc.read': 'await api.node.get(uuid).content（teaching 字段就是正文）',
  'doc.readRange': 'const c = await api.node.get(uuid).content; c.teaching.slice(start, end)',
  'doc.find': 'const c = await api.node.get(uuid).content; c.teaching.indexOf("要找的")',
  'doc.write': 'const n = await api.node.get(uuid); const c = await n.content; c.teaching = 新正文; await n.editContent(c)',
  'doc.append': 'const n = await api.node.get(uuid); const c = await n.content; c.teaching += 追加内容; await n.editContent(c)',
  'doc.replace': 'const c = await api.node.get(uuid).content; c.teaching = c.teaching.slice(0, start) + 新内容 + c.teaching.slice(end); await n.editContent(c)',
  'note.read': 'await api.node.get(笔记uuid).content',
  'note.write': 'await api.node.get(笔记uuid).editContent({ text })',
  read_note: 'await api.node.get(笔记uuid).content',
  update_note: 'await api.node.get(笔记uuid).editContent({ text })',
  set_title: 'const n = await api.node.get(uuid); const c = await n.content; c.title = 新标题; await n.editContent(c)',
  rename_node: '同 set_title：editContent 整份写回（title 在 content 里）',
  create_node: 'api.node.create({ kind: "doc", title, under: 父的 uuid })',
  delete_node: 'api.node.delete(uuid)',
  list_nodes: 'api.node.list()',
  'content.read': 'await api.node.get(uuid).content',
  'content.write': 'await api.node.get(uuid).editContent(...)',
  'content.append': 'const c = await api.node.get(uuid).content; 拼接后 editContent 整份写回',
  'content.readRange': 'const c = await api.node.get(uuid).content; 按字段自行 slice',
  'content.find': 'const c = await api.node.get(uuid).content; 在对应字段里 indexOf',
  'content.replace': 'const c = await api.node.get(uuid).content; 改完 editContent 整份写回',
  'content.list': 'api.node.list()（每份文档的挂件清单都在回执里）',
  'content.remove': 'api.node.delete(超级文档uuid)',
  'outline.read': 'await api.node.get("o:" + 文档uuid).content',
  'outline.write': 'await api.node.get("o:" + 文档uuid).editContent({ intro, children })',
  'sdoc.list': 'api.node.list()（回执的 superdocs 数组带每份的 uuid）',
  'sdoc.read': 'await api.node.get(超级文档uuid).content（html 字段）',
  'sdoc.write': 'await api.node.get(超级文档uuid).editContent({ html })；新建用 api.node.create({ kind: "superdoc", under, title })',
  'sdoc.delete': 'api.node.delete(超级文档uuid)',
}

/* ---------- 真正跑沙箱 ---------- */

/** 默认执行器：起一个 Worker，把 api 调用转发回宿主 */
export function runInWorker(req: SandboxRequest): Promise<SandboxReply> {
  return new Promise((resolve) => {
    let worker: Worker
    /*
     * blob URL 要在收尾时撤销：它把整份沙箱源码钉在文档的 URL 表里，不撤就是每次
     * 执行漏一份（每次几 KB，重度使用一小时上百次）。撤销放在 terminate 之后——
     * Worker 已经起来了，这时再撤不影响它。
     */
    let url = ''
    try {
      url = URL.createObjectURL(new Blob([SANDBOX_SOURCE], { type: 'text/javascript' }))
      worker = new Worker(url)
    } catch (err) {
      if (url) URL.revokeObjectURL(url)
      resolve({ ok: false, error: '沙箱启动失败：' + (err instanceof Error ? err.message : String(err)) })
      return
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    let keepAlive: ReturnType<typeof setInterval> | null = null
    let pendingOps = 0
    const finish = (reply: SandboxReply) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (keepAlive) clearInterval(keepAlive)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(reply)
    }
    /**
     * 超时的语义是「**连续这么久没有 api 活动**」，不是「总共跑这么久」：
     * 宿主每次收到调用或回完结果都续一次命，Worker 侧靠心跳同步（见 sandboxRuntime）。
     * 原先按总时长掐，一次十几跳的合法编排（每跳都是毫秒级的 doc 读写）也会被杀；
     * 而 ask / wait 这类「等用户」的调用更是必须无限期等下去——有调用悬着就持续心跳，
     * 真正卡死的纯计算（一次都不调 api）依然会到点被 terminate。
     */
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(
        () => finish({ ok: false, error: '沙箱超时（' + req.timeoutMs + ' ms 没有进展），已中断执行' }),
        req.timeoutMs + 1500,
      )
    }
    arm()
    // 有调用悬着期间，每 3 秒给 Worker 发一次心跳（让它把自家的超时也续上），并给自己续命
    keepAlive = setInterval(() => {
      if (pendingOps > 0) {
        worker.postMessage({ kind: 'heartbeat' })
        arm()
      }
    }, 3000)
    worker.onerror = (ev) => finish({ ok: false, error: '沙箱出错：' + (ev.message || '未知错误') })
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as {
        kind?: string
        id?: number
        name?: string
        args?: unknown[]
        ok?: boolean
        value?: unknown
        error?: string
        ms?: number
      }
      if (msg.kind === 'call' && typeof msg.id === 'number') {
        pendingOps++
        req
          .callApi(msg.name ?? '', msg.args ?? [])
          .then((value) => {
            pendingOps--
            arm()
            worker.postMessage({ kind: 'reply', id: msg.id, ok: true, value })
          })
          .catch((err: unknown) => {
            pendingOps--
            arm()
            worker.postMessage({
              kind: 'reply',
              id: msg.id,
              ok: false,
              message: err instanceof Error ? err.message : String(err),
            })
          })
        return
      }
      if (msg.kind === 'done') {
        finish(msg.ok ? { ok: true, value: msg.value, ms: msg.ms ?? 0 } : { ok: false, error: msg.error ?? '沙箱执行失败' })
      }
    }
    worker.postMessage({ kind: 'run', body: req.body, timeoutMs: req.timeoutMs })
  })
}

/**
 * ui.dom 的宿主门面：root 上的每个方法都翻成一次 domOp。
 * Worker 通道（session/op 两步）与进程内直调通道共用这一份方法表。
 */
export function makeDomFacade(root: Element): Record<string, (...args: unknown[]) => unknown> {
  const call = (op: string) => (...args: unknown[]) => domOp(root, op, args)
  return {
    exists: call('exists'),
    count: call('count'),
    query: call('query'),
    text: call('text'),
    // attr 的第三个参数是属性名：签名是 attr(sel, name, i?)，与 domOp 的 (sel, i, name) 对齐
    attr: (sel: unknown, name: unknown, i?: unknown) => domOp(root, 'attr', [sel, i ?? 0, name]),
    html: call('html'),
    rect: call('rect'),
    click: call('click'),
  }
}