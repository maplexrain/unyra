import type { ContextSummary, Conversation, ConversationMessage } from '../agent/types'
import { t } from '../i18n'

/**
 * 上下文压缩（compaction）：**由 agent 自己写一份交接摘要**。
 *
 * 与上一版的分别（需求定的）：
 * - 以前是宿主另起一次「读旧稿写新稿」的模型请求（把整段历史渲染成稿子再让模型总结），
 *   压完保留最近 N 条原话；
 * - 现在是**一个工作流 + 一个 execute api**：导师本来就看得到整段上下文，让它直接把摘要写出来
 *   （api.compact），不再为了压缩多花一次「把历史再发一遍」的钱；
 *   压完全部旧消息**失活**（retired），一条原消息都不留——摘要就是第一条消息。
 *
 * 三条边界：
 * 1. **应用时机**：api.compact 只把摘要写进会话（pending: true）。把上下文从正在跑的循环底下
 *    抽走是不行的，所以真正的「失活 + 摘要成为第一条消息」发生在**本轮 agent loop 结束后**
 *    （见 useAgent 的 finally 与 applyCompaction）。
 * 2. **系统提示词不动**：摘要是一条 user 消息，拼在消息的最前面、系统提示词之后
 *    （见 summaryBlock 与 useAgent 的 toChatHistory）。系统提示词仍然固定在目标一级，
 *    服务端的前缀缓存才不会因为压缩而整段作废。
 * 3. **没做完的事要高保真**：摘要分两半——\`tasks\`（还没交付的事，逐条、带文件名/节点/卡在哪一步）
 *    与 \`text\`（正文摘要）。任务细节是压缩里最容易丢、也最要命的部分，所以它单独一个字段、
 *    拼进上下文时排在正文前面（见 summaryBlock）。
 */

/** 摘要至少这么长才算数：几十个字的「摘要」只说明它没干这件事 */
export const MIN_SUMMARY_CHARS = 80
/** 正文摘要的上限；超了截断（任务那半不截） */
export const MAX_SUMMARY_CHARS = 6000
/** 未完成的事最多几条、每条多少字 */
export const MAX_TASKS = 20
export const MAX_TASK_CHARS = 400
/**
 * 活着的消息少于这个数就别压了。
 *
 * 压一次要起一轮工作流（要花钱），而三四条消息本来就占不了多少上下文——
 * 压了省不下什么，还把刚说过的话变成了转述。
 */
export const MIN_ACTIVE_MESSAGES = 4

/** 一条消息有多少字（正文 + 工具结果 + 注入的模块全文；工具参数不算——它是过程，不是内容） */
export function messageChars(m: ConversationMessage): number {
  let n = 0
  for (const p of m.parts) {
    if (p.type === 'text' || p.type === 'thinking') n += p.text.length
    else if (p.type === 'tool') n += p.result.length
    else if (p.type === 'prompt-module') n += p.text.length
  }
  return n
}

/** 还活着的消息（没失活的）——真正进上下文的就是这些 */
export function activeMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.filter((m) => !m.retired)
}

/** 到阈值了、而且确实有东西可压：才值得起一轮压缩 */
export function shouldCompact(activeCount: number, ratio: number, threshold: number): boolean {
  return ratio >= threshold && activeCount >= MIN_ACTIVE_MESSAGES
}

/**
 * api.compact 的入参校验与摘要成形。
 *
 * 摘要太短直接拒绝：模型偶尔会「我压好了」然后交一句空话——那种摘要一旦生效，
 * 前文就真的没了。宁可让它重写一次（错误信息里说清楚要写什么）。
 */
