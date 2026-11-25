/**
 * 结构化教学组件渲染器 (HTML 生成)
 *
 * 对应「排版配方」的 9 种出版级精装教学卡片与通用组件：
 * 1. Notice / Callout   带眉标的提示框（核心结论 / 易错警示 / 思考锚点）
 * 2. Compare / Duel     双栏概念交锋 / 正误辨析
 * 3. Formula / Anatomy  定理 / 核心公式解剖卡
 * 4. Steps / Timeline   带贯穿引导线的步骤轴
 * 5. Pipeline / Chain   横向机制推导链
 * 6. Stat / Dashboard   关键指标 / 参数看板
 * 7. Concept / Term     词典式术语名片
 * 8. Breakdown          分段式构成条
 * 9. Quiz / Check       随堂微测 / 自检折叠卡
 * 10. Card / Generic    通用卡片兜底
 */

import type { ComponentNode, ComponentRenderCtx } from './types'

/** 辅助获取插槽文本 */
function getSlotText(node: ComponentNode, ...slotNames: string[]): string {
  for (const name of slotNames) {
    const list = node.slots[name]
    if (list && list.length > 0 && list[0]!.content) {
      return list[0]!.content
    }
  }
  return ''
}

/** 组件正文里允许少量结构化 HTML：列表折成紧凑的「•」行，段落/div 折成换行 */
function normalizeRichText(text: string): string {
  if (!text.includes('<')) return text
  return text
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/?(?:p|div|section|article)\b[^>]*>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 辅助处理内联 Markdown 文本 */
function fmt(text: string, ctx: ComponentRenderCtx): string {
  if (!text) return ''
  const normalized = normalizeRichText(text)
  if (!normalized) return ''
  if (!ctx.renderInline) return ctx.escape(normalized)
  // 卡片正文是行内层：逐行渲染再拼 <br>，避免多行内容被 markdown 包成 <p>/<ul>。
  return normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return ctx.renderInline!(line)
      } catch {
        return ctx.escape(line)
      }
    })
    .join('<br>')
}

/** 语义色调样式映射 */
function toneColors(tone?: string): {
  borderL: string
  text: string
  bg: string
  bgSoft: string
  border: string
} {
  const t = (tone || '').toLowerCase()
  switch (t) {
    case 'warn':
    case 'warning':
    case 'amber':
      return {
        borderL: 'border-l-warn',
        text: 'text-warn',
        bg: 'bg-warn',
        bgSoft: 'bg-warn/15',
        border: 'border-warn/50',
      }
    case 'ok':
    case 'success':
    case 'green':
      return {
        borderL: 'border-l-ok',
        text: 'text-ok',
        bg: 'bg-ok',
        bgSoft: 'bg-ok/15',
        border: 'border-ok/50',
      }
    case 'sky':
    case 'info':
    case 'blue':
      return {
        borderL: 'border-l-sky',
        text: 'text-sky',
        bg: 'bg-sky',
        bgSoft: 'bg-sky/15',
        border: 'border-sky/50',
      }
    case 'purple':
    case 'violet':
      return {
        borderL: 'border-l-purple',
        text: 'text-purple',
        bg: 'bg-purple',
        bgSoft: 'bg-purple/15',
        border: 'border-purple/50',
      }
    case 'seal':
    case 'danger':
    case 'red':
    default:
      return {
        borderL: 'border-l-seal',
        text: 'text-seal',
        bg: 'bg-seal',
        bgSoft: 'bg-seal/15',
        border: 'border-seal/50',
      }
  }
}

/** 1. 配方一：带眉标的提示框 (Notice / Callout) */
export function renderNotice(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const tone = toneColors(node.attrs.type || node.attrs.tone || 'seal')
  const title = node.attrs.title || getSlotText(node, 'title', 'badge', 'eyebrow') || '核心提示'
  const desc = getSlotText(node, 'describe', 'desc', 'content', 'body') || node.rawText

  const titleHtml = fmt(title, ctx)
  const descHtml = fmt(desc, ctx)

  return (
    `<div class="my-5 border border-line border-l-4 ${tone.borderL} bg-sunken/60 px-5 py-3.5 moji-component-notice">` +
    `<div class="flex items-center gap-2">` +
    `<span class="h-1.5 w-1.5 rounded-full ${tone.bg}"></span>` +
    `<span class="text-[0.72em] font-semibold tracking-widest ${tone.text}">${titleHtml}</span>` +
    `</div>` +
    (descHtml ? `<div class="mt-1.5 mb-0 text-[0.88em] leading-relaxed text-ink">${descHtml}</div>` : '') +
    `</div>`
  )
}

