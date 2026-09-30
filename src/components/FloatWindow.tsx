import { useEffect, useRef, type ReactNode } from 'react'
import { animate } from 'animejs'
import { t } from '../i18n'

/**
 * 主窗口里的**悬浮窗口**（目前只有上下文比对调试器，见 components/agent/ContextDebugger）。
 *
 * 与设置弹窗的差别只有一处：**没有遮罩**。这两个面板是「一边看文档一边看」的东西，
 * 蒙一层灰、点不动背后的任何东西，用起来就得先关掉它——那还不如放回文档列里。
 * 所以它只是一片浮在上面的卡片：能拖开、能盖住正文，但底下的界面照常能用。
 *
 * 三层各管一件事，互不打架：
 * - 外层：**居中**（Tailwind 的 translate）与**拖动位移**（内联 transform）；
 * - 中层：进退场动画（anime.js 动 opacity / scale / y）；
 * - 内层（children）：面板自己的内容与标题栏。
 *
 * 为什么不能合成一层：translate 与 transform 是两个属性，会**叠加**而不是覆盖；
 * 而动画与拖动都想独占 transform——分开之后，拖动不会打断动画，动画也不会把窗口弹回原位。
 * （同一层里混用这两件事正是前两轮踩过的坑：动画的 fill 会把内联位移整段顶掉。）
 *
 * 进退场由上层用 lib/presence 的 usePresence 控时序：closing 为真时播退场，
 * 播完（EXIT_MS 到点）由它把节点摘掉。
 */

interface Props {
  width: number
  height: number
  /** 正在退场：播完动画就等着被卸载 */
  closing: boolean
  children: ReactNode
}

export default function FloatWindow({ width, height, closing, children }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const posRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null)

  /** 拖动位移：直接写在外层，走的是 transform，与居中用的 translate 叠加 */
  const apply = (x: number, y: number) => {
    const el = boxRef.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    // 夹住：整片始终留在视口里（它本来就是居中的，两边各留这么远就够）
    const maxX = Math.max(0, (window.innerWidth - w) / 2 - 8)
    const maxY = Math.max(0, (window.innerHeight - h) / 2 - 8)
    const nx = Math.min(maxX, Math.max(-maxX, x))
    const ny = Math.min(maxY, Math.max(-maxY, y))
    posRef.current = { x: nx, y: ny }
    el.style.transform = 'translate(' + nx + 'px, ' + ny + 'px)'
    el.dataset.off = nx + ',' + ny
  }

  /* 进场：淡入 + 轻微放大上浮 */
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    animate(el, { opacity: [0, 1], scale: [0.965, 1], y: [12, 0], duration: 260, ease: 'out(3)' })
  }, [])

  /* 退场：反向来一遍，但更快（用户已经决定要走，这时候让他等只会显得迟钝） */
  useEffect(() => {
    const el = cardRef.current
    if (!el || !closing) return
    animate(el, { opacity: [1, 0], scale: [1, 0.98], y: [0, 8], duration: 150, ease: 'in(2)' })
  }, [closing])

  /**
   * 拖动：按在卡片上（不在按钮 / 输入框上）就开始，监听挂 window、只在这一手势期间挂着。
   *
   * 不用 pointer capture：捕获会把随后的 click 也重定向到卡片上，面板里的按钮就点不动了；
   * 挂在 window 上同样能接住「拖到卡片外面」的移动，松手时自己摘掉。
   */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select, [role=button]')) return
    const start = { px: e.clientX, py: e.clientY, x: posRef.current.x, y: posRef.current.y }
    dragRef.current = start
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return
      apply(start.x + (ev.clientX - start.px), start.y + (ev.clientY - start.py))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label={t('悬浮面板')}
      style={{
        width: 'min(' + width + 'px, calc(100vw - 32px))',
        minWidth: 'min(360px, calc(100vw - 32px))',
        height: 'min(' + height + 'px, calc(100vh - 96px))',
      }}
      className="no-print fixed left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2"
      onPointerDown={onPointerDown}
    >
      <div
        ref={cardRef}
        className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-paper shadow-[0_24px_64px_rgba(31,27,23,0.32)]"
      >
        {children}
      </div>
    </div>
  )
}
