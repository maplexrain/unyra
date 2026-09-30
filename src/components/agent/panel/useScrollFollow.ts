/**
 * 对话区的滚动跟随：贴底、脱离、回到最新，外加 Ctrl + 滚轮的对话区字号。
 *
 * 从 AgentPanel 那个大函数里整段搬出来，写法一行没动——它读的全是 DOM 的实时几何
 * （scrollTop / clientHeight / getBoundingClientRect），下面这些「为什么」注释
 * 解释的就是同一件事：什么时候读 ref、什么时候用 state，都不许"顺手改成 useEffect"。
 *
 * 与定位条的分工：滚动的是不是"往上走"由这里判，高亮哪一条由 useMsgRail 判——
 * onScroll 里算完顺便把结果写回去（getAnchors 读、setRailActive 写）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { bottomGap, isAtBottom, isUserScrollUp, shouldDetachByWheel } from '../../../lib/scrollFollow'
import {
  SCALE_HUD_MS,
  SCALE_ZOOM_STEP,
  clampChatScale,
  getAppearance,
  setAppearance,
} from '../../../lib/appearance'
import { MSG_FLASH_FALLBACK_MS, MSG_FLASH_MS } from './constants'
import { nowMs } from './preview'

export interface ScrollFollow {
  onWheel: (e: React.WheelEvent<HTMLDivElement>) => void
  onScroll: () => void
  /** 是否跟随最新消息（渲染用：决定右下角那颗按钮出不出现） */
  pinned: boolean
  /** 跳到某条消息（定位条点一下走这里），顺带脱离跟随 */
  jumpToMessage: (id: string) => void
  /** 回到最新：平滑滚到底并恢复跟随 */
  restoreFollow: () => void
  /** 跟随状态下，内容每长一点就贴到底部（调用方在条数 / 流式内容 / 在不在跑变化时调） */
  stickToBottom: () => void
  /** 刚从定位条跳过来的那条消息：闪一下（消息列表据此加类） */
  flashId: string | null
  /** 对话区文字大小系数（Ctrl + 滚轮调） */
  chatScale: number
  /** 右下角的比例提示：显示一会儿再淡出 */
  zoomPct: number
  zoomHud: boolean
}

/**
 * ref 由调用方（AgentPanel）建好传进来：定位条（useMsgRail）要用同一批 DOM，
 * 而它得排在后面调用——见文件头那段关于顺序的说明。
 *
 * 「内容一变就贴到底部」那个 useEffect 也留在调用方：它要挂在定位条那个 useLayoutEffect
 * **后面**才与拆分前一致（谁先谁后见 AgentPanel 里那一段注释）。
 *
 * @param messages 当前显示的消息：消息顺序表跟着它走
 * @param railAnchorsRef 定位条当前的点位（measureAnchors 写、onScroll 读）
 * @param setRailActive 把「读到哪一条」写回定位条
 */
