import { useLayoutEffect, useMemo, useRef, useEffect } from 'react'
import type { Annotation } from '../learn/types'
import {
  endAnnotationPreview,
  hydrateAnnotations,
  setAnnotationActions,
  syncAnnotations,
  type AnnotationActions,
} from '../lib/annotation'
import { parseStyle, serializeStyle } from '../lib/annotationStyle'
import { DOC_TW_CLASS, hydrateDocTailwind } from '../lib/docTailwind'
import { hydrateDocImages, type LocalImageResolver } from '../lib/docImages'
import {
  markLearnLinks,
  markdownPathFromHref,
  tryDocLinkFromEvent,
  tryLearnLinkFromEvent,
  tryMarkdownPathFromEvent,
  tryNodeLinkFromEvent,
  trySuperLinkFromEvent,
} from '../lib/nodeLink'
import { isExternalHref, openExternalLink } from '../lib/externalLink'
import { flashHeading } from '../lib/headingFlash'
import { headingJumpTarget, headingSlug, headingsOf } from '../lib/outline'
import { smoothScrollTo } from '../lib/smoothScroll'
import { hydrateRenderPlugins } from '../lib/renderPlugins'
import { hydrateStaticFiles } from '../lib/staticView'
import { normalizeKey } from '../learn/graph'

interface Props {
  /** renderNote / renderInline 产出的 HTML */
  html: string
  /** 「了解」/「注解」：渲染后在 DOM 上把术语包成虚线样式（不改动源文） */
  annotations?: Annotation[]
  /**
   * 当前目标内已存在节点的归一化 key 集合。
   * `moji:learn` 链接据此分「已创建（点击跳转）」与「未创建（点击新建）」两种外观。
   */
  knownConceptKeys?: Set<string>
  /** 用户注解的浮层里「修改/删除」按钮的回调（了解浮层不需要） */
  annotationActions?: AnnotationActions
  className?: string
  /**
   * 就地图片的解析器（见 lib/docImages）：文档里相对路径 / file:/// 的 <img>（图片放在
   * 文档自己的目录旁边）据此读字节贴成 data URL。不传就不管这类引用——对话气泡、
   * 试卷这些没有「文档目录」概念的渲染方不传。
   */
  resolveLocalImage?: LocalImageResolver
}

/**
 * 渲染由 renderNote 产出的 HTML，并接管渲染期的五件事：
 * 1. 节点链接点击跳转（moji:node/…）
 * 2. 「点击学习」链接：按文字创建/跳转子节点（moji:learn，见 lib/nodeLink.ts）
 * 3. 「点击学习」链接标注已创建/未创建（依据 knownConceptKeys）
 * 4. 插件挂载（```plot 的占位容器 → function-plot；代码块的右侧菜单 → 复制/编译/运行）
 * 5. 「了解」/「注解」：套在正文对应词上（见 lib/annotation.ts）
 *
 * 这里不用 dangerouslySetInnerHTML，而是自己往容器里写 innerHTML：
 * 图像是命令式画进 DOM 的，若交给 React 托管内容，任何一次重渲染都可能
 * 重新设置 innerHTML、把已画好的 <svg> 连同占位容器一起丢掉。
 * 由本组件独占容器内容后，React 不再触碰它，图像才不会被抹掉。
 *
 * 正文与注解因此分成三条路（见下面的 effect）：
 * 只有正文（html）变了才重建 DOM；注解变化走增量补丁，只动变的那几处；
 * 学习集变化只重标链接外观。老版本把它们塞进同一个 effect，
 * 于是「改一条注解」也要把整篇正文重写一遍——那正是画面闪一下的来源。
 */
