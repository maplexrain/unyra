/**
 * 群消息调度 agent（幕后，无独立 UI）。
 *
 * 用户在一级群聊 / 评论串里发消息、但正文没有点名任何 agent 时，宿主把这条消息
 * 交给这里做一次**极窄的一次性分类**：只判断「该由群里的哪位 agent 接手」，
 * 不执行任务、不回复用户、不进入 role 会话。分类结果由调用方解析成
 * `GroupTriageResult`，再走群通道投给目标 role 并激活它。
 *
 * 为什么不复用普通 role loop：
 * - 它只需要看「职责表 + 最近 10 条群聊 + 当前消息」，一次补全就够；
 * - 必须固定 `reasoningEffort: 'none'`，否则每次无 @ 发言都要先思考一遍；
 * - 输出是严格的 JSON 数据，不是聊天正文，方便系统直接消费。
 *
 * 提示词顺序按产品口径固定：职责 → 当前群成员（名称 / id / 职责）→ 最近群聊 → 输出契约。
 */

import { AiRequestError, chatCompleteWith } from '../../ai/client'
import { activeLabel, hasApiKey, loadAiSettings, resolveGlobal } from '../../ai/settings'
import type { AgentVoice } from '../../agent/agentProfile'
import type { ChannelMessage } from '../../agent/types'

/** 群调度 agent 能看到的成员信息；名称来自用户对 role 的改名，职责来自运行时名册。 */
export interface GroupTriageAgent {
  id: AgentVoice
  name: string
  duty: string
}

/** 分类结果：系统只认 agentId，reason / confidence 只用于日志与调试。 */
export interface GroupTriageResult {
  agentId: AgentVoice
  reason: string
  confidence?: number
}

export interface GroupTriageInput {
  /** 用户当前这条群消息（原文，不含宿主生成的元信息） */
  text: string
  /** 当前群里的全部 agent（不含 free） */
  agents: GroupTriageAgent[]
  /** 当前消息之前的最近群聊，最多取末尾 10 条 */
  recent: ChannelMessage[]
  signal?: AbortSignal
}

/** 测试或宿主替换分类器；null = 回到真实的模型调用。 */
export type GroupTriageRunner = (input: GroupTriageInput) => Promise<GroupTriageResult>

const MAX_RECENT = 10
const MAX_HISTORY_CHARS = 280
const MAX_AGENT_DUTY_CHARS = 80
/** 分类失败后的重试次数（首次调用之外，最多再试 3 次）。 */
export const GROUP_TRIAGE_RETRY_LIMIT = 3

/** 分类器只输出这个结构；字段名固定，系统不再做二次猜测。 */
export const GROUP_TRIAGE_OUTPUT_SHAPE = '{"agentId":"<成员 id>","reason":"一句话理由","confidence":0.0}'

