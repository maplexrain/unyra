import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { startLoopback, type LoopbackSession } from '../../lib/audio/loopback'
import { addBreath, applyGravity, barCount, barRanges, sampleBars, smoothBars } from '../../lib/audio/bars'

/**
 * 资源管理器底部的系统音频律动频谱：电脑正在播的声音，实时画成灵动光波。
 *
 * **挂在侧栏底端当一台小电台**：
 * - 纯装饰、无文字、无边框、无背景底色，与侧栏底色融为一体；
 * - 响应主题色切换（--color-seal / --color-seal-deep / --color-line-strong）；
 * - 采用流体极光底衬、双层高质感光柱、悬浮流光珠与环境自然呼吸律动；
 * - 鼠标划过带有轻盈的交互声波荡漾，整体灵动、现代且通透。
 */

/** 下降重力：每帧回落的全高占比（涨即时、落缓慢，见 bars.applyGravity） */
const BAR_FALL = 0.045

/** 峰值帽的下落速度：比柱身慢一截，柱子落下去之后流光珠还缓缓悬浮漂移 */
const CAP_FALL = 0.014

/** 静音呼吸的涟漪幅度（0..1 全高占比） */
const BREATH_AMP = 0.06

/** 静音判定线：峰值低于此值判定为静音状态 */
const SILENCE_LEVEL = 0.035

/** 接连失败的重试上限 */
const MAX_RETRIES = 10

/** 主题切换按帧数隔一阵重读一次 */
const COLOR_REFRESH_FRAMES = 90

