/**
 * 上下文压缩的分界线（含可展开的摘要）。
 *
 * 单独一个文件：它插在消息列表的顶部，但它讲的是一段完全不同的东西——
 * 「线以上已经不进上下文了」，读的人需要一眼看出这条线不是一条普通消息。
 */

import { Archive } from 'lucide-react'
import type { ContextSummary } from '../../../agent/types'
import { compactLabel } from '../../../learn/compact'
import MarkdownView from '../../MarkdownView'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'

/**
 * 上下文压缩的分界线。
 *
 * 它落在**摘要与原文之间**：线上面那些消息已经不再进上下文（显示得淡一些），
 * 线下面的是照原样发出去的。摘要本身默认收起——它是给模型看的东西，
 * 平时占了位置只会挡着对话；想核对「它到底记住了什么」时再展开。
 */
export function CompactionDivider({
  summary,
  open,
  onToggle,
}: {
  summary: ContextSummary
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong/70 bg-paper/50 px-2.5 py-1.5">
        <Archive size={12} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink-faint">
          {t(compactLabel(summary))}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
        >
          {open ? t('收起摘要') : t('看摘要')}
        </button>
      </div>
      {open && (
        <div className="moji-in-soft mt-1.5 max-h-[42vh] overflow-y-auto rounded-lg border border-line bg-card px-3 py-2.5">
          <MarkdownView html={renderNote(summary.text)} className="moji-agent-md" />
        </div>
      )}
    </div>
  )
}
