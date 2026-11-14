/**
 * 笔记总结（**内部的一次性补全**，不走导师对话）：把一份笔记的正文交给模型，
 * 换回一段 **≤200 字**的「这篇讲什么」。总结只给节点宇宙的笔记卡当注脚看，
 * 没有工具、没有多轮、没有上下文——一次请求就答得完（与视频总结 / 对话命名
 * 是同一种做法：少提示词的一次性补全，思考档位 none，省钱也省等待）。
 *
 * 200 字的上限双保险：提示词里要求，这里再硬截一刀兜模型的跑题。
 * 失败原话上抛，调用方（画布右键的「生成总结」）接到 toast 上。
 */
import { AiRequestError, chatCompleteWith } from '../ai/client'
import { activeLabel, hasApiKey, loadAiSettings, resolveGlobal } from '../ai/settings'

/** 总结的硬上限（提示词要求 ≤200 字，这里兜模型的跑题） */
export const NOTE_SUMMARY_MAX_CHARS = 200

const SUMMARY_SYSTEM = [
  '你给一篇学习笔记写一段内容总结，给学习者自己扫一眼「这篇讲了什么」用。',
  '',
  '只输出一个 JSON 对象，不要输出其它任何文字：',
  '{"summary": "<不超过200字的一段连贯的话：这篇笔记的核心内容与要点>"}',
  '',
  '要求：与笔记相同的语言；一段话写完，不要分点、不要标题、不要前缀（如「总结：」）；不要复述原文细节，抓主干。',
].join('\n')

/** 把模型的输出收拾成一段总结：剥围栏、抓第一个 JSON 对象，截到 200 字 */
export function parseNoteSummary(raw: string): string {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return ''
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const summary = typeof parsed.summary === 'string' ? parsed.summary.replace(/\s+/g, ' ').trim() : ''
    if (!summary) return ''
    // 200 字按**字符**数（中文一字一符），超了硬截——模型偶尔不听话，这里兜住
    let out = ''
    let n = 0
    for (const ch of summary) {
      if (n >= NOTE_SUMMARY_MAX_CHARS) break
      out += ch
      n++
    }
    return out.trim()
  } catch {
    return ''
  }
}

/**
 * 跑一次笔记总结。正文为空直接抛（调用侧不该放行空笔记）；
 * 失败原话上抛，由画布右键的触发处接到 toast 上。
 */
export async function generateNoteSummary(opts: { title: string; content: string; signal?: AbortSignal }): Promise<string> {
  const body = opts.content.trim()
  if (!body) throw new AiRequestError('这份笔记还是空的，没有可总结的内容')
  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    throw new AiRequestError(`尚未配置「${activeLabel(settings)}」的 API Key，请在设置中填写`)
  }
  const { provider, model } = resolveGlobal(settings)
  const raw = await chatCompleteWith(provider, model, {
    messages: [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: `笔记标题：${opts.title}\n笔记正文：\n${body}` },
    ],
    reasoningEffort: 'none',
    maxTokens: 1024,
    signal: opts.signal,
    purpose: 'other',
  })
  const summary = parseNoteSummary(raw)
  if (!summary) throw new AiRequestError('AI 未能生成总结，稍后再试一次')
  return summary
}
