/*
 * 试卷插图的视觉自检：出卷落库后，把每张 SVG 渲染成位图，交给当前模型的视觉能力
 * 检查一遍「能不能正常渲染、与题干是否相符」；发现坏图再让模型重画一轮，修完写回试卷。
 *
 * 为什么是后台任务而不是 exam.create 的一部分：沙箱一次 execute 只有 15 秒
 * （agent/sandbox/limits），两跳视觉请求轻松超出它——把检查挂在 exam.create 里
 * 等于把整段编排拖死。所以 exam.create 只在回执里说「已启动自检」，这里修完后
 * 打补丁（replaceQuestionImages）并 toast；模型不需要、也无法参与这个过程。
 */

import { chatCompleteWith } from '../../../ai/client'
import { resolveGlobal, supportsImage } from '../../../ai/settings'
import type { ChatContentPart, ChatMessage } from '../../../ai/types'
import { sanitizeExamSvg, type ExamQuestion } from '../../../learn/exam'
import { replaceQuestionImages } from '../../../learn/graph'
import { t } from '../../../i18n'
import type { ExamToolHost } from './examTools'

/** 交给视觉模型的位图宽度：看得清坐标轴与文字，又不至于把请求撑大 */
const RASTER_WIDTH = 640
/** 每一跳的时间上限；到点放弃，自检失败不拖累出卷 */
const STEP_TIMEOUT_MS = 90_000

interface Figure {
  /** 出题顺序里的下标（发给质检模型的编号） */
  index: number
  questionId: string
  stem: string
  svg: string
  /** null = 浏览器就渲染不出来——这本身就是「坏」，不用再问模型 */
  png: string | null
}

type FigureQuestion = ExamQuestion & { image: string }

export const hasExamFigures = (questions: ExamQuestion[]): boolean =>
  questions.some((q) => typeof q.image === 'string' && !!q.image)

/** 出题回执里给模型的那句话：自检由宿主做，模型不要过问（模型不支持视觉时如实说） */
export function figureSelfCheckNote(questions: ExamQuestion[]): string {
  const n = questions.filter((q) => typeof q.image === 'string' && !!q.image).length
  if (!n) return ''
  if (!supportsImage()) {
    return (
      `题目里带了 ${n} 张插图；当前模型不支持视觉输入，宿主没有做渲染自检——` +
      '如果图有问题，用户会直接告诉你。'
    )
  }
  return (
    `题目里带了 ${n} 张插图：宿主正在后台用视觉自检渲染质量（发现坏图会自动重画修复），` +
    '你不必检查图像，也不要为此重出卷。'
  )
}

/** 把 SVG 源码画成 PNG data URL；画不出（源码坏、引用外部资源）返回 null */
export function svgToPngDataUrl(svg: string, width = RASTER_WIDTH): Promise<string | null> {
  return new Promise((resolve) => {
    let url: string
    try {
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    } catch {
      resolve(null)
      return
    }
    const img = new Image()
    const done = (v: string | null): void => {
      URL.revokeObjectURL(url)
      resolve(v)
    }
    img.onload = () => {
      try {
        if (!img.naturalWidth) {
          done(null)
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = Math.max(1, Math.round((width * img.naturalHeight) / img.naturalWidth))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          done(null)
          return
        }
        // 白底：模型的图常是深色线条，透明底在深色主题里会被读成「黑块」
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        done(canvas.toDataURL('image/png'))
      } catch {
        done(null)
      }
    }
    img.onerror = () => done(null)
    img.src = url
  })
}

/** 模型的回复经常裹着说明文字或 ``` 围栏——抠第一段 {…} 出来当 JSON */
function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const v: unknown = JSON.parse(raw.slice(start, end + 1))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const dataUrlPart = (png: string): ChatContentPart => ({
  type: 'image',
  mime: 'image/png',
  // chatCompleteWith 的协议层要的是裸 base64（data: 前缀由 toXxx 拼）
  data: png.replace(/^data:image\/png;base64,/, ''),
})

/** 第一跳：全部图 + 题干交给质检模型，回 JSON 结论 */
function buildCheckMessages(figures: Figure[]): ChatMessage[] {
  const parts: ChatContentPart[] = [
    {
      type: 'text',
      text:
        '一份试卷里有若干道带 SVG 配图的题。下面按顺序给出每张图渲染成位图后的样子与题干。' +
        '对每一张判断两点：① 图形是否完整正常（没有截断、大面积空白、错位、乱码，坐标轴与文字可读）；' +
        '② 图的内容与题干相符。只回复 JSON，不要别的文字：' +
        '{"results":[{"i":0,"ok":true},{"i":1,"ok":false,"reason":"坏在哪"}]}，i 从 0 起，每张都必须给结论。',
    },
  ]
  for (const f of figures) {
    parts.push({ type: 'text', text: `【第 ${f.index + 1} 张】题干：${f.stem}` })
    if (f.png) parts.push(dataUrlPart(f.png))
    else parts.push({ type: 'text', text: '（这张图在浏览器里渲染不出来：源码多半不是合法 SVG，或引用了外部资源）' })
  }
  return [{ role: 'user', content: parts }]
}

