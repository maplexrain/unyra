/** 对话的反序列化：消息、部件、引用、图片、附件、摘要、用量，以及旧数据里 nodeId → goalId 的折算。 */

import type {
  AgentPart,
  ContextSummary,
  Conversation,
  ConversationMessage,
  MessageFile,
  MessageImage,
  MessageQuote,
  MessageUsage,
} from '../../../agent/types'
import { applyCompaction } from '../../compact'
import { recoverInterruptedTurn } from '../../agent/inflight'

function normalizeQuote(raw: unknown): MessageQuote | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = typeof r.text === 'string' ? r.text.trim() : ''
  if (!text) return null
  const quote: MessageQuote = { text }
  if (typeof r.start === 'number' && Number.isFinite(r.start)) quote.start = r.start
  if (typeof r.end === 'number' && Number.isFinite(r.end)) quote.end = r.end
  return quote
}

/**
 * 消息里的一张图片附件（消息自己的、或工具附带回的，两处同一形状）。
 * 只认**完整**的那几条：id、rel 缺一不可——半条记录读回来只会在发请求时变成一张
 * 读不到的空图，不如当场丢掉。
 */
function normalizeImage(raw: unknown): MessageImage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  const rel = typeof r.rel === 'string' ? r.rel : ''
  if (!id || !rel) return null
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    id,
    rel,
    name: typeof r.name === 'string' ? r.name : '',
    mime: typeof r.mime === 'string' && r.mime ? r.mime : 'image/png',
    bytes: num(r.bytes),
    // 尺寸可以缺：由资源库挂上来的图只从清单里拿到字节数，没有量过像素
    ...(typeof r.width === 'number' && typeof r.height === 'number'
      ? { width: num(r.width), height: num(r.height) }
      : {}),
  }
}

function normalizeImages(raw: unknown): MessageImage[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeImage).filter((img): img is MessageImage => img !== null)
}

/**
 * 消息里的**文件**附件（见 agent/types 的 MessageFile）。两种情况：
 *
 * - 文本附件：uuid + rel 一对，正文在资源库里，每一轮发请求前按它读回来
 *   （见 useAgent 的 loadAttachTexts）。缺一个就再也读不回来：那一对不留，
 *   只留名字与体积——模型至少知道「他附过一份东西」；
 * - 二进制附件：本来就没有 uuid/rel（字节对模型没用，没进资源库），只有名字与体积。
 *
 * 名字是唯一的必填项：没有名字的附件在气泡里只是一个空框。
 */
function normalizeFiles(raw: unknown): MessageFile[] {
  if (!Array.isArray(raw)) return []
  const out: MessageFile[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name : ''
    if (!name) continue
    const uuid = typeof r.uuid === 'string' ? r.uuid : ''
    const rel = typeof r.rel === 'string' ? r.rel : ''
    out.push({
      name,
      bytes: typeof r.bytes === 'number' && Number.isFinite(r.bytes) ? r.bytes : 0,
      ...(uuid && rel ? { uuid, rel } : {}),
      ...(typeof r.chars === 'number' && Number.isFinite(r.chars) ? { chars: r.chars } : {}),
      ...(r.truncated === true ? { truncated: true } : {}),
      ...(r.binary === true ? { binary: true } : {}),
    })
  }
  return out
}

/**
 * 会话上的压缩摘要（见 learn/compact）。
 *
 * 正文空的不算：summaryBlock 会把它整段拼进上下文，一份没正文的「摘要」比没有更糟。
 * 没有 tasks 的（老结构、或模型一件没记）给空数组——界面与 summaryBlock 都直接读它。
 */
function normalizeSummary(raw: unknown): ContextSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const text = typeof r.text === 'string' ? r.text : ''
  if (!text.trim()) return undefined
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  return {
    at: num(r.at),
    text,
    tasks: Array.isArray(r.tasks) ? r.tasks.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [],
    messages: num(r.messages),
    chars: num(r.chars),
    ...(r.pending === true ? { pending: true } : {}),
  }
}

/**
 * 在途轮次标记（见 agent/types 的 Conversation.inflight）：进程被杀时它还留在盘上，
 * 载入据此做中断恢复。残缺的按没有处理——恢复判据宁可缺失也不可误报。
 */
function normalizeInflight(raw: unknown): Conversation['inflight'] {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.messageId !== 'string' || !r.messageId) return undefined
  return { messageId: r.messageId, startedAt: typeof r.startedAt === 'number' ? r.startedAt : 0 }
}

function normalizePart(raw: unknown): AgentPart | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // 跳边界标记（见 agent/types 的 hop 说明）：必须原样保留，否则读回来之后
  // 多跳回合会退化成「整轮一条」还原，与重启前实发的结构对不上
  if (r.type === 'hop') return { type: 'hop' }
  if (r.type === 'thinking' && typeof r.text === 'string') return { type: 'thinking', text: r.text }
  if (r.type === 'text' && typeof r.text === 'string') return { type: 'text', text: r.text }
  if (r.type === 'notice' && typeof r.text === 'string') {
    return { type: 'notice', level: r.level === 'info' ? 'info' : 'warn', text: r.text }
  }
  if (r.type === 'tool' && typeof r.name === 'string') {
    // 工具附带回的图（res.read 看了一张图、ui.screenshot 截了一张）也要还原：
    // 它们在 toChatHistory 里会被重新拼成一条带图的 user 消息，丢一张就等于那一步的
    // 历史与上一轮实发的对不上（前缀缓存整段作废）
    const images = normalizeImages(r.images)
    return {
      type: 'tool',
      id: typeof r.id === 'string' ? r.id : '',
      name: r.name,
      args: typeof r.args === 'string' ? r.args : '',
      result: typeof r.result === 'string' ? r.result : '',
      ok: r.ok !== false,
      status: r.status === 'running' || r.status === 'error' ? r.status : 'done',
      ...(images.length ? { images } : {}),
    }
  }
  return null
}