export function buildSummary(
  input: { summary?: unknown; tasks?: unknown },
  now = Date.now(),
): { ok: true; summary: ContextSummary } | { ok: false; error: string } {
  const text = typeof input.summary === 'string' ? input.summary.trim() : ''
  if (!text) {
    return { ok: false, error: 'compact 需要 summary（交接摘要正文，Markdown）；未完成的事请放进 tasks' }
  }
  if (text.length < MIN_SUMMARY_CHARS) {
    return {
      ok: false,
      error: '摘要太短了（只有 ' + text.length + ' 字，至少 ' + MIN_SUMMARY_CHARS + ' 字）：压缩之后原始消息全部失活，摘要就是唯一的上下文。' +
        '请按「学习目标与背景 / 已经讲清的内容 / 学习者的状态 / 约定与术语」把这一段重写一遍。',
    }
  }
  const tasks = (Array.isArray(input.tasks) ? input.tasks : [])
    .map((t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_TASKS)
    .map((t) => (t.length > MAX_TASK_CHARS ? t.slice(0, MAX_TASK_CHARS) + '…' : t))
  const clipped = text.length > MAX_SUMMARY_CHARS ? text.slice(0, MAX_SUMMARY_CHARS) + '\n…（摘要过长，已截断）' : text
  return { ok: true, summary: { at: now, text: clipped, tasks, messages: 0, chars: 0, pending: true } }
}

/**
 * 应用一次压缩：**所有还活着的消息失活**，摘要成为第一条消息。
 *
 * 由宿主在**本轮 loop 结束后**调用（见 useAgent）。返回的 label 给界面用。
 * 没有 pending 的摘要时原样返回（幂等：重复调用不会把新消息也一起标掉——
 * 判据是 summary.pending，应用过一次就清了）。
 */
export function applyCompaction(conv: Conversation): { conv: Conversation; label: string } {
  const summary = conv.summary
  if (!summary || !summary.pending) return { conv, label: '' }
  const live = activeMessages(conv.messages)
  const messages = conv.messages.map((m) => (m.retired ? m : { ...m, retired: true }))
  const chars = live.reduce((n, m) => n + messageChars(m), 0)
  const next: ContextSummary = { ...summary, pending: false, messages: live.length, chars }
  return { conv: { ...conv, summary: next, messages }, label: compactLabel(next) }
}

/**
 * 摘要以一条 **user 消息**的形式接在历史最前面（系统提示词之后）。
 *
 * 不用 system：Anthropic 的中间系统消息不被接受，而这段摘要要跟着整段历史走，
 * 换协议就得换写法；也不用两条（用户+助手应答）——那会凭空多出一轮假对话。
 * 措辞里点明「原始消息已不再提供」，模型才不会去找「你上面说的第三点」。
 *
 * **未完成的事排在正文前面**：压缩之后最容易出事的就是「上次做到一半的那件事」，
 * 把它放在摘要正文之前，模型读完前几行就知道该接着干什么。
 */
export function summaryBlock(s: ContextSummary): string {
  const head =
    '【先前对话的压缩摘要】\n' +
    '下面这段是本段对话早先内容的摘要。那些原始消息**已不再随本次请求提供**，' +
    '但它们的内容与结论以下面的摘要为准，请当作你已经知道：'
  const tasks = s.tasks.length
    ? '\n\n## 还没做完的事（按原样接着做，不要重新开始）\n' + s.tasks.map((t) => '- ' + t).join('\n')
    : ''
  return head + tasks + '\n\n' + s.text.trim()
}

/** 界面上那条说明（对话顶部那张摘要卡与压缩完成的提示都用它） */
export function compactLabel(s: ContextSummary): string {
  const k = Math.max(1, Math.round(s.chars / 1000))
  const head = t('上下文已压缩：前面 {0} 条消息（约 {1}k 字）已折进摘要，只在对话里留作查看', s.messages, k)
  return head + (s.tasks.length ? t('；未完成的 {0} 件事按原样保留', s.tasks.length) : '')
}

/**
 * 读回一段对话时的**迁移**：把旧结构（throughId 那条分界）折算成新的「失活」标记。
 *
 * 不做全字段校验——对话消息的形状由写入方保证（这是项目里既有的约定，见 files.ts）。
 * 老的 ContextSummary 没有 tasks / pending：折算之后一律当作「已应用」。
 */
export function migrateConversation(raw: Conversation): Conversation {
  const s = raw.summary as unknown
  if (!s || typeof s !== 'object') return raw
  const old = s as Record<string, unknown>
  if (typeof old.throughId !== 'string') {
    // 已经是新结构：只保证 tasks 是数组（界面与 summaryBlock 都直接读它）
    return { ...raw, summary: { ...(s as ContextSummary), tasks: Array.isArray(old.tasks) ? (old.tasks as string[]) : [] } }
  }
  const at = raw.messages.findIndex((m) => m.id === old.throughId)
  const messages = at < 0 ? raw.messages : raw.messages.map((m, i) => (i <= at ? { ...m, retired: true as const } : m))
  const covered = at < 0 ? raw.messages.filter((m) => m.retired).length : at + 1
  const chars = raw.messages.slice(0, covered < 0 ? 0 : covered).reduce((n, m) => n + messageChars(m), 0)
  return {
    ...raw,
    messages,
    summary: {
      at: typeof old.at === 'number' ? old.at : 0,
      text: typeof old.text === 'string' ? old.text : '',
      tasks: [],
      messages: covered,
      chars,
    },
  }
}
