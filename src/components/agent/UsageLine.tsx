/**
 * 一条回复末尾的 token 账：↑输入 ↓输出 · 缓存命中率。
 *
 * 输入用的是这一轮**最后一跳**的量——它等于「此刻上下文占了多少」，
 * 也就是下一句话要送进去的规模；输出是这一轮各跳合计。
 * 老会话没有 usage 字段，这里直接什么都不显示，不占位置。
 */
import type { MessageUsage } from '../../agent/types'
import { formatPercent, formatTokens, hitRateOf } from '../../lib/usage'
import { t } from '../../i18n'

export default function UsageLine({ usage }: { usage?: MessageUsage }) {
  if (!usage || !usage.totalTokens) return null
  const hit = hitRateOf(usage)
  return (
    <span className="select-none text-[10.5px] text-ink-faint" title={usage.estimated ? t('服务端未返回用量，这里是按字数估算的') : undefined}>
      {`↑${formatTokens(usage.contextTokens)} ↓${formatTokens(usage.outputTokens)}`}
      {hit !== null && t(' · 缓存 {0}', formatPercent(hit))}
      {usage.estimated && t(' · 估算')}
    </span>
  )
}
