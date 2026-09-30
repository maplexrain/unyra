/**
 * 文档大纲：从「已经渲染好的正文 DOM」里抽取各级标题，供标题定位栏使用。
 *
 * 为什么不解析 Markdown 源文：页面上真正成为标题的东西，只有渲染结果说了算——
 * 围栏代码块里的 `#` 不是标题、正文里手写的 `<h3>` 是标题、公式归一化也会改变行数。
 * 直接读渲染结果，栏里列出的每一项都必然能在页面上找到对应位置。
 */
import { t } from '../i18n'

export interface OutlineNode {
  /** 正文里第几个标题（从 0 起）。用它反查元素，见 headingAt */
  index: number
  /** 层级，从 1 起。已按文档实际用到的级别归一（只写 h2/h3 的文档，h2 就是第 1 层） */
  depth: number
  /** 标题纯文本（空白已折叠） */
  text: string
  children: OutlineNode[]
}

/** 渲染用的一行：树按当前展开状态拍平，depth 决定缩进 */
export interface OutlineRow {
  index: number
  depth: number
  text: string
  /** 有下级标题：要画展开箭头 */
  hasChildren: boolean
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

/**
 * 标题里的一段公式在渲染结果里长这样：
 *
 *   <span class="katex">
 *     <span class="katex-mathml"><math>…<annotation encoding="application/x-tex">E=mc^2</annotation></math></span>
 *     <span class="katex-html">…渲染好的字形…</span>
 *   </span>
 *
 * 公式的源码只留在 annotation 里，而 textContent 会把 MathML、HTML 两份字形
 * 连同 annotation 一起读出来——直接用它，大纲里出现的会是「E=mc2E=mc^2E=mc2」。
 * 因此遇到 .katex 就取回 LaTeX 源，还原成 $…$：调用方用同一套 Markdown 再渲染一次，
 * 大纲里的公式才与正文里的一模一样。
 */
function textOf(node: Node, out: string[]): void {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    out.push(node.nodeValue ?? '')
    return
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return
  const el = node as HTMLElement
  if (el.classList.contains('katex')) {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    if (tex) {
      // 标题里一律按行内公式还原：$$ 会让 marked 渲染成独占一行的块级公式，
      // 那一行就不再是「一行标题」了
      out.push(`$${tex}$`)
      return
    }
  }
  for (const child of Array.from(el.childNodes)) textOf(child, out)
}

/** 标题的可再渲染文本：空白折叠，公式还原成 $…$ */
export function headingText(el: HTMLElement): string {
  const out: string[] = []
  textOf(el, out)
  return out.join('').replace(/\s+/g, ' ').trim()
}

/**
 * 标题文字 → 锚点 id（GitHub 的 slug 规则）：小写、去掉标点（保留字母数字与
 * 连字符——中文、CJK 全都算字母，原样保留），空白折叠成一个连字符。
 *
 * 正文里 `[文字](#标题)` 这类锚点链接没有可对上的 id（marked 不给标题生成 id，
 * 正文 DOM 还会被注解层整体重写），跳转时拿这个函数把**每个标题现算一遍 slug**
 * 与 href 比对——不往 DOM 上写 id，重写多少遍都不会失配。
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/**
 * 正文里的全部标题元素（文档顺序）。
 *
 * 用序号而不是 id 反查元素：正文 DOM 由 MarkdownView 整体重写
 * （注解、学习集变化时都会重写 innerHTML），写在标题上的 id 会被一并抹掉，
 * 而同一份 html 下标题的数量与顺序是稳定的。
 */
export function headingsOf(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
}

/** 按正文顺序取第 index 个标题；正文还在变（流式写作）时可能取不到 */
export function headingAt(root: HTMLElement | null, index: number): HTMLElement | null {
  return headingsOf(root)[index] ?? null
}

/**
 * 跳转的目标位置：把标题放到容器顶往下 gap 像素处。
 *
 * 参数只要求「有 scrollTop 与 getBoundingClientRect」而不要求真是 HTMLElement：
 * 这条式子是跳转的核心，值得在 Node 里钉住——它的关键性质是**结果与「此刻滚到哪」无关**
 * （box.scrollTop 与 head 的视口位置里各有一份 -scrollTop，正好抵消），
 * 所以滚动动画可以每帧重算目标，既不会漂，也不会被中途长高的内容带偏。
 */
export function headingJumpTarget(
  box: { scrollTop: number; getBoundingClientRect(): { top: number } },
  head: { getBoundingClientRect(): { top: number } },
  gap: number,
): number {
  return box.scrollTop + head.getBoundingClientRect().top - box.getBoundingClientRect().top - gap
}

/** 抽取大纲树；正文里没有标题时返回空数组（调用方据此不渲染这一栏） */
export function collectOutline(root: HTMLElement | null): OutlineNode[] {
  const items = headingsOf(root).map((el, index) => ({
    index,
    // tagName 是 H1…H6，取数字部分当级别；取不到（理论上不会）按 1 层算
    level: Number(el.tagName.slice(1)) || 1,
    text: headingText(el) || t('未命名标题'),
  }))
  if (!items.length) return []

  // 以文档里出现过的最浅级别为第 1 层：只写 ## 与 ### 的文档，
  // 不该让整份大纲白顶着两级缩进
  const min = items.reduce((m, it) => Math.min(m, it.level), 6)

  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const it of items) {
    const node: OutlineNode = { index: it.index, depth: it.level - min + 1, text: it.text, children: [] }
    // 回退到第一个比自己浅的标题，作为自己的父级
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(node)
    else roots.push(node)
    stack.push(node)
  }
  return roots
}

