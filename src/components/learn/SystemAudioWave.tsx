import { useEffect, useRef } from 'react'
import { t } from '../../i18n'
import { isWeb } from '../../lib/native'
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
 *
 * **看不见就停**：它是装饰，没人看的时候不该占着主线程。三件事都会让它停下 rAF——
 * canvas 滚出视口（IntersectionObserver）、页面被切到后台（visibilitychange）、
 * 组件卸载；回来时自动续上。采集那一侧（loopback 会话）不停：停掉再起要重新
 * 握手，还可能赶上「输出设备变了」的重试，而画不画才是这里要省的那笔账。
 *
 * 主题色改由 MutationObserver 盯着 `data-theme` / `style` 变，不再按帧数轮询
 * `getComputedStyle`——那是一次强制样式结算，而主题切换本来就是低频事件。
 *
 * **状态一律 save / restore 成对**：这是个每帧跑几十次的循环，一次没配对的 save
 * 就是状态栈每帧长一层、永不回收（细节见图层 5 那段注释）。改这个文件时先数一遍。
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

/**
 * 一分钟内「输出设备变了」触发的重连上限。
 *
 * 蓝牙耳机来回切、外接声卡被别的程序抢，onEnded 会连着来。不设上限就是每 800ms
 * 新建一套 AudioContext + 屏幕捕获会话，几分钟就能把渲染进程的音频通道堆满
 * （AudioContext 同时存在是有上限的，超过之后新建的会一直挂起）。
 */
const MAX_RECONNECTS = 5

/** 重连计数的时间窗 */
const RECONNECT_WINDOW_MS = 60_000

