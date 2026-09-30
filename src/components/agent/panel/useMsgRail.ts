/**
 * 消息定位条的全部逻辑：量出每条用户消息的位置、算命中区、判断这条条还显不显示。
 *
 * 从 AgentPanel 那个大函数里整段搬出来。这里量的是 DOM 的实时几何，注释解释的
 * 就是「为什么必须这么量、什么时候不许量」——搬走时一字未改。
 * 画出来的是 MsgRail.tsx，滚动跟随便在 useScrollFollow.ts。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationMessage } from '../../../agent/types'
import { RAIL_MIN_WIDTH, RAIL_PAD, RAIL_PITCH } from './constants'
import { layoutHeld, onLayoutRelease } from '../../../lib/layoutHold'
import type { MsgAnchor } from './types'
import { messagePreview } from './preview'
import { t } from '../../../i18n'

export interface MsgRail {
  /** 定位条上的点，随消息、尺寸与字号重算 */
  anchors: MsgAnchor[]
  /** 鼠标停在哪一个点上（浮层跟着它） */
  railHover: string | null
  setRailHover: (next: string | null | ((prev: string | null) => string | null)) => void
  /** 现在读到哪一个（高亮那一个） */
  railActive: string | null
  setRailActive: (next: string | null) => void
  /** 导师栏够不够宽：不够就不显示定位条（判据见 RAIL_MIN_WIDTH） */
  railWide: boolean
  /** 浮层正在显示的那一条（没有悬停就是 null） */
  hoverAnchor: MsgAnchor | null
  /**
   * 重新量一遍定位条：调用方在「消息 / 流式内容 / 字号」变了时挂一个 useLayoutEffect 调它
   * （同一帧里的重复请求会被合并成最后一次：量出来的结果不变，省掉中间的强制排版，见 scheduleMeasure）
   */
  measureAnchors: () => void
}

/**
 * @param messages 当前显示的消息，锚点只从其中的用户消息与导师动作（带 mark）里取
 * @param refs 与 useScrollFollow 共用的那一批 DOM：滚动容器（量出的 top 与它的
 *   scrollTop 同一套像素）、整块面板（定位条挂在它上面，量的是面板坐标）、
 *   每条消息的 DOM、以及量完写回去的点位（onScroll 从那里读）
 *
 * 「消息 / 流式内容一变就重新量一遍」那个 useLayoutEffect 留在调用方（AgentPanel）：
 * 它要挂在这个 hook **后面**，才能与拆分前一样排在「贴底」那个 effect 之后。
 */
