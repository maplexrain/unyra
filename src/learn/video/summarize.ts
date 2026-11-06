/**
 * 视频总结（内容总结 + 语义分段，**一个动作一次生成**）：把一份 STT 转录稿交给
 * **内部的一次性补全**，让它同时产出「这个视频讲了什么的一段话」与「按话题切开的
 * 分段表」——分段点钉在播放器进度条上，总结落在底部「总结」页签里。
 *
 * 刻意不用导师 agent（用户定的）：这件事没有工具、没有上下文、没有多轮——
 * 一次请求就答得完。所以这里是一个**极窄的内部通道**：
 * - 系统提示词只有几行（输出 JSON 对象的形状约定：{ summary, chapters }）；
 * - 思考档位 `none`（总结不需要推理，省钱也省等待）；
 * - 输入先按 ~20 秒聚桶（一小时的视频从上千行字幕压到一两百行，模型照样认得出话题转折）。
 *
 * 与 learn/title 的对话命名是同一种做法（少提示词的一次性补全），失败抛给调用方显示。
 */
import { AiRequestError, chatCompleteWith } from '../../ai/client'
import { hasApiKey, loadAiSettings, resolveGlobal, activeLabel } from '../../ai/settings'
import { formatClock } from '../../video/transcript'
import type { Transcript, TranscriptSegment } from '../../video/types'
import type { VideoChapter, VideoRecap } from '../types'

/** 送进模型的转录行数硬上限（聚桶之后）：再长的课也截到这里，尾部信息损失可接受 */
const MAX_LINES = 600
/** 单段概述的长度上限（超出截断；提示词里也要求了短句） */
const SUMMARY_MAX_CHARS = 60
/** 内容总结的硬上限（超出截断；提示词要求 80~150 字，这里只兜模型的跑题） */
const SUMMARY_TEXT_MAX_CHARS = 600
/** 分段数上限（提示词要求 3~12 段，这里再兜一刀防刷屏） */
const MAX_CHAPTERS = 24

const RECAP_SYSTEM = [
  '你给一段带时间戳的视频转录稿做两件事：写一份内容总结，并按话题把内容分成几段。',
  '',
  '只输出一个 JSON 对象，不要输出其它任何文字：',
  '{"summary": "<80~150字的一段连贯的话：这个视频讲了什么、大致按什么顺序展开>", "chapters": [{"startMs": <这一段开始的毫秒数，取该段第一行的时间戳>, "summary": "<不超过20字的内容概述>"}]}',
  '',
  '要求：都用与转录相同的语言；summary 不要分点、不要前缀；chapters 按 startMs 升序、段数在 3~12 之间、startMs 必须取转录中出现过的某个时间戳。',
].join('\n')

/**
 * 转录聚桶：把逐句的 segments 按 ~20 秒并成一行（`[分:秒] 这段时间里说了什么`）。
 * 时间轴信息保留在行首——分段点只能落在这些时间戳上，模型抄最近的即可。
 */
export function transcriptLines(segments: readonly TranscriptSegment[], bucketMs = 20_000): string[] {
  const lines: string[] = []
  let bucketStart = -1
  let buf: string[] = []
  const flush = (): void => {
    if (bucketStart >= 0 && buf.length) lines.push(`[${formatClock(bucketStart)}] ${buf.join(' ')}`)
    buf = []
  }
  for (const seg of segments) {
    if (bucketStart < 0 || seg.startMs - bucketStart >= bucketMs) {
      flush()
      bucketStart = seg.startMs
    }
    buf.push(seg.text)
  }
  flush()
  return lines.slice(0, MAX_LINES)
}

/**
 * 把模型吐出来的总结收拾成一段话：剥代码围栏、砍掉 Markdown 标题记号、
 * 逐行 trim 后拼成一段。空结果返回空串（调用方当失败处理）。
 */
export function cleanSummaryText(raw: string): string {
  const text = raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return clampChars(text, SUMMARY_TEXT_MAX_CHARS)
}

function clampChars(text: string, max: number): string {
  let out = ''
  let n = 0
  for (const ch of text) {
    if (n >= max) break
    out += ch
    n++
  }
  return out.trim()
}

/** 分段项的逐条校验：startMs 非负整数、summary 非空，排序、同点去重、掐上限 */
function chapterItems(items: unknown[]): VideoChapter[] {
  const stamps = new Set<number>()
  const out: VideoChapter[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const ms = typeof o.startMs === 'number' && Number.isFinite(o.startMs) ? Math.max(0, Math.round(o.startMs)) : null
    const summary = typeof o.summary === 'string' ? o.summary.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX_CHARS) : ''
    if (ms === null || !summary || stamps.has(ms)) continue
    stamps.add(ms)
    out.push({ startMs: ms, summary })
  }
  out.sort((a, b) => a.startMs - b.startMs)
  return out.slice(0, MAX_CHAPTERS)
}

