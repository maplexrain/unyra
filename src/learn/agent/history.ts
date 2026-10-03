/**
 * 这个文件负责「已存会话 → 模型对话历史」的全部纯逻辑：送进模型的字符预算
 * （MAX_HISTORY_CHARS）、逐字节忠实的还原（toChatHistory）、残缺工具调用的清理
 * （dropOrphans）、超预算时从最旧一轮开始丢（withinBudget）与隐藏上下文拼接（withContext）。
 *
 * 从 learn/useAgent 拆出（见 docs/refactor-plan.md 3.8）；不依赖 React，可单独测。
 */

import {
  MAX_TOOL_IMAGES,
  TOOL_IMAGE_NOTE,
  type AgentPart,
  type ContextSummary,
  type ConversationMessage,
  type MessageImage,
} from '../../agent/types'
import type { ChatMessage } from '../../ai/types'
import { budgetChars, imagePart, textPart } from '../../ai/content'
import { fileBlock } from '../attachments'
import { summaryBlock } from '../compact'

/**
 * 送入模型的历史预算（字符数）。不是「最近 N 条」——按条数裁剪会让前缀每轮都变：
 * 只要有一轮超出了 N 条，之后每次请求的开头都往前挪一格，服务端的前缀缓存
 * （OpenAI / DeepSeek / Anthropic 都是前缀匹配）**全部落空**，每一轮都要全价重算。
 * 按字符预算裁剪则多数会话根本不会触发裁剪，触发后也会稳定在同一个起点上。
 *
 * 20 万字符 ≈ 单轮十万 token 量级的上限，够一般会话跑很久；
 * 超出后从最旧的一轮开始整轮丢弃。
 */
const MAX_HISTORY_CHARS = 200_000

/**
 * 把已存会话还原成模型的对话历史。
 *
 * 关键在于**忠实**：工具调用按原样还原成 assistant.tool_calls 与配对的 tool 消息，
 * 而不是折叠成一句「我使用了工具：…」。折叠过的历史与上一轮真正发出去的那份不同，
 * 服务端的前缀缓存从第一个对不上的位置起就整段作废——而 Agent 每轮都会调工具读笔记，
 * 折叠就等于把整段对话都变成缓存盲区。
 *
 * 导出是为了让验证脚本能直接检查这份还原是否逐字节稳定（前缀缓存能否命中的唯一判据）。
 *
 * images 是「图片 id → base64」的表（见 learn/images 的 loadImagesFor）：
 * 图片字节不进 chat.json，只在这里按引用拼回内容片段。取不到就按纯文本发——
 * 少一张图远好过整轮请求失败。
 */
export function toChatHistory(
  messages: ConversationMessage[],
  images?: Map<string, { mime: string; data: string }>,
  /**
   * 额外的两块料：
   * - files：附件 uuid → 正文（文本附件的内容存在资源库里，见 learn/attachments）；
   * - summary：上下文压缩的结果（见 learn/compact）。
   * 做成一个选项对象而不是第三、第四个位置参数：这一层已经有两个可选参数了，
   * 再加位置参数，调用点上就分不清哪个是哪个。
   */
  opts?: { files?: Map<string, string>; summary?: ContextSummary },
): ChatMessage[] {
  /*
   * 压缩过的历史：**失活的消息一条都不发**，摘要作为第一条用户消息接在最前面
   * （系统提示词由调用方拼在它之前——这是「摘要不动系统提示词」的约定，见 learn/compact）。
   * 判据只有 m.retired 一条：不再有「压到哪一条」的分界点，压缩就是「全压 + 摘要」。
   */
  const out: ChatMessage[] = []
  if (opts?.summary) out.push({ role: 'user', content: summaryBlock(opts.summary) })
  for (const m of messages) {
    if (m.retired) continue
    if (m.role === 'user') {
      const text = m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('')
      const pics = (m.images ?? [])
        .map((img) => images?.get(img.id))
        .filter((p): p is { mime: string; data: string } => !!p)
      // 附件的正文接在用户那句话之后、位置说明之前：先看他问了什么、附了什么，再看「此刻在哪个节点」
      const attach = m.files?.length ? fileBlock(m.files, opts?.files ?? new Map()) : ''
      const body = withContext([text, attach].filter(Boolean).join('\n\n'), m.context)
      // 片段顺序：先文字后图片。顺序一旦定下就不能再改——历史要逐字节稳定
      out.push({
        role: 'user',
        content: pics.length ? [textPart(body), ...pics.map((p) => imagePart(p.mime, p.data))] : body,
      })
      continue
    }
    /**
     * 一轮回复还原成**与线上实发完全相同**的结构——「完全相同」要精确到**每一跳**：
     * runtime 在循环里逐跳 push（一条 assistant，content 与 tool_calls 并存，紧跟本跳的
     * tool 消息与附图，见 agent/runtime 的 messages.push），下一跳的请求带着前几跳的
     * 这些消息一起发出去。历史因此必须按跳边界（hop 片段：runtime 发、applyEvent 记）
     * 切开、逐跳重放——整轮折叠成一条 assistant 的话，从第二跳起就与实发对不上，
     * 服务端的前缀缓存整段作废。这个文件里的两条教训都出在这里：把 text 拆成独立的
     * assistant 消息（单跳结构与实发不符）、忽略跳边界（多跳回合折叠还原），
     * 全是缓存命中率极低的元凶。
     *
     * 没有 hop 标记的旧数据按「整轮一段」兜底还原：它只影响跨重启后的还原形状——
     * 重启后前缀门禁重新记账，服务端缓存也早已过期，不构成破坏。
     */
    for (const seg of hopSegments(m.parts)) {
      const text = seg.filter((p) => p.type === 'text').map((p) => p.text).join('')
      const calls = seg.filter((p): p is Extract<AgentPart, { type: 'tool' }> => p.type === 'tool')
      if (text || calls.length) {
        out.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((t) => ({
                  id: t.id,
                  type: 'function' as const,
                  function: { name: t.name, arguments: t.args },
                })),
              }
            : {}),
        })
        if (calls.length) {
          for (const t of calls) out.push({ role: 'tool', tool_call_id: t.id, content: t.result })
          /**
           * 工具附带的图片（Agent 用 res.read 看的那张）：还原成工具结果之后的**一条 user 消息**。
           *
           * 这里必须与 agent/runtime 实发的那一条逐字节一致——说明文字、去重、张数上限、
           * 顺序任何一处不同，下一轮的历史就从这里开始与上一轮对不上，服务端的前缀缓存
           * 整段作废（见 TOOL_IMAGE_NOTE 的说明）。因此这段逻辑与 runtime 里那段是**镜像**的，
           * 改一处就要改另一处。
           */
          const shots: MessageImage[] = []
          const seenShot = new Set<string>()
          for (const t of calls) {
            for (const img of t.images ?? []) {
              if (seenShot.has(img.id) || shots.length >= MAX_TOOL_IMAGES) continue
              seenShot.add(img.id)
              shots.push(img)
            }
          }
          const shotParts = []
          for (const img of shots) {
            const data = images?.get(img.id)
            if (data) shotParts.push(imagePart(data.mime, data.data))
          }
          if (shotParts.length) {
            out.push({ role: 'user', content: [textPart(TOOL_IMAGE_NOTE), ...shotParts] })
          }
        }
      } else {
        // 整跳没有正文也没有调用（只有 thinking，或干脆为空）：占位一条，与既有行为一致
        out.push({ role: 'assistant', content: '（已处理）' })
      }
      /**
       * 动态注入的提示词模块（learn/ai/prompt-modules）：它发生在跳的边界——线上实发
       * 是「这一跳的消息 + 一条模块 user 消息」，所以还原时按它在片段里的位置补发。
       * 逐字节镜像纪律与上面的图片消息同一条：差一个字符，前缀缓存从这里整段作废。
       */
      for (const p of seg) {
        if (p.type === 'prompt-module') out.push({ role: 'user', content: p.text })
      }
    }
  }
  return withinBudget(dropOrphans(out))
}

