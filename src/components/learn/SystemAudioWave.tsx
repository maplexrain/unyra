import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { startLoopback, type LoopbackSession } from '../../lib/audio/loopback'
import { addBreath, applyGravity, barCount, barRanges, sampleBars, smoothBars } from '../../lib/audio/bars'

/**
 * 顶栏的系统音频柱形频谱：电脑正在播的声音，实时画成一排柱。
 *
 * **挂在侧栏底端当一台小电台**：资源管理器滚动区与拖拽提示行之间的一条专属
 * 底带，**满宽**（高 48px）；柱数/柱宽/间隙全部按实际宽度现算（bars.barCount），
 * 侧栏拖宽拖窄都跟着重排，无需任何固定宽度。
 *
 * 数据从系统回环来（src/lib/audio/loopback），这里只管画。三条自我约束与
 * GoalParticles 同一套：
 * - 纯装饰、不挂任何事件——pointer-events 放行，鼠标划过去还是在拖窗口；
 * - 颜色从 CSS 变量读（--color-seal / --color-seal-deep / --color-line-strong），
 *   主题自动跟随；
 * - 尊重「减少动效」：降到约 8fps，柱子还在呼吸，只是不逐帧刷新。
 *
 * 采不到系统音频时（Linux 无回环、无声卡、权限被拒）只剩一排 2px 底座，原因
 * 写进 canvas 的 title——频谱缺席是可理解的降级，不值得为它弹吐司。
 */

/** 下降重力：每帧回落的全高占比（涨即时、落缓慢，见 bars.applyGravity） */
const BAR_FALL = 0.04

/** 峰值帽的下落速度：比柱身慢一截，柱子落下去之后帽还悬在上面（Monstercat 的招牌细节） */
const CAP_FALL = 0.012

/** 静音呼吸的涟漪幅度（0..1 全高占比 ≈ 3px）：无声时柱子缓缓起伏，整块「活着在听」 */
const BREATH_AMP = 0.055

/** 接连失败的重试上限：约半分钟都接不上就放弃（title 里留着原因），不再空转 */
const MAX_RETRIES = 10

/** 主题切换只改 CSS 变量，画布收不到通知；按帧数隔一阵重读一次（GoalParticles 同款） */
const COLOR_REFRESH_FRAMES = 90

export default function SystemAudioWave() {
  const ref = useRef<HTMLCanvasElement | null>(null)

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
    let grad: CanvasGradient | null = null
    let disposed = false
    let session: LoopbackSession | null = null
    let retryTimer = 0
    let attempts = 0

    // 频谱缓冲与频段表按「会话 × 当前宽度」现分配：会话重连、侧栏拖宽拖窄都会重算
    let freq: Uint8Array<ArrayBuffer> | null = null
    let ranges: Array<[number, number]> | null = null
    let bars = 0
    let target = new Float32Array(0)
    let shown = new Float32Array(0)
    // 峰值帽：独立于柱身的第二套高度轨迹，落得更慢（见 bars.applyGravity）
    let caps = new Float32Array(0)
    // 实际画出去的柱高 = 柱身重力 + 静音呼吸；单开一份，别把呼吸喂回重力的状态里
    let drawn = new Float32Array(0)

    /** 柱数变了就重排缓冲与频段表（顺带清零重力状态） */
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
      // 柱身渐变：底部深、顶部强调色；换主题/换尺寸时重建
      grad = ctx.createLinearGradient(0, height, 0, 0)
      grad.addColorStop(0, sealDeep)
      grad.addColorStop(1, seal)
    }

    const setTip = (text: string) => {
      canvas.setAttribute('title', text)
    }

    const start = (): void => {
      void (async () => {
        try {
          const s = await startLoopback({
            // 输出设备切换/拔掉会让回环音轨结束：接上来重连（不计入重试上限）
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
          console.warn('[sys-audio] 采集失败：', err)
          if (attempts < MAX_RETRIES) {
            attempts++
            retryTimer = window.setTimeout(start, 3000)
          }
        }
      })()
    }

    const draw = (now: number): void => {
      ctx.clearRect(0, 0, width, height)

      // 柱数/柱宽/间隙全部按实际宽度现算（侧栏拖宽拖窄跟着重排）；间隙按柱距的
      // 三成走（夹在 1..3px），宽度变了疏密关系不变
      const n = barCount(Math.max(1, width))
      if (n !== bars) realloc(n)
      const step = width / n
      const gap = Math.min(3, Math.max(1, step * 0.3))
      const barW = Math.max(1, step - gap)

      // 底座：每柱常驻 2px，静音时也能看出这里是一排频谱柱
      ctx.fillStyle = line
      ctx.globalAlpha = 0.35
      for (let i = 0; i < n; i++) {
        ctx.fillRect(i * step, height - 2, barW, 2)
      }

      if (session && freq && ranges && session.spectrum(freq)) {
        sampleBars(freq, ranges, target)
        // 段间平滑：相邻柱互相带一带，消掉单柱独有的抖毛刺
        smoothBars(target)
        applyGravity(shown, caps, target, BAR_FALL, CAP_FALL)
        drawn.set(shown)
        addBreath(drawn, now, BREATH_AMP)

        // 柱身：从底座往上长，圆角顶，底部深顶部亮的渐变；半透明——它压在
        // 顶栏内容底下，太实会顶得文字发闷
        ctx.fillStyle = grad ?? seal
        ctx.globalAlpha = 0.5
        for (let i = 0; i < n; i++) {
          const h = drawn[i] * (height - 2)
          if (h < 0.5) continue
          const r = Math.min(barW / 2, h)
          ctx.beginPath()
          ctx.roundRect(i * step, height - 2 - h, barW, h, [r, r, 0, 0])
          ctx.fill()
        }

        // 峰值帽：骑在柱顶正上方 2px 的小节，比柱身亮、落得比柱身慢——
        // 一眼能看出刚才的峰有多高
        ctx.fillStyle = seal
        ctx.globalAlpha = 0.85
        for (let i = 0; i < n; i++) {
          const ch = caps[i] * (height - 2)
          if (ch < 1.5) continue
          ctx.fillRect(i * step, height - 2 - ch - 2, barW, 2)
        }
      }
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
      // 上限 2 倍：4K 屏按 3 倍渲染是白烧 GPU，肉眼也看不出差别
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

  return <canvas ref={ref} aria-hidden="true" className="block h-12 w-full" />
}