export default function SystemAudioWave() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const mouseRef = useRef<{ x: number; active: boolean }>({ x: -1, active: false })

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let raf = 0
    let frames = 0
    let seal = '#a8432f'
    let sealDeep = '#8c3524'
    let line = '#d0c6b1'
    let disposed = false
    let session: LoopbackSession | null = null
    let retryTimer = 0
    let attempts = 0

    // 频谱缓冲与频段表
    let freq: Uint8Array<ArrayBuffer> | null = null
    let ranges: Array<[number, number]> | null = null
    let bars = 0
    let target = new Float32Array(0)
    let shown = new Float32Array(0)
    let caps = new Float32Array(0)
    let drawn = new Float32Array(0)

    const realloc = (n: number): void => {
      bars = n
      target = new Float32Array(n)
      shown = new Float32Array(n)
      caps = new Float32Array(n)
      drawn = new Float32Array(n)
      ranges = session ? barRanges(session.sampleRate(), session.bins(), n) : null
    }

    const readColors = () => {
      const cs = getComputedStyle(canvas)
      seal = cs.getPropertyValue('--color-seal').trim() || seal
      sealDeep = cs.getPropertyValue('--color-seal-deep').trim() || sealDeep
      line = cs.getPropertyValue('--color-line-strong').trim() || line
    }

    const setTip = (text: string) => {
      canvas.setAttribute('title', text)
    }

    const start = (): void => {
      void (async () => {
        try {
          const s = await startLoopback({
            onEnded: () => {
              if (disposed) return
              session?.stop()
              session = null
              setTip(t('输出设备变了，重新接系统音频'))
              window.clearTimeout(retryTimer)
              retryTimer = window.setTimeout(start, 800)
            },
          })
          if (disposed) {
            s.stop()
            return
          }
          session = s
          freq = new Uint8Array(s.bins())
          realloc(barCount(Math.max(1, width)))
          attempts = 0
          setTip(t('正在监听系统音频'))
        } catch (err) {
          if (disposed) return
          session = null
          freq = null
          ranges = null
          const msg = err instanceof Error ? err.message : String(err)
          setTip(t('系统音频拿不到：{0}', msg))
          if (attempts < MAX_RETRIES) {
            attempts++
            retryTimer = window.setTimeout(start, 3000)
          }
        }
      })()
    }

    const draw = (now: number): void => {
      ctx.clearRect(0, 0, width, height)

      const n = barCount(Math.max(1, width))
      if (n !== bars) realloc(n)
      const step = width / n
      const gap = Math.min(2.5, Math.max(1, step * 0.16))
      const barW = Math.max(1.5, step - gap)
      const baseY = height - 4
      const usableHeight = Math.max(10, baseY - 8)

      let realAudioPlaying = false

      if (session && freq && ranges && session.spectrum(freq)) {
        sampleBars(freq, ranges, target)
        smoothBars(target)
        applyGravity(shown, caps, target, BAR_FALL, CAP_FALL)
        drawn.set(shown)
        addBreath(drawn, now, BREATH_AMP)

        let capPeak = 0
        for (let i = 0; i < n; i++) if (caps[i] > capPeak) capPeak = caps[i]
        realAudioPlaying = capPeak > SILENCE_LEVEL
      } else {
        // 无声音输入或静音待机时：赋予灵动自然的双频正弦有机呼吸波（使界面具备呼吸感生命力）
        for (let i = 0; i < n; i++) {
          const t1 = now * 0.0016
          const t2 = now * 0.0008
          const wave1 = Math.sin(t1 + i * 0.32)
          const wave2 = Math.cos(t2 - i * 0.2)
          const wave3 = Math.sin(t1 * 0.5 + i * 0.12)
          const idleVal = 0.05 + 0.065 * (wave1 * 0.5 + wave2 * 0.3 + wave3 * 0.2 + 0.5)

          drawn[i] = Math.max(drawn[i] * 0.94, idleVal)
          caps[i] = Math.max(caps[i] * 0.96, drawn[i])
        }
      }

      // 鼠标划过微交互波动：靠近鼠标指针的柱产生优雅的微隆起波澜
      const mouse = mouseRef.current
      if (mouse.active && mouse.x >= 0) {
        for (let i = 0; i < n; i++) {
          const barCenterX = i * step + barW / 2
          const dist = Math.abs(barCenterX - mouse.x)
          if (dist < 45) {
            const factor = (1 - dist / 45) * 0.16
            drawn[i] = Math.min(1, drawn[i] + factor)
            if (drawn[i] > caps[i]) caps[i] = drawn[i]
          }
        }
      }


      // --- 图层 1：极光流体呼吸底衬（柔光平滑曲线） ---
      ctx.beginPath()
      ctx.moveTo(0, baseY)
      for (let i = 0; i < n; i++) {
        const cx = i * step + barW / 2
        const cy = baseY - drawn[i] * usableHeight
        if (i === 0) {
          ctx.lineTo(cx, cy)
        } else {
          const prevCx = (i - 1) * step + barW / 2
          const prevCy = baseY - drawn[i - 1] * usableHeight
          const midX = (prevCx + cx) / 2
          const midY = (prevCy + cy) / 2
          ctx.quadraticCurveTo(prevCx, prevCy, midX, midY)
        }
      }
      const lastCx = (n - 1) * step + barW / 2
      const lastCy = baseY - drawn[n - 1] * usableHeight
      ctx.lineTo(lastCx, lastCy)
      ctx.lineTo(width, baseY)
      ctx.closePath()

      const auroraGrad = ctx.createLinearGradient(0, baseY - usableHeight, 0, baseY)
      auroraGrad.addColorStop(0, seal)
      auroraGrad.addColorStop(1, 'transparent')
      ctx.fillStyle = auroraGrad
      ctx.globalAlpha = realAudioPlaying ? 0.15 : 0.08
      ctx.fill()

      // --- 图层 2：底座基垫（半透明圆角底托） ---
      ctx.fillStyle = line
      ctx.globalAlpha = 0.22
      for (let i = 0; i < n; i++) {
        const bx = i * step
        ctx.beginPath()
        ctx.roundRect(bx, baseY - 1.5, barW, 2, 1)
        ctx.fill()
      }

      // --- 图层 3：主频谱光柱（丰富渐变 + 顶部高光） ---
      const barGrad = ctx.createLinearGradient(0, baseY, 0, baseY - usableHeight)
      barGrad.addColorStop(0, sealDeep)
      barGrad.addColorStop(0.65, seal)
      barGrad.addColorStop(1, seal)

      for (let i = 0; i < n; i++) {
        const h = Math.max(2, drawn[i] * usableHeight)
        const bx = i * step
        const by = baseY - h
        const r = Math.min(barW / 2, 2.5)

        ctx.fillStyle = barGrad
        ctx.globalAlpha = realAudioPlaying ? 0.85 : 0.65
        ctx.beginPath()
        ctx.roundRect(bx, by, barW, h, [r, r, 0.5, 0.5])
        ctx.fill()

        // 较高柱顶部的微弱反光珠，增添琉璃通透感
        if (h > 8) {
          ctx.fillStyle = '#ffffff'
          ctx.globalAlpha = 0.3
          ctx.beginPath()
          ctx.roundRect(bx + 0.5, by + 0.5, barW - 1, Math.min(2, h * 0.18), 1)
          ctx.fill()
        }
      }

      // --- 图层 4：悬浮流光峰值珠（慢速漂浮回落） ---
      for (let i = 0; i < n; i++) {
        const ch = caps[i] * usableHeight
        if (ch < 3) continue
        const bx = i * step
        const beadY = baseY - ch - 3
        const beadH = 2

        ctx.save()
        ctx.fillStyle = seal
        ctx.globalAlpha = realAudioPlaying ? 0.95 : 0.75
        if (realAudioPlaying) {
          ctx.shadowColor = seal
          ctx.shadowBlur = 4
        }
        ctx.beginPath()
        ctx.roundRect(bx, beadY, barW, beadH, 1)
        ctx.fill()
        ctx.restore()
      }

      // --- 图层 5：底部微倒影 ---
      ctx.save()
      ctx.globalAlpha = 0.08
      for (let i = 0; i < n; i++) {
        const rh = Math.min(4, drawn[i] * usableHeight * 0.2)
        if (rh <= 0.5) continue
        const bx = i * step
        ctx.fillStyle = seal
        ctx.fillRect(bx, baseY + 1, barW, rh)
      }
      ctx.restore()

      ctx.globalAlpha = 1
    }

    const step = (now: number): void => {
      frames++
      if (!reduce || frames % 8 === 0) draw(now)
      if (frames % COLOR_REFRESH_FRAMES === 0) readColors()
      raf = window.requestAnimationFrame(step)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      readColors()
      draw(0)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    start()
    raf = window.requestAnimationFrame(step)

    return () => {
      disposed = true
      ro.disconnect()
      if (raf) window.cancelAnimationFrame(raf)
      window.clearTimeout(retryTimer)
      session?.stop()
    }
  }, [])

  return (
    <div
      className="relative w-full"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        mouseRef.current = { x: e.clientX - rect.left, active: true }
      }}
      onMouseLeave={() => {
        mouseRef.current = { x: -1, active: false }
      }}
    >
      <canvas ref={ref} aria-hidden="true" className="block h-10 w-full cursor-pointer" />
    </div>
  )
}