export default function MarkdownView({
  html,
  annotations,
  knownConceptKeys,
  annotationActions,
  className,
  resolveLocalImage,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null)
  /**
   * 上一轮真正落到 DOM 上的注解：补丁的比较基准。
   *
   * 重建正文的 ① 会把它直接刷成当前列表，因此补丁不需要自己判断「DOM 是不是新的」——
   * 刚重建过的话，下面的补丁自然是个空操作。
   * （早先这里用一个代际计数器来判断，结果是：正文变过、注解列表没变的那一轮，
   * ② 根本不会执行，代际就永远对不上，于是**下一次加注解会被整条跳过**。）
   */
  const appliedRef = useRef<Annotation[]>([])

  // 按内容比较，避免父组件每次渲染都重挂图像。
  // 必须带上 kind 与 style：只改样式时也要重挂，否则标注不会更新。
  // occurrence（第几次出现）同样要带上：它变了说明标注要挪到另一处，必须重挂。
  //
  // 用 useMemo 挂在**输入本身**上：这两条签名原先每次都重算——注解多、节点多时是
  // 一趟 JSON.stringify 和一趟排序，而它们只是给下面三个 effect 当依赖用的。
  // 签名怎么构造一个字没改，值因此与原先逐个相同，依赖比较的结果也一样：
  // 注解列表换一份新数组（store 的图操作一律换新数组，不原地改）就重算，
  // 引用没变就复用——复用的正是「值也没变」的那一种。
  const annoKey = useMemo(
    () =>
      annotations?.length
        ? JSON.stringify(
            annotations.map((a) => [
              a.term,
              a.body,
              a.kind ?? 'understand',
              serializeStyle(a.style),
              a.occurrence ?? 0,
            ]),
          )
        : '',
    [annotations],
  )
  // 已知概念集合的签名：内容变化时重新标注链接外观（不再重建正文）
  const learnSig = useMemo(
    () => (knownConceptKeys?.size ? [...knownConceptKeys].sort().join('\u0001') : ''),
    [knownConceptKeys],
  )

  /**
   * 浮层回调每次渲染都刷一遍。
   *
   * 回调是父组件每次渲染新造的闭包，不能进补丁的比较（那会让每次渲染都白算一遍 DOM），
   * 也不能只在重建时取一次（会用到过期的 store）。只认「有回调」的实例：
   * 试卷面板里的 MarkdownView 不传回调，别把注解这边的回调清掉。
   */
  useLayoutEffect(() => {
    if (annotationActions) setAnnotationActions(annotationActions)
  })

  /**
   * ① 冷路径：正文变了才重建。整个组件里只有这一处写 innerHTML。
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html
    // 正文里的 Tailwind 工具类现算成样式（见 lib/docTailwind）：趁正文还是原样先收一遍类名，
    // 之后注解、插件还会往这棵树上加它们自己的类（.moji-anno、.tok-*），那些与应用 CSS 一对，
    // 收进来只是白算。同步返回，编译在后台跑。
    hydrateDocTailwind(el)
    const parsed = parseAnnos(annoKey)
    appliedRef.current = parsed
    const undoAnno = hydrateAnnotations(el, parsed, annotationActions)
    // 学习链接的外观要在重建后重标一次；learnSig 变化时由 ③ 负责
    markLearnLinks(el, knownFrom(learnSig))
    const undoPlugins = hydrateRenderPlugins(el)
    // 资源引用（moji:static）与图像、注解同一套：渲染期的活儿在 DOM 提交后做
    const undoStatic = hydrateStaticFiles(el)
    return () => {
      undoStatic()
      undoPlugins()
      undoAnno?.()
    }
    // annoKey / learnSig / annotationActions 故意不进依赖：它们变了走 ②③ 的增量路径。
    // 正文一个字都没变却把整篇 DOM 重写一遍，是「改一条注解闪一下」的根源。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html])

  /**
   * ② 注解路径：正文没变，只把变了的那几处补上去（新增/改样式/改文案/删除/挪位置）。
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = parseAnnos(annoKey)
    // 预览会话先收尾：正文不再重建，预览期临时包出来的 span 与写进内联样式的预览值
    // 会留在文档里，必须先还原，再让补丁写进「保存后的真实样式」。
    // （① 若在同一轮里重建过 DOM，它已经把 appliedRef 刷成 next，下面这记补丁便是空操作）
    endAnnotationPreview()
    syncAnnotations(el, appliedRef.current, next)
    appliedRef.current = next
  }, [annoKey])

  /**
   * ③ 学习集变化：只重标 `moji:learn` 链接的已创建/未创建外观，正文一个字都不动。
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    markLearnLinks(el, knownFrom(learnSig))
  }, [learnSig])

  /**
   * ④ 就地图片：文档旁边（相对路径，或数据树内的 file:///）的 <img> 读字节贴成 data URL
   * （见 lib/docImages 的说明——生产 CSP 不放行 file:，这是「文档资源加载不出来」的修复）。
   * 与 ① 同一块 DOM；水合按元素记进度，resolver 换身份 / 正文重建后的重跑都是幂等空转。
   * 用 effect 而非 layout effect：它是异步读盘，不参与这一帧的排版。
   */
  useEffect(() => {
    const el = ref.current
    if (!el || !resolveLocalImage) return
    return hydrateDocImages(el, resolveLocalImage)
  }, [html, resolveLocalImage])

  return (
    <div
      ref={ref}
      /*
       * 作用域类：文档里的 Tailwind 工具类只在这棵子树里生效（见 lib/docTailwind）。
       * 它跟着每一个渲染正文的地方走，因此对话气泡里引用的组件样式也一并对上。
       */
      className={className ? className + ' ' + DOC_TW_CLASS : DOC_TW_CLASS}
      onClick={(e) => {
        /*
         * 锚点链接（`[文字](#某标题)`）：滚到正文里对应的标题。
         *
         * 为什么不靠浏览器默认行为：marked 不给标题生成 id，正文 DOM 又会被注解层
         * 整体重写，写在标题上的 id 活不长。这里拿 href 现场和每个标题的 slug 比对
         * （见 lib/outline 的 headingSlug），对上了就平滑滚过去；标题里手写了
         * `id="…"` 的先按 id 找，写得动的都认。
         */
        const anchorEl = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null
        if (anchorEl) {
          e.preventDefault()
          jumpToAnchor(ref.current, decodeAnchorHref(anchorEl.getAttribute('href') ?? ''))
          return
        }
        // 四类链接都阻止默认（moji: 协议本身无意义），命中哪个执行哪个：
        // moji:learn 建/跳下级节点、moji:node 跳节点、moji:doc 跳某一份文档、moji:super 跳某份超级文档
        if (tryDocLinkFromEvent(e) || trySuperLinkFromEvent(e) || tryLearnLinkFromEvent(e) || tryNodeLinkFromEvent(e)) {
          e.preventDefault()
          return
        }
        /*
         * 指向另一份 markdown 的相对链接（`[docs/README.md](docs/README.md)`）：
         * 拦下来转成「打开对应的标签页」，内/外部文件的分工见 useLinkHandlers。
         */
        const pathAnchor = e.target instanceof Element ? e.target.closest('a[href]') : null
        if (pathAnchor && markdownPathFromHref(pathAnchor.getAttribute('href'))) {
          e.preventDefault()
          tryMarkdownPathFromEvent(e)
          return
        }
        /*
         * 外链（http/https/mailto）：**交给系统浏览器**，不在应用内打开。
         *
         * 主进程那三道拦截（新窗口、主框架、子框架，见 electron/main.ts 的 hardenLinks）是兜底；
         * 这里先接住是让意图明确——否则会是「先发起一次导航，再被主进程拦下来」，
         * 那一下虽然看不见，但地址栏式的语义是错的（这不是一次站内跳转）。
         */
        const target = e.target instanceof Element ? e.target.closest('a[href]') : null
        const href = target?.getAttribute('href') ?? ''
        if (href && isExternalHref(href)) {
          e.preventDefault()
          void openExternalLink(href)
        }
      }}
    />
  )
}