export default function SystemAudioWave() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const mouseRef = useRef<{ x: number; active: boolean }>({ x: -1, active: false })

  useEffect(() => {
    if (isWeb()) return
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
    /** 「设备变了」触发的重连计数（时间窗见 RECONNECT_WINDOW_MS） */
    let reconnects = 0
    let lastEndedAt = 0

    // 频谱缓冲与频段表
    let freq: Uint8Array<ArrayBuffer> | null = null
    let ranges: Array<[number, number]> | null = null
    let bars = 0
    let target = new Float32Array(0)
    let shown = new Float32Array(0)
    let caps = new Float32Array(0)
    let drawn = new Float32Array(0)

    /*
     * 画笔缓存：两个线性渐变原本每帧重建一次（每秒几十上百个对象），而它们只随
     * 「canvas 高度」与「主题色」变——resize / 换肤之后重建一次就够。
     * baseY 与 usableHeight 同理，它们只依赖 height。
     */
    let baseY = 0
    let usableHeight = 0
    let auroraGrad: CanvasGradient | null = null
    let barGrad: CanvasGradient | null = null
    /** 圆角半径四元组：每根柱子共用一个数组，别在循环里新建（每帧 n 个对象） */
    const barRadii: [number, number, number, number] = [0, 0, 0.5, 0.5]

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

    /** 尺寸或主题色变了之后重建渐变（不是每帧） */
    const rebuildPaint = () => {
      baseY = height - 4
      usableHeight = Math.max(10, baseY - 8)
      const aurora = ctx.createLinearGradient(0, baseY - usableHeight, 0, baseY)
      aurora.addColorStop(0, seal)
      aurora.addColorStop(1, 'transparent')
      auroraGrad = aurora
      const bar = ctx.createLinearGradient(0, baseY, 0, baseY - usableHeight)
      bar.addColorStop(0, sealDeep)
      bar.addColorStop(0.65, seal)
      bar.addColorStop(1, seal)
      barGrad = bar
    }

    const setTip = (text: string) => {
      canvas.setAttribute('title', text)
    }

    const createWebLoopbackSession = async (): Promise<LoopbackSession> => {
      let active = true
      let lastData = new Uint8Array(1024)
      const poll = async () => {
        while (active && !disposed) {
          try {
            const res = await fetch('/api/audio/spectrum?bins=1024')
            const json = (await res.json()) as { ok: boolean; data?: number[] }
            if (json.ok && Array.isArray(json.data)) {
              lastData = new Uint8Array(json.data)
            }
          } catch {
            // ignore network jitter
          }
          await new Promise((r) => window.setTimeout(r, 60))
        }
      }
      void poll()

      return {
        spectrum(into) {
          if (!active) return false
          into.set(lastData.subarray(0, Math.min(into.length, lastData.length)))
          return true
        },
        bins: () => 1024,
        sampleRate: () => 44100,
        via: () => '微服务后端 (/api/audio/spectrum)',
        stop: () => {
          active = false
        },
      }
    }

    const start = (): void => {
      void (async () => {
        try {
          const s = isWeb()
            ? await createWebLoopbackSession()
            : await startLoopback({
                onEnded: () => {
                  if (disposed) return
                  session?.stop()
                  session = null
                  window.clearTimeout(retryTimer)
                  // 设备反复抖动时不无限重连：否则每次都在新建 AudioContext + 屏幕捕获
                  const at = Date.now()
                  reconnects = at - lastEndedAt < RECONNECT_WINDOW_MS ? reconnects + 1 : 1
                  lastEndedAt = at
                  if (reconnects > MAX_RECONNECTS) {
                    setTip(t('输出设备反复中断，已停止监听系统音频'))
                    return
                  }
                  setTip(t('输出设备变了，重新接系统音频'))
                  retryTimer = window.setTimeout(start, 800)
                },
              })
          if (disposed) {
            s.stop()
            return
          }
          /*
            正常路径走不到这里（重连前一定先把旧的 stop 过了），但真叠上两路的话，
            旧的那套 AudioContext + 屏幕捕获会一直挂着——覆盖前先还回去，代价是一次判空。
          */
          session?.stop()
          session = s
          freq = new Uint8Array(s.bins())
          realloc(barCount(Math.max(1, width)))
          attempts = 0
          setTip(isWeb() ? t('电台律动 · 实时音频') : t('正在监听系统音频'))
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
      const aurora = auroraGrad
      const bar = barGrad
      // 渐变还没建好（首帧 resize 之前）就不画：尺寸相关的几何也还没算出来
      if (!aurora || !bar) return

      /*
        整帧包在一对 save / restore 里：下面每个图层都会改 globalAlpha、fillStyle、shadow，
        漏掉任何一处复原本该只影响这一帧，但更怕的是有人再写出一层「只 save 不 restore」。
        帧内对称是这个文件的唯一纪律——见文件头。
      */
      ctx.save()
      ctx.clearRect(0, 0, width, height)

      const n = barCount(Math.max(1, width))
      if (n !== bars) realloc(n)
      const step = width / n
      const gap = Math.min(2.5, Math.max(1, step * 0.16))
      const barW = Math.max(1.5, step - gap)

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


      /*
        每个图层收成**一次 fill**：同一套填充色/透明度的 n 根柱子放进同一个 path，
        比逐根 beginPath + fill 少一个数量级的绘制调用（n≈37 时每帧从一百多次降到五次）。
        线性渐变按坐标空间定义、与拆成几条子路径无关，看着和逐根填完全一样。
      */

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
      ctx.lineTo((n - 1) * step + barW / 2, baseY - drawn[n - 1] * usableHeight)
      ctx.lineTo(width, baseY)
      ctx.closePath()
      ctx.fillStyle = aurora
      ctx.globalAlpha = realAudioPlaying ? 0.15 : 0.08
      ctx.fill()

      // --- 图层 2：底座基垫（半透明圆角底托） ---
      ctx.beginPath()
      for (let i = 0; i < n; i++) ctx.roundRect(i * step, baseY - 1.5, barW, 2, 1)
      ctx.fillStyle = line
      ctx.globalAlpha = 0.22
      ctx.fill()

      // --- 图层 3：主频谱光柱（丰富渐变 + 顶部高光） ---
      const r = Math.min(barW / 2, 2.5)
      barRadii[0] = r
      barRadii[1] = r
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const h = Math.max(2, drawn[i] * usableHeight)
        ctx.roundRect(i * step, baseY - h, barW, h, barRadii)
      }
      ctx.fillStyle = bar
      ctx.globalAlpha = realAudioPlaying ? 0.85 : 0.65
      ctx.fill()

      // 较高柱顶部的微弱反光珠，增添琉璃通透感
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const h = Math.max(2, drawn[i] * usableHeight)
        if (h > 8) ctx.roundRect(i * step + 0.5, baseY - h + 0.5, barW - 1, Math.min(2, h * 0.18), 1)
      }
      ctx.fillStyle = '#ffffff'
      ctx.globalAlpha = 0.3
      ctx.fill()

      // --- 图层 4：悬浮流光峰值珠（慢速漂浮回落） ---
      /*
        这一层要开 shadowBlur（最贵的一项），单独 save/restore 包住：阴影不能漏到下面
        那层倒影上。整排珠子共用一套填充与阴影，path 合并成一次 fill。
      */
      ctx.save()
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const ch = caps[i] * usableHeight
        if (ch < 3) continue
        ctx.roundRect(i * step, baseY - ch - 3, barW, 2, 1)
      }
      ctx.fillStyle = seal
      ctx.globalAlpha = realAudioPlaying ? 0.95 : 0.75
      if (realAudioPlaying) {
        ctx.shadowColor = seal
        ctx.shadowBlur = 4
      }
      ctx.fill()
      ctx.restore()

      // --- 图层 5：底部微倒影 ---
      /*
        这一层是最后一层，状态由开头那对整帧 save/restore 收尾——**不要再手动改 globalAlpha
        就了事**：那正是状态栈每帧长一层的写法（详见文件头）。要局部复原就用 restore。
      */
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const rh = Math.min(4, drawn[i] * usableHeight * 0.2)
        if (rh <= 0.5) continue
        ctx.rect(i * step, baseY + 1, barW, rh)
      }
      ctx.fillStyle = seal
      ctx.globalAlpha = 0.08
      ctx.fill()

      ctx.restore()
      lastAudioActive = realAudioPlaying
    }

    let lastAudioActive = false
    /** rAF 是否在跑。看不见 / 页面隐藏时它是 false */
    let running = false
    /** canvas 此刻是否落在视口里（由 IntersectionObserver 维护） */
    let onScreen = true

    const step = (now: number): void => {
      frames++
      /*
        画不画这一帧：有声音时每帧（只有 reduced-motion 降到 15fps），静音待机时每两帧
        ——呼吸波本来就是 4 秒一个周期的慢正弦，30fps 绰绰有余。reduced-motion 下静音
        也降到 15fps：这条「不该动」的路径没理由比有声音时还费。
      */
      const shouldDraw = reduce ? frames % 4 === 0 : lastAudioActive || frames % 2 === 0
      if (shouldDraw) draw(now)
      raf = window.requestAnimationFrame(step)
    }

    const play = (): void => {
      if (running || disposed) return
      running = true
      raf = window.requestAnimationFrame(step)
    }

    const pause = (): void => {
      if (!running) return
      running = false
      if (raf) window.cancelAnimationFrame(raf)
      raf = 0
    }

    /** 「该不该跑」只有一个判据：在视口里 且 页面可见 */
    const sync = (): void => {
      if (onScreen && document.visibilityState !== 'hidden') play()
      else pause()
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      /*
        设 width/height 会把上下文重置到默认状态（含状态栈、变换、样式）——这是规范行为，
        所以 setTransform 等一切设置都必须排在它后面。
      */
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      readColors()
      // 几何与渐变只在尺寸 / 换肤时变，不进每帧的热路径
      rebuildPaint()
      draw(0)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    // 滚出视口就停（侧栏收起、窗口太窄、用户滚到别处）
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting)
      sync()
    }) : null
    io?.observe(canvas)

    // 页面切到后台也停
    document.addEventListener('visibilitychange', sync)

    /*
     * 主题换了才重读颜色。原先是在 step 里按帧数轮询（每 90 帧一次 getComputedStyle），
     * 而 getComputedStyle 会把待处理的样式就地结算掉——低频事件没必要按帧付这个钱。
     */
    const themeWatch = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          if (onScreen && document.visibilityState !== 'hidden') {
            readColors()
            rebuildPaint()
          }
        })
      : null
    themeWatch?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })

    resize()
    start()
    sync()

    return () => {
      disposed = true
      ro.disconnect()
      io?.disconnect()
      themeWatch?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      pause()
      window.clearTimeout(retryTimer)
      session?.stop()
    }
  }, [])

  if (isWeb()) return null

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