/**
 * 把模型吐出来的东西收拾成分段表：剥围栏、抓第一个 JSON 数组、逐项校验。
 * 模型偶尔不听话（多说话、给秒数不给毫秒），这里兜住而不是让整次总结作废。
 */
export function parseChapters(raw: string): VideoChapter[] {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? chapterItems(parsed) : []
  } catch {
    return []
  }
}

/**
 * 把模型的输出收拾成一份总结：剥围栏、抓第一个 JSON 对象，summary 与 chapters
 * 都有效才算成功（**合在同一个动作**——产出要么两样都有、要么算失败）。
 */
export function parseRecap(raw: string): VideoRecap | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  const summary = typeof o.summary === 'string' ? cleanSummaryText(o.summary) : ''
  const chapters = Array.isArray(o.chapters) ? chapterItems(o.chapters) : []
  if (!summary || !chapters.length) return null
  return { summary, chapters }
}

/**
 * 跑一次视频总结（内容总结 + 语义分段，一次生成）。转录为空直接抛（调用侧就不该
 * 放行）；失败原话上抛，由页签显示——总结失败不打断播放。
 */

const CHAPTERS_SYSTEM = [
  '你给一段带时间戳的视频转录稿做语义分段，按话题把内容分成几段。',
  '',
  '只输出一个 JSON 数组，不要输出其它任何文字：',
  '[{"startMs": <这一段开始的毫秒数，取该段第一行的时间戳>, "summary": "<不超过20字的内容概述>"}]',
  '',
  '要求：都用与转录相同的语言；chapters 按 startMs 升序、段数在 3~12 之间、startMs 必须取转录中出现过的某个时间戳。',
].join('\n')

/**
 * 跑一次视频语义分段：仅输出章节列表，不再生成视频总结。
 */
export async function summarizeVideoChapters(opts: {
  title: string
  transcript: Transcript
  signal?: AbortSignal
}): Promise<VideoChapter[]> {
  const lines = transcriptLines(opts.transcript.segments)
  if (!lines.length) throw new AiRequestError('这份转录是空的，没有可分段的内容')
  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    throw new AiRequestError(`尚未配置「${activeLabel(settings)}」的 API Key，请在设置中填写`)
  }
  const { provider, model } = resolveGlobal(settings)
  const raw = await chatCompleteWith(provider, model, {
    messages: [
      { role: 'system', content: CHAPTERS_SYSTEM },
      { role: 'user', content: `视频标题：${opts.title}\n转录（[分:秒] 文本，约每 20 秒一行）：\n${lines.join('\n')}` },
    ],
    reasoningEffort: 'none',
    maxTokens: 2048,
    signal: opts.signal,
    purpose: 'other',
  })
  const chapters = parseChapters(raw)
  if (!chapters.length) throw new AiRequestError('AI 未能生成分段')
  return chapters
}

export async function summarizeVideoRecap(opts: {
  title: string
  transcript: Transcript
  signal?: AbortSignal
}): Promise<VideoRecap> {
  const lines = transcriptLines(opts.transcript.segments)
  if (!lines.length) throw new AiRequestError('这份转录是空的，没有可总结的内容')
  const settings = loadAiSettings()
  if (!hasApiKey(settings)) {
    throw new AiRequestError(`尚未配置「${activeLabel(settings)}」的 API Key，请在设置中填写`)
  }
  const { provider, model } = resolveGlobal(settings)
  const raw = await chatCompleteWith(provider, model, {
    messages: [
      { role: 'system', content: RECAP_SYSTEM },
      { role: 'user', content: `视频标题：${opts.title}\n转录（[分:秒] 文本，约每 20 秒一行）：\n${lines.join('\n')}` },
    ],
    // 总结不需要想：思考档位钉死 none（思考 token 与正文同池，还白占等待时间）
    reasoningEffort: 'none',
    // 输出预算给足：一段总结 + 12 段章节 + 偶发的格式啰嗦，2k 绰绰有余
    maxTokens: 2048,
    // 同 title 的教训：不传 temperature，省一种网关 400
    signal: opts.signal,
    purpose: 'other',
  })
  const recap = parseRecap(raw)
  if (!recap) throw new AiRequestError('AI 未能生成总结与分段')
  return recap
}
