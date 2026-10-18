/**
 * 「定位源码」的一次性请求：预览里右键选中的那段文字，切到源码视图之后要**选中**它。
 *
 * 为什么要过一个模块级的槽：切视图是**换组件**——预览（NodeNote / LocalDoc）被卸载，
 * SourceEditor 挂载，两者之间没有一条父子链可以把「选哪一段」递过去；而请求又是
 * 「先放下、后取走」的时序（先 setTabView，编辑器才会挂载）。于是：
 * 切之前 `requestSourceReveal(key, …)` 放下，编辑器挂载时凭同一个 key `takeSourceReveal`。
 *
 * key 是**这份文档的身份**（节点 + 文档类型 + 笔记名，或本地文件的绝对路径），不是页签 id：
 * 同一份文档可能在两格、两个页签里各开着一份，谁先挂上谁取走，落点都是同一段源文。
 *
 * 带时间戳是因为槽是全局的：取走之前用户可能自己点了「源码」按钮——那次切换与这次请求
 * 毫无关系，不该突然跳去选中一段几分钟前选过的文字。过了保质期就当没有。
 */

/** 一次定位请求：源文里的字符区间 */
export interface SourceReveal {
  start: number
  end: number
  /** 放下的时刻（见文件头「带时间戳」那段） */
  at: number
}

/** 请求的保质期：从右键到编辑器挂载通常只有一帧，给足余量但不至于留到下一次手动切换 */
const REVEAL_TTL_MS = 4000

let pending: { key: string; reveal: SourceReveal } | null = null

/** 节点文档的身份键（教学文档与每一份笔记各算一份） */
export function nodeRevealKey(nodeId: string, kind: string, note?: string): string {
  return 'node:' + nodeId + ':' + kind + ':' + (note ?? '')
}

/** 本地文件的身份键 */
export function localRevealKey(path: string): string {
  return 'local:' + path
}

/** 放下一次请求（切视图之前调用） */
export function requestSourceReveal(key: string, start: number, end: number): void {
  pending = { key, reveal: { start, end, at: Date.now() } }
}

/**
 * 取走这次请求（SourceEditor 挂载时调用）。key 对不上、或已经过期，都返回 null——
 * 后者顺带把槽清掉，免得一条过期请求一直躺在那里等下一次切换。
 */
export function takeSourceReveal(key: string): SourceReveal | null {
  if (!pending || pending.key !== key) return null
  const reveal = pending.reveal
  pending = null
  return Date.now() - reveal.at <= REVEAL_TTL_MS ? reveal : null
}