/** 第二跳：把坏图的原 SVG 与坏因交回去，让模型重画 */
function buildFixMessages(broken: Array<Figure & { reason: string }>): ChatMessage[] {
  const parts: ChatContentPart[] = [
    {
      type: 'text',
      text:
        '下面这些试卷配图渲染有问题。请重画每一张：修掉给出的坏因、保持题意不变，' +
        '输出**完整的 SVG 源码**（以 <svg 开头、</svg> 结尾，含 viewBox，不要引用外部资源）。' +
        '只回复 JSON，不要别的文字：{"fixes":[{"i":0,"svg":"<svg …</svg>"}]}，i 对应下面的编号，每张都必须重画。',
    },
  ]
  for (const f of broken) {
    parts.push({ type: 'text', text: `【第 ${f.index + 1} 张】坏因：${f.reason}\n题干：${f.stem}\n原 SVG：\n${f.svg}` })
  }
  return [{ role: 'user', content: parts }]
}

/**
 * 对一份刚出的卷子跑插图自检（fire-and-forget，exam.create 里 void 调用）。
 * 结局一律 toast：全过、修了几张、或没查成——用户不必翻对话也知道图的情况。
 */
export async function selfCheckExamFigures(
  host: Pick<ExamToolHost, 'getLatest' | 'set' | 'onToast'>,
  examId: string,
  questions: ExamQuestion[],
): Promise<void> {
  const withFigures = questions.filter((q): q is FigureQuestion => typeof q.image === 'string' && !!q.image)
  if (!withFigures.length || !supportsImage()) return
  let provider: ReturnType<typeof resolveGlobal>['provider']
  let model: string
  try {
    const g = resolveGlobal()
    provider = g.provider
    model = g.model
  } catch {
    return // 没配提供商：出题回执里已说明，这里静默
  }

  try {
    const figures: Figure[] = await Promise.all(
      withFigures.map(async (q, index) => ({
        index,
        questionId: q.id,
        stem: q.stem.slice(0, 300),
        svg: q.image,
        png: await svgToPngDataUrl(q.image),
      })),
    )

    const raw = await chatCompleteWith(provider, model, {
      messages: buildCheckMessages(figures),
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      purpose: 'exam',
    })
    const results = extractJson(raw)?.results
    const verdicts = new Map<number, string>()
    if (Array.isArray(results)) {
      for (const item of results) {
        if (!item || typeof item !== 'object') continue
        const r = item as Record<string, unknown>
        const i = typeof r.i === 'number' ? r.i : Number(r.i)
        if (!Number.isInteger(i) || i < 0 || i >= figures.length) continue
        if (r.ok === false) verdicts.set(i, typeof r.reason === 'string' && r.reason ? r.reason : '质检说渲染有问题')
      }
    }
    // 浏览器都渲染不出来的图，模型根本没看到位图——不管质检怎么说都算坏
    const broken: Array<Figure & { reason: string }> = figures.map((f) => ({
      ...f,
      reason: f.png ? (verdicts.get(f.index) ?? '') : '浏览器渲染失败：源码不是合法 SVG 或引用了外部资源',
    })).filter((f) => !!f.reason)

    if (!broken.length) {
      host.onToast(t('插图自检：{0} 张全部正常', figures.length))
      return
    }

    // 第二跳只送坏图：好图不陪跑，请求体和等待时间都省下来
    const fixed: Record<string, string> = {}
    try {
      const fixRaw = await chatCompleteWith(provider, model, {
        messages: buildFixMessages(broken),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        purpose: 'exam',
      })
      const fixes = extractJson(fixRaw)?.fixes
      if (Array.isArray(fixes)) {
        for (const item of fixes) {
          if (!item || typeof item !== 'object') continue
          const r = item as Record<string, unknown>
          const i = typeof r.i === 'number' ? r.i : Number(r.i)
          const figure = broken.find((f) => f.index === i)
          const cleaned = sanitizeExamSvg(r.svg)
          if (figure && cleaned) fixed[figure.questionId] = cleaned
        }
      }
    } catch (err) {
      // 修复跳失败不影响结论的呈现：带着失败原因走「没修成」的分支
      console.warn('[exam-image] fix round failed', err)
    }

    if (!Object.keys(fixed).length) {
      host.onToast(t('插图自检：{0} 张异常，自动修复没有成功——可以让导师在对话里修图', broken.length))
      return
    }
    host.set(replaceQuestionImages(host.getLatest(), examId, fixed))
    const repaired = Object.keys(fixed).length
    host.onToast(
      repaired === broken.length
        ? t('插图自检：{0} 张异常，已修复', broken.length)
        : t('插图自检：{0} 张异常，修复了 {1} 张', broken.length, repaired),
    )
  } catch (err) {
    host.onToast(t('插图自检没有完成：{0}', err instanceof Error ? err.message : String(err)))
  }
}
