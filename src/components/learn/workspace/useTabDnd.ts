/*
 * 这个文件负责：文档区的两套拖拽——**页签拖到别的格**（挪过去 / 贴边分割出新格）
 * 与**按住格间的分割线**调整两格占比。
 *
 * 共同的纪律是「拖动期间不写 store」：高亮与占比预览都落在本地 state 上
 * （指针每动一像素都 set 的话，整棵学习区会跟着重渲染，跟手感当场就没了），
 * 松手才写一次。每一格的根元素与页签条由 renderGroup 用返回的 ref 登记——
 * 落点判定按**实测矩形**算，不猜。
 */

import { useCallback, useRef, useState } from 'react'
import type { LearnStore } from '../../../learn/types'
import {
  findSplit,
  groupIdOfTab,
  groupOf,
  moveTab,
  resizePair,
  setSizes,
  splitSpecOf,
  splitWith,
  zoneAtPoint,
  type DocSplit,
  type DropZone,
} from '../../../learn/groups'
import { insertIndexAt, sameZone } from './drag'
import { SPLIT_TOP_MARGIN } from './constants'

/**
 * 页签与分割线的拖拽（文档区分屏那套，不是两列之间的那根把手）。
 * renderGroup 把返回的 refs / 回调逐个挂上去；落点高亮读 tabDrag，占比预览读 splitDrag。
 */
