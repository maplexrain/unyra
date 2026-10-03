import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeftToLine, ArrowRightToLine, FoldHorizontal, Globe, OctagonX, Star, X } from 'lucide-react'
import { DocTypeIcon, WebTabTypeIcon } from './docTypes'
import type { LearnTab, TabRef, WebTabMeta } from '../../learn/types'
import { TAB_CLOSE_LABEL, dragSlotDelta, type TabCloseMode } from '../../learn/tabs'
import { setTabMarkHandlers } from '../../lib/tabMark'
import { docChipDrop, docChipHover, type ChipPayload } from '../../lib/docChip'
import { CHIP_MIME, parseChipJson } from '../../lib/chipSyntax'
import { useClampToViewport, useDismissOn } from '../../lib/useDismiss'
import { t } from '../../i18n'

/**
 * 文档区的页签栏：像 vscode 那样自由开关文件。**一格一条**（分割出来的每一格都有自己的）。
 *
 * 各种页签平级地排在同一条栏上（节点的教学文档 / 某一份笔记 / 本地文件 / 试卷副本），
 * 所以这里只认 TabRef，不认「它是从哪来的」——再加一种来源也只需补下面那两张小表的取值。
 *
 * 栏上**只有页签**：原先右侧那一组「源码 / 预览 / 导出」搬进了文档区右上角的悬浮组
 * （见 components/learn/DocFloat）——它们是「对这份文档做的事」，与「开着哪些文档」不是一类；
 * 挤在页签栏里既占地方，又让一条本该只回答「有哪些文档」的栏变得要读两遍。
 *
 * 拖动除了栏内排序，还有**跨格**：拖到别格的边上就是分割（见 onDrop）。
 * 页签还能被**真正拖出来**：出了这条栏，一枚一模一样的影子跟着指针满窗口走，
 * 落在对话输入框上就变成一枚文档引用（见 lib/docChip），落在文档区之外则取消回原位。
 */

interface Props {
  tabs: LearnTab[]
  activeId: string | null
  /** 页签标题：教学文档显示节点名（不再是「教学文档」四个字，见 learn/tabs 的 tabTitle） */
  titleOf: (ref: TabRef) => string
  /**
   * 同名页签的路径后缀（只在真有重名时给，见 LearnWorkspace 的 tabTrails）。
   * 没有它就是普通的页签：标题居中，不带前缀。
   */
  trailOf?: (ref: TabRef) => string
  onActivate: (id: string) => void
  onClose: (id: string, mode: TabCloseMode) => void
  /** 拖动结束后给出的新顺序（页签 id 列表，只在栏内排序时用得上） */
  onReorder: (ids: string[]) => void
  /** 有未保存改动的页签 id（暂存区里有它的正文，见 learn/drafts）：关闭键画成一颗圆点 */
  unsaved: ReadonlySet<string>
  /**
   * 拖动中的位置（每次指针移动一次）。上层据此判断「落点在哪一格的哪一条边上」，
   * 并在那一格上画一块落点高亮——栏内排序不需要它，跨格移动与分割全靠它。
   */
  onDragMove: (tabId: string, x: number, y: number) => void
  /**
   * 把页签条那个元素交给上层。
   *
   * 上层要靠它的实测矩形认「指针是不是落在这一格的页签栏上」——落在别格的页签栏上是
   * **加入那一格**（按位置插进去），而不是在它的上边或下边拆一格，两件事差得很远。
   */
  onStripHost?: (el: HTMLDivElement | null) => void
  /**
   * 松手。返回 true = **上层接手了这一下**（拖到别格 / 拖到某格边上分割），
   * 本栏于是不做栏内重排，也不播归位动画。
   * commit 为 false（拖动被取消）时也要走一趟：把上层那块高亮收掉。
   */
  onDrop: (tabId: string, ids: string[], x: number, y: number, commit: boolean) => boolean
  /**
   * 页签拖进对话输入框时交给它的那份信息（显示名 + 路径信息，见 lib/docChip）。
   * 在上层算——它认得 store 与考试名；不给这条，页签就拖不进输入框。
   */
  docPayloadOf?: (ref: TabRef) => ChipPayload | null
  /**
   * 资源管理器 / 外部拖进来的引用落在这一格的页签栏上：还原成页签开在这一格里。
   * 上层解析不出 TabRef（比如试卷原件）就忽略——那不是一份能开页签的文档。
   */
  onDropChip?: (p: ChipPayload) => void
  /**
   * web 页签的活信息（真标题 / 站点图标 / 加载态，见 WebTabMeta）：有就盖过 titleOf——
   * 页面的真标题要等加载完才有，tabTitle 只能兜底出域名（见 learn/tabs）。
   */
  webMetaOf?: (tab: LearnTab) => WebTabMeta | undefined
  /**
   * 这一格是不是焦点格。
   *
   * 棱形只在焦点格的栏上跟着右键走（见 lib/tabMark）：分割成好几格之后，每格都有自己的
   * 栏，让「最后挂上的那条」说了算是不行的。
   */
  focused?: boolean
  /**
   * 这一格的页签右键菜单要的收藏两件事：它收藏了没有（决定显示「收藏」还是「取消收藏」）、
   * 以及切换它——传**整枚页签**：网页收藏要顺手记下这一页的活标题与站点图标（见 learn/favorites），
   * 只给 ref 就查不到它们。不给这两条，菜单里就没有收藏这一项。
   */
  favoriteOf?: (ref: TabRef) => boolean
  onToggleFavorite?: (tab: LearnTab) => void
  /**
   * 右键点在**栏上空白处**（不是任何一枚页签）时的菜单要的两件事：
   * 开一个新的浏览器页签，以及把这一格的页签全部关掉。不给就没有这张菜单。
   */
  onOpenWebTab?: () => void
  /**
   * 文档区里按住右键横向拖动的进度：在当前页签的背景里画出来。
   * dir 是方向（1 = 往右拖，进度从左往右长；-1 = 往左拖，从右往左长），
   * ratio 是「这一格拖了多少」（0~1，满一格就换页签）。
   */

}

