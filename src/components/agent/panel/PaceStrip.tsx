/**
 * 输入框底下的状态行（AgentPanel）：轮数 / 输出速度 / 累计 token / 上下文占用。
 *
 * 数据由 AgentPanel 现推（它才知道消息与实时账），这里只负责怎么摆。
 * 上下文圆环原本挂在输入框右下角那颗「提供商 · 模型」旁边，2026-11 搬到这儿：
 * 它与左边这几个数是一路货（都是「这个对话的账」），而右下角那颗按钮那一排要留给动作。
 */

import { MessagesSquare, Sigma, Zap } from 'lucide-react'
import type { MessageUsage } from '../../../agent/types'
import { formatTokens } from '../../../lib/usage'
import ContextRing from '../ContextRing'
import { t } from '../../../i18n'

/**
 * 状态行右侧的三个数：轮数 / 输出速度 / 累计 token。
 *
 * 一行 12px 的灰字，各项占自己的自然宽度、从左往右排（速度与总账没数据就不占位）；
 * 只有在还没有任何回复时整段隐藏。每项都有 title：悬停能看到口径。
 * 它住在 AgentPanel 的状态行里（与「正在辅导」同一行），行距由那一行统一管。
 */
export function PaceStrip({
  turns,
  tps,
  tokens,
  usages,
}: {
  turns: number
  tps: number | null
  tokens: number
  /** 每一轮的用量：圆环按它算上下文占用（见 ContextRing） */
  usages: MessageUsage[]
}) {
  if (turns <= 0) return null
  return (
    <div className="flex shrink-0 items-center gap-3.5 text-[12px] leading-none text-ink-faint tabular-nums">
      <span title={t('这个对话里导师回复的轮数')} className="flex items-center gap-1.5">
        <MessagesSquare size={12} className="shrink-0" />
        {t('{0} 轮', turns)}
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
      {/* 上下文占用：紧跟在累计 token 之后——「花了多少」与「还剩多少地方」是同一件事的两面 */}
      <ContextRing usages={usages} />
    </div>
  )
}
