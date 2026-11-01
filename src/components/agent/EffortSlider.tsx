/**
 * 思考档位调节器（Codex 风格能量流体微粒滑块）：
 * 沿圆角胶囊能量管以 5 档推理强度（无 / 低 / 中 / 高 / 最大）切换。
 * 内部是**从右往左**流的能量气泡：右端（白钮那侧）生成、向左飘散并渐渐冷掉，
 * 档位越高流得越快、气泡越多。
 *
 * 色彩是一条**连续色阶**：灰 → 绿 → 蓝 → 紫 → 红。每一档取相邻两段，
 * 右端是本档的能量色（更亮一档），左端是上一档的主色——所以往上拨一档，
 * 看到的是「色带整体往热的方向挪了一格」，而不是五个互不相干的主题色。
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
  /** 档位主色：名称高亮、白钮光晕 */
  color: string
  /** 渐变的右端（能量端）：气泡从这里生成，最亮 */
  energy: string
  /** 渐变的左端：上一档的主色，形成连续色阶 */
  from: string
  glow: string
  gradient: string
  particleGlow: string
  /** 气泡流速（像素/秒，帧率无关）：档位越高越快 */
  speed: number
  /** 同屏气泡数：档位越高越密，「高能」不只是快 */
  count: number
}

/**
 * 五档的视觉参数。
 *
 * 色阶是刻意接上的：low 的左端 = none 的主色，medium 的左端 = low 的主色……
 * 这样拖动时相邻两档之间没有色相断裂，能量管的「温度」是一条连续的轴。
 */