/**
 * 消息上的 token 账。字段全要数字，缺项按 0；一项都没有就当没有——
 * 老会话（写这个字段之前存的）走这条路，界面上不显示用量。
 */
function normalizeUsage(raw: unknown): MessageUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const usage: MessageUsage = {
    contextTokens: num(r.contextTokens),
    contextWindow: num(r.contextWindow),
    totalTokens: num(r.totalTokens),
    outputTokens: num(r.outputTokens),
    cacheReadTokens: num(r.cacheReadTokens),
    cacheMissTokens: num(r.cacheMissTokens),
    estimated: r.estimated === true,
    ...(typeof r.tps === 'number' && Number.isFinite(r.tps) && r.tps > 0 ? { tps: r.tps } : {}),
  }
  return usage.totalTokens || usage.contextTokens ? usage : null
}

/**
 * 一段对话。归属单位是目标：新数据直接带 goalId；旧数据带的是 nodeId，
 * 按「那个节点属于哪个目标」折算过去（节点已被删掉的对话只能丢弃）。
 */
export function normalizeConversation(
  raw: unknown,
  goalIds: Set<string>,
  goalOfNode: (nodeId: string) => string,
): Conversation | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rawGoalId = typeof r.goalId === 'string' ? r.goalId : ''
  const nodeId = typeof r.nodeId === 'string' ? r.nodeId : ''
  const goalId = rawGoalId || (nodeId ? goalOfNode(nodeId) : '')
  if (!goalId || !goalIds.has(goalId)) return null
  const now = Date.now()
  const summary = normalizeSummary(r.summary)
  const messages: ConversationMessage[] = []
  if (Array.isArray(r.messages)) {
    for (const m of r.messages) {
      if (!m || typeof m !== 'object') continue
      const mr = m as Record<string, unknown>
      if (mr.role !== 'user' && mr.role !== 'assistant') continue
      const parts = Array.isArray(mr.parts)
        ? mr.parts.map(normalizePart).filter((p): p is AgentPart => p !== null)
        : []
      const quote = normalizeQuote(mr.quote)
      const usage = normalizeUsage(mr.usage)
      const images = normalizeImages(mr.images)
      const files = normalizeFiles(mr.files)
      /*
       * 失活是**相对摘要**才成立的：没有摘要（手改掉了，或老数据里那段正文已经没了）
       * 就不认这个标记——否则 toChatHistory 会把整段历史都当成「已经折进摘要」而一条都不发，
       * 导师当场失忆。多花一次上下文钱，好过让它什么都看不见。
       */
      const retired = !!summary && mr.retired === true
      messages.push({
        id: typeof mr.id === 'string' ? mr.id : crypto.randomUUID(),
        role: mr.role,
        parts,
        ...(usage ? { usage } : {}),
        ts: typeof mr.ts === 'number' ? mr.ts : now,
        ...(mr.hidden === true ? { hidden: true } : {}),
        /*
         * mark：这条隐藏指令是「哪件事」（回忆 / 探针 / 开讲 / 压缩…）。
         * 界面靠它把导师自己发起的动作画成一条分界条，消息定位条也靠它当锚点
         * （见 agent/types 的 mark）——丢了就等于「那次回忆」在对话里凭空消失。
         */
        ...(typeof mr.mark === 'string' && mr.mark ? { mark: mr.mark } : {}),
        // 人格指令的标记：丢了会让「人格交代过没有」重新变成「没交代」，每轮都补一条
        ...(typeof mr.persona === 'string' && mr.persona ? { persona: mr.persona } : {}),
        ...(typeof mr.context === 'string' && mr.context ? { context: mr.context } : {}),
        ...(quote ? { quote } : {}),
        ...(images.length ? { images } : {}),
        ...(files.length ? { files } : {}),
        /*
         * retired：已经折进摘要的旧消息。丢了不是「多显示几条」那么轻——
         * toChatHistory 是按它决定发什么的，全活了就等于把压过的历史整段再发一遍。
         */
        ...(retired ? { retired: true } : {}),
      })
    }
  }
  const title = typeof r.title === 'string' ? r.title.trim() : ''
  const inflight = normalizeInflight(r.inflight)
  const conv: Conversation = {
    id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
    goalId,
    messages,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
    // 标题：模型起的名字，读回来照旧；没有就不写这个字段（界面退回「对话 N」）
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(inflight ? { inflight } : {}),
  }
  /*
   * 先做中断恢复，再应用挂着的压缩摘要：恢复出来的消息若遇上「没应用完的压缩」
   * （写摘要的那一轮被杀），跟其它旧消息一起失活——「一条原消息都不留」照旧成立。
   *
   * 还挂着 pending 的摘要：写它的那一轮 loop 没跑完就没了（进程被杀、断电），就地应用掉——
   * 本来就该在那一轮的 finally 里做，而那一轮已经不存在了。不应用的话，下一次 finally
   * 才会动手，那时它会把**之后**的新消息一起吞掉，而摘要里根本没有那几句话。
   */
  const recovered = recoverInterruptedTurn(conv)
  return recovered.summary?.pending ? applyCompaction(recovered).conv : recovered
}
