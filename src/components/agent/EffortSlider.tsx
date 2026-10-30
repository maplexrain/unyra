/**
 * 思考档位调节器（Codex 风格能量流体微粒滑块）：
 * 沿圆角胶囊能量管以 5 档推理强度（无 / 低 / 中 / 高 / 最大）切换，
 * 内部带有自主横向平缓流动的气泡微粒（Fluid Bubble Stream），随档位动态切换主题色：
 * 无档中性灰、低档薄荷绿、中档琥珀金、高档紫罗兰、最大档印章红。
 * 纯白圆钮随档位平滑吸附，支持拖拽、点击与方向键调节。
 */
import { useEffect, useRef } from 'react'
import {
  REASONING_EFFORTS,
  REASONING_HINT,
  REASONING_LABEL,
  type ReasoningEffort,
} from '../../ai/types'
import { t } from '../../i18n'

interface EffortVisual {
  color: string
  glow: string
  gradient: string
  particleGlow: string
}

/**
 * 思考档位视觉参数：随档位动态切换能量液管渐变与发光
 */
const EFFORT_VISUALS: Record<ReasoningEffort, EffortVisual> = {
  none: {
    color: '#94a3b8',
    glow: 'rgba(148, 163, 184, 0.35)',
    gradient: 'linear-gradient(90deg, #475569 0%, #64748b 50%, #94a3b8 100%)',
    particleGlow: 'rgba(255, 255, 255, 0.4)',
  },
  low: {
    color: '#10b981',
    glow: 'rgba(16, 185, 129, 0.45)',
    gradient: 'linear-gradient(90deg, #059669 0%, #10b981 50%, #34d399 100%)',
    particleGlow: 'rgba(52, 211, 153, 0.7)',
  },
  medium: {
    color: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.45)',
    gradient: 'linear-gradient(90deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%)',
    particleGlow: 'rgba(251, 191, 36, 0.7)',
  },
  high: {
    color: '#8b5cf6',
    glow: 'rgba(139, 92, 246, 0.5)',
    gradient: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
    particleGlow: 'rgba(168, 85, 247, 0.7)',
  },
  max: {
    color: '#a8432f',
    glow: 'rgba(168, 67, 47, 0.55)',
    gradient: 'linear-gradient(90deg, #8c3524 0%, #a8432f 50%, #e11d48 100%)',
    particleGlow: 'rgba(244, 63, 94, 0.7)',
  },
}

/**
 * 档位对应的能量液微粒流动速度（像素/秒）：
 * 采用帧率无关的时间增量 dt 计算，在普屏与高刷屏上均保持优雅舒缓的流速。
 */
const FLOW_SPEEDS: Record<ReasoningEffort, number> = {
  none: 0,
  low: 10,     // 约 25 秒穿行全轨，安适舒缓
  medium: 18,  // 约 14 秒穿行全轨，温润流动
  high: 28,    // 约 9 秒穿行全轨，活跃流体
  max: 40,     // 约 6 秒穿行全轨，高能充沛
}

interface FlowParticle {
  x: number
  baseYRatio: number
  radius: number
  speedMult: number
  baseAlpha: number
  waveAmp: number
  waveFreq: number
  wavePhase: number
}

function createInitialParticles(count: number, width: number): FlowParticle[] {
  return Array.from({ length: count }, (_, i) => ({
    // 初始位置均匀交错散布在流体内部
    x: (i / count) * Math.max(width, 100) + (Math.random() - 0.5) * 20,
    baseYRatio: 0.22 + Math.random() * 0.56,
    radius: 0.65 + Math.random() * 0.75, // 直径 1.3 ~ 2.8px 的微气泡
    speedMult: 0.85 + Math.random() * 0.3,
    baseAlpha: 0.16 + Math.random() * 0.2, // 细腻微光不透明度（0.16 ~ 0.36）
    waveAmp: 0.5 + Math.random() * 0.8, // 柔和起伏幅度
    waveFreq: 0.0008 + Math.random() * 0.001, // 慢速呼吸微波周期
    wavePhase: Math.random() * Math.PI * 2,
  }))
}

