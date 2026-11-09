import { streamChatWith } from '../../ai/client'
import { hasApiKey, loadAiSettings, resolveGlobal } from '../../ai/settings'
import type { ChatMessage } from '../../ai/types'

export interface StreamAiqaAnswerOptions {
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  onDelta: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
  signal?: AbortSignal
}

/**
 * 独立的 AI 考察 Agent：不复用导师 Agent 上下文，直接调用配置好的全局模型进行问答考察。
 */
export async function streamAiqaAnswer(opts: StreamAiqaAnswerOptions): Promise<string> {
  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    throw new Error('尚未配置 API Key，请在「设置 - 模型」中配置')
  }

  const { provider, model, effort } = resolveGlobal(settings)

  const apiMessages: ChatMessage[] = [
    { role: 'system', content: opts.systemPrompt },
    ...opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ]

  const result = await streamChatWith(provider, model, {
    messages: apiMessages,
    reasoningEffort: effort === 'max' ? 'low' : effort,
    temperature: 0.6,
    signal: opts.signal,
    purpose: 'chat',
    onDelta: (d) => {
      if (d.content) opts.onDelta(d.content)
      if (d.reasoning && opts.onReasoningDelta) opts.onReasoningDelta(d.reasoning)
    },
  })

  return result.content
}
