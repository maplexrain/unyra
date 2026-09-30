import { tabIdNodeId } from './tabs'

/**
 * 暂存区：改了还没保存的正文。
 *
 * 为什么不让源码视图直接写进文档：那是**随改随存**（store 500ms 防抖落盘），于是
 * 「改了一半」与「改完了」在数据上没有任何区别——想放弃这半截改动只能一段段删回去，
 * Agent 也可能在你还没改完的时候就读到它。改成「先暂存、手动保存（Ctrl+S）」之后，
 * 「未保存」成了一个说得清的状态（页签上那颗圆点），保存则是一次明确的动作。
 *
 * 键就是页签 id（见 tabs 的 tabKey）：一份文档一个页签，两者的身份本来就是同一个。
 * 值是**整篇正文**，不做 diff：正文是几 KB 的 Markdown，整篇存下来最直白，
 * 也不会出现「补丁算错了」这类只有用户看得见的损坏。
 *
 * 它随 state.json 一起落盘（与页签、当前目标同一份文件，见 learn/files 的 buildState）：
 * 关掉应用再打开，没保存的改动还在，页签上那颗圆点也还在——这正是「暂存」与
 * 「内存里的一个变量」的区别。
 */
export type Drafts = Record<string, string>

/** 某个页签暂存的正文；没有就是「没改过」 */
export function draftOf(drafts: Drafts | undefined, id: string | null): string | undefined {
  if (!drafts || !id) return undefined
  return Object.prototype.hasOwnProperty.call(drafts, id) ? drafts[id] : undefined
}

/** 记一份暂存（调用方自己判「还是不是改动过」时用它） */
export function putDraft(drafts: Drafts, id: string, text: string): Drafts {
  if (drafts[id] === text) return drafts
  return { ...drafts, [id]: text }
}

/** 撤掉一份暂存：保存成功、或用户把它改回了原样 */
export function dropDraft(drafts: Drafts, id: string): Drafts {
  if (!Object.prototype.hasOwnProperty.call(drafts, id)) return drafts
  const next = { ...drafts }
  delete next[id]
  return next
}

/**
 * 记一笔改动，与**已保存的那一份**一模一样时把这一条删掉。
 *
 * 「有没有未保存的改动」只该有一个判据：暂存区里有没有这一条。于是用户把正文改回
 * 原样之后，页签上那颗圆点自己就消失了——不需要谁再拿两份正文去比对一次。
 */
export function stageDraft(drafts: Drafts, id: string, text: string, saved: string): Drafts {
  return text === saved ? dropDraft(drafts, id) : putDraft(drafts, id, text)
}

/** 一套页签没了（删笔记、删节点）：它的暂存也一并清掉，免得占着键、日后再撞上 */
export function dropDrafts(drafts: Drafts, ids: string[]): Drafts {
  if (!ids.length) return drafts
  let hit = false
  const next = { ...drafts }
  for (const id of ids) {
    if (!Object.prototype.hasOwnProperty.call(next, id)) continue
    delete next[id]
    hit = true
  }
  return hit ? next : drafts
}

/**
 * 改名：暂存跟着页签一起搬家。
 *
 * 页签 id 里含着笔记名（`n:{节点}:{名字}`），名字一换，键就对不上了——不搬的话，
 * 用户改到一半的正文会**留在一个谁也读不到的键上**：页签上那颗圆点没了，内容也回不来。
 */
export function moveDraft(drafts: Drafts, fromId: string, toId: string): Drafts {
  if (fromId === toId) return drafts
  if (!Object.prototype.hasOwnProperty.call(drafts, fromId)) return drafts
  const next = { ...drafts }
  const text = next[fromId]
  delete next[fromId]
  next[toId] = text
  return next
}

/**
 * 读回来的暂存区：键必须是字符串、值必须是字符串，其余一律丢掉。
 *
 * 指向已经不存在的节点的那些也丢掉（节点没了，它的正文再留着也没有意义）；
 * 本地文件**不查文件在不在**——查存在性要逐个访问磁盘，而这一步在启动的关键路径上，
 * 列表里的文件后来被删掉是常态，打开时报一句「文件不在了」代价小得多（同 localFiles）。
 */
export function normalizeDrafts(raw: unknown, nodeIds: Set<string>): Drafts {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Drafts = {}
  for (const [id, text] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || typeof text !== 'string') continue
    const nodeId = tabIdNodeId(id)
    if (nodeId && !nodeIds.has(nodeId)) continue
    out[id] = text
  }
  return out
}
