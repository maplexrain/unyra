/**
 * 思维层顶部的上下文账。
 *
 * 用户看 mind 是为了判断「它现在还记得多少、为这段执行烧了多少」：
 * - **当前占用**取最近一跳的输入量 ÷ 上下文窗口（下一句话要送进去的规模）；
 * - **累计消耗**把所有跳的输入与输出分别加总（编排里的每一跳都单独计费）。
 *
 * 这里只做展示，数据由 AgentPanel 从当前会话 / 当前 work 的 usage 现推。
 * role mind 与 work 二级页共用这一块，口径完全一致。
 */
import { useMemo } from 'react'
import { Database, Sigma } from 'lucide-react'
import type { MessageUsage } from '../../../agent/types'
import { averageHitRate, contextRatio, formatPercent, formatTokens, totalUsage } from '../../../lib/usage'
import { t, useLocale } from '../../../i18n'

/** 占用越高越醒：与 ContextRing 同一套阈值 */
function ratioColor(ratio: number): string {
  if (ratio >= 0.9) return 'var(--color-seal)'
  if (ratio >= 0.5) return 'var(--color-warn)'
  return 'var(--color-ok)'
}

export function MindContextSummary({
  usages,
  subject,
  embedded = false,
}: {
  usages: MessageUsage[]
  /** 这段账属于谁：role 名 / work 名；只用于标题，不改变计算 */
  subject?: string
  /** 嵌在右侧状态面板里：不吸顶、不画边框/圆角/投影，只承担内容 */
  embedded?: boolean
}) {
  useLocale()
  const totals = useMemo(() => totalUsage(usages), [usages])
  if (!totals) return null
  const ratio = contextRatio(totals)
  const percent = ratio === null ? null : Math.round(ratio * 100)
  const avg = averageHitRate(totals)
  return (
    <div
      data-mind-context-summary
      className={
        embedded
          ? 'bg-transparent px-0 py-0'
          : 'sticky top-0 z-20 mb-3 rounded-xl border border-line/80 bg-card/95 px-3 py-2 shadow-[0_1px_0_rgba(31,27,23,0.04)] backdrop-blur-sm'
      }
      title={
        subject
          ? t('{0} 的上下文账：当前占用取最近一跳，累计消耗按每次请求的输入量加总', subject)
          : t('当前占用取最近一跳，累计消耗按每次请求的输入量加总')
      }
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <Database size={12} className="shrink-0 text-seal/75" />
        <span className="text-[11.5px] font-medium text-ink-strong">{t('上下文占用')}</span>
        {percent === null ? (
          <span className="text-[11px] text-ink-faint">{t('窗口未知')}</span>
        ) : (
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: ratioColor(ratio ?? 0) }}>
            {percent}%
          </span>
        )}
        <span className="text-[10.5px] tabular-nums text-ink-faint">
          {formatTokens(totals.contextTokens)} / {totals.contextWindow ? formatTokens(totals.contextWindow) : t('未设置')} token
        </span>
        <span className="ml-auto text-[10.5px] tabular-nums text-ink-faint">
          {t('{0} 次请求', totals.messages)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line/70">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: (percent ?? 0) + '%', background: ratioColor(ratio ?? 0) }}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] tabular-nums text-ink-faint">
        <span className="flex items-center gap-1">
          <Sigma size={10} className="shrink-0" />
          {t('累计输入 {0}', formatTokens(totals.input))}
        </span>
        <span>{t('输出 {0}', formatTokens(totals.output))}</span>
        {avg !== null && <span>{t('缓存命中 {0}', formatPercent(avg))}</span>}
        {totals.estimated && <span>{t('含估算')}</span>}
      </div>
    </div>
  )
}
