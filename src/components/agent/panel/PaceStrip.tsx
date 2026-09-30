/**
 * 输入框底下的状态条：轮数 / 步数 / 输出速度 / 累计 token。
 *
 * 数据由 AgentPanel 现推（它才知道消息与实时账），这里只负责怎么摆。
 */

import { Footprints, MessagesSquare, Sigma, Zap } from 'lucide-react'
import { formatTokens } from '../../../lib/usage'
import { t } from '../../../i18n'

/**
 * 输入框底下的状态条：轮数 / 步数 / 输出速度 / 累计 token。
 *
 * 一行 12px 的灰字，四项各占自己的自然宽度、从左往右排（速度与总账没数据就不占位）；
 * 只有在还没有任何回复时整条隐藏。每项都有 title：悬停能看到口径，不必猜「步」指什么。
 */
export function PaceStrip({
  turns,
  steps,
  tps,
  tokens,
}: {
  turns: number
  steps: number
  tps: number | null
  tokens: number
}) {
  if (turns <= 0 && steps <= 0) return null
  return (
    <div className="flex items-center gap-3.5 px-1 pb-1 pt-2 text-[12px] leading-none text-ink-faint tabular-nums">
      <span title={t('这个对话里导师回复的轮数')} className="flex items-center gap-1.5">
        <MessagesSquare size={12} className="shrink-0" />
        {t('{0} 轮', turns)}
      </span>
      <span title={t('累计执行的编排步数（导师每跑一次代码算一步）')} className="flex items-center gap-1.5">
        <Footprints size={12} className="shrink-0" />
        {t('{0} 步', steps)}
      </span>
      {tps !== null && (
        <span title={t('当前输出速度：最近几秒的实时吞吐（请求结束后换成该跳的精确平均）')} className="flex items-center gap-1.5">
          <Zap size={12} className="shrink-0 text-seal/70" />
          {tps} tok/s
        </span>
      )}
      {tokens > 0 && (
        <span title={t('这个对话累计消耗的 token（输入 + 输出）')} className="flex items-center gap-1.5">
          <Sigma size={12} className="shrink-0" />
          {formatTokens(tokens)}
        </span>
      )}
    </div>
  )
}