function clip(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/** 把一条群消息压成调度 agent 可读的一行；没有正文的卡片只留类型。 */
function historyLine(message: ChannelMessage): string {
  const who =
    message.from.kind === 'user'
      ? '用户'
      : message.from.kind === 'group'
        ? '群聊'
        : message.from.name?.trim() || message.from.id
  const text = clip(message.text || (message.ask ? '（ask 表单）' : ''), MAX_HISTORY_CHARS)
  const thread = message.threadRootId ? ' [评论串]' : ''
  const stamp = new Date(message.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `- ${stamp}${thread} ${who}: ${text}`
}

/**
 * 生成调度 agent 的系统提示词。
 *
 * 职责段很短，真正的判断依据只有三块：成员职责、最近群聊、用户当前消息。
 * 「最近最多 10 条」在函数里强制截断，调用方传多少都不会把上下文撑爆。
 */
export function buildGroupTriagePrompt(opts: {
  text: string
  agents: GroupTriageAgent[]
  recent: ChannelMessage[]
}): { system: string; user: string } {
  const agents = opts.agents
    .map((agent) => `- ${agent.name}（id: ${agent.id}）：${clip(agent.duty, MAX_AGENT_DUTY_CHARS)}`)
    .join('\n')
  const recent = opts.recent.slice(-MAX_RECENT)
  const history = recent.length ? recent.map(historyLine).join('\n') : '（暂无更早的群聊记录）'
  const system = [
    '## 职责',
    '',
    '你是群消息调度 agent：只判断用户这条群消息最该由群里的哪一位 agent 接手。',
    '你不执行任务，不回复用户，不调用工具，也不参与群聊；只输出一条结构化结果给系统。',
    '',
    '## 当前群成员',
    '',
    agents || '（当前群里没有可调度的成员）',
    '',
    '## 最近群聊',
    '',
    history,
    '',
    '## 输出',
    '',
    '只输出一个 JSON 对象，不要 Markdown、不要解释、不要思考过程：',
    GROUP_TRIAGE_OUTPUT_SHAPE,
    '',
    '规则：',
    '- agentId 必须是上面列出的成员 id 之一，不能编造。',
    '- 优先按职责匹配：教学 / 答疑 / 大纲 → tutor；多角色协作与任务分派 → dispatcher；出卷 / 判分 → examiner；课堂 / 实验 → designer；联网调研 / 浏览器 → researcher；函数图修复 → fixer。',
    '- 结合最近群聊判断当前上下文：如果正在某个任务串里，优先接续该任务的负责人。',
    '- 用户只是闲聊、问身份或没有明确任务时，选最适合接住这句话的成员，不要为了「显得合理」硬派一个领域任务。',
    '- 拿不准时选 tutor（教学主线协调者），不要默认丢给 dispatcher。',
  ].join('\n')

  return { system, user: opts.text.trim() }
}

/** 从模型输出里抽出 JSON；兼容 ```json 围栏与前后废话。 */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * 严格解析分类结果；agentId 不在允许集合里就返回 null，让宿主不要误投。
 * 这是「系统拿到结构化内容解析成数据」的唯一入口，模型输出再花也越不过这里。
 */
export function parseGroupTriageOutput(raw: string, allowedIds: readonly AgentVoice[]): GroupTriageResult | null {
  const obj = extractJsonObject(raw)
  if (!obj) return null
  const agentId = typeof obj.agentId === 'string' ? obj.agentId.trim() : ''
  if (!allowedIds.includes(agentId as AgentVoice)) return null
  const reason = typeof obj.reason === 'string' ? clip(obj.reason, 200) : ''
  const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : Number.NaN
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : undefined
  return { agentId: agentId as AgentVoice, reason, ...(confidence === undefined ? {} : { confidence }) }
}

/**
 * 真实分类器：一次 `chatCompleteWith`，不启用思考。
 *
 * 没有 API Key / 模型输出无效时抛 `AiRequestError`；调用方（群聊桥）负责吞掉失败，
 * 不把内部错误变成一条群消息。失败时这条消息仍留在群聊里，用户可以补 @ 再投。
 */
async function runGroupTriageWithModel(input: GroupTriageInput): Promise<GroupTriageResult> {
  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    throw new AiRequestError(`尚未配置「${activeLabel(settings)}」的 API Key，群消息调度暂不可用`)
  }
  const { provider, model } = resolveGlobal(settings)
  const { system, user } = buildGroupTriagePrompt(input)
  const raw = await chatCompleteWith(provider, model, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    // 分类是极短任务：不思考、低随机、低输出预算；json 让支持的端点直接回 JSON。
    reasoningEffort: 'none',
    temperature: 0.1,
    maxTokens: 300,
    json: true,
    signal: input.signal,
    purpose: 'other',
  })
  const allowedIds = input.agents.map((agent) => agent.id)
  const parsed = parseGroupTriageOutput(raw, allowedIds)
  if (!parsed) throw new AiRequestError('群消息调度返回了无效的 JSON 结构')
  return parsed
}

let triageRunner: GroupTriageRunner = runGroupTriageWithModel

/** 宿主 / 测试替换分类器；传 null 恢复真实模型。 */
export function setGroupTriageRunner(next: GroupTriageRunner | null): void {
  triageRunner = next ?? runGroupTriageWithModel
}

/** 调用当前分类器。 */
export function triageGroupMessage(input: GroupTriageInput): Promise<GroupTriageResult> {
  return triageRunner(input)
}

/**
 * 带重试的分类入口。
 *
 * 分类失败不是业务结果（不是「用户这条消息没人接」），而是模型 / 网络 / JSON 解析
 * 的一次技术故障。宿主给三次重试机会；三次都失败后抛最后一次错误，由群聊桥弹窗
 * 让用户显式指定接手人，绝不伪造一条 agent 回复。
 */
export async function triageGroupMessageWithRetry(
  input: GroupTriageInput,
  retries = GROUP_TRIAGE_RETRY_LIMIT,
): Promise<GroupTriageResult> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (input.signal?.aborted) {
      throw lastError instanceof Error ? lastError : new AiRequestError('群消息调度已取消')
    }
    try {
      return await triageGroupMessage(input)
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error ? lastError : new AiRequestError('群消息调度失败')
}
