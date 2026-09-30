import { useEffect, useRef, type RefObject } from 'react'
import { usePresence } from './presence'

/**
 * 顶栏那几个入口（用户菜单 / 打卡 / 番茄钟 / 有效阅读）与导师人格、模型选择器
 * 共用的一套「指针悬停即展开」时序。
 *
 * 为什么收在一起：这六处的开合时机本来是各抄一份的——指针进来就展开、
 * 移开延后一点再收、点外面或按 Esc 收起、退场动画播完才卸载。抄的时候每一处
 * 都少改一个数字，但「为什么」那一套说明只写在其中一两个地方；收成一份之后，
 * 时序只有一条实现，差异只剩下面那几个时长参数。
 *
 * 时长**没有统一**，也不该统一：各处按钮与面板之间的缝宽不一样、面板大小不一样，
 * 90 / 110 与 160 / 170 是各处的取舍，所以由调用点原样传进来。
 */

/**
 * 悬停浮层的选项：所有时长都必须与 index.css 里对应的动画时长一致。
 *
 * 按钮上原来那两条（点一下展开 / 获得焦点展开）也由返回的 `wrapProps` 出，
 * 但要不要给由 `buttonOpens` 决定：那是各个调用点自己的写法，不是时序的一部分。
 */
export interface HoverMenuOptions {
  /**
   * 指针停够这么久才展开（不给就是**立刻**展开）。
   *
   * 只有带有「划过时不该闪出一张面板」顾虑的调用点才给这个值
   * （见 PersonaPicker 的 HOVER_OPEN_MS）。
   */
  openMs?: number
  /**
   * 指针离开之后延后这么久再收：按钮与面板之间有一道 pt-1 的缝，
   * 立刻收会在半路上被关掉（指针正走在缝里，既不在按钮上也不在面板上）。
   *
   * 不给这个值 = 这个浮层**不靠悬停开合**（ModelPicker 那颗按钮是自己点开的）：
   * 那时 wrapper 上不会挂指针事件，只有外点/ Esc 那一套照旧生效。
   */
  closeMs?: number
  /** 退场动画时长：与 index.css 的 .moji-wipe-corner-out 对齐，动画播完才卸载。 */
  exitMs: number
  /** 要不要注册「点外面 + Esc 收起」。默认要；不注册的调用点自己管关闭。 */
  outsideClick?: boolean
  /**
   * Esc 监听挂在哪：window（默认）或 document。
   * mousedown 那一头始终挂 document——两种口径都如此，见 useCloseOnOutside。
   */
  listenOn?: 'window' | 'document'
  /**
   * 按钮上「点一下展开 / 获得焦点展开」要不要也由这个钩子给（默认不要）。
   * 原来有这两条的调用点才给 true——ReadingButton 的按钮本来就没有（点它不动，
   * 展开只靠指针经过），给了反而多出两条它没有的行为。
   */
  buttonOpens?: boolean
}

