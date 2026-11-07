/*
 * 这个文件负责：上边框上那颗**棱形**（tabMark）——它停在当前页签正上方，
 * 右键拖它（或在正文里右键横划，经 lib/tabMark 转过来）就换页签。
 *
 * 直接写 DOM 而不走 state：拖动时它每帧都要动，setState 会把整棵学习区带上
 * （页签栏在文档区里，文档区挂在工作区上）。refs 由门面创建后递进来——
 * 根元素与页签条是门面 JSX 也要用的同两块。
 */

import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { setTabMarkHandlers } from '../../../lib/tabMark'
import type { TabPresence } from '../../../lib/tabPresence'
import type { LearnTab } from '../../../learn/types'
import { DRAG_MIN, type DragState } from './barGeometry'

interface UseTabMarkDeps {
  /** 这一条栏的根元素：棱形摆位与页签命中都按它的实测矩形算 */
  rootRef: RefObject<HTMLDivElement | null>
  stripRef: RefObject<HTMLDivElement | null>
  /** 当前页签：棱形停在它的正上方，压到哪枚就切到哪枚 */
  activeId: string | null
  /**
   * 这一格是不是焦点格。
   *
   * 棱形只在焦点格的栏上跟着右键走（见 lib/tabMark）：分割成好几格之后，每格都有自己的
   * 栏，让「最后挂上的那条」说了算是不行的。
   */
  focused: boolean
  /** 棱形压到哪枚页签，就打开哪枚 */
  onActivate: (id: string) => void
  /** 重量的时机跟进出场对齐（presence.length 而不是 tabs.length，见下面那个 effect） */
  presence: TabPresence<LearnTab>[]
  /** 拖动 / 落定期间棱形先不重量（见下面的重量 effect） */
  drag: DragState | null
  settle: { id: string; offset: number } | null
}

