/**
 * 渲染后选区 → Markdown 源文偏移的映射。
 *
 * 选区是在渲染后的 DOM 里划出来的，而笔记正文是 Markdown 源文，两者之间隔着：
 * 被解析掉的语法（`#`、`**`、`[]()` 等）、被 KaTeX 渲染的公式、被 `<br>` 折叠的换行。
 * 直接拿渲染文字去源文里 indexOf，遇到公式或跨行就找不到、或者匹配到错误的位置。
 *
 * 做法：按文档顺序遍历「可参与映射」的文本节点，在源文里用一个只前进的游标依次
 * 定位每个节点，得到「渲染文本节点 → 源文区间」的索引。选区只需取起止两个锚点
 * 所属节点的映射，再换算节点内偏移；夹在中间的公式/语法被区间自然跨过，不影响结果。
 */

import { SKIP_SELECTOR } from './textNodes'

interface Span {
  start: number
  end: number
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function accepts(node: Text): boolean {
  const parent = node.parentElement
  if (!parent || parent.closest(SKIP_SELECTOR)) return false
  return node.data.length > 0
}

/** 按文档顺序收集可映射的文本节点 */
function acceptedTextNodes(root: HTMLElement): Text[] {
  const doc = root.ownerDocument
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode: (n) => (accepts(n as Text) ? 1 /* ACCEPT */ : 2 /* REJECT */),
  })
  const out: Text[] = []
  let n = walker.nextNode()
  while (n) {
    out.push(n as Text)
    n = walker.nextNode()
  }
  return out
}

/**
 * 从 from 起在源文里定位 needle。优先精确匹配；渲染会把源文里的换行/多空格
 * 折叠成单个空格，因此再加一轮「空白不敏感」匹配。
 */
function findFrom(source: string, needle: string, from: number): Span | null {
  if (!needle) return null
  const direct = source.indexOf(needle, from)
  if (direct >= 0) return { start: direct, end: direct + needle.length }
  const trimmed = needle.trim()
  if (!trimmed) return null
  const pattern = trimmed.split(/\s+/).map(escapeRe).join('\\s+')
  const re = new RegExp(pattern, 'g')
  re.lastIndex = from
  const m = re.exec(source)
  return m ? { start: m.index, end: m.index + m[0].length } : null
}

/**
 * 把节点内的渲染偏移换成源文偏移。渲染文本与源文片段只在空白处有差别，
 * 因此同步推进两个游标：相等就一起走，源文多出的空白单独跳过。
 */
function offsetWithin(rendered: string, raw: string, offset: number): number {
  let ri = 0
  let si = 0
  while (ri < offset && si < raw.length) {
    const r = rendered[ri]
    const s = raw[si]
    if (r === s) {
      ri++
      si++
    } else if (/\s/.test(r)) {
      ri++
    } else if (/\s/.test(s)) {
      si++
    } else {
      // 理论上不会出现在同一文本节点内部；保持同步，避免死循环
      ri++
      si++
    }
  }
  return si
}

function firstTextIn(node: Node): Text | null {
  const walker = (node.ownerDocument as Document).createTreeWalker(node, 4, {
    acceptNode: (n) => (accepts(n as Text) ? 1 : 2),
  })
  return walker.nextNode() as Text | null
}

function lastTextIn(node: Node): Text | null {
  const walker = (node.ownerDocument as Document).createTreeWalker(node, 4, {
    acceptNode: (n) => (accepts(n as Text) ? 1 : 2),
  })
  let last: Text | null = null
  let n = walker.nextNode()
  while (n) {
    last = n as Text
    n = walker.nextNode()
  }
  return last
}

/** 锚点容器不是文本节点（如整段/整个标题被选中）时，向邻近找可映射的文本节点 */
function anchorText(container: Node, offset: number, forward: boolean): Text | null {
  if (container.nodeType === 3) return container as Text
  const pick = (from: Node | null, back: boolean): Text | null => {
    let n = from
    while (n) {
      const t = back ? lastTextIn(n) : firstTextIn(n)
      if (t) return t
      n = back ? n.previousSibling : n.nextSibling
    }
    return null
  }
  const kids = container.childNodes
  if (forward) return pick(kids[offset] ?? null, false) ?? lastTextIn(container)
  return pick(offset > 0 ? kids[offset - 1] : null, true) ?? firstTextIn(container)
}

/**
 * 「渲染文本节点 → 源文区间」的索引：顺序定位，游标只前进，因此同名文字也会按
 * 出现顺序各归其位。**正反两个方向共用它**（选区 → 源文、源文 → 选区）——
 * 两边各算一套的话，同一段文字在两个方向上会落到不同的地方。
 */