interface Props {
  value: ReasoningEffort
  onChange: (e: ReasoningEffort) => void
  /** 紧凑态：菜单浮层里用 */
  compact?: boolean
  className?: string
}

export default function EffortSlider({ value, onChange, compact = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<FlowParticle[]>([])
  const levels = REASONING_EFFORTS
  const n = levels.length
  const index = Math.max(0, levels.indexOf(value))
  const visual = EFFORT_VISUALS[value]
  const baseSpeed = FLOW_SPEEDS[value]

  // 当前进度百分比 0 ~ 100%
  const pct = (index / (n - 1)) * 100

  // 滑块圆钮直径（像素）：根据紧凑态适配
  const thumbSize = compact ? 18 : 22
  // 滑块圆钮左侧位移（确保 0% 靠齐最左端、100% 靠齐最右端，无任何溢出或挤压）
  const thumbLeft = `calc(${pct}% - ${(pct / 100) * thumbSize}px)`
  // 填充条宽度（与滑块右边界完全契合连接）
  const fillWidth = `calc(${pct}% + ${(1 - pct / 100) * thumbSize}px)`

  /** 指针拖拽或点击：按百分比吸附到最接近的刻度档位 */
  const pickAt = (clientX: number) => {
    const el = ref.current
    if (!el) return
    const box = el.getBoundingClientRect()
    if (!box.width) return
    const ratio = (clientX - box.left) / box.width
    const i = Math.min(n - 1, Math.max(0, Math.round(ratio * (n - 1))))
    const next = levels[i]
    if (next && next !== value) onChange(next)
  }

  const step = (delta: number) => {
    const next = levels[Math.min(n - 1, Math.max(0, index + delta))]
    if (next && next !== value) onChange(next)
  }

  // 流动气泡 Canvas 动画渲染循环
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId: number
    let running = true
    let lastTime: number | null = null

    // 初始化粒子群
    if (particlesRef.current.length === 0) {
      const initialW = canvas.parentElement?.clientWidth || 260
      particlesRef.current = createInitialParticles(10, initialW)
    }

    // 缩放适配 DPR
    const updateSize = () => {
      if (!canvas || !canvas.parentElement) return
      const rect = canvas.parentElement.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
        ctx.resetTransform?.()
        ctx.scale(dpr, dpr)
      }
    }

    updateSize()
    const ro = new ResizeObserver(updateSize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    const render = (time: number) => {
      if (!running) return

      if (lastTime === null) lastTime = time
      // 帧间隔秒数（dt），封顶 80ms 防止切后台恢复后瞬移
      const dt = Math.min((time - lastTime) / 1000, 0.08)
      lastTime = time

      const w = canvas.width / (window.devicePixelRatio || 1)
      const h = canvas.height / (window.devicePixelRatio || 1)

      ctx.clearRect(0, 0, w, h)

      // 计算当前档位下的流体实际右边界（px）
      const fillPx = (pct / 100) * (w - thumbSize) + thumbSize

      if (fillPx > 0 && baseSpeed > 0) {
        const particles = particlesRef.current

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i]
          // 沿水平方向向前舒缓流动（像素/秒 * dt）
          p.x += baseSpeed * p.speedMult * dt

          // 当气泡流至流体右边界（接近白圆钮）时，循环至最左端重新生成
          if (p.x > fillPx + 4) {
            p.x = -p.radius * 2 - Math.random() * 14
            p.baseYRatio = 0.2 + Math.random() * 0.6
          }

          // 进场（左侧淡入）与出场（右侧临近圆钮淡出）平滑淡化，绝无突兀闪烁
          const fadeIn = Math.max(0, Math.min(1, (p.x + p.radius * 2) / 16))
          const fadeOut = Math.max(0, Math.min(1, (fillPx - p.x) / 18))
          const alpha = p.baseAlpha * fadeIn * fadeOut

          if (alpha <= 0.02) continue

          // 慢速微波上下浮动
          const y = p.baseYRatio * h + Math.sin(time * p.waveFreq + p.wavePhase) * p.waveAmp

          ctx.save()
          ctx.globalAlpha = alpha
          ctx.fillStyle = '#ffffff'
          ctx.shadowColor = visual.particleGlow
          ctx.shadowBlur = p.radius > 1.1 ? 3 : 1.5
          ctx.beginPath()
          ctx.arc(p.x, y, p.radius, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }

      rafId = requestAnimationFrame(render)
    }

    rafId = requestAnimationFrame(render)

    // 页面切到后台时暂停动画节省电量
    const onVisChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId)
      } else {
        lastTime = null
        rafId = requestAnimationFrame(render)
      }
    }
    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      running = false
      cancelAnimationFrame(rafId)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [pct, baseSpeed, visual.particleGlow, thumbSize])

  return (
    <div className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-2'} select-none ${className}`}>
      {/* 能量胶囊滑动轨道 */}
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
        className={`group relative flex select-none touch-none cursor-pointer items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-seal/40 bg-[#24211e] dark:bg-[#141210] border border-black/25 dark:border-white/10 shadow-[inset_0_1.5px_3.5px_rgba(0,0,0,0.45)] transition-colors duration-300 ${
          compact ? 'h-[18px]' : 'h-[22px]'
        }`}
      >
        {/* 内部能量液层：通过 clip-path 随滑块平滑展开，内部多个梯度层通过 opacity 实现平滑色彩切换 (transition) */}
        <div
          className="absolute inset-0 rounded-full transition-all duration-300 ease-out overflow-hidden"
          style={{
            boxShadow: `0 0 14px ${visual.glow}, inset 0 1px 1px rgba(255, 255, 255, 0.3)`,
            clipPath: `inset(0 calc(100% - ${fillWidth}) 0 0 round 9999px)`,
          }}
        >
          {levels.map((lvl) => {
            const v = EFFORT_VISUALS[lvl]
            const active = lvl === value
            return (
              <div
                key={lvl}
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none transition-opacity duration-300 ease-out"
                style={{
                  background: v.gradient,
                  opacity: active ? 1 : 0,
                }}
              />
            )
          })}
          {/* 流动气泡微粒画布 Canvas：气泡随流体流向白钮，活灵活现 */}
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>

        {/* 纯白滑块圆钮 Thumb（微宝石质感纯白圆球，带立体阴影与档位光晕，随档位平滑过渡） */}
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-white ring-1 ring-black/10 transition-all duration-300 ease-out z-10"
          style={{
            left: thumbLeft,
            width: `${thumbSize}px`,
            height: `${thumbSize}px`,
            boxShadow: `0 2px 6px rgba(0,0,0,0.42), 0 0 8px ${visual.glow}`,
          }}
        />
      </div>

      {/* 刻度下方档位名称列表 */}
      <div className="relative flex w-full justify-between items-center px-0.5">
        {levels.map((e) => {
          const isSelected = e === value
          const itemVisual = EFFORT_VISUALS[e]
          return (
            <button
              key={e}
              type="button"
              tabIndex={-1}
              onClick={(ev) => {
                ev.stopPropagation()
                onChange(e)
              }}
              className={`text-center leading-none transition-all duration-300 cursor-pointer ${
                compact ? 'text-[10px]' : 'text-[11px]'
              } ${
                isSelected
                  ? 'font-semibold'
                  : 'font-normal text-ink-faint hover:text-ink'
              }`}
              style={{
                color: isSelected ? itemVisual.color : undefined,
                transition: 'color 300ms ease-out',
              }}
            >
              {REASONING_LABEL[e]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
