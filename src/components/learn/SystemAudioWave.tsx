import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { FFT_SIZE, startLoopback, type LoopbackSession } from '../../lib/audio/loopback'
import { autoGain, sampleWave, WAVE_POINTS } from '../../lib/audio/wave'

/**
 * 顶栏的系统音频波浪：电脑正在播的声音，实时画成一条波。
 *
 * 数据从系统回环来（src/lib/audio/loopback），这里只管画。三条自我约束与
 * GoalParticles 同一套：
 * - 纯装饰、不挂任何事件——它处在顶栏拖拽区里，鼠标划过去还是在拖窗口；
 * - 颜色从 CSS 变量读（--color-seal / --color-line-strong），主题自动跟随；
 * - 尊重「减少动效」：降到约 8fps，波浪还在呼吸，只是不逐帧刷新。
 *
 * 采不到系统音频时（Linux 无回环、无声卡、权限被拒）只画一条基线，原因写进
 * canvas 的 title——波浪缺席是可理解的降级，不值得为它弹吐司。
 */

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
    let line = '#d0c6b1'
    let disposed = false
    let session: LoopbackSession | null = null
    let retryTimer = 0
    let attempts = 0

    const buf = new Float32Array(FFT_SIZE)
    const ys = new Float32Array(WAVE_POINTS)
    // 上一帧画出去的形状：时间平滑的基准（shown 与 ys 分开，sampleWave 不能原地插值）
    const shown = new Float32Array(WAVE_POINTS)
    let hasPrev = false
    const peak = { value: 0 }

    const readColors = () => {
      const cs = getComputedStyle(canvas)
      seal = cs.getPropertyValue('--color-seal').trim() || seal
      line = cs.getPropertyValue('--color-line-strong').trim() || line
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
          attempts = 0
          peak.value = 0
          hasPrev = false
          setTip(t('正在监听系统音频'))
        } catch (err) {
          if (disposed) return
          session = null
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

    const draw = (): void => {
      ctx.clearRect(0, 0, width, height)
      const cy = height / 2

      // 基线：波浪再安静这一条也在——它同时是「没有信号」的形状
      ctx.strokeStyle = line
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, cy)
      ctx.lineTo(width, cy)
      ctx.stroke()

      if (session?.waveform(buf)) {
        const gain = autoGain(peak, buf, 0.998)
        sampleWave(buf, ys, hasPrev ? shown : null, 0.5)
        shown.set(ys)
        hasPrev = true

        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = seal
        ctx.beginPath()
        for (let i = 0; i < WAVE_POINTS; i++) {
          const x = (i / (WAVE_POINTS - 1)) * width
          // 增益已把峰值抬到 92% 半高，这里直接乘上去；夹在 1px 内防削出画布
          const y = Math.min(height - 1, Math.max(1, cy - ys[i] * gain * cy))
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        // 同一条路径描两遍：先垫一圈光晕，再压一条细主线
        ctx.globalAlpha = 0.14
        ctx.lineWidth = 5
        ctx.stroke()
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    const step = (): void => {
      frames++
      if (!reduce || frames % 8 === 0) draw()
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
      draw()
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

  return <canvas ref={ref} aria-hidden="true" className="h-full w-[400px] shrink-0" />
}
