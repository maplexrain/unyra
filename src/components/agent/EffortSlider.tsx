import { useRef } from 'react'
import { REASONING_EFFORTS, REASONING_HINT, REASONING_LABEL, type ReasoningEffort } from '../../ai/types'
import { t } from '../../i18n'

/**
 * 思考等级（四档，Low → Max）的选择控件：一根**进度条**。
 *
 * 视觉口径（用户定的）：背景不再跟着档位变色，整根是粉紫色左右渐变——
 * 组件从滑动变阻器改成进度条，**只有进度条本身有颜色**：走到哪一档，
 * 渐变就填到哪一格，剩下的轨道保持素色。
 *
 * 交互还是那套：点击 / 拖动按「最近的档位」吸附，键盘左右也能换档。
 * 整体做得矮而窄：它常在输入框旁边当配角，抢版面就过了。
 */

/** 进度条的粉紫渐变（左右方向，写死不跟主题走：它是这个控件的身份色） */
const FILL_GRADIENT = 'linear-gradient(90deg, #f472b6, #a78bfa)'

interface Props {
  value: ReasoningEffort
  onChange: (e: ReasoningEffort) => void
  /** 紧凑态：菜单浮层里用，再矮一点、字再小一点 */
  compact?: boolean
  className?: string
}

export default function EffortSlider({ value, onChange, compact = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const levels = REASONING_EFFORTS
  const n = levels.length
  const index = Math.max(0, levels.indexOf(value))

  /** 指针落在哪一档：点击与拖动共用这一条映射，手感才一致 */
  const pickAt = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (!box.width) return
    const ratio = (clientX - box.left) / box.width
    // 按「最近的档位」吸附，而不是按落点所在的格子：拖到两档之间时，
    // 过中线才换，来回抖动不会在两个值之间反复横跳
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
        // 捕获指针：拖出控件外也照样跟手，松手才算数
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
      className={`relative cursor-pointer touch-none select-none overflow-hidden rounded-full border border-line-strong bg-line/60 p-[3px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-seal/60 ${
        compact ? 'h-[22px]' : 'h-[26px]'
      } ${className}`}
    >
      {/* 进度填充：到当前档位为止的那一段是粉紫渐变，宽度带过渡——换档看着是「长过去」的 */}
      <span className="pointer-events-none absolute inset-y-[3px] left-[3px]" aria-hidden="true">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `calc(${(index / n) * 100}% + ${100 / n}% - 3px)`, background: FILL_GRADIENT }}
        />
      </span>
      <span className="relative flex h-full items-center">
        {levels.map((e) => {
          // 选中的那档坐在渐变上（渐变一定盖到它：i <= index），用白字；
          // 没选中的在素色轨道上，用主题的次级字色
          const on = e === value
          return (
            <span
              key={e}
              className={`flex-1 text-center leading-none transition-colors duration-300 ${
                compact ? 'text-[10.5px]' : 'text-[11.5px]'
              } ${on ? 'font-semibold text-white' : 'font-medium text-ink-soft'}`}
              style={on ? { textShadow: '0 1px 2px rgba(0,0,0,0.25)' } : undefined}
            >
              {REASONING_LABEL[e]}
            </span>
          )
        })}
      </span>
    </div>
  )
}