/** 2. 配方二：双栏概念交锋 / 正误辨析 (Compare / Duel / Split) */
export function renderCompare(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const leftSlots = node.slots.left || []
  const rightSlots = node.slots.right || []
  const items = node.slots.item || []

  const leftNode = leftSlots[0] || items[0]
  const rightNode = rightSlots[0] || items[1]

  const leftTitle = leftNode?.attrs.title || '直觉误区'
  const leftBadge = leftNode?.attrs.badge || '✗ 常见错误'
  const leftTone = toneColors(leftNode?.attrs.type || leftNode?.attrs.tone || 'warn')
  const leftContent = fmt(leftNode?.content || '', ctx)

  const rightTitle = rightNode?.attrs.title || '严格定义'
  const rightBadge = rightNode?.attrs.badge || '✓ 正确认知'
  const rightTone = toneColors(rightNode?.attrs.type || rightNode?.attrs.tone || 'ok')
  const rightContent = fmt(rightNode?.content || '', ctx)

  return (
    `<div class="my-5 grid grid-cols-1 md:grid-cols-2 gap-4 moji-component-compare">` +
    `<div class="border border-line bg-sunken/50 p-4">` +
    `<div class="flex items-center justify-between border-b border-line pb-2">` +
    `<span class="text-[0.92em] font-semibold text-ink-strong">${fmt(leftTitle, ctx)}</span>` +
    `<span class="${leftTone.bgSoft} px-1.5 py-0.5 text-[0.72em] font-semibold ${leftTone.text}">${fmt(leftBadge, ctx)}</span>` +
    `</div>` +
    `<div class="mt-2.5 mb-0 text-[0.86em] leading-relaxed text-ink-soft">${leftContent}</div>` +
    `</div>` +
    `<div class="border border-line bg-card p-4">` +
    `<div class="flex items-center justify-between border-b border-line pb-2">` +
    `<span class="text-[0.92em] font-semibold text-ink-strong">${fmt(rightTitle, ctx)}</span>` +
    `<span class="${rightTone.bgSoft} px-1.5 py-0.5 text-[0.72em] font-semibold ${rightTone.text}">${fmt(rightBadge, ctx)}</span>` +
    `</div>` +
    `<div class="mt-2.5 mb-0 text-[0.86em] leading-relaxed text-ink">${rightContent}</div>` +
    `</div>` +
    `</div>`
  )
}

/** 3. 配方三：定理 / 核心公式解剖卡 (Formula / Anatomy) */
export function renderFormula(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const title = node.attrs.title || getSlotText(node, 'title', 'badge') || '核心公式解剖'
  const expr = node.attrs.expr || getSlotText(node, 'expr', 'formula') || node.rawText
  const items = node.slots.item || []

  const titleHtml = fmt(title, ctx)
  const exprHtml = fmt(expr, ctx)

  const colCount = Math.max(1, Math.min(items.length, 4))
  const itemsHtml = items
    .map((item) => {
      const name = item.attrs.name || item.attrs.label || item.attrs.title || '项'
      const tone = toneColors(item.attrs.tone || item.attrs.type || 'seal')
      const content = fmt(item.content, ctx)
      return (
        `<div class="p-3.5">` +
        `<span class="font-semibold ${tone.text}">${fmt(name, ctx)}</span>` +
        `<div class="mt-1 mb-0 leading-snug text-ink-soft">${content}</div>` +
        `</div>`
      )
    })
    .join('')

  return (
    `<div class="my-6 border border-line bg-card overflow-hidden moji-component-formula">` +
    `<div class="border-b border-line bg-sunken/50 px-5 py-4 text-center">` +
    `<div class="text-[0.72em] font-semibold tracking-widest text-ink-faint">${titleHtml}</div>` +
    `<div class="mt-1.5 text-[1.35em] font-semibold tracking-wide text-ink-strong tabular-nums">${exprHtml}</div>` +
    `</div>` +
    (items.length > 0
      ? `<div class="grid grid-cols-1 md:grid-cols-${colCount} divide-y md:divide-y-0 md:divide-x divide-line bg-paper/40 text-[0.82em]">${itemsHtml}</div>`
      : '') +
    `</div>`
  )
}

/** 4. 配方四：带贯穿引导线的步骤轴 (Steps / Timeline) */
export function renderSteps(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const stepNodes = node.slots.step || node.slots.item || node.children.filter((c) => c.slotName === 'step' || c.slotName === 'item')
  const steps = stepNodes.length > 0 ? stepNodes : node.children

  const stepsHtml = steps
    .map((s, idx) => {
      const num = s.attrs.num || String(idx + 1)
      const title = s.attrs.title || `步骤 0${idx + 1}`
      const tone = toneColors(s.attrs.tone || s.attrs.type || (idx === steps.length - 1 ? 'default' : 'seal'))
      const bgClass = s.attrs.tone === 'ink' || idx === steps.length - 1 ? 'bg-ink-strong' : tone.bg
      const content = fmt(s.content, ctx)

      return (
        `<div class="relative">` +
        `<span class="absolute -left-[35px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${bgClass} text-[0.72em] font-semibold text-white tabular-nums">${num}</span>` +
        `<h4 class="m-0 text-[0.92em] font-semibold text-ink-strong">${fmt(title, ctx)}</h4>` +
        `<div class="mt-1 mb-0 text-[0.86em] leading-relaxed text-ink-soft">${content}</div>` +
        `</div>`
      )
    })
    .join('')

  return (
    `<div class="my-5 pl-3 moji-component-steps">` +
    `<div class="relative border-l border-line-strong pl-6 space-y-5">` +
    stepsHtml +
    `</div>` +
    `</div>`
  )
}