/** 拖动一个页签要挪动这么多像素才算「在拖」，低于它仍是点击 */
const DRAG_MIN = 4

/** 指针出栏多少像素算「拖出来了」：出栏的判定留余量防抖，回栏的判定不留（回得更紧） */
const LIFT_PAD = 8

/** 页签之间的间距，与下面那个 gap-[3px] 是一对 */
const TAB_GAP = 3

/*
 * 页签类型的标识图标：一眼分清这一排里哪种文档是哪种。
 * 图标与颜色与左侧资源管理器共用一份（见 components/learn/docTypes）——
 * 同一个东西在两处长得一样，用户才不用重新认一遍。
 * 那一格占住原先留给「与关闭键等宽的空档」的 16px（见下面页签里那格），
 * 于是标题仍然是在整条页签里居中的——图标只是把空档填成了有用信息。
 */
function TabTypeIcon({ tab, favicon, loading }: { tab: TabRef; favicon?: string; loading?: boolean }) {
  // 网页页签的图标带活信息（转圈/站点图标，见 docTypes 的 WebTabTypeIcon）
  if (tab.kind === 'web') return <WebTabTypeIcon favicon={favicon} loading={loading} />
  return <DocTypeIcon kind={tab.kind} />
}

/**
 * 按下那一刻量到的一个页签。
 *
 * 量一次就冻住：拖动过程中旁边的页签一直在让位，实时量出来的矩形一直在动，
 * 拿它算落点会来回抖（这条教训上一次就是这么踩到的）。
 */
interface TabRect {
  id: string
  left: number
  width: number
}

interface DragState {
  id: string
  /** 拖动开始时它在列表里的位置 */
  from: number
  /** 此刻它应该落到哪个位置（把其余页签按原位置的中点一分为二算出来的） */
  to: number
  /** 指针相对起点的位移 */
  dx: number
  /** 被拖的那个页签的宽度（其余页签要让位的距离就是它 + 间距） */
  width: number
  /** 指针出了页签栏：页签被真正拖了出来，栏里只剩一枚淡占位（影子跟着指针走） */
  lifted: boolean
}