export function useTabDnd({ getLatest, set }: { getLatest: () => LearnStore; set: (s: LearnStore) => void }) {
  /** 正在拖的页签悬在哪一格的哪一条边上；null = 不在任何一格上（或没在拖） */
  const [tabDrag, setTabDrag] = useState<{ tab: string; over: DropZone | null } | null>(null)
  /** 每一格的根元素：落点判定按**实测矩形**算，不猜（见 zoneAt） */
  const groupHosts = useRef(new Map<string, HTMLElement>())
  /** 每一格的页签条：落在它上面 = 加入那一格（见 zoneAt 的第一段） */
  const stripHosts = useRef(new Map<string, HTMLElement>())
  /**
   * 分割线拖动期间的预览占比。
   *
   * 拖动期间**不写 store**：那条线每帧都在动，而写 store 会连带整棵学习区
   * （正文 + 对话栏）一起重渲染，跟手感当场就没了。松手才写一次（见 beginSplitDrag）。
   */
  const [splitDrag, setSplitDrag] = useState<{ id: string; sizes: number[] } | null>(null)

  /**
   * 指针落在哪一格的哪一条边上。
   *
   * 贴着边的那 30% 算「贴边」（上下左右四选一），中间 40% 见方算「放进这一格」。
   * 拖回**自己那一格**的中间返回 null：那表示用户在栏内挪顺序，由 TabBar 自己重排
   * （见它的 endDrag）——同一个动作在两种情形下意思不同，分界就画在这里。
   */
  const zoneAt = useCallback(
    (tabId: string, x: number, y: number): DropZone | null => {
      const from = groupIdOfTab(getLatest().docArea, tabId)
      /*
       * 先认**页签栏**：拖到别格的页签栏上是「加入那一格」（按指针落在哪两个页签之间插进去），
       * 而不是在它的上边或下边拆一格——用户把页签拖到另一排页签里，想的是归到那一排。
       * 落在**自己**那一栏上返回 null：那是栏内排序，TabBar 自己算得更细（它有待位的动画）。
       */
      for (const [groupId, strip] of stripHosts.current) {
        const r = strip.getBoundingClientRect()
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
        if (groupId === from) return null
        return { group: groupId, zone: 'center', index: insertIndexAt(strip, x) }
      }
      /*
       * 从页签栏里往外拖时，指针得**真的离开栏那一条**才谈得上「在上边分割」。
       *
       * 页签栏就贴在正文上方，而正文的上边 30% 都算「上边」（见 groups 的 zoneAtPoint）——
       * 于是「想在栏内换顺序、手往下偏二十像素」会被判成分屏。用户反馈的正是这个：
       * 拖页签十次里有几次变成了画面分割。往下留出差不多一条栏的高度再说。
       *
       * 只压「上边」这一条：左右两条边是横向动作，在栏这一带做本来就该生效
       * （把页签拖到栏的左/右外侧 = 并排分屏，仍然好用）。
       */
      const strip = from ? stripHosts.current.get(from) : undefined
      const topArmedBelow = strip ? strip.getBoundingClientRect().bottom + SPLIT_TOP_MARGIN : 0
      for (const [groupId, host] of groupHosts.current) {
        const r = host.getBoundingClientRect()
        // 判定本身是纯函数（见 groups 的 zoneAtPoint）：贴边还是整格接收都在那里算
        const zone = zoneAtPoint(r, x, y)
        if (!zone) continue
        if (zone === 'top' && y < topArmedBelow) continue
        // 拖回自己那一格的中间 = 栏内挪顺序，交给 TabBar 自己重排（见它的 endDrag）
        if (zone === 'center' && groupId === from) return null
        return { group: groupId, zone }
      }
      return null
    },
    [getLatest],
  )

  const onTabDragMove = useCallback(
    (tabId: string, x: number, y: number) => {
      const over = zoneAt(tabId, x, y)
      // 高亮只在落点真的变了时才更新：指针每动一像素都 setState 会把整棵学习区带上
      setTabDrag((cur) => (cur && cur.tab === tabId && sameZone(cur.over, over) ? cur : { tab: tabId, over }))
    },
    [zoneAt],
  )

  /**
   * 页签落下：拖到别格的中间 = 挪过去；拖到某一格的边上 = 从那儿分割。
   * 返回 true 表示这一下已经由这里处理（TabBar 不必再自己重排，也不必播归位动画）。
   */
  const onTabDrop = useCallback(
    (tabId: string, x: number, y: number, commit: boolean): boolean => {
      setTabDrag(null)
      if (!commit) return false
      const over = zoneAt(tabId, x, y)
      if (!over) return false
      const s = getLatest()
      if (over.zone === 'center') {
        /*
         * index 只有「落在别格页签栏上」时才有：那时按指针的位置插进去。
         * 页签自己还占着计数器里的一个位置（它就在那一排里被拖着），落在它右边时要减一。
         */
        let index = over.index ?? null
        if (index !== null) {
          const old = groupOf(s.docArea, over.group)?.tabs.findIndex((t) => t.id === tabId) ?? -1
          if (old >= 0 && old < index) index -= 1
        }
        set({ ...s, docArea: moveTab(s.docArea, tabId, over.group, index) })
        return true
      }
      // 左右贴边 = 并排（row），上下贴边 = 叠放（col）；映射见 groups 的 splitSpecOf
      const { dir, side } = splitSpecOf(over.zone)
      set({ ...s, docArea: splitWith(s.docArea, over.group, dir, side, tabId) })
      return true
    },
    [getLatest, set, zoneAt],
  )

  /**
   * 按住某一条分割线拖动。
   *
   * 位移先换算成**占总长的比例**再交给 groups 的 resizePair：比例是布局里存的量，
   * 缩放窗口之后那一条线还在原来的相对位置上（存像素的话，窗口一变就得回头改一遍）。
   */
  const beginSplitDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    split: DocSplit,
    index: number,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const box = e.currentTarget.parentElement
    if (!box) return
    const total = split.dir === 'row' ? box.clientWidth : box.clientHeight
    if (total <= 0) return
    const start = split.dir === 'row' ? e.clientX : e.clientY
    const base = [...split.sizes]
    let preview = base
    setSplitDrag({ id: split.id, sizes: base })
    const move = (ev: PointerEvent) => {
      const delta = (split.dir === 'row' ? ev.clientX : ev.clientY) - start
      preview = resizePair(base, index, delta / total)
      setSplitDrag({ id: split.id, sizes: preview })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setSplitDrag(null)
      const s = getLatest()
      const cur = findSplit(s.docArea.layout, split.id)
      // 只是点了一下（没挪动）就不写：没必要为一次点击往 state.json 里写一遍同样的数
      if (cur && preview.some((v, i) => Math.abs(v - (cur.sizes[i] ?? 0)) > 1e-6)) {
        set({ ...s, docArea: setSizes(s.docArea, split.id, preview) })
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return {
    tabDrag,
    splitDrag,
    groupHosts,
    stripHosts,
    zoneAt,
    onTabDragMove,
    onTabDrop,
    beginSplitDrag,
  }
}