/** 5. 配方五：横向机制推导链 (Pipeline / Chain) */
export function renderPipeline(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const stages = node.slots.stage || node.slots.item || node.children

  const stagesHtml = stages
    .map((s, idx) => {
      const label = s.attrs.label || `STAGE 0${idx + 1}`
      const title = s.attrs.title || `阶段 ${idx + 1}`
      const tone = toneColors(s.attrs.tone || s.attrs.type || (idx === 0 ? 'default' : idx === 1 ? 'seal' : 'ok'))
      const borderClass = s.attrs.tone ? tone.border : 'border-line'
      const labelColor = s.attrs.tone === 'seal' ? 'text-seal' : s.attrs.tone === 'ok' ? 'text-ok' : 'text-ink-faint'
      const content = fmt(s.content, ctx)

      const card =
        `<div class="flex-1 bg-card p-3 border ${borderClass}">` +
        `<div class="text-[0.72em] ${labelColor} tabular-nums font-semibold">${fmt(label, ctx)}</div>` +
        `<div class="mt-0.5 font-semibold text-ink-strong">${fmt(title, ctx)}</div>` +
        `<div class="mt-1 mb-0 text-[0.88em] leading-snug text-ink-soft">${content}</div>` +
        `</div>`

      if (idx < stages.length - 1) {
        return card + `<div class="flex items-center justify-center text-ink-faint px-1">→</div>`
      }
      return card
    })
    .join('')

  return (
    `<div class="my-5 flex flex-col md:flex-row items-stretch justify-between gap-2 border border-line bg-sunken/40 p-3.5 text-[0.84em] moji-component-pipeline">` +
    stagesHtml +
    `</div>`
  )
}

/** 6. 配方六：关键指标 / 参数看板 (Stat / Dashboard) */
export function renderStat(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const items = node.slots.item || node.slots.stat || node.children
  const colCount = Math.max(1, Math.min(items.length, 4))

  const cardsHtml = items
    .map((item) => {
      const label = item.attrs.label || item.attrs.title || '指标'
      const val = item.attrs.value || item.attrs.val || item.content || '-'
      const tone = toneColors(item.attrs.tone || item.attrs.type || 'seal')
      const note = item.attrs.value ? fmt(item.content, ctx) : ''

      return (
        `<div class="border border-line bg-card px-4 py-3.5">` +
        `<div class="text-[0.74em] text-ink-faint">${fmt(label, ctx)}</div>` +
        `<div class="mt-1 text-[1.5em] font-semibold ${tone.text} tabular-nums">${fmt(val, ctx)}</div>` +
        (note ? `<div class="mt-1 text-[0.78em] text-ink-soft">${note}</div>` : '') +
        `</div>`
      )
    })
    .join('')

  return (
    `<div class="my-5 grid grid-cols-1 md:grid-cols-${colCount} gap-4 moji-component-stat">` +
    cardsHtml +
    `</div>`
  )
}

/** 7. 配方七：词典式术语名片 (Concept / Term) */
export function renderConcept(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const term = node.attrs.term || getSlotText(node, 'term', 'title') || '概念术语'
  const en = node.attrs.en || getSlotText(node, 'en', 'subtitle') || ''
  const tag = node.attrs.tag || getSlotText(node, 'tag', 'badge') || ''
  const desc = getSlotText(node, 'describe', 'desc', 'content', 'def') || node.rawText

  return (
    `<div class="my-4 border border-line bg-card px-5 py-3.5 moji-component-concept">` +
    `<div class="flex items-baseline justify-between border-b border-line pb-2">` +
    `<div class="flex items-baseline gap-2.5">` +
    `<span class="text-[1.05em] font-semibold text-ink-strong">${fmt(term, ctx)}</span>` +
    (en ? `<span class="text-[0.82em] italic text-ink-faint">${fmt(en, ctx)}</span>` : '') +
    `</div>` +
    (tag ? `<span class="bg-sunken px-2 py-0.5 text-[0.72em] text-ink-soft">${fmt(tag, ctx)}</span>` : '') +
    `</div>` +
    `<div class="mt-2.5 mb-0 text-[0.88em] leading-relaxed text-ink">${fmt(desc, ctx)}</div>` +
    `</div>`
  )
}

