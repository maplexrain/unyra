import { t } from '../../i18n'
import type { PluginRenderContext } from '../renderPlugins'
import { parseAiqaBlock } from './parse'

export const AIQA_LANG = 'aiqa'

export function aiqaBlock(source: string, ctx: PluginRenderContext): string {
  const raw = source.trim()
  if (!raw) {
    return (
      `<div class="moji-aiqa moji-aiqa-error my-3 border border-warn/40 bg-warn/10 p-3 rounded-none text-xs text-ink font-sans">` +
      `<div class="font-medium text-warn mb-1">${ctx.escape(t('AIQA 语法错误：内容为空'))}</div>` +
      `</div>`
    )
  }

  const parsed = parseAiqaBlock(raw)
  if (!parsed.question && !parsed.system) {
    return (
      `<div class="moji-aiqa moji-aiqa-error my-3 border border-warn/40 bg-warn/10 p-3 rounded-none text-xs text-ink font-sans">` +
      `<div class="font-medium text-warn mb-1">${ctx.escape(t('AIQA 语法错误：未指定 system 或 question'))}</div>` +
      `<pre class="text-[11px] text-ink-soft"><code>${ctx.escape(raw)}</code></pre>` +
      `</div>`
    )
  }

  const safeQuestion = parsed.question || t('请回答下列问题：')
  const safeSystem = parsed.system || t('你是一位严谨耐心的老师，请根据学生回答进行点评与引导。')

  // 占位容器：无圆角直角风格卡片，默认形态展示开场白与静态输入区预占位（避免布局跳动）
  return (
    `<div class="moji-aiqa my-4 rounded-none border border-line bg-surface/90 shadow-2xs font-sans select-text" ` +
    `data-aiqa-id="${ctx.attr(parsed.id)}" ` +
    `data-aiqa-question="${ctx.attr(safeQuestion)}" ` +
    `data-aiqa-system="${ctx.attr(safeSystem)}">` +
    `<div class="p-3.5">` +
    `<div class="flex items-center gap-1.5 text-xs font-semibold text-seal mb-2 select-none">` +
    `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` +
    `<span>${ctx.escape(t('问答考察'))}</span>` +
    `</div>` +
    `<div class="text-xs text-ink font-medium leading-relaxed mb-3 whitespace-pre-wrap select-text">${ctx.escape(safeQuestion)}</div>` +
    `<div class="flex items-center gap-2">` +
    `<div class="flex-1 rounded-none border border-line bg-paper/60 px-3 py-1.5 text-xs text-ink-faint select-none">${ctx.escape(t('输入你的回答...'))}</div>` +
    `<div class="rounded-none bg-seal px-3.5 py-1.5 text-xs font-medium text-white opacity-60 select-none">${ctx.escape(t('发送'))}</div>` +
    `</div>` +
    `</div>` +
    `</div>`
  )
}