export function useScrollFollow(
  messages: { id: string }[],
  refs: {
    scrollRef: React.RefObject<HTMLDivElement | null>
    rootRef: React.RefObject<HTMLDivElement | null>
    msgRefs: React.RefObject<Map<string, HTMLDivElement>>
    railAnchorsRef: React.RefObject<{ id: string; top: number }[]>
  },
  setRailActive: (id: string | null) => void,
): ScrollFollow {
  const { scrollRef, rootRef, msgRefs, railAnchorsRef } = refs
  /**
   * 消息的渲染顺序：ref 回调每次渲染都会重挂，按 Map 自己的顺序读会乱
   */
  const msgOrderRef = useRef<string[]>([])

  /**
   * 是否跟随最新消息。
   *
   * 状态给渲染用（决定右下角那颗按钮出不出现），ref 给 effect 与事件用——
   * effect 里读 ref 而不是依赖 state，恢复时才能让平滑滚动跑完：
   * 若把 pinned 放进依赖，setPinned(true) 会立刻再触发一次「瞬间跳到底」，动画当场被打断。
   */
  const [pinned, setPinned] = useState(true)
  const pinnedRef = useRef(true)
  /** 滚轮累计：短时间内往上滚够了就脱离（判据见 lib/scrollFollow） */
  const wheelRef = useRef({ last: 0, up: 0 })
  /** 上一次的滚动位置：用来判断「这次往上走」是不是用户干的 */
  const lastTopRef = useRef(0)

  /** 对话区文字大小系数：Ctrl + 滚轮调，与文档区同一套手感（见 lib/appearance） */
  const [chatScale, setChatScale] = useState(() => getAppearance().chatScale)
  /** 右下角的比例提示：显示一会儿再淡出 */
  const [zoomPct, setZoomPct] = useState(100)
  const [zoomHud, setZoomHud] = useState(false)
  const zoomTimer = useRef<number | null>(null)
  /** 缩放前记下视口顶部那条消息，字号变了之后照它贴回原处 */
  const zoomAnchor = useRef<{ id: string; offset: number } | null>(null)

  /** 正在等这次跳转「滚完」：滚完才闪（见 jumpToMessage） */
  const flashWait = useRef<{ box: HTMLDivElement; onEnd: () => void; fallback: number } | null>(null)
  /** 刚从定位条跳过来的那条消息：闪一下，1 秒后自己卸掉 */
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)

  // 顺序表跟着消息走（不在渲染里写 ref：那会让 React Compiler 放弃这个组件）
  useEffect(() => {
    msgOrderRef.current = messages.map((m) => m.id)
  }, [messages])

  /**
   * 记下视口顶部那条消息：Ctrl + 滚轮改字号前调用，字号变了之后照它贴回原处。
   * 只认 ref，因此这个函数是稳定的，可以安全地放进只挂一次的滚轮监听里。
   */
  const captureAnchor = useCallback(() => {
    // react(refs) 分不清这里在回调体里：读的是 identity 稳定的 ref 的当下值
    // eslint-disable-next-line react/refs
    const box = scrollRef.current
    if (!box) return null
    const boxTop = box.getBoundingClientRect().top
    for (const id of msgOrderRef.current) {
      const el = msgRefs.current.get(id)
      if (!el) continue
      const offset = el.getBoundingClientRect().top - boxTop
      if (offset >= -4) return { id, offset }
    }
    return null
    // scrollRef / msgRefs / msgOrderRef 都是 identity 稳定的 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Ctrl + 滚轮调对话区字号。与文档区（NodeNote）同一套写法与手感：
   * 只认 Ctrl / Cmd（触控板双指缩放走的也是带 ctrlKey 的 wheel 事件）；
   * 不按修饰键就原样让给滚动。preventDefault 顺便挡掉浏览器自带的缩放。
   */
  useEffect(() => {
    // eslint-disable-next-line react/refs
    const area = rootRef.current
    if (!area) return
    const onZoomWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      // 把各种来源的 delta 折算成「格」：像素模式一格约 100，行模式一格约 3 行
      const unit = e.deltaMode === 1 ? 3 : 100
      const notches = Math.max(-3, Math.min(3, -e.deltaY / unit))
      if (!notches) return
      const prev = getAppearance().chatScale
      const next = clampChatScale(prev * SCALE_ZOOM_STEP ** notches)
      if (next !== prev) {
        zoomAnchor.current = captureAnchor()
        setAppearance({ ...getAppearance(), chatScale: next })
        setChatScale(next)
      }
      // 到顶/到底时数值不再变，但比例提示照给——否则会以为滚轮没生效
      setZoomPct(Math.round(next * 100))
      setZoomHud(true)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
      zoomTimer.current = window.setTimeout(() => {
        zoomTimer.current = null
        setZoomHud(false)
      }, SCALE_HUD_MS)
    }
    area.addEventListener('wheel', onZoomWheel, { passive: false })
    return () => {
      area.removeEventListener('wheel', onZoomWheel)
      if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current)
    }
    // rootRef 是 identity 稳定的 ref：这个监听只挂一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureAnchor])

  /**
   * 字号变了：把刚才记下的那条消息贴回原来的位置。
   * 不贴的话，字号一变大，正在读的那句就被顶到视口外面去了。
   */
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current
    zoomAnchor.current = null
    const box = scrollRef.current
    if (!anchor || !box) return
    const el = msgRefs.current.get(anchor.id)
    if (!el) return
    const offset = el.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTop += offset - anchor.offset
    // scrollRef / msgRefs 是 identity 稳定的 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatScale])

  /** 收掉还没兑现的那次闪：连着点几下时，只有最后一下算数 */
  const cancelFlashWait = () => {
    const wait = flashWait.current
    if (!wait) return
    flashWait.current = null
    wait.box.removeEventListener('scrollend', wait.onEnd)
    window.clearTimeout(wait.fallback)
  }

  /**
   * 跳到某条消息（定位条点一下走这里）。
   * 顺带脱离「跟随最新」：人都翻到上面去了，再被自动贴回底部就没法读了。
   */
  const jumpToMessage = (id: string) => {
    const box = scrollRef.current
    const el = msgRefs.current.get(id)
    if (!box || !el) return
    detach()
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 10
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })

    // 先清掉上一个高亮，再等这一次滚动停下来
    cancelFlashWait()
    if (flashTimer.current !== null) {
      window.clearTimeout(flashTimer.current)
      flashTimer.current = null
    }
    setFlashId(null)

    /*
      闪要等滚动停了才开始。滚动的那几百毫秒里人还在追着屏幕看，
      这时候闪等于白闪——等它停稳，再指一下「就是这一条」。
      scrollend 是「滚完了」的正式信号（Chromium 114+）；没有它（或这次压根没滚动）
      就退回一颗定时器，两边只会兑现一次（onEnd 自己会先 cancel）。
    */
    const onEnd = () => {
      cancelFlashWait()
      setFlashId(id)
      flashTimer.current = window.setTimeout(() => {
        flashTimer.current = null
        setFlashId(null)
      }, MSG_FLASH_MS)
    }
    box.addEventListener('scrollend', onEnd, { once: true })
    flashWait.current = { box, onEnd, fallback: window.setTimeout(onEnd, MSG_FLASH_FALLBACK_MS) }
  }

  // 卸载时把那两颗定时器（等滚完的、闪的）都收掉（组件会随「换对话」重挂，见 LearnWorkspace 的 key）
  const glideRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      cancelFlashWait()
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
      if (glideRef.current !== null) cancelAnimationFrame(glideRef.current)
    },
    // cancelFlashWait 只读 ref，身份每次渲染都会变，这里就要「挂载时那一份」——它读的是同一个 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * 贴底的**缓动**版：内容长高不再瞬移 scrollTop，而是每帧向底部滑一段。
   *
   * 为什么要缓动——流式输出时每个 chunk 都让列表长高一点，瞬移贴底意味着视口
   * 跟着 chunk 的节奏一跳一跳；模型吐字快时，一帧之间还可能落下好几个块级变化
   * （组标题挂载、正文块边界、思考块换成工具气泡），高度一跳几十像素，看上去
   * 就是频繁抖动。缓动把「贴底」从跟随 chunk 的节奏解耦成**跟随帧的节奏**：
   * 每帧只走剩余距离的三成，再快的输出也是一段连续的滑动，跳变被抹平。
   *
   * 稳态下的滞后 ≈ 每帧增量 ÷ 0.3，正常吐字速度是几十像素以内——正在长出来的
   * 那一截本来就在视口下沿，滞后不构成阅读问题；输出一停，滑几帧就精确落底
   * （dist ≤ 0.5 才停）。已在滑时不重复起循环：本帧的 step 会读到最新的
   * scrollHeight，下一次调用只是「确认还要继续滑」。
   */
  const glide = () => {
    if (glideRef.current !== null) return
    const step = () => {
      glideRef.current = null
      const el = scrollRef.current
      if (!el || !pinnedRef.current) return
      const dist = el.scrollHeight - el.clientHeight - el.scrollTop
      if (dist <= 0.5) return
      el.scrollTop += Math.max(1, Math.ceil(dist * 0.3))
      glideRef.current = requestAnimationFrame(step)
    }
    glideRef.current = requestAnimationFrame(step)
  }

  /** 跟随状态下，内容每长一点就向底部滑动；脱离之后一律不动（调用方按内容变化调它） */
  const stickToBottom = () => {
    if (!pinnedRef.current) return
    glide()
  }

  const detach = () => {
    pinnedRef.current = false
    setPinned(false)
  }

  /** 回到最新：平滑滚到底并恢复跟随 */
  const restoreFollow = () => {
    pinnedRef.current = true
    setPinned(true)
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  /**
   * 滚轮累计到阈值就脱离自动滚动。
   * 往下滚要把累计清零：那说明他正往回走，不该攒着上一次的额度把他踢出去。
   */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Ctrl / Cmd + 滚轮是调字号（见上面那个原生监听），不是滚动：
    // 不拦的话它会被当成「往上滚」，把跟随判掉
    if (e.ctrlKey || e.metaKey) return
    if (!pinnedRef.current) return
    const viewport = scrollRef.current?.clientHeight ?? 400
    if (shouldDetachByWheel(wheelRef.current, e, nowMs(), viewport)) detach()
  }

  /**
   * 滚动位置的两种含义，都在这里读：
   * 1. 回到离底部 32px 以内 → 恢复跟随（「我读完了」最自然的表达，不该逼用户去点那颗按钮；
   *    留这点余量是因为内容一直在长，卡得刚好贴底会永远差一点点）；
   * 2. 位置**往上走**了 → 脱离。我们的自动滚动只会往下（贴住底部），所以往上走一定是用户干的：
   *    滚轮、拖滚动条、PageUp 都算。滚轮那一类交给滚轮自己的累计判据（见 onWheel）——
   *    那里有「短时间内滚够了」的门槛，在这里再判一次会把触控板的轻微抖动也算成「想上去看」。
   */
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop
    const prev = lastTopRef.current
    lastTopRef.current = top

    // 定位条：标出「现在读到哪一条」——最后一条已经越过视口顶部一点点的
    let current: string | null = null
    for (const a of railAnchorsRef.current) if (a.top <= top + 24) current = a.id
    setRailActive(current)

    if (isAtBottom(bottomGap(el))) {
      if (!pinnedRef.current) {
        pinnedRef.current = true
        setPinned(true)
      }
      return
    }
    if (!pinnedRef.current) return
    if (isUserScrollUp(top, prev, nowMs() - wheelRef.current.last)) detach()
  }

  return {
    onWheel,
    onScroll,
    pinned,
    jumpToMessage,
    restoreFollow,
    stickToBottom,
    flashId,
    chatScale,
    zoomPct,
    zoomHud,
  }
}