/** annoKey → 注解数组。样式要解回来（否则样式会在这一层被丢掉），occurrence 也要带过去 */
function parseAnnos(annoKey: string): Annotation[] {
  if (!annoKey) return []
  return (JSON.parse(annoKey) as Array<[string, string, Annotation['kind'], string, number]>).map(
    ([term, body, kind, styleSig, occurrence]) => ({
      term,
      body,
      kind,
      style: parseStyle(styleSig),
      ...(occurrence ? { occurrence } : {}),
    }),
  )
}

/** 「该词条是否已有节点」的判定函数：从签名还原集合，effect 只依赖签名这单一来源 */
function knownFrom(learnSig: string): (term: string) => boolean {
  const known = learnSig ? new Set(learnSig.split('\u0001')) : null
  return (term) => (known ? known.has(normalizeKey(term)) : false)
}

/** href 的 `#` 后面那一段；写没写百分号编码都认 */
function decodeAnchorHref(href: string): string {
  const raw = href.replace(/^#/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** 目标标题落点离容器顶的间距：与大纲跳转（useDocView 的 JUMP_GAP）同一个数 */
const ANCHOR_GAP = 16

/** 离目标标题最近的纵向滚动容器：锚点要滚的是它（正文自己不滚，滚的是外层那一格） */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const oy = getComputedStyle(node).overflowY
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

/**
 * 滚到正文里 slug（或手写 id）对得上的那个标题，到位后把标题高亮一下——
 * 与标题大纲的跳转（useDocView 的 jumpTo）同一套手感：缓动滚动 + flashHeading。
 * 先按 id 找（作者手写 `<h2 id="…">` 的场合），找不到再按标题文字的 slug 比对；
 * 都没有就安静作罢——一个写错的锚点不值得打断阅读。
 */
function jumpToAnchor(container: HTMLElement | null, id: string): void {
  if (!container || !id) return
  let target: HTMLElement | null = null
  try {
    target = container.querySelector<HTMLElement>('#' + CSS.escape(id))
  } catch {
    target = null
  }
  if (!target) {
    for (const head of headingsOf(container)) {
      if (headingSlug(head.textContent ?? '') === id.toLowerCase()) {
        target = head
        break
      }
    }
  }
  if (!target) return
  const box = scrollParentOf(target)
  if (!box) {
    // 没有可滚的祖先（预览直接铺在页面上）：退回浏览器自带的平滑滚动
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    flashHeading(target)
    return
  }
  smoothScrollTo(
    box,
    () => (target ? headingJumpTarget(box, target, ANCHOR_GAP) : box.scrollTop),
    () => flashHeading(target),
  )
}