/**
 * 把一条回复的 parts 按跳边界切成若干段，每段对应 runtime 实发的一条 assistant 消息。
 * 段内顺序即事件顺序：思考/正文片段、若干次工具调用；'hop' 标记本身不进任何一段。
 * 连着的标记（不该出现，防御一下）只算一个边界，不产生空段。
 */
function hopSegments(parts: AgentPart[]): AgentPart[][] {
  const segs: AgentPart[][] = [[]]
  for (const p of parts) {
    if (p.type === 'hop') {
      if (segs[segs.length - 1].length) segs.push([])
      continue
    }
    segs[segs.length - 1].push(p)
  }
  return segs
}

/**
 * 砍掉配不成对的工具调用/返回。
 *
 * 两种残缺都会让服务端直接报错：只有 tool_calls 没有返回（上一轮出错或被打断），
 * 或只有 tool 消息没有对应的调用（旧数据）。宁可少还原一段，也不能让请求发不出去。
 */
function dropOrphans(history: ChatMessage[]): ChatMessage[] {
  const called = new Set<string>()
  const answered = new Set<string>()
  for (const m of history) {
    for (const c of m.tool_calls ?? []) called.add(c.id)
    if (m.role === 'tool' && m.tool_call_id) answered.add(m.tool_call_id)
  }
  const out: ChatMessage[] = []
  for (const m of history) {
    if (m.role === 'tool') {
      if (m.tool_call_id && called.has(m.tool_call_id)) out.push(m)
      continue
    }
    if (!m.tool_calls) {
      out.push(m)
      continue
    }
    const paired = m.tool_calls.filter((c) => answered.has(c.id))
    if (!paired.length) {
      // 调用全被丢掉了，这条 assistant 只剩正文
      out.push({ role: 'assistant', content: m.content })
      continue
    }
    out.push({ ...m, tool_calls: paired })
  }
  return out
}

/**
 * 超出预算时从最旧的一轮开始丢，直到装得下。
 * 丢弃不会破坏前缀——被留下的那一段在下一轮仍然逐字节相同。
 */
function withinBudget(history: ChatMessage[]): ChatMessage[] {
  // 图片按 base64 长度计入：一张图往往比一整段文字还重，先丢它才划算
  // 图片按张数折算，不按 base64 长度——否则一张大图就能把整段历史（含本次提问）顶掉
  const size = (m: ChatMessage) => budgetChars(m.content)
  let chars = history.reduce((sum, m) => sum + size(m), 0)
  let start = 0
  while (start < history.length && chars > MAX_HISTORY_CHARS) {
    chars -= size(history[start])
    start++
    // 起点必须落在一轮的开头，否则会把工具返回和它的调用拆散
    while (start < history.length && history[start].role === 'tool') {
      chars -= size(history[start])
      start++
    }
  }
  return start ? history.slice(start) : history
}

/** 把附加上下文并进用户消息：模型能读到位置说明，界面仍只显示正文 */
function withContext(text: string, context?: string): string {
  return context?.trim() ? `${text}\n\n${context.trim()}` : text
}