/** wrapper 上的东西：`ref` 与指针事件。按钮那两条**不在这里**，见下面的 `HoverButtonProps`。 */
interface HoverWrapProps {
  ref: RefObject<HTMLDivElement | null>
  /** 不给 closeMs 时没有这两条（那不靠悬停开合） */
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

/**
 * 按钮上那两条：点一下展开、获得焦点展开（只有 `buttonOpens` 的调用点才有）。
 *
 * **为什么必须挂在按钮上、不能跟着 wrapper 一起给**：wrapper 里除了按钮还有**面板**，
 * 而 React 的事件是冒泡的——挂到 wrapper 上，面板里点任何一下（选一项、按「开始」）
 * 都会冒上来触发「展开」。UserMenu 那三项菜单的写法是「先 setOpen(false) 再执行动作」，
 * 于是变成「点一项 → 它把自己关掉 → 同一串冒泡又把它打开」。挂在按钮上才与拆分前逐字一致。
 *
 * PersonaPicker 的按钮自己有一条 `onClick={() => setOpen(!open)}`（切换），那条留在它的 JSX 里；
 * 它的 `openMs` 只作用于 focus 那一条。
 */
interface HoverButtonProps {
  onClick?: () => void
  onFocus?: () => void
}

/**
 * 把「悬停浮层」的时序交给这个钩子。
 *
 * - `open` / `setOpen`：逻辑上的展开状态（面板里的按钮、点外面、Esc 都用它）
 * - `mounted`：要不要渲染
 * - `closing`：用进场那套类还是退场那套（见 index.css 的 .moji-wipe-corner-*）
 * - `wrapProps`：wrapper 上的 ref 与指针事件；**别拆开用**，外点判定靠同一个 ref
 * - `buttonProps`：按钮上的「点一下展开 / 获得焦点展开」，**必须铺在按钮上**（理由见 HoverButtonProps）
 * - `panelProps`：`panelProps.className` 拼在面板自己那串类名后面（含退场时断指针事件）
 */
export function useHoverMenu(opts: HoverMenuOptions): {
  open: boolean
  setOpen: (next: boolean) => void
  mounted: boolean
  closing: boolean
  wrapProps: HoverWrapProps
  buttonProps: HoverButtonProps
  panelProps: { className: string }
} {
  const { openMs, closeMs, exitMs, outsideClick = true, listenOn = 'window', buttonOpens = false } = opts
  // 浮层要等退场动画播完才卸载，所以展开状态交给 usePresence 管（与弹窗那套共用同一个钩子）
  const { open, setOpen, mounted, closing } = usePresence(false, exitMs)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /** 延迟展开的定时器：指针又走了就取消掉 */
  const openTimer = useRef<number | null>(null)
  /** 「正准备收起」的定时器：指针又回来时取消掉 */
  const closeTimer = useRef<number | null>(null)

  /** 指针进来 / 按钮获得焦点：撤掉待执行的收起，然后立刻（或按 openMs 延后）展开 */
  const openNow = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (openMs === undefined) {
      setOpen(true)
      return
    }
    // 已经在等着展开了：重新开始等，别让连着来的两次 hover 各排一个定时器
    if (openTimer.current !== null) window.clearTimeout(openTimer.current)
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      setOpen(true)
    }, openMs)
  }

  /**
   * 指针离开：稍等一会儿再收。留这一点时间是因为「从按钮移到面板里」的路径上
   * 有一道 pt-1 的缝，中间那一瞬间指针既不在按钮上、也不在面板上。
   */
  const closeSoon = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    // 没有 closeMs 的调用点不会有鼠标离开这条路（见上面的说明），这里给 0 只是让类型闭合
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, closeMs ?? 0)
  }

  // 组件卸载时清掉没跑完的定时器：人已经走了，再展开/收起也没人看，留着只会报「更新已卸载组件」
  useEffect(
    () => () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current)
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    [],
  )

  useCloseOnOutside({ ref: wrapRef, open: outsideClick && open, onClose: () => setOpen(false), listenOn })

  return {
    open,
    setOpen,
    mounted,
    closing,
    wrapProps: {
      ref: wrapRef,
      ...(closeMs === undefined ? null : { onMouseEnter: openNow, onMouseLeave: closeSoon }),
    },
    // 带 openMs 的调用点只给 focus 那一条（它的按钮自己管「点一下切换」）
    buttonProps: !buttonOpens ? {} : openMs === undefined ? { onClick: openNow, onFocus: openNow } : { onFocus: openNow },
    // 正在收起的面板不该还能点到里面的东西
    panelProps: { className: closing ? 'moji-wipe-corner-out pointer-events-none' : 'moji-wipe-corner-in' },
  }
}

/**
 * 「点外面 + Esc 收起」：面板开着的时候，mousedown 落在 ref 外面、或者按下 Esc，就调 onClose。
 *
 * 为什么是 mousedown 而不是 click：菜单是「按下即响应」的东西——按下就该有反应；
 * 等到 click 才收，中间那段时间面板还立在那儿，看起来像没听见。
 *
 * `open` 由调用点传进来（它可能写成 `outsideClick && open`）：不需要外点关闭的那种浮层
 * 传 false 就行，这个钩子自己不会凭空注册监听。
 * `listenOn` 只影响 Esc 那一头：mousedown 始终挂 document。
 */
export function useCloseOnOutside({
  ref,
  open,
  onClose,
  listenOn = 'window',
}: {
  /** 只用到 `ref.current.contains`：任何一种元素 ref 都能传（`RefObject<T | null>` 与
   *  `RefObject<T>` 都能赋给这个形状），所以这里不写死元素类型 */
  ref: { readonly current: HTMLElement | null }
  open: boolean
  onClose: () => void
  listenOn?: 'window' | 'document'
}): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    /*
     * Esc 那一头分两条写，不是图清楚：`document` 与 `window` 的 addEventListener 重载不同，
     * 写成 `const keys = a ? document : window` 之后类型是二者的联合，重载挑不出来，
     * 会把 onKey 当成 EventListener（于是 (e: KeyboardEvent) 报「参数不兼容」）。
     */
    if (listenOn === 'document') document.addEventListener('keydown', onKey)
    else window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      if (listenOn === 'document') document.removeEventListener('keydown', onKey)
      else window.removeEventListener('keydown', onKey)
    }
  }, [open, ref, onClose, listenOn])
}