const EFFORT_VISUALS: Record<ReasoningEffort, EffortVisual> = {
  none: {
    color: '#94a3b8',
    energy: '#cbd5e1',
    from: '#475569',
    glow: 'rgba(148, 163, 184, 0.3)',
    gradient: 'linear-gradient(270deg, #cbd5e1 0%, #94a3b8 42%, #475569 100%)',
    particleGlow: 'rgba(148, 163, 184, 0.5)',
    speed: 0,
    count: 0,
  },
  low: {
    color: '#10b981',
    energy: '#34d399',
    from: '#94a3b8',
    glow: 'rgba(16, 185, 129, 0.42)',
    gradient: 'linear-gradient(270deg, #34d399 0%, #10b981 42%, #94a3b8 100%)',
    particleGlow: 'rgba(52, 211, 153, 0.62)',
    speed: 30,
    count: 8,
  },
  medium: {
    color: '#3b82f6',
    energy: '#60a5fa',
    from: '#10b981',
    glow: 'rgba(59, 130, 246, 0.45)',
    gradient: 'linear-gradient(270deg, #60a5fa 0%, #3b82f6 42%, #10b981 100%)',
    particleGlow: 'rgba(96, 165, 250, 0.62)',
    speed: 55,
    count: 10,
  },
  high: {
    color: '#8b5cf6',
    energy: '#a78bfa',
    from: '#3b82f6',
    glow: 'rgba(139, 92, 246, 0.5)',
    gradient: 'linear-gradient(270deg, #a78bfa 0%, #8b5cf6 42%, #3b82f6 100%)',
    particleGlow: 'rgba(167, 139, 250, 0.62)',
    speed: 90,
    count: 12,
  },
  max: {
    color: '#ef4444',
    energy: '#fb7185',
    from: '#8b5cf6',
    glow: 'rgba(239, 68, 68, 0.52)',
    gradient: 'linear-gradient(270deg, #fb7185 0%, #ef4444 42%, #8b5cf6 100%)',
    particleGlow: 'rgba(251, 113, 133, 0.65)',
    speed: 135,
    count: 15,
  },
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

/** 造一颗气泡；x 不给就从右端外沿出发（见 spawnX） */
function makeParticle(x: number): FlowParticle {
  return {
    x,
    baseYRatio: 0.22 + Math.random() * 0.56,
    /*
      尺寸与亮度是按「在彩色液面上真的看得见」定的。
      关键教训：气泡**不能**用同一套渐变色去填——那样它和背景同色系，只剩 alpha 差，
      叠上去就是一层看不见的雾（实测 canvas 里确实画了 1384 个像素，人眼却什么也看不出）。
      气泡本身永远是白的（「气泡」的物理直觉就是亮的、透的），彩色留给光晕：
      低档是绿光、高档是红光——渐变由液面承担，层次由明度承担。
    */
    radius: 0.95 + Math.random() * 0.85, // 直径 1.9 ~ 3.6px
    speedMult: 0.85 + Math.random() * 0.3,
    baseAlpha: 0.5 + Math.random() * 0.32, // 0.5 ~ 0.82：白点压在半透明液面上要够亮
    waveAmp: 0.5 + Math.random() * 0.8, // 柔和起伏幅度
    waveFreq: 0.0008 + Math.random() * 0.001, // 慢速呼吸微波周期
    wavePhase: Math.random() * Math.PI * 2,
  }
}

/**
 * 气泡出生点分布：铺满**当前液面**（不是整条轨道）。
 * 铺整条轨道会让低档的气泡大半落在液面右边——它们得飘十几秒才进得来，
 * 那十几秒里看起来就是「根本没有动画」。
 */
function createInitialParticles(count: number, span: number): FlowParticle[] {
  return Array.from({ length: count }, (_, i) =>
    makeParticle((i / Math.max(1, count)) * Math.max(span, 40) + (Math.random() - 0.5) * 12),
  )
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
  /** 上一档的液面像素宽度：换档缩窄时按比例把气泡压回来（见 effect 里的说明） */
  const liquidSpanRef = useRef(0)
  const levels = REASONING_EFFORTS
  const n = levels.length
  const index = Math.max(0, levels.indexOf(value))
  const visual = EFFORT_VISUALS[value]

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

  /*
    能量气泡：右端（白钮那一侧）生成，向左飘散并渐渐冷掉。
    —— 与填充条的增长方向相反，视觉上是一股顶着液面前沿走的逆流；
       档位越高流速越快、气泡越密，「高能」不只是快，还有挤。

    方向反过来之后有两处必须跟着反：气泡的淡入在右端、淡出在左端；
    回收条件从「越过右边界」变成「越过左边界」。
  */
  useEffect(() => {
    const canvas = canvasRef.current
    const track = ref.current
    if (!canvas || !track) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const v = EFFORT_VISUALS[value]
    const particles = particlesRef.current
    /** 当前档位下能量液的像素宽度：与 JSX 的 fillWidth 同一个式子，气泡只在这段里活着 */
    const liquidWidth = (w: number): number =>
      Math.max(thumbSize, (pct / 100) * (w - thumbSize) + thumbSize)
    /** 画布尺寸 = 轨道尺寸（不是填充宽度）：气泡的 x 与 fillPx 得是同一套像素 */
    let width = 0
    let height = 0
    let rafId = 0
    let running = true
    let lastTime: number | null = null

    if (particles.length === 0) {
      const w0 = track.clientWidth || 260
      height = track.clientHeight || 22
      particles.push(...createInitialParticles(Math.max(v.count, 6), liquidWidth(w0)))
    }

    const updateSize = () => {
      const rect = track.getBoundingClientRect()
      /*
        尺寸拿不到时按轨道宽 260 / 档位高度兜底，而不是直接 return：
        浮层展开的第一帧、或者组件刚从 display:none 里出来时 rect 会是 0，
        那时若跳过设置，width 一直是 0，render 每帧都早退——表现就是「一条死轨道」。
        真正的尺寸随后由 ResizeObserver 补上。
      */
      width = rect.width || track.clientWidth || 260
      // 兜底高度直接用 thumbSize（紧凑态 18 / 常规 22，与轨道 h-[18px]/h-[22px] 同一档）
      height = rect.height || track.clientHeight || thumbSize
      // dpr 下限取 1：有些环境（缩放比 <100% 的虚拟显示）会给出 0.6 之类的小数，
      // 那会让位图比 CSS 尺寸还小，粒子被压成不到一个像素，再被浏览器拉大显示
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const pw = Math.round(width * dpr)
      const ph = Math.round(height * dpr)
      // 只在真的变了才赋：赋值会清空画布并重置上下文状态
      if (canvas.width !== pw) canvas.width = pw
      if (canvas.height !== ph) canvas.height = ph
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    updateSize()

    /*
      换档时把气泡一起压回液面里。
      缩窄（max → low）之后，原先铺在整条轨道上的气泡有一大半落到新液面之外——
      它们得飘十几秒才进得来，那段时间看起来就是「没有动画」。按比例压缩比逐个
      重投更连续：气泡之间的相对位置还在，拨回高档时也不会挤成一团。
    */
    const span = liquidWidth(width || track.clientWidth || 260)
    const prevSpan = liquidSpanRef.current
    if (prevSpan > 0 && span !== prevSpan) {
      const k = span / prevSpan
      for (const p of particles) p.x *= k
    }
    // 兜底：任何情况下都不许有气泡停在液面右边（初始按轨道宽铺的那批就靠这一行收回来）
    for (const p of particles) if (p.x > span) p.x = Math.random() * span
    liquidSpanRef.current = span

    const ro = new ResizeObserver(updateSize)
    ro.observe(track)

    const render = (time: number) => {
      if (!running) return

      if (lastTime === null) lastTime = time
      // 帧间隔秒数（dt），封顶 80ms 防止切后台恢复后瞬移
      const dt = Math.min((time - lastTime) / 1000, 0.08)
      lastTime = time

      const w = width
      const h = height
      if (!w || !h) {
        rafId = requestAnimationFrame(render)
        return
      }

      ctx.clearRect(0, 0, w, h)

      // 能量液的实际右边界（px）：与 JSX 里的 fillWidth 同一个式子
      const fillPx = (pct / 100) * (w - thumbSize) + thumbSize

      if (fillPx <= 0 || v.speed <= 0 || v.count <= 0) {
        rafId = requestAnimationFrame(render)
        return
      }

      // 气泡数跟着档位走：新增的随机铺进轨道，不排队从右端进场（否则拨高一档会看见「一股脑涌出来」）
      while (particles.length < v.count) particles.push(makeParticle(Math.random() * fillPx))
      if (particles.length > v.count) particles.length = v.count

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        // 从右往左（像素/秒 × dt，帧率无关）
        p.x -= v.speed * p.speedMult * dt

        // 飘出左端就回收，从右端外侧重新进场
        if (p.x < -p.radius * 2 - 4) {
          p.x = fillPx + p.radius * 2 + Math.random() * 16
          p.baseYRatio = 0.2 + Math.random() * 0.6
        }

        // 右端淡入、左端淡出，各留 16~18px 的过渡
        const fadeIn = Math.max(0, Math.min(1, (fillPx - p.x) / 16))
        const fadeOut = Math.max(0, Math.min(1, (p.x + p.radius * 2) / 18))
        const alpha = p.baseAlpha * fadeIn * fadeOut
        if (alpha <= 0.02) continue

        // 慢速微波上下浮动
        const y = p.baseYRatio * h + Math.sin(time * p.waveFreq + p.wavePhase) * p.waveAmp
        // 光晕跟着「热度」一起收：快熄灭的气泡还拖一圈光只会显脏
        const heat = Math.min(1, alpha / Math.max(0.001, p.baseAlpha))

        // 不再逐个 save/restore：每个粒子都显式设了 alpha / 填充 / 阴影，末尾一次性复位
        ctx.globalAlpha = alpha
        // 白芯 + 彩色光晕：明度负责「看得见」，色相负责「这一档是什么温度」
        ctx.fillStyle = '#ffffff'
        ctx.shadowColor = v.particleGlow
        ctx.shadowBlur = (p.radius > 1.2 ? 4 : 2.5) * heat
        ctx.beginPath()
        ctx.arc(p.x, y, p.radius, 0, Math.PI * 2)
        ctx.fill()
      }

      // 全局状态复位：留着会渗到下一帧（阴影尤其明显）
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0

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
  }, [value, pct, thumbSize])

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
        {/*
          能量液层：宽度随档位展开（不用 clip-path，见下）。
          渐变定义在**这一层**上，不是整条轨道上——否则低档只露出左边四分之一，
          看到的永远是色带的冷端（灰），「右绿左灰」根本看不见。
          宽度用 calc 过渡，渐变跟着这一层缩放，拨档时像色带被推开一样。
        */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-out overflow-hidden"
          style={{
            width: fillWidth,
            boxShadow: `0 0 14px ${visual.glow}, inset 0 1px 1px rgba(255, 255, 255, 0.3)`,
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
        </div>

        {/*
          气泡画布铺满**整条轨道**（不是填充层）：填充层宽度随档位变，画在上面的话
          每换一档画布尺寸就变一次，粒子的坐标系跟着跳。铺满轨道后宽度只随窗口变。
          粒子自身只活在 [0, fillPx] 内，透明像素不遮挡下面的内阴影与渐变。
        */}
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

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