/** 8. 配方八：分段式构成条 (Breakdown / Segments) */
export function renderBreakdown(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const title = node.attrs.title || getSlotText(node, 'title') || '构成比例拆解'
  const total = node.attrs.total || getSlotText(node, 'total') || '总计 100%'
  const items = node.slots.item || node.children

  const bars = items
    .map((item) => {
      const val = item.attrs.value || item.attrs.val || '10%'
      const tone = toneColors(item.attrs.tone || item.attrs.type || 'seal')
      const width = val.endsWith('%') ? val : `${val}%`
      return `<div class="h-full ${tone.bg}" style="width:${width}"></div>`
    })
    .join('')

  const legends = items
    .map((item) => {
      const label = item.attrs.label || '分类'
      const val = item.attrs.value || item.attrs.val || ''
      const tone = toneColors(item.attrs.tone || item.attrs.type || 'seal')
      return (
        `<span class="flex items-center gap-1.5">` +
        `<i class="inline-block h-2 w-2 rounded-full ${tone.bg}"></i>` +
        `${fmt(label, ctx)} <strong class="tabular-nums text-ink-strong">${fmt(val, ctx)}</strong>` +
        `</span>`
      )
    })
    .join('')

  return (
    `<div class="my-5 border border-line bg-card p-4 moji-component-breakdown">` +
    `<div class="flex items-baseline justify-between text-[0.84em]">` +
    `<span class="font-semibold text-ink-strong">${fmt(title, ctx)}</span>` +
    `<span class="tabular-nums text-ink-faint">${fmt(total, ctx)}</span>` +
    `</div>` +
    `<div class="mt-2.5 flex h-3 w-full overflow-hidden bg-inset gap-0.5">${bars}</div>` +
    `<div class="mt-2.5 flex flex-wrap items-center gap-5 text-[0.76em] text-ink-soft">${legends}</div>` +
    `</div>`
  )
}

/** 9. 配方九：随堂微测 / 自检折叠卡 (Quiz / Check) */
export function renderQuiz(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const title = node.attrs.title || getSlotText(node, 'title') || '快问快答 · 概念自检'
  const question = getSlotText(node, 'question', 'q', 'stem') || node.rawText
  const answer = getSlotText(node, 'answer', 'a', 'explain', 'solution')

  return (
    `<div class="my-5 border border-line bg-card overflow-hidden moji-component-quiz">` +
    `<div class="px-5 py-3.5">` +
    `<span class="bg-seal/10 px-1.5 py-0.5 text-[0.72em] font-semibold text-seal">${fmt(title, ctx)}</span>` +
    `<div class="mt-2 mb-0 text-[0.9em] font-semibold text-ink-strong">${fmt(question, ctx)}</div>` +
    `</div>` +
    (answer
      ? `<details class="group border-t border-dashed border-line bg-sunken/60 px-5 py-3 text-[0.84em] leading-relaxed text-ink-soft">` +
        `<summary class="cursor-pointer select-none font-semibold text-seal/90 hover:text-seal transition-colors list-none flex items-center justify-between">` +
        `<span>▶ 点击展开：查看解析与思路揭晓</span>` +
        `<span class="text-[0.75em] text-ink-faint group-open:hidden">自检答案</span>` +
        `</summary>` +
        `<div class="mt-2.5 pt-2 border-t border-line/40 text-ink">` +
        `<strong class="text-ok">✓ 答案：</strong>` +
        ` ${fmt(answer, ctx)}` +
        `</div>` +
        `</details>`
      : '') +
    `</div>`
  )
}

/** 10. 通用卡片兜底 (Card / Generic Tag) */
export function renderGenericCard(node: ComponentNode, ctx: ComponentRenderCtx): string {
  const title = node.attrs.title || getSlotText(node, 'title', 'header')
  const eyebrow = node.attrs.eyebrow || getSlotText(node, 'eyebrow', 'badge')
  const content = getSlotText(node, 'describe', 'content', 'body') || node.rawText

  const headerHtml =
    eyebrow || title
      ? `<div class="border-b border-line pb-2 mb-3">` +
        (eyebrow ? `<div class="text-[0.72em] font-semibold tracking-widest text-ink-faint">${fmt(eyebrow, ctx)}</div>` : '') +
        (title ? `<div class="text-[1.05em] font-semibold text-ink-strong">${fmt(title, ctx)}</div>` : '') +
        `</div>`
      : ''

  const contentHtml = content ? `<div class="text-[0.88em] leading-relaxed text-ink">${fmt(content, ctx)}</div>` : ''

  return (
    `<div class="my-5 border border-line bg-card p-4 moji-component-card">` +
    headerHtml +
    contentHtml +
    `</div>`
  )
}
