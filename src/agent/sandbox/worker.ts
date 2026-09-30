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
 * 文档模型与寻址方式一起改过（note.* 变成带 path 的 doc.*），而对话历史里还留着
 * 上一版的名字：模型照抄旧调用时会撞上「没有这个 api」，只给这一句它不知道下一步该写什么。
 * 这里把「叫什么」直接翻成「现在怎么写」。
 */
export const RENAMED_API_HINT: Record<string, string> = {
  'note.read': 'doc.read(path)',
  'note.readRange': 'doc.readRange(path, start, end)',
  'note.replace': 'doc.replace(path, { start, end, content, expected })',
  'note.append': 'doc.append(path, content)',
  'note.write': 'doc.write(path, content)',
  'note.update': 'doc.write(path, content)',
  'doc.list': 'node.read(path)（里面列出该节点的文档与字数）',
  'doc.search': 'doc.find(path, 要查的文字)',
  read_note: 'doc.read(path)',
  read_note_range: 'doc.readRange(path, start, end)',
  update_note: 'doc.write(path, content)',
  update_note_range: 'doc.replace(path, { start, end, content, expected })',
  set_title: 'node.rename(path, title)',
  rename_node: 'node.rename(path, title)',
  create_node: 'node.create({ parent, title, description })',
  delete_node: 'node.delete(path)',
  list_nodes: 'node.list()',
}

/* ---------- 真正跑沙箱 ---------- */

/** 默认执行器：起一个 Worker，把 api 调用转发回宿主 */
export function runInWorker(req: SandboxRequest): Promise<SandboxReply> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      const url = URL.createObjectURL(new Blob([SANDBOX_SOURCE], { type: 'text/javascript' }))
      worker = new Worker(url)
    } catch (err) {
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