/** 按展开状态把树拍平成待渲染的行；收起的分支整枝跳过 */
export function flattenOutline(
  nodes: OutlineNode[],
  collapsed: ReadonlySet<number>,
  depth = 1,
  out: OutlineRow[] = [],
): OutlineRow[] {
  for (const n of nodes) {
    const hasChildren = n.children.length > 0
    out.push({ index: n.index, depth, text: n.text, hasChildren })
    if (hasChildren && !collapsed.has(n.index)) flattenOutline(n.children, collapsed, depth + 1, out)
  }
  return out
}

/** 结构是否一致：正文流式变化时，用它避免「内容改了但标题没变」也重挂大纲 */
export function sameOutline(a: OutlineNode[], b: OutlineNode[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.index !== y.index || x.depth !== y.depth || x.text !== y.text) return false
    if (!sameOutline(x.children, y.children)) return false
  }
  return true
}

/**
 * 一份文档的大纲句柄：渲染组件（NodeNote / LocalDoc）把自己算出来的大纲、
 * 当前读到哪一节、以及「跳到第几个标题」的能力装进这个对象，交还给上层。
 *
 * 为什么用 ref 槽而不是 state：大纲跟着滚动时时变化（activeIndex 每跨一节就变），
 * 提成 state 会让整个工作区跟着每次跨节滚动重渲染。装进 ref 槽之后，
 * 只有真正打开悬浮大纲（DocFloat 的按钮）那一刻才会来读它。
 */
export interface OutlineHandle {
  items: OutlineNode[]
  /** 视口当前落在第几个标题上（-1 = 还没到第一个标题） */
  activeIndex: number
  /** 跳到第 index 个标题（滚动动画由渲染组件自己实现） */
  jump: (index: number) => void
}

/*
 * 大纲句柄的登记处：每个页签一格（键是页签 id），渲染组件往里装、悬浮组往外取。
 *
 * 放在模块级而不是组件的 ref 里：槽要作为 prop 在渲染期交给 DocPane / LocalDoc /
 * DocFloat，而组件 ref 的 .current 不能在渲染期读（React Compiler 的纪律，
 * 见 workspace-split-conventions）；普通 Map 没有这条禁忌。条目随页签只增不减，
 * 一个 id 不过一个小对象，不值得为它做回收。
 */
const outlineSlots = new Map<string, { current: OutlineHandle | null }>()

/** 取某个页签的大纲句柄槽；没有就现开一格 */
export function getOutlineSlot(tabId: string): { current: OutlineHandle | null } {
  let slot = outlineSlots.get(tabId)
  if (!slot) {
    slot = { current: null }
    outlineSlots.set(tabId, slot)
  }
  return slot
}

/** 标题总数（含收起的），栏头显示用 */
export function countOutline(nodes: OutlineNode[]): number {
  return nodes.reduce((n, it) => n + 1 + countOutline(it.children), 0)
}