export function useMsgRail(
  messages: ConversationMessage[],
  refs: {
    scrollRef: React.RefObject<HTMLDivElement | null>
    rootRef: React.RefObject<HTMLDivElement | null>
    msgRefs: React.RefObject<Map<string, HTMLDivElement>>
    railAnchorsRef: React.RefObject<MsgAnchor[]>
  },
): MsgRail {
  const { scrollRef, rootRef, msgRefs, railAnchorsRef } = refs
  /** 定位条上的点，随消息、尺寸与字号重算 */
  const [anchors, setAnchors] = useState<MsgAnchor[]>([])
  /**
   * 定位条此刻是不是真的显示着。
   *
   * 为什么要单独一个 ref：量锚点要逐个消息 getBoundingClientRect，那是**强制整页排版**，
   * 几十条消息的历史会话在启动时为此要多花几十毫秒，而定位条窄到放不下时根本不显示
   * （见下面的 RAIL_MIN_WIDTH），量了也白量。用 ref 而不是 state：measureAnchors 的身份
   * 一变，挂着它的那几个 effect 都会重来一遍，没必要为此重建。
   */
  const railLiveRef = useRef(false)
  /** 鼠标停在哪一个点上（浮层跟着它），以及现在读到哪一个（高亮那一个） */
  const [railHover, setRailHover] = useState<string | null>(null)
  const [railActive, setRailActive] = useState<string | null>(null)
  /** 导师栏够不够宽：不够就不显示定位条（判据见 RAIL_MIN_WIDTH） */
  const [railWide, setRailWide] = useState(false)

  /**
   * 重新量一遍定位条。
   *
   * 消息顶端一律走 getBoundingClientRect 相减（而不是 offsetTop）：列表内容带着 zoom，
   * 只有视口坐标才和滚动容器的 scrollTop 处在同一套像素里。
   */
  const measureAnchors = useCallback(() => {
    // 条不显示就没有锚点这回事（见 railLiveRef）：不为看不见的东西强制排版
    if (!railLiveRef.current) return
    // 下面这几处读的都是 identity 稳定的 ref（react(refs) 分不清这里在回调体里）
    // eslint-disable-next-line react/refs
    const box = scrollRef.current
    // eslint-disable-next-line react/refs
    const panel = rootRef.current
    if (!box || !panel) return
    const boxTop = box.getBoundingClientRect().top
    const rows: Array<{ id: string; text: string; top: number }> = []
    for (const m of messages) {
      // 锚点 = 用户说过的话 + 导师自己发起的那些动作（分界条）
      if (m.role !== 'user') continue
      // eslint-disable-next-line react/refs
      const el = msgRefs.current.get(m.id)
      if (!el) continue
      rows.push({
        id: m.id,
        text: m.hidden ? t(m.mark ?? '导师动作') : messagePreview(m),
        top: el.getBoundingClientRect().top - boxTop + box.scrollTop,
      })
    }
    /*
      点在条上按「第几条」等距排，不按它在对话里的位置排。
      按位置排看着直觉，用起来不是：两条消息一个在开头一个在结尾时，中间空出一大片，
      读的人对不上号（哪一点是刚才那句？）；几十条时又会挤成一条线。
      等距则永远「从上到下 = 第一条到最后一条」，点与点之间留 RAIL_PITCH；
      消息多到一屏放不下时再按整条轨等分（span / (n-1)），两头都不会溢出。
    */
    const span = Math.max(0, box.clientHeight - RAIL_PAD * 2)
    const pitch = rows.length > 1 ? Math.min(RAIL_PITCH, span / (rows.length - 1)) : 0
    // 排得下就整簇居中；排满时这个式子自然落回上下各留 RAIL_PAD
    const start = (box.clientHeight - pitch * (rows.length - 1)) / 2
    // 定位条挂在整块面板上（贴着面板右边），所以还要加上列表距面板顶部的那一段（表头）
    const listTop = boxTop - panel.getBoundingClientRect().top
    const next: MsgAnchor[] = rows.map((r, i) => ({
      ...r,
      y: listTop + start + i * pitch,
      // 命中区就取这个间距：相邻两项正好首尾相接。挤到间距小于 4px 时给个下限，
      // 否则那些点会缩成看不见的一条缝
      h: Math.max(4, pitch),
    }))
    // onScroll 判「现在读到哪一条」时读它，因此量完先写 ref（那是事件回调，不参与渲染）
    // eslint-disable-next-line react/refs
    railAnchorsRef.current = next
    // 值没变就不写回：ResizeObserver 每次回调都写会白白重渲染一遍。
    // 高度也要比：间距随条数变，h 跟着变时这几个点得重排
    const same = (p: MsgAnchor, i: number): boolean => {
      const q = next[i]
      return p.id === q.id && p.y === q.y && p.top === q.top && p.h === q.h
    }
    setAnchors((prev) => (prev.length === next.length && prev.every(same) ? prev : next))
    // scrollRef / rootRef / msgRefs / railAnchorsRef 都是 identity 稳定的 ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  /** 这一帧里已经排进队列的那次测量（0 = 没排）：同一帧里再来多少个请求都只跑它一次 */
  const frameRef = useRef(0)

  /**
   * 请求重新量一遍：合并到**每帧最多一次**。
   *
   * 为什么可以这么省：上面量的是**当下**的 DOM 几何，而同一帧里排在前面的那几次读到的
   * 是同一份还没变的排版——中间那几次的读数根本没机会被画出来，只有这一帧末尾的那一次
   * 才有意义。于是合并之后量出来的结果与「每来一个请求就当场量一遍」逐字相同，
   * 省掉的只是中间那些白算的强制整页排版。
   *
   * 流式写作时调用方（AgentPanel 的 useLayoutEffect）每来一个 chunk 都要调一次，
   * 几十条历史消息时那正是逐 token 的主要开销。
   */
  const scheduleMeasure = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      measureAnchors()
    })
    // measureAnchors 是「这一份 messages 的量法」，它变这个包装也跟着变（与合并前同一个节奏）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureAnchors])

  /** 卸载时把还没跑的那一帧取消：那时组件已经不在，量出来也没人看 */
  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  /**
   * 尺寸一变就重量：容器高矮决定点在条上怎么排，栏宽决定这条条还显不显示，
   * 所以面板本身与滚动容器都要观察。
   */
  useEffect(() => {
    // eslint-disable-next-line react/refs
    const panel = rootRef.current
    // eslint-disable-next-line react/refs
    const box = scrollRef.current
    if (!panel || !box || typeof ResizeObserver === 'undefined') return
    const sync = () => {
      const wide = panel.clientWidth >= RAIL_MIN_WIDTH
      railLiveRef.current = wide
      setRailWide(wide)
    }
    /*
     * 这里量的是锚点，量一次要挨个 getBoundingClientRect（强制整页排版），
     * 所以只在这一趟真的需要时量：sync 先把「条够不够宽」定下来，
     * 窄了 measureAnchors 自己会早退（见 railLiveRef）。
     *
     * 注意别把这句挪进 rAF：实测那样反而更慢。启动时这一段 subscribe 是**首帧画完之后**
     * 才跑的（React 把被动 effect 排在绘制之后），此刻量一次不影响窗口什么时候出来；
     * 排进 rAF 却会落到下一帧的绘制之前，等于把整页排版硬塞回首帧路径上，
     * 窗口显示从 506 ms 掉到 705 ms。
     */
    const remeasure = () => {
      sync()
      // 拖动分割线那会儿门是挂着的：几何每帧都在变，量了也白量，还白付一趟全页排版
      // （门是谁挂的、松手时怎么补量，见 lib/layoutHold）
      if (layoutHeld()) return
      measureAnchors()
    }
    remeasure()
    const ro = new ResizeObserver(remeasure)
    ro.observe(panel)
    ro.observe(box)
    /*
     * 拖动结束那一刻补一次测量：最后一帧的 RO 可能被门拦下了，而松手后的尺寸
     * 恰好不再变化（RO 不再响），不补这一趟定位条就是旧几何。排进下一帧：
     * 那时松手引起的那次排版已经落定，量到的是最终值。
     */
    const offRelease = onLayoutRelease(() => {
      if (frameRef.current) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        sync()
        measureAnchors()
      })
    })
    return () => {
      ro.disconnect()
      offRelease()
    }
    // 上面读的是 identity 稳定的 ref，依赖只有量锚点这一件事
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureAnchors])

  /** 定位条浮层正在显示的那一条（没有悬停就是 null） */
  const hoverAnchor = railHover ? (anchors.find((a) => a.id === railHover) ?? null) : null

  return {
    anchors,
    railHover,
    setRailHover,
    railActive,
    setRailActive,
    railWide,
    hoverAnchor,
    // 对外仍旧只叫「重新量一遍」：合并每帧重复请求这件事不外露，调用方一行都不用改
    measureAnchors: scheduleMeasure,
  }
}