function indexNodes(root: HTMLElement, source: string): Map<Text, Span> {
  const index = new Map<Text, Span>()
  let cursor = 0
  for (const t of acceptedTextNodes(root)) {
    if (!t.data.trim()) continue
    const found = findFrom(source, t.data, cursor)
    if (!found) continue
    index.set(t, found)
    cursor = found.end
  }
  return index
}

/**
 * 把 root 内的一次选区映射回 source 的字符区间；无法可靠映射时返回 null，
 * 由调用方走兜底逻辑。
 */
export function mapRangeToSource(
  root: HTMLElement,
  range: Range,
  source: string,
): Span | null {
  if (range.collapsed) return null
  const index = indexNodes(root, source)
  if (!index.size) return null

  const startContainer = range.startContainer
  const endContainer = range.endContainer
  const startNode =
    startContainer.nodeType === 3 ? (startContainer as Text) : anchorText(startContainer, range.startOffset, true)
  const endNode =
    endContainer.nodeType === 3 ? (endContainer as Text) : anchorText(endContainer, range.endOffset, false)
  if (!startNode || !endNode) return null

  const startSpan = index.get(startNode)
  const endSpan = index.get(endNode)
  if (!startSpan || !endSpan) return null

  const startOff = startContainer.nodeType === 3 ? range.startOffset : 0
  const endOff = endContainer.nodeType === 3 ? range.endOffset : endNode.data.length
  const start = startSpan.start + offsetWithin(startNode.data, source.slice(startSpan.start, startSpan.end), startOff)
  const end = endSpan.start + offsetWithin(endNode.data, source.slice(endSpan.start, endSpan.end), endOff)
  if (end <= start || end > source.length) return null
  return { start, end }
}

/**
 * 节点内的**源文偏移换回渲染偏移**：与 offsetWithin 反向，规则是同一条
 * （渲染把源文里的换行与连续空格折成一个空格，于是同步推进两个游标）。
 */
function renderedOffsetWithin(rendered: string, raw: string, offset: number): number {
  let ri = 0
  let si = 0
  while (si < offset && ri < rendered.length) {
    const r = rendered[ri]
    const s = raw[si]
    if (r === s) {
      ri++
      si++
    } else if (/\s/.test(s)) {
      si++
    } else if (/\s/.test(r)) {
      ri++
    } else {
      // 理论上不会出现在同一文本节点内部；保持同步，避免死循环
      ri++
      si++
    }
  }
  return ri
}

/**
 * 反方向：源文区间 → 渲染 DOM 里的一次 Range。
 *
 * 用途是「回到原处」：对话气泡里的选段引文点一下要闪的那一段，必须与用户当初划的
 * 是**同一处**——同一个词在正文里出现好几回时，拿文字去 indexOf 只会找到第一次，
 * 用户点「定位」得到的却是别处的闪光。源文区间在划词那一刻就量好了（见
 * mapRangeToSource），这里只是把它还原成 DOM。
 *
 * 区间端点落在被解析掉的语法或公式里（那几段文字根本不参与映射）时，
 * 起点顺延到后面第一段能对上号的文字、终点收到前面最后一段——高亮短一点，
 * 但仍落在用户选的那一处。正文已经被改写、一处都对不上时返回 null，
 * 调用方退回文字匹配。
 */
export function mapSourceToRange(
  root: HTMLElement,
  source: string,
  start: number,
  end: number,
): Range | null {
  if (!(end > start)) return null
  const index = indexNodes(root, source)
  if (!index.size) return null

  let first: { node: Text; span: Span } | null = null
  let last: { node: Text; span: Span } | null = null
  for (const [node, span] of index) {
    if (span.end <= start) continue
    if (!first) first = { node, span }
    if (span.start < end) last = { node, span }
  }
  if (!first || !last) return null

  const startOff = renderedOffsetWithin(
    first.node.data,
    source.slice(first.span.start, first.span.end),
    Math.max(0, start - first.span.start),
  )
  const endOff = renderedOffsetWithin(
    last.node.data,
    source.slice(last.span.start, last.span.end),
    Math.min(end - last.span.start, last.span.end - last.span.start),
  )
  const range = root.ownerDocument.createRange()
  range.setStart(first.node, Math.min(startOff, first.node.data.length))
  range.setEnd(
    last.node,
    Math.min(Math.max(endOff, first === last ? startOff : 0), last.node.data.length),
  )
  return range.collapsed ? null : range
}
