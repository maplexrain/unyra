/**
 * Agent 名册的「最近动态」：在思维运行、work 运行与私聊通道消息之间按时间戳取最新的一条。
 *
 * 名册不是任务面板，只占一行副标题；因此这里不拼接历史，只返回一条可直接展示的短句。
 * - 思维运行：取实时 parts 里最后一个可见片段（思考 / 正文 / 工具名）；
 * - work 运行：取 work 实时流，带上 work 名字，避免用户看见「正在调用」却不知道是谁在跑；
 * - 私聊消息：只取 user 通道，正文按聊天气泡同一套短摘要规则压缩。
 */
import type { AgentPart, Conversation } from '../../../agent/types'
import { liveActivityOfParts, workActivityOf, type WorkInlineRun } from '../../../lib/workInline'
import { plainPreview } from '../agent-team/conversationList'
import type { AgentVoiceActivity } from '../agent-team/agentRoster'
import { t } from '../../../i18n'

interface StreamLike {
  parts: AgentPart[]
}

function previewChannelText(text: string): string {
  const short = text.split(/\n\s*---\s*\n/)[0] ?? text
  const clean = plainPreview(short)
  return clean.length > 32 ? `${clean.slice(0, 32)}…` : clean
}

function latestChannelMessage(conv: Conversation): { text: string; at: number } | null {
  let best: { text: string; at: number } | null = null
  for (const msg of conv.channels ?? []) {
    if (msg.kind !== 'user' || !msg.text.trim()) continue
    if (!Number.isFinite(msg.ts)) continue
    if (!best || msg.ts >= best.at) best = { text: previewChannelText(msg.text), at: msg.ts }
  }
  return best && best.text ? best : null
}

function newer(
  current: AgentVoiceActivity | null,
  candidate: AgentVoiceActivity | null,
): AgentVoiceActivity | null {
  if (!candidate || !candidate.text.trim()) return current
  if (!current) return candidate
  return candidate.at >= current.at ? candidate : current
}

/**
 * 从一段 role 的全部会话里取最近动态。
 *
 * `streams` 是 useAgent 的会话级流式槽；`running` 只用来给「正在跑但还没吐出第一段」
 * 的思维轮一个兜底文案，避免运行点亮着、副标题却停在旧消息上。
 */
export function latestAgentVoiceActivity(args: {
  conversations: readonly Conversation[]
  workRuns: readonly WorkInlineRun[]
  streams?: Record<string, StreamLike>
  running?: Record<string, boolean | undefined>
}): AgentVoiceActivity | null {
  const { conversations, workRuns, streams, running } = args
  let best: AgentVoiceActivity | null = null
  for (const conv of conversations) {
    const channel = latestChannelMessage(conv)
    if (channel) best = newer(best, { kind: 'channel', text: channel.text, at: channel.at })

    for (const run of workRuns) {
      if (run.conversationId !== conv.id) continue
      const session = conv.works?.sessions.find((w) => w.id === run.workId)
      const activity = session
        ? workActivityOf(session, run)
        : liveActivityOfParts(run.parts, run.runId ?? `work:${run.workId}`)
      const text = activity?.text?.trim()
      if (!text) continue
      const label = session?.name?.trim() || t('工作')
      best = newer(best, { kind: 'work', text: `${label} · ${text}`, at: run.ts })
    }

    const stream = streams?.[conv.id]
    if (running?.[conv.id] || stream?.parts.length) {
      const activity = liveActivityOfParts(stream?.parts ?? [], `mind:${conv.id}`)
      const text = activity?.text?.trim() || t('思考中…')
      const at = conv.inflight?.startedAt ?? conv.updatedAt ?? 0
      best = newer(best, { kind: 'mind', text, at })
    }
  }
  return best
}
