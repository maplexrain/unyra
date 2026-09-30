/**
 * 上下文占用圆环：挂在「提供商 · 模型」选择器右边，一眼看出这个对话有多满。
 *
 * 分子是最近一条回复的输入量（= 下一句话要送进去的规模），分母是模型的上下文窗口。
 * 窗口没填时不算百分比，只画一个灰环——宁可不显示，也不给一个看起来确定、其实错的数。
 *
 * 悬停展开的浮层里给三样东西：上下文进度条、这个对话的累计 token、平均缓存命中率。
 * 平均是**按输入量加权**算的，不是各条命中率的算术平均：只发一句话的那条与读了一整篇
 * 文档的那条，权重显然不该一样。
 */
import type { MessageUsage } from '../../agent/types'
import { averageHitRate, contextRatio, formatPercent, formatTokens, totalUsage } from '../../lib/usage'
import { usePresence } from '../../lib/presence'
import { t } from '../../i18n'

/**
 * 圆环尺寸：外径 16、线宽 2。
 * 原来 20/2.5 摆在「提供商 · 模型」旁边偏大，抢了选择器的视觉重心；
 * 收到 16 后与按钮图标同一个量级，线宽按比例收，粗细观感不变。
 */
const SIZE = 16
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * RADIUS

/** 占用越高越要提醒：过半转黄，九成转红 */
function ratioColor(ratio: number): string {
  if (ratio >= 0.9) return 'var(--color-seal)'
  if (ratio >= 0.5) return 'var(--color-warn)'
  return 'var(--color-ok)'
}

export default function ContextRing({ usages }: { usages: MessageUsage[] }) {
  // 展开状态整个交给 usePresence：它同时管着「渲染不渲染」与进退场动画
  const { open, setOpen, mounted, closing } = usePresence(false, 150)
  const totals = totalUsage(usages)
  const ratio = totals ? contextRatio(totals) : null
  const percent = ratio === null ? 0 : Math.round(ratio * 100)

  const avg = totals ? averageHitRate(totals) : null

  return (
    <div
      className="relative flex h-8 items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={ratio === null ? t('上下文占用未知') : t('上下文已用 {0}%', percent)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-8 w-6 items-center justify-center rounded-lg text-ink-faint"
      >
        <svg width={SIZE} height={SIZE} viewBox={'0 0 ' + SIZE + ' ' + SIZE} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-line" />
          {ratio !== null && ratio > 0 && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE}
              strokeLinecap="round"
              stroke={ratioColor(ratio)}
              strokeDasharray={CIRC * ratio + ' ' + CIRC}
            />
          )}
        </svg>
      </button>

      {/* open 与 mounted 都要：前者决定「该不该显示」，后者让退场动画有机会播完 */}
      {open && mounted && totals && (
        <div
          className={
            'absolute right-0 bottom-full z-30 mb-2 w-60 rounded-xl border border-line bg-card p-3 shadow-lg ' +
            (closing ? 'moji-bloom-up-out' : 'moji-bloom-up')
          }
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[11.5px] font-medium text-ink-strong">{t('上下文占用')}</span>
            <span className="text-[11.5px] text-ink-soft">
              {ratio === null ? t('窗口未知') : formatPercent(ratio)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: percent + '%', background: ratioColor(ratio ?? 0) }}
            />
          </div>
          <div className="mt-1 text-[10.5px] text-ink-faint">
            {formatTokens(totals.contextTokens)} / {totals.contextWindow ? formatTokens(totals.contextWindow) : t('未设置')} token
          </div>

          <div className="my-2 border-t border-line" />

          <Line label={t('本对话输入')} value={formatTokens(totals.input) + ' token'} />
          <Line label={t('本对话输出')} value={formatTokens(totals.output) + ' token'} />
          <Line label={t('平均缓存命中')} value={avg === null ? '—' : formatPercent(avg)} />
          <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
            {t('按每次请求的输入量加权：一轮编排里的每一跳都各自计入（命中总量 ÷ 输入总量）， 不是只拿每轮最后一条回复来平均。')}
          </p>
          {totals.estimated && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
              {t('部分数据是服务端未返回用量时的估算值')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-[10.5px] text-ink-faint">{label}</span>
      <span className="text-[11px] text-ink-soft">{value}</span>
    </div>
  )
}