export function useTabMark({ rootRef, stripRef, activeId, focused, onActivate, presence, drag, settle }: UseTabMarkDeps) {
  /** 上边框上那颗棱形：它停在**当前页签**正上方，右键拖它就换页签 */
  const markRef = useRef<HTMLSpanElement | null>(null)
  /** 刚刚是用右键拖棱形：那一下的 contextmenu 要吃掉，别弹菜单（见 onSwallowMenuCapture） */
  const swallowMenu = useRef(false)
  /**
   * 右键拖动棱形的那一次会话。
   *
   * 与左键拖页签同一个套路：按下只记位置，位移超过 DRAG_MIN 才算「在拖」——
   * 右键还有「弹菜单」这一层意思，一动就抢会把菜单弄没（见 root 上的 onContextMenuCapture）。
   */
  const markDrag = useRef<{ startX: number; active: boolean } | null>(null)
  /**
   * 棱形的**相对距离**会话：动起来那一刻记下指针与棱形各自的位置，
   * 之后棱形只跟着指针的**位移**走，两者始终保持按下那一刻的相对距离，
   * 直到松手（右键横划与直接拖棱形两条路共用；见 moveMarkTo）。
   */
  const markSession = useRef<{ startX: number; originLeft: number } | null>(null)

  /**
   * 把棱形摆到**当前页签的正上方**。
   *
   * 直接写 DOM 而不走 state：拖动时它每帧都要动，setState 会把整棵学习区带上
   * （页签栏在文档区里，文档区挂在工作区上）。
   */
  const measureMark = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const el = root.querySelector<HTMLElement>('[data-tab="' + activeId + '"]')
    if (!el) return
    const rootRect = root.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const left = elRect.left - rootRect.left + elRect.width / 2
    if (markRef.current) markRef.current.style.left = left + 'px'
    // rootRef / stripRef 是门面 useRef 递进来的稳定引用，补进依赖只为过 lint，行为不变
  }, [activeId, rootRef])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const onScroll = () => {
      measureMark()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [measureMark, stripRef])

  // 换页签、增删页签、拖完排序之后都要重量一次。
  // 通过 requestAnimationFrame 调度，避免在 React 提交 DOM 后同步读取几何属性引发 110ms 强制全树重排（Layout Thrashing）
  useEffect(() => {
    if (markSession.current) return
    const raf = requestAnimationFrame(measureMark)
    return () => cancelAnimationFrame(raf)
    // presence.length 而不是 tabs.length：新开 / 关掉那一枚是跟着栏上这一份进出场的
  }, [measureMark, presence.length, drag, settle])

  /** 右键按下：只记位置，等它动起来（见 markDrag 的说明） */
  const onMarkDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return
    markDrag.current = { startX: e.clientX, active: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  /** 棱形此刻停在哪（style.left 的数值）；还没摆过就是 null */
  const markLeftNow = () => {
    const v = parseFloat(markRef.current?.style.left ?? '')
    return Number.isFinite(v) ? v : null
  }

  /**
   * 棱形跟到指针这一处（夹在这条栏的范围内），并把指针底下的页签切成当前页签。
   *
   * 直接写 DOM：拖动时它每帧都要动，setState 会把整棵学习区带上。
   * 两条路都会走到这里——在正文里右键横划（经 lib/tabMark 转过来）与直接右键拖这颗棱形。
   *
   * 会话的第一次移动记下「指针在哪、棱形在哪」，之后棱形只随指针的**位移**走：
   * 原点 +（现在 − 起点），直到松手。这样棱形不会在起手那一刻猛跳到指针的 x 上
   * （右键横划从正文里起手时，指针离棱形隔着一整片文档区的距离），
   * 也不用每次都量「该在哪儿」，一个加法就够。
   */
  const moveMarkTo = useCallback(
    (clientX: number) => {
      const root = rootRef.current
      const strip = stripRef.current
      if (!root || !strip) return
      const rr = root.getBoundingClientRect()
      if (!markSession.current) {
        markSession.current = { startX: clientX, originLeft: markLeftNow() ?? clientX - rr.left }
      }
      const { startX, originLeft } = markSession.current
      const left = Math.max(0, Math.min(rr.width, originLeft + (clientX - startX)))
      if (markRef.current) markRef.current.style.left = left + 'px'
      /*
       * 棱形压到哪个页签，就打开哪个——按页签自己的矩形命中。
       * 判的是**棱形**此刻的 x（left + 条栏左缘）而不是指针的 x：改成相对距离之后，
       * 棱形与指针并不重合（正文横划时指针在文档区，隔着一整片），跟着指针判的话，
       * 激活的页签和棱形画的位置就是两回事。
       */
      const markX = rr.left + left
      for (const node of root.querySelectorAll<HTMLElement>('[data-tab]')) {
        const r = node.getBoundingClientRect()
        if (markX < r.left || markX > r.right) continue
        const id = node.dataset.tab
        if (id && id !== activeId) {
          onActivate(id)
          /*
           * 吸附：棱形吸到这枚页签的正中间，会话原点也重锚在这里——之后的相对距离
           * 从新原点继续算。不吸附的话，激活只改高亮、棱形还悬在页签边上甚至缝上，
           * 「棱形压着谁」和「打开着谁」就又对不上了；重锚让指针反向一动就换下一枚，
           * 不必先退回吸附前的位置。
           */
          const center = Math.max(0, Math.min(rr.width, r.left - rr.left + r.width / 2))
          markSession.current = { startX: clientX, originLeft: center }
          if (markRef.current) markRef.current.style.left = center + 'px'
        }
        break
      }
    },
    [activeId, onActivate, rootRef, stripRef],
  )

  /** 一次拖动会话结束：清掉相对距离的记号，棱形回到当前页签正上方 */
  const endMarkSession = useCallback(() => {
    markSession.current = null
    measureMark()
  }, [measureMark])

  // 焦点格把棱形的两个动作挂到 lib/tabMark 上：正文里的右键横划靠它找到这条栏
  useEffect(() => {
    if (!focused) return
    setTabMarkHandlers({ move: moveMarkTo, reset: endMarkSession })
    return () => setTabMarkHandlers(null)
  }, [focused, moveMarkTo, endMarkSession])

  const onMarkMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = markDrag.current
    if (!d) return
    if (!d.active) {
      if (Math.abs(e.clientX - d.startX) < DRAG_MIN) return
      d.active = true
    }
    moveMarkTo(e.clientX)
  }

  const onMarkUp = () => {
    const d = markDrag.current
    markDrag.current = null
    if (!d?.active) return
    // 拖过这一下之后紧跟的 contextmenu 是拖动的尾巴，不是「要菜单」
    swallowMenu.current = true
    // 松手后棱形回到当前页签正上方（拖动过程中它是跟着位移走的，可能停在两格之间）
    endMarkSession()
  }

  /**
   * 根元素上的 contextmenu 捕获：刚刚是用右键拖过棱形的话，把紧跟着的那一下吃掉，
   * 别弹菜单。读写都在这个 hook 里（swallowMenu 是它的 ref），门面只管挂到根元素上。
   */
  const onSwallowMenuCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!swallowMenu.current) return
    swallowMenu.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  return { markRef, onMarkDown, onMarkMove, onMarkUp, onSwallowMenuCapture }
}