export default function TabBar({
  tabs,
  activeId,
  titleOf,
  trailOf,
  onActivate,
  onClose,
  onReorder,
  unsaved,
  onDragMove,
  onStripHost,
  onDrop,
  docPayloadOf,
  webMetaOf,
  onDropChip,
  favoriteOf,
  onToggleFavorite,
  onOpenWebTab,
  focused = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  /** 上边框上那颗棱形：它停在**当前页签**正上方，右键拖它就换页签 */
  const markRef = useRef<HTMLSpanElement | null>(null)
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
  /** 刚刚是用右键拖棱形：那一下的 contextmenu 要吃掉，别弹菜单 */
  const swallowMenu = useRef(false)
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  /** 右键点在栏上空白处的菜单（不是某一枚页签）：开新网页页签 / 全部关闭 */
  const [barMenu, setBarMenu] = useState<{ x: number; y: number } | null>(null)
  /** 右键菜单抬头那一行要说的话：这一项叫什么（找不到就不用说了，它已经被关掉了） */
  const menuTab = menu ? tabs.find((tab) => tab.id === menu.id) : undefined
  const menuLabel = menuTab ? titleOf(menuTab.ref) : ''
  const [drag, setDrag] = useState<DragState | null>(null)
  /**
   * 落下那一帧：被拖的那一项先留在手指底下，下一帧再滑进它的位置。
   *
   * offset 是「它此刻在哪儿」相对**重排之后**的落点还差多少（见 endDrag）。
   * 少了这一帧，松手的一瞬间它会横着抽出去再滑回来——位移是整段拖动距离，
   * 而落位又整格整格地挪，两个差着整整一格。
   */
  const [settle, setSettle] = useState<{ id: string; offset: number } | null>(null)
  /**
   * 落下那一帧不许补间。
   *
   * 其余页签在拖动期间的位移**正好等于**重排之后的位置：清掉位移，它们本来就在原地。
   * 可 CSS 过渡是按「过渡前算出来的 transform」补间的，若不掐掉，浏览器会以为
   * 它们该从「再退一格」的地方滑回来——整条栏在松手时抽一下，就是这么来的。
   */
  const [snap, setSnap] = useState(false)
  /** 上面那个「下一帧」的把手：卸载、或连着拖两次时要能取消 */
  const raf = useRef(0)
  const dragRef = useRef<{
    id: string
    from: number
    startX: number
    width: number
    /** 拖动开始时每个页签的位置与宽度（见 TabRect） */
    rects: TabRect[]
    moved: boolean
    /** 最近一次算出来的落点与位移。松开时以它为准，而不是再读一遍 React 状态 */
    to: number
    dx: number
    /** 抓取点相对页签的偏移：影子跟指针保持按下那一刻的相对位置 */
    grabX: number
    grabY: number
    lifted: boolean
  } | null>(null)
  /**
   * 刚刚拖完的这一下不算「点击」。
   *
   * pointerup 之后浏览器还会补一个 click，而那时拖动状态已经清掉了——不单独记一笔，
   * 松手就会把刚拖过去的那一项**激活**（拖一下顺带换了文档，没人想要这个副作用）。
   */
  const justDragged = useRef(false)

  /**
   * 页签被拖出栏之后跟着指针走的那枚影子：一份克隆直接挂在 body 上（每帧写 style）。
   * 走 state 会把整棵学习区带上重渲染（棱形同一条纪律）。松手/回栏/卸载都要摘掉。
   */
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const removeGhost = () => {
    ghostRef.current?.remove()
    ghostRef.current = null
  }

  /**
   * 激活的页签要**尽量落在正中间**：页签多了必然横向溢出，从大纲链接跳过来、
   * 或按住右键横向拖着换页签时，新激活的那个可能只露出半个，甚至还在可视区之外。
   *
   * 没有用 scrollIntoView：它只保证「露出来」，而这里要的是「在中间」。
   * 而且它会连祖先容器一起滚——那几层本来就在该在的位置上，不该被这一下拽动。
   * 两端够不着时下面这一算自然就停在尽头（clamp 到 0 与最大滚动量）。
   */
  useEffect(() => {
    if (!activeId) return
    const strip = stripRef.current
    if (!strip) return
    /*
     * 逐个比 data-tab，而不是拼一个属性选择器：本地文件页签的 id 就是一条 Windows 路径，
     * 而反斜杠在 CSS 字符串里是**转义符**——[data-tab="l:C:\a\b.md"] 会被当成
     * 「l:C:ab.md」去找，永远选不中，从本地文件列表点开的页签于是从来不往中间滚。
     * 用 dataset 比字符串就没有这回事（拖动那一段本来也是这么找的）。
     */
    const el = [...strip.querySelectorAll<HTMLElement>('[data-tab]')].find(
      (n) => n.dataset.tab === activeId,
    )
    if (!el) return
    const sr = strip.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    const max = strip.scrollWidth - strip.clientWidth
    const target = strip.scrollLeft + (er.left + er.width / 2 - (sr.left + sr.width / 2))
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    strip.scrollTo({
      left: Math.max(0, Math.min(max, target)),
      behavior: still ? 'auto' : 'smooth',
    })
  }, [activeId])

  /* 卸载时把没跑完的「下一帧」撤掉（它里面是 setState）；拖到一半的影子与输入框高亮一并收掉 */
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current)
    ghostRef.current?.remove()
    ghostRef.current = null
    docChipHover(-1, -1)
  }, [])

  /* ---------- 拖动排序 ---------- */

  /**
   * 按下：只记位置，不动顺序。
   *
   * 一按下就把自己挪走是不行的——用户十次里有九次是在**点**页签而不是拖它，
   * 只有位移超过 DRAG_MIN 才真的进入拖动状态（见 onPointerMove）。
   * 指针捕获挂在页签自己身上：手指/鼠标划到栏外面（甚至划过视图开关）时，
   * 事件仍然回到这一条上，拖动不会因为划出去而断掉。
   */
  const onTabDown = (e: React.PointerEvent<HTMLDivElement>, id: string, from: number) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    const strip = stripRef.current
    const rects: TabRect[] = [...(strip?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])].map((node) => {
      const r = node.getBoundingClientRect()
      return { id: node.dataset.tab ?? '', left: r.left, width: r.width }
    })
    justDragged.current = false
    dragRef.current = {
      id,
      from,
      startX: e.clientX,
      width: el.getBoundingClientRect().width,
      rects,
      moved: false,
      to: from,
      dx: 0,
      grabX: 0,
      grabY: 0,
      lifted: false,
    }
    el.setPointerCapture(e.pointerId)
  }

  const onTabMove = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    const d = dragRef.current
    if (!d || d.id !== id) return
    const dx = e.clientX - d.startX
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_MIN) return
      d.moved = true
      // 抓取点相对页签的偏移量一次：影子此后与指针保持这个相对位置（跟棱形同一条纪律）
      const r = e.currentTarget.getBoundingClientRect()
      d.grabX = e.clientX - r.left
      d.grabY = e.clientY - r.top
    }
    /*
     * 在栏内还是在栏外：栏内沿用原来的跟手位移与让位预览；出了栏页签就**真的被拖了出来**
     * ——一枚一模一样的影子跟着指针满窗口走，栏里那枚退成淡淡的占位。
     * 出栏的判定留 LIFT_PAD 的余量防抖，回栏的判定不留（回得更紧）：在边界上抖动不会来回闪。
     */
    const strip = stripRef.current
    const inStrip = (() => {
      if (!strip) return false
      const r = strip.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    })()
    const lifted = d.lifted
      ? !inStrip
      : (() => {
          if (inStrip || !strip) return false
          const r = strip.getBoundingClientRect()
          return (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top - LIFT_PAD ||
            e.clientY > r.bottom + LIFT_PAD
          )
        })()
    if (lifted) {
      if (!d.lifted) {
        d.lifted = true
        // 影子 = 这一枚页签的克隆：样式宽窄一模一样，只把拖动位移清掉
        const g = document.createElement('div')
        const clone = e.currentTarget.cloneNode(true) as HTMLElement
        clone.style.transform = ''
        g.appendChild(clone)
        g.style.cssText =
          'position:fixed;z-index:90;pointer-events:none;width:' + d.width + 'px;' +
          'border-radius:6px;overflow:hidden;opacity:.96;transform:rotate(-.5deg);' +
          'box-shadow:0 14px 32px rgba(31,27,23,.30);'
        document.body.appendChild(g)
        ghostRef.current = g
        // 光标不必另设：指针捕获在页签上，页签拖动态自带的 cursor-grabbing 会跟着捕获走
      }
      const g = ghostRef.current
      if (g) {
        g.style.left = e.clientX - d.grabX + 'px'
        g.style.top = e.clientY - d.grabY + 'px'
      }
    } else if (d.lifted) {
      d.lifted = false
      removeGhost()
    }
    if (d.lifted) {
      // 影子模式下栏里风平浪静：被拖的那枚回槽（淡显），其余不让位。状态不变就不必重渲染
      d.to = d.from
      d.dx = 0
      setDrag((cur) =>
        cur && cur.id === d.id && cur.lifted
          ? cur
          : { id: d.id, from: d.from, to: d.from, dx: 0, width: d.width, lifted: true },
      )
    } else {
      // 落点 = 指针越过了其余页签里多少个的中点。被拖的那个自己不参与比较
      let to = 0
      for (const r of d.rects) {
        if (r.id === d.id) continue
        if (e.clientX > r.left + r.width / 2) to++
      }
      d.to = to
      d.dx = dx
      setDrag({ id: d.id, from: d.from, to, dx, width: d.width, lifted: false })
    }
    // 报给上层：它据此判断「指针现在落在哪一格的哪一条边上」（见 onDrop 与 LearnWorkspace）
    onDragMove(d.id, e.clientX, e.clientY)
    // 输入卡片的高亮跟着指针走：压在上面就亮起来，告诉用户「松手就放这里」
    docChipHover(e.clientX, e.clientY)
  }

  const endDrag = (commit: boolean, x = 0, y = 0) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    removeGhost()
    docChipHover(-1, -1)
    if (!d?.moved) return
    justDragged.current = true
    const ids = tabs.map((tab) => tab.id)
    // 影子模式下不存在「栏内落点」：松手要么被输入框/别的格接走，要么取消回原位
    if (commit && !d.lifted && d.to !== d.from) {
      const [moved] = ids.splice(d.from, 1)
      ids.splice(d.to, 0, moved)
    }
    /*
     * 先问对话输入框：页签落在输入卡片上 = 把这份文档交给导师（变成一枚引用）。
     * 接住了就到此为止——这不是排序也不是分屏，本栏什么都不用做。
     */
    if (commit && docPayloadOf) {
      const ref = tabs.find((tab) => tab.id === d.id)?.ref
      const payload = ref ? docPayloadOf(ref) : null
      if (payload && docChipDrop(x, y, payload)) return
    }
    /*
     * 先问上层接不接手：拖到**别格**（或别格的边上）是「移动 / 分割」，
     * 与栏内排序是两件事，而只有上层知道别的格在哪。接手了就直接返回——
     * 这一项已经从本栏消失了，再播一次归位动画只会让它闪一下。
     */
    if (onDrop(d.id, ids, x, y, commit)) return
    if (!commit || d.to === d.from) return
    /*
     * 落下这一帧是整段拖动里最容易出错的一帧。两件事必须**同时**发生：
     * 1. 页签按新顺序重排——DOM 顺序变了，每个页签的落位也跟着挪；
     * 2. 拖动期间的位移清掉——清掉之后它们恰好落在该在的地方。
     *
     * 麻烦在于过渡是拿「过渡前的 transform」补间的：重排让页签的**落位**挪了一格，
     * 而 transform 又在同一帧里从 ±一格变成 0，浏览器于是认定「它得从两格前滑回来」。
     * 于是：
     * - 让过位的那些页签：这一帧的过渡先掐掉（见 snap）。它们本来就在原地，补了反而跳；
     * - 被拖的那一项：把「手指底下的位置」原样保留一帧（见 settle），下一帧才放开过渡，
     *   让它从那儿滑进自己的位置——这一段的距离才是它真正剩下的那点路。
     */
    setSettle({ id: d.id, offset: d.dx - dragSlotDelta(d.rects.map((r) => r.width), d.from, d.to, TAB_GAP) })
    setSnap(true)
    if (raf.current) cancelAnimationFrame(raf.current)
    // 两帧：第一帧把这次重排画上去，第二帧（已经画完）才放开过渡
    raf.current = requestAnimationFrame(() => {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        setSnap(false)
        setSettle(null)
      })
    })
    onReorder(ids)
  }

  /**
   * 其余页签要让多远：被拖的那个插到右边去，中间这些就往左让一个「页签宽 + 间距」，
   * 反过来往右让。位移用 transform 而不是重排 DOM——重排会让整条栏瞬间跳一下，
   * 而 transform 是能补间的（transition-transform）。
   */
  /* ---------- 棱形：右键拖动它换页签 ---------- */

  /**
   * 把棱形摆到**当前页签的正上方**。
   *
   * 直接写 DOM 而不走 state：拖动时它每帧都要动，setState 会把整棵学习区带上
   * （页签栏在文档区里，文档区挂在工作区上）。
   */
  const measureMark = useCallback(() => {
    const root = rootRef.current
    const el = stripRef.current?.querySelector<HTMLElement>('[data-tab="' + activeId + '"]')
    if (!root || !el) return
    const rr = root.getBoundingClientRect()
    const tr = el.getBoundingClientRect()
    if (markRef.current) markRef.current.style.left = tr.left - rr.left + tr.width / 2 + 'px'
  }, [activeId])

  // 换页签、增删页签、拖完排序之后都要重量一次（页签的宽度与位置都会变）。
  // 拖动会话进行中不重量：激活页签在拖动里会一路跟着指针换，一换就把棱形吸回
  // 新页签正上方，「相对距离」就断了——松手时 endMarkSession 会把它摆回去。
  useLayoutEffect(() => {
    if (markSession.current) return
    measureMark()
  }, [measureMark, tabs.length, drag, settle])

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
      for (const node of strip.querySelectorAll<HTMLElement>('[data-tab]')) {
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
    [activeId, onActivate],
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

  const shiftOf = (i: number): number => {
    if (!drag) return 0
    const step = drag.width + TAB_GAP
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return -step
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return step
    return 0
  }

  return (
    /*
     * 这一条栏与下面的正文之间画**一道下边框**（见末尾那条线，粗细颜色与页签描边一致），
     * 页签自己带边、选中的还有底色——线上被选中那一截由页签自己的背景盖掉（z-10），
     * 于是它看起来是从正文里长出来的，而不是浮在一条线上面。
     * 一个页签都没有（栏「收起」）时：线与底色都不画——空栏不该看着像一条空工具带。
     * moji-tab-snap：落下那一帧不许补间（见 snap）。
     */
    <div
      ref={rootRef}
      onPointerDown={onMarkDown}
      onPointerMove={onMarkMove}
      onPointerUp={onMarkUp}
      onPointerCancel={onMarkUp}
      onContextMenuCapture={(e) => {
        // 刚用右键拖过棱形：这一下 contextmenu 是那趟拖动的尾巴，别弹菜单
        if (!swallowMenu.current) return
        swallowMenu.current = false
        e.preventDefault()
        e.stopPropagation()
      }}
      className={
        'no-print relative flex shrink-0 items-stretch gap-2 px-2 pt-1.5 pb-0 ' +
        (tabs.length ? 'bg-paper/40' : '') +
        (snap ? ' moji-tab-snap' : '')
      }
    >
      {/*
        栏顶边上那颗**棱形**（用户定的）：停在哪一个页签的正上方，就表示「现在读的是它」。
        右键按住它左右拖 = 换页签——这件事原来靠在正文里右键横拖，那个手势既看不见、
        又和「右键菜单」抢同一颗键。位置由 measureMark 与拖动时直接写 DOM 来管（见上）。
      */}
      {tabs.length > 0 && (
        <span
          ref={markRef}
          aria-hidden="true"
          className="pointer-events-none absolute -top-[6px] left-0 z-20 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] border border-seal/70 bg-seal/80 shadow-sm"
        />
      )}
      {/* 页签条：横向滚动，滚动条藏起来（页签自己会跟着激活项滚） */}
      <div
        ref={(el) => {
          stripRef.current = el
          onStripHost?.(el)
        }}
        onDragOver={(e) => {
          if (!onDropChip || !e.dataTransfer.types.includes(CHIP_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(CHIP_MIME)
          if (!onDropChip || !raw) return
          e.preventDefault()
          const p = parseChipJson(raw)
          if (p) onDropChip(p)
        }}
        onContextMenu={(e) => {
          // 落在某枚页签上的右键归页签自己的菜单（那里已经 preventDefault 过了）
          if ((e.target as HTMLElement).closest('[data-tab]')) return
          e.preventDefault()
          setBarMenu({ x: e.clientX, y: e.clientY })
        }}
        className="moji-tab-strip flex min-w-0 flex-1 items-end gap-[3px] overflow-x-auto"
      >
        {tabs.map((tab, i) => {
          const on = tab.id === activeId
          const wmeta = webMetaOf?.(tab)
          const title = (tab.ref.kind === 'web' ? wmeta?.title : undefined) ?? titleOf(tab.ref)
          // 重名时才有：「路径 · 标题」，平时一条路径都不显示（见 Props.trailOf）
          const trail = trailOf?.(tab.ref) ?? ''
          const dragging = drag?.id === tab.id
          const settling = settle?.id === tab.id
          const dirty = unsaved.has(tab.id)
          const lifted = dragging && !!drag?.lifted
          const shift = shiftOf(i)
          // 三种位移只会有一个生效：拖着的跟手（拖出栏后的影子模式里它留在槽位上）、
          // 刚落下的在归位、其余在让位
          const offset = dragging && !lifted ? drag.dx : settling ? settle.offset : shift
          /*
           * min-w：页签的宽度本来由标题撑开，短标题（「导数」两个字）就窄得只剩一个
           * 可以点的小方块，一排页签看着也参差不齐。给它一个下限，短标题一样好按。
           *
           * 字重（font-medium）只跟「是不是当前这一个」有关，**不跟拖动状态**：字重一变
           * 宽度就跟着变几个像素，而让位的距离是按下那一刻量出来的——页签之间会对不齐。
           * 「被拿起来了」这个观感由阴影 + 底色 + 描边给，够用了。
           */
          const cls =
            'moji-tab group relative flex h-7 min-w-[120px] max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12px] ' +
            (on ? 'z-10 font-medium ' : '') +
            (dragging || settling
              ? 'z-10 cursor-grabbing border-line-strong bg-card text-ink-strong shadow-md'
              : 'transition-transform duration-150 ' +
                (on
                  ? 'border-line-strong bg-card text-ink-strong'
                  : 'border-transparent text-ink-soft hover:bg-line/50 hover:text-ink')) +
            // 拖出栏后栏里这枚只剩个淡占位：正文跟着指针（影子）走了
            (lifted ? ' opacity-40' : '')
          return (
            <div
              key={tab.id}
              data-tab={tab.id}
              role="tab"
              aria-selected={on}
              tabIndex={0}
              // 未保存时顺带说一句：那颗圆点本身没有 tooltip（它是 aria-hidden 的装饰）
              title={
                (trail ? trail + ' · ' + title : title) +
                (dirty ? t('（有未保存的改动，Ctrl+S 保存）') : '')
              }
              onClick={() => {
                // 刚刚是在拖它：这一下不算「点开这个页签」
                if (justDragged.current) return
                onActivate(tab.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onActivate(tab.id)
              }}
              onPointerDown={(e) => onTabDown(e, tab.id, i)}
              onPointerMove={(e) => onTabMove(e, tab.id)}
              onPointerUp={(e) => endDrag(true, e.clientX, e.clientY)}
              onPointerCancel={() => endDrag(false)}
              onContextMenu={(e) => {
                // 右键先在菜单里选中这一项：对着 A 右键却关掉 B，是最难解释的一类交互
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, id: tab.id })
              }}
              style={{ transform: offset ? 'translateX(' + offset + 'px)' : undefined }}
              className={cls}
            >
              {/*
                左边这格是**页签类型的标识图标**（教学文档 / 笔记 / 超级文档 / 外部文件），
                与右边那颗关闭键等宽（都是 16px）：标题因此还是在整条页签里居中，
                而空档本身也成了有用的信息。
              */}
              <TabTypeIcon
                tab={tab.ref}
                favicon={tab.ref.kind === 'web' ? wmeta?.favicon : undefined}
                loading={wmeta?.loading}
              />
              {/*
                标题居中：外层 flex-1 占住两边等宽的空档、内层按内容宽。
                不直接写 text-center + truncate 是因为那样**长标题会把开头切掉**：
                居中的行盒两侧一起溢出，浏览器只会在右端补省略号，看到的是标题中段——
                而认一份文档靠的正是开头那几个字。内层按内容宽就没有这回事：
                装得下就居中，装不下就从右边截，开头始终在。
              */}
              <span className="flex min-w-0 flex-1 justify-center">
                {/* 路径淡一档、可截断：它是**区分**用的，主角始终是标题 */}
                {trail && <span className="min-w-0 truncate text-ink-faint">{trail} · </span>}
                <span className="min-w-0 truncate">{title}</span>
              </span>
              {/* 关闭键固定在右端（标题 flex-1 把它顶过去）；未保存时它被一颗圆点盖住。
                  选中与否都只在鼠标扫过这一条页签时才亮出来：常驻的 × 是一排噪声，
                  真正高频的状态（标题）不该被挤到次要位置 */}
              <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
                <button
                  type="button"
                  title={t('关闭')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(tab.id, 'self')
                  }}
                  className={'flex h-4 w-4 items-center justify-center rounded opacity-0 transition focus-visible:opacity-100 group-hover:opacity-70 hover:bg-line-strong/60'}
                >
                  <X size={11} />
                </button>
                {/*
                  未保存：一颗圆点压在关闭键的位置上（鼠标扫过这一条页签时才让开）。
                  pointer-events-none：点在圆点上也要落到下面那颗关闭键上——
                  「看着是关闭键、点了却没反应」比没有这个提示更糟。
                  aria-hidden：它只是状态，读屏该读的是底下那颗带 title 的按钮。
                */}
                {dirty && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-seal/80 transition-opacity group-hover:opacity-0"
                  />
                )}
              </span>
            </div>
          )
        })}
        {!tabs.length && (
          <span className="px-2 pb-1 text-[11.5px] text-ink-faint">{t('没有打开的文档')}</span>
        )}
      </div>

      {/*
        这条栏与正文之间的下边框：粗细与颜色都跟页签自己的描边一致（1px 的 line-strong），
        看上去才是「同一套框」。画成**绝对定位的一条线**（而不是容器的 border-b），
        是为了「选中页签遮住它」这件事能成立：线是定位元素、排在页签之后绘制，
        而选中的页签有 z-10，它的背景正好压住脚下那一像素——
        线在它两侧继续，到它这里「断开」，页签与下面的正文就融为了一体。
        容器自己的 border 画不出这个效果：子元素的背景永远盖不到父元素的边框上。
      */}
      {!!tabs.length && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line-strong" />
      )}

      {barMenu && onOpenWebTab && (
        <BarMenu
          menu={barMenu}
          canCloseAll={tabs.length > 0}
          count={tabs.length}
          onOpenWebTab={() => {
            onOpenWebTab()
            setBarMenu(null)
          }}
          onCloseAll={() => {
            // 「全部关闭」不吃页签 id：给谁都一样，mode 说了算（见 learn/tabs 的 closeTabs）
            onClose(activeId ?? tabs[0]?.id ?? '', 'all')
            setBarMenu(null)
          }}
          onClose={() => setBarMenu(null)}
        />
      )}

      {menu && (
        <TabMenu
          menu={menu}
          label={menuLabel}
          tabs={tabs}
          favorited={menuTab ? (favoriteOf?.(menuTab.ref) ?? false) : false}
          onToggleFavorite={() => {
            if (menuTab && onToggleFavorite) onToggleFavorite(menuTab)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
          onPick={(mode) => {
            onClose(menu.id, mode)
            setMenu(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * 栏上空白处的右键菜单：开一个新浏览器页签，或把这一格的页签全部关掉。
 *
 * 与页签自己的菜单共用同一套骨架（图标一列 + 左对齐标签）；
 * 「全部关闭」同样取印章红——它连当前页签一起收走，是这张菜单里最狠的一个。
 */
function BarMenu({
  menu,
  canCloseAll,
  count,
  onOpenWebTab,
  onCloseAll,
  onClose,
}: {
  menu: { x: number; y: number }
  canCloseAll: boolean
  count: number
  onOpenWebTab: () => void
  onCloseAll: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)
  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[70] min-w-[196px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      <button type="button" role="menuitem" onClick={onOpenWebTab} className={ROW}>
        <span className={ICON}>
          <Globe size={13} className="text-ink-soft" />
        </span>
        {t('打开新浏览器标签页')}
      </button>
      <span aria-hidden="true" className="my-1 block h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        disabled={!canCloseAll}
        onClick={onCloseAll}
        className={ROW + ' text-seal-deep hover:bg-seal/10'}
      >
        <span className={ICON}>
          <OctagonX size={13} />
        </span>
        {t(TAB_CLOSE_LABEL.all)}
        <span className={COUNT}>{count}</span>
      </button>
    </div>
  )
}

/** 菜单里整行的一项 */
const ROW =
  'flex w-full items-center gap-2.5 rounded-md py-1.5 pl-2 pr-2.5 text-left text-[12px] text-ink transition hover:bg-line/60 disabled:opacity-40 disabled:hover:bg-transparent'
/** 图标那一格：固定宽，于是所有标签的左边缘对齐——**菜单的骨架就是这一列** */
const ICON = 'flex w-[14px] shrink-0 items-center justify-center'
/** 右侧那枚淡数：这一下会关掉几项 */
const COUNT = 'ml-auto pl-3 text-[11px] tabular-nums text-ink-faint'

/**
 * 页签右键菜单：收藏（或取消收藏）/ 关闭 / 关闭左侧 / 关闭右侧 / 关闭其他 / 全部关闭。
 *
 * 排版只有一条规矩：**一枚图标 + 一个左对齐的标签**，图标对齐在同一列上。
 * 前一版把图标撒在文字的左右两侧（这边一个箭头、那边一个箭头、中间再夹一枚叉），
 * 每一行的对齐方式都不一样，整张菜单看着像四段不同的东西拼起来的。
 * 方向感交给图标本身，文字只负责说人话：
 * - ⇤ 朝左收进竖线 = 这一项左边的一起关；⇥ 朝右收进竖线 = 右边的；
 * - ⇹ 两枚箭头收向中间 = 左右两侧都关（留下这一项）；
 * - ⊗ 一枚叉装进八角框 = 连这一项一起，全都关（这一张菜单里最狠的一个，取印章红）。
 * 右侧那枚淡淡的数字是**会关掉几项**：这一眼比「关闭其他」四个字更能说明后果。
 *
 * 没有可关的那些项置灰：对着最左边那一项点「关闭左侧」，
 * 它本来就没事可做，做成可点的只会让人以为点漏了。
 */
function TabMenu({
  menu,
  label,
  tabs,
  favorited,
  onToggleFavorite,
  onClose,
  onPick,
}: {
  menu: { x: number; y: number; id: string }
  /** 这一项的名字（抬头那一行）：右键菜单先说清「是对着哪一个」 */
  label: string
  tabs: LearnTab[]
  /** 这一项收藏了没有（决定星标是实是虚、文案是「收藏」还是「取消收藏」） */
  favorited: boolean
  onToggleFavorite: () => void
  onClose: () => void
  onPick: (mode: TabCloseMode) => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const idx = tabs.findIndex((tab) => tab.id === menu.id)
  /** 三种「按位置关」各自会关掉几项：右侧那个淡数就是它（负数一律夹成 0） */
  const leftCount = Math.max(0, idx)
  const rightCount = idx < 0 ? 0 : Math.max(0, tabs.length - idx - 1)
  const otherCount = Math.max(0, tabs.length - 1)

  /*
   * 点别处 / 滚动 / Esc / 改窗口大小都收起，并把菜单夹进视口：这两条与资源管理器
   * 右键菜单共用一份实现（为什么要收在 mousedown 上、8px 余量怎么算，见 lib/useDismiss）。
   */
  useDismissOn({ onClose })
  useClampToViewport(ref, menu)

  return (
    <div
      ref={ref}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="moji-in-soft fixed z-[70] min-w-[196px] rounded-lg border border-line-strong bg-card p-1 shadow-[0_12px_36px_rgba(31,27,23,0.24)]"
    >
      {/*
        抬头：这一下是对着哪一份文档。与节点、笔记那两张菜单同一条规矩——
        右键菜单是「此刻对着这一项」的东西，先说清是哪一个，再看能做什么。
      */}
      <div className="truncate px-2.5 py-1 text-[10.5px] text-ink-faint" title={label}>
        {label}
      </div>

      {/*
        收藏：菜单的第一项（星标实 = 已收藏，再点就取消）。它与「关闭」是两类事，
        中间隔一道线；收藏是留下轨迹的温和动作，排在最前面。
      */}
      <button type="button" role="menuitem" onClick={onToggleFavorite} className={ROW}>
        <span className={ICON}>
          <Star
            size={13}
            className={favorited ? 'text-seal' : 'text-ink-soft'}
            fill={favorited ? 'currentColor' : 'none'}
          />
        </span>
        {favorited ? t('取消收藏') : t('收藏')}
      </button>

      <span aria-hidden="true" className="my-1 block h-px bg-line" />

      {/* 关闭这一项：一枚普通的叉，中性色——最常用、也最不「狠」的一个 */}
      <button type="button" role="menuitem" onClick={() => onPick('self')} className={ROW}>
        <span className={ICON}>
          <X size={13} className="text-ink-soft" />
        </span>
        {t(TAB_CLOSE_LABEL.self)}
      </button>

      {/*
        「按位置关」的三项：它们是同一类事，用一道分隔线单独成组，
        与上面「只关这一项」和下面「全都关掉」都分开。
      */}
      <span aria-hidden="true" className="my-1 block h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        disabled={leftCount === 0}
        onClick={() => onPick('left')}
        className={ROW}
      >
        <span className={ICON}>
          <ArrowLeftToLine size={13} className="text-seal" />
        </span>
        {t(TAB_CLOSE_LABEL.left)}
        <span className={COUNT}>{leftCount}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={rightCount === 0}
        onClick={() => onPick('right')}
        className={ROW}
      >
        <span className={ICON}>
          <ArrowRightToLine size={13} className="text-seal" />
        </span>
        {t(TAB_CLOSE_LABEL.right)}
        <span className={COUNT}>{rightCount}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={otherCount === 0}
        onClick={() => onPick('others')}
        className={ROW}
      >
        <span className={ICON}>
          <FoldHorizontal size={13} className="text-seal" />
        </span>
        {t(TAB_CLOSE_LABEL.others)}
        <span className={COUNT}>{otherCount}</span>
      </button>

      {/*
        全部关闭：与上面那一组分开——它是这一张菜单里唯一「一个都不留」的动作。
        图标是一枚叉装进八角框（OctagonX）：比普通的叉多一层「整个停掉」的意思，
        文字与图标一并取印章红，与删除、危险动作同一套语言。
      */}
      <span aria-hidden="true" className="my-1 block h-px bg-line" />
      <button
        type="button"
        role="menuitem"
        title={t('这一格里的页签全部关掉（含当前这一个）')}
        onClick={() => onPick('all')}
        className={ROW + ' text-seal-deep hover:bg-seal/10'}
      >
        <span className={ICON}>
          <OctagonX size={13} />
        </span>
        {t(TAB_CLOSE_LABEL.all)}
        <span className={COUNT}>{tabs.length}</span>
      </button>
    </div>
  )
}
