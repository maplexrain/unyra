import { useRef } from 'react'
import {
  REASONING_EFFORTS,
  REASONING_HINT,
  REASONING_LABEL,
  type ReasoningEffort,
} from '../../ai/types'
import { t } from '../../i18n'

/**
 * 思考档位视觉强调色：雅致的微宝石质感色调（轻快薄荷绿 → 暖琥珀金 → 深入紫罗兰 → 极致珊瑚红）
 */
const EFFORT_ACCENTS: Record<ReasoningEffort, { dot: string; glow: string }> = {
  low: { dot: '#10b981', glow: 'rgba(16, 185, 129, 0.3)' },
  medium: { dot: '#f59e0b', glow: 'rgba(245, 158, 11, 0.3)' },
  high: { dot: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.3)' },
  max: { dot: '#f43f5e', glow: 'rgba(244, 63, 94, 0.3)' },
}

interface Props {
  value: ReasoningEffort
  onChange: (e: ReasoningEffort) => void
  /** 紧凑态：菜单浮层里用，再矮一点、字更紧凑 */
  compact?: boolean
  className?: string
}

export default function EffortSlider({ value, onChange, compact = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const levels = REASONING_EFFORTS
  const n = levels.length
  const index = Math.max(0, levels.indexOf(value))
  const accent = EFFORT_ACCENTS[value]

  /** 指针落在哪一档：点击与拖动共用这一条映射，吸附手感一致 */
  const pickAt = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (!box.width) return
    const ratio = (clientX - box.left) / box.width
    const i = Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))))
    const next = levels[i]
    if (next !== value) onChange(next)
  }

  const step = (delta: number) => {
    const next = levels[Math.min(n - 1, Math.max(0, index + delta))]
    if (next && next !== value) onChange(next)
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={t('思考等级')}
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={index}
      aria-valuetext={REASONING_LABEL[value]}
      title={t('思考等级：{0}（{1}）', REASONING_LABEL[value], t(REASONING_HINT[value]))}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        pickAt(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e.clientX)
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault()
          step(-1)
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault()
          step(1)
        }
      }}
      className={`relative flex select-none touch-none cursor-pointer items-center rounded-full border border-line-strong/40 bg-line/35 p-[2px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-seal/40 focus-visible:ring-offset-1 focus-visible:ring-offset-paper dark:bg-black/25 ${
        compact ? 'h-[25px]' : 'h-[30px]'
      } ${className}`}
    >
      {/* 浮动滑块 Thumb */}
      <div
        className="pointer-events-none absolute inset-y-[2px] rounded-full border border-line-strong/30 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.08),0_0.5px_1px_rgba(0,0,0,0.05)] transition-all duration-200 ease-out dark:border-white/10 dark:bg-elevated dark:shadow-[0_2px_4px_rgba(0,0,0,0.3)]"
        style={{
          left: `calc(${(index / n) * 100}% + 1px)`,
          width: `calc(${100 / n}% - 2px)`,
        }}
      >
        {/* 滑块底部的微弱光晕线，指示当前档位能量感 */}
        <div
          className="absolute inset-x-2 bottom-0 h-[1.5px] rounded-full transition-colors duration-200"
          style={{ backgroundColor: accent.dot, boxShadow: `0 0 6px ${accent.glow}` }}
        />
      </div>

      {/* 档位标签列表 */}
      <div className="relative z-10 grid h-full w-full grid-cols-4 items-center">
        {levels.map((e) => {
          const isActive = e === value
          const levelAccent = EFFORT_ACCENTS[e]
          return (
            <button
              key={e}
              type="button"
              tabIndex={-1}
              onClick={(ev) => {
                ev.stopPropagation()
                if (e !== value) onChange(e)
              }}
              className={`flex h-full items-center justify-center gap-1 rounded-full text-center transition-all duration-150 ${
                compact ? 'text-[11px]' : 'text-[11.5px]'
              } ${
                isActive
                  ? 'font-semibold text-ink-strong'
                  : 'font-normal text-ink-soft/80 hover:text-ink'
              }`}
            >
              {isActive && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full transition-transform duration-200"
                  style={{
                    backgroundColor: levelAccent.dot,
                    boxShadow: `0 0 4px ${levelAccent.dot}`,
                  }}
                />
              )}
              <span className="leading-none">{REASONING_LABEL[e]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
