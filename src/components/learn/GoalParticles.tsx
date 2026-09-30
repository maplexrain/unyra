import { useEffect, useRef } from 'react'

/**
 * 目标创建页的粒子背景：缓慢漂移的点 + 近处的连线。
 *
 * 为什么用 canvas 而不是几十个 div：这里的点是**互相连线**的（近的点之间连一条
 * 淡线，像知识的关联），用 DOM 画线要么靠边框拼、要么靠 SVG，节点一多就都在
 * 每帧改样式，得不偿失。canvas 一次 clearRect + 几十个 arc 就完事。
 *
 * 三条自我约束：
 * - 只有装饰作用，所以 pointer-events-none，绝不抢输入框的点击与选择；
 * - 颜色从 CSS 变量读（--color-seal / --color-ink-faint），深浅色主题自动跟随，
 *   画布不像 CSS 那样能继承变量，只能自己读出来；
 * - 尊重「减少动效」偏好：这时不跑动画循环，只静态画一帧。
 */

interface Dot {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
  speed: number
}

/** 每约 1.8 万平方像素一颗，夹在 26–64 之间：大窗口不空旷，小窗口不拥挤 */
const dotCount = (w: number, h: number) => Math.max(26, Math.min(64, Math.round((w * h) / 18000)))

/** 连线的最大距离：比这更远的两点之间不该再暗示「有关系」 */
const LINK_DIST = 132

/** 主题切换只改 CSS 变量，画布收不到通知；按帧数隔一阵重读一次即可 */
const COLOR_REFRESH_FRAMES = 90

export default function GoalParticles({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let dots: Dot[] = []
    let raf = 0
    let frames = 0
    let seal = '#a8432f'
    let faint = '#a89e90'

    const readColors = () => {
      const cs = getComputedStyle(canvas)
      seal = cs.getPropertyValue('--color-seal').trim() || seal
      faint = cs.getPropertyValue('--color-ink-faint').trim() || faint
    }

    const seed = () => {
      dots = Array.from({ length: dotCount(width, height) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        // 速度压得很低：这是背景，不该把视线从输入框上拉走
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: 1 + Math.random() * 1.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.006 + Math.random() * 0.01,
      }))
    }

    /** 画一帧。t 是毫秒时间戳，用来做呼吸式的明暗起伏 */
    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height)

      // 先连线、后画点：点压在线上，交叠处才清楚
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i]
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 > LINK_DIST * LINK_DIST) continue
          ctx.globalAlpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.16
          ctx.strokeStyle = seal
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      for (const p of dots) {
        ctx.globalAlpha = 0.16 + 0.16 * (0.5 + 0.5 * Math.sin(t * p.speed + p.phase))
        // 大点用印章红（少数），小点用墨灰（多数），避免整片背景泛红
        ctx.fillStyle = p.r > 1.8 ? seal : faint
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const step = (t: number) => {
      for (const p of dots) {
        p.x += p.vx
        p.y += p.vy
        // 出界就从另一侧绕回来，粒子数始终稳定
        if (p.x < -4) p.x = width + 4
        else if (p.x > width + 4) p.x = -4
        if (p.y < -4) p.y = height + 4
        else if (p.y > height + 4) p.y = -4
      }
      draw(t)
      if (++frames % COLOR_REFRESH_FRAMES === 0) readColors()
      raf = window.requestAnimationFrame(step)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      // 上限 2 倍：4K 屏按 3 倍渲染是白烧 GPU，肉眼也看不出差别
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      readColors()
      seed()
      if (reduce) draw(0)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    if (!reduce) raf = window.requestAnimationFrame(step)

    return () => {
      ro.disconnect()
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  )
}
