import { useRef } from 'react'
import {
  REASONING_EFFORTS,
  REASONING_HINT,
  REASONING_LABEL,
  REASONING_NEON,
  type ReasoningEffort,
} from '../../ai/types'
import { t } from '../../i18n'

/**
 * 思考等级（四档，Low → Max）的选择控件：**滑动变阻**式的滑条。
 *
 * 为什么不是列表菜单：这四档本身是有序的（越往右想得越深），滑条把「序」画了出来，
 * 用户拖一下就换档，不必「展开菜单 → 找到那一项 → 点一下 → 菜单再收回去」。
 *
 * 视觉上刻意做得像一根电阻丝：
 * - 整条底色是当前档位的荧光色，**由低到高 = 绿 / 黄 / 紫 / 红**，一眼看出开到了多深；
 * - 底色上压一层缓慢滚动的斜条纹（见 index.css 的 .moji-effort-zebra-layer），「通电」的感觉；
 * - 档位文字一律用深色（荧光底偏亮，白字会糊成一片），选中的那档坐在一块毛玻璃上。
 *
 * 整体做得矮而窄：它常在输入框旁边当配角，抢版面就过了。
 */

/**
 * 档位文字的颜色写死成深色，**不跟主题走**：滑条底色恒为那四种荧光色、
 * 滑块恒为一块压亮的毛玻璃，两套主题下它都是「亮底压深字」。
 * 用 text-ink 这类主题色会出事——深色主题下它是接近白色的字，
 * 落在玻璃上就彻底看不见了。
 */
const LABEL_COLOR = { on: '#14110d', off: '#2f2a24' } as const

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
  const color = REASONING_NEON[value]

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
      className={`moji-effort-zebra relative cursor-pointer touch-none select-none overflow-hidden rounded-full border border-black/20 p-[3px] outline-none transition-[background-color] duration-300 focus-visible:ring-2 focus-visible:ring-seal/60 ${
        compact ? 'h-[22px]' : 'h-[26px]'
      } ${className}`}
      style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}55` }}
    >
      {/* 条纹单独占一层，而不是画在外框自己的背景上：外框要圆角裁剪，
          背景动画会被合成到按元素盒子取整的图层上，左端于是裂出一道接缝；
          独立一层整体平移就没有这回事（细节见 index.css 的 .moji-effort-zebra-layer） */}
      <span className="moji-effort-zebra-layer" aria-hidden="true" />
      {/* 滑块：半透白的毛玻璃胶囊在档位之间滑动，滑到哪一档就是哪一档。
          不做成纯白——它身下压着滚动的条纹，磨砂一下才有「一块玻璃」的厚度；
          也不能再透：荧光色每一档都不同，透过头就压不住深色字了 */}
      <span className="pointer-events-none absolute inset-y-[3px] left-[3px] right-[3px]" aria-hidden="true">
        <span
          className="absolute inset-y-0 rounded-full border border-white/70 bg-white/45 shadow-[0_1px_3px_rgba(0,0,0,0.28)] backdrop-blur-md transition-[left] duration-300 ease-out"
          style={{ width: `${100 / n}%`, left: `${(index / n) * 100}%` }}
        />
      </span>
      <span className="relative flex h-full items-center">
        {levels.map((e) => (
          <span
            key={e}
            className={`moji-effort-label flex-1 text-center leading-none ${
              compact ? 'text-[10.5px]' : 'text-[11.5px]'
            } ${e === value ? 'font-semibold' : 'font-medium'}`}
            style={{ color: LABEL_COLOR[e === value ? 'on' : 'off'] }}
          >
            {REASONING_LABEL[e]}
          </span>
        ))}
      </span>
    </div>
  )
}
