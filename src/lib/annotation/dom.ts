/** 这个文件负责：正文 DOM 上的注解操作——选区取词、文字流里的定位、把命中段包成 span，以及一条注解的套用与拆除。 */

import type { Annotation, AnnotationKind } from '../../learn/types'
import { applyAnnotationStyle } from '../annotationStyle'
import { BLOCK_TAGS, HOLE_SELECTOR, SPACER_SELECTOR } from './selectors'

/**
 * 把一次选区取成「注解词条」：只收渲染后真的是文字的部分，其余用一个空格占位。
 *
 * 不能直接拿 selection.toString()：跨元素选择时它会把公式的排版字符、以及块与块之间的
 * 换行一并抓进来，而这些字符在正文的文字流里并不存在，词条存下来就再也匹配不上——
 * 「该词已不在正文中，无法注解」正是这么来的。这里改成按 DOM 走一遍选区，
 * 与渲染期匹配共用同一套「什么算文字」的口径，取出来的词条必然匹配得上。
 */
export function selectionTerm(range: Range): string {
  // 整个选区都落在公式/图形里：一处正文文字都没有
  const host =
    range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement
  if (host?.closest(SPACER_SELECTOR)) return ''
  const out: string[] = []
  collectText(range.cloneContents(), out)
  return out.join('').replace(/\s+/g, ' ').trim()
}

function collectText(node: Node, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out.push((child as Text).data)
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as Element
    if (el.matches(SPACER_SELECTOR)) {
      out.push(' ')
      continue
    }
    const block = BLOCK_TAGS.has(el.tagName)
    if (block) out.push(' ')
    collectText(el, out)
    if (block) out.push(' ')
  }
}

/* ---------- 在正文的文字流里找词条 ---------- */

/**
 * 正文的「文字流」：按文档顺序把可注解的文本节点接成一条字符串。
 *
 * 之所以要接成一条：选区是划在渲染后的 DOM 上的，可以横跨任意多个元素——
 * 跨粗体、跨链接、从一段的中间划到另一段的中间。词条在这些情况下跨着好几个文本节点，
 * 逐节点 indexOf 永远找不到；接成一条之后，元素边界不再造成断点，
 * 词条里的空白还能「落空」（跨段落时选区文字里是空格，正文里根本没有对应的字符）。
 */
interface TextStream {
  text: string
  /** 参与匹配的文本节点，与 starts 一一对应 */
  nodes: Text[]
  /** 每个节点在 text 里的起点 */
  starts: number[]
}

export function buildStream(root: HTMLElement): TextStream {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode(node) {
      const text = (node as Text).data
      // 纯空白节点不算正文的字：段与段之间的换行、缩进都在这里被滤掉，
      // 于是「跨段落」的词条里那个空格正好可以落空
      if (!text || !text.trim()) return 2 /* FILTER_REJECT */
      const parent = (node as Text).parentElement
      if (!parent || parent.closest(HOLE_SELECTOR)) return 2
      return 1 /* FILTER_ACCEPT */
    },
  })
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  let n = walker.nextNode()
  while (n) {
    starts.push(text.length)
    nodes.push(n as Text)
    text += (n as Text).data
    n = walker.nextNode()
  }
  return { text, nodes, starts }
}

/** 一段命中：某个文本节点里的 [start, end) */
interface Piece {
  node: Text
  start: number
  end: number
}

/** 依次匹配词条的每一段，段与段之间允许有空白（也可以一段空白都没有） */
function matchAt(text: string, at: number, parts: string[]): number {
  let p = at
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) while (p < text.length && /\s/.test(text[p])) p++
    if (!text.startsWith(parts[i], p)) return -1
    p += parts[i].length
  }
  return p
}

/** 一次命中：文字流上的 [start, end) 与它摊到各文本节点上的几段 */
interface Hit {
  start: number
  end: number
  pieces: Piece[]
}

/**
 * 在文字流里从 from 起定位词条；找不到返回 null。
 *
 * 返回命中区间（而不只是几段）是为了能接着往后找下一次：同一段话里同一个词出现好几回时，
 * 「用户选的是第几回」只能靠在文字流里数命中次数来定（见 occurrenceAt）。
 */
export function findHit(stream: TextStream, term: string, from = 0): Hit | null {
  const parts = term.split(/\s+/).filter(Boolean)
  if (!parts.length) return null
  const { text } = stream
  let at = from
  while (at <= text.length) {
    const start = text.indexOf(parts[0], at)
    if (start < 0) return null
    const end = matchAt(text, start, parts)
    if (end > start) return { start, end, pieces: clip(stream, start, end) }
    // 这一处起头虽然相同，后面接不上：从下一个字符再试
    at = start + 1
  }
  return null
}

/** 第 n 次命中（n 从 0 起）；不够 n+1 次则返回 null */
export function nthHit(stream: TextStream, term: string, n: number): Hit | null {
  let hit: Hit | null = null
  let from = 0
  for (let i = 0; i <= n; i++) {
    hit = findHit(stream, term, from)
    if (!hit) return null
    from = hit.start + 1
  }
  return hit
}

/** 选区起点在文字流里的偏移；量不出来时返回 0（当作从头数） */
function streamOffset(stream: TextStream, node: Node, offset: number): number {
  const { nodes, starts } = stream
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i] === node) return starts[i] + offset
  }
  // 端点落在元素上（例如整段被选中）或落在没参与匹配的节点里：
  // 取「站在该位置往后看，第一个参与匹配的文本节点」
  const doc = node.ownerDocument
  if (!doc) return 0
  try {
    const probe = doc.createRange()
    probe.setStart(node, offset)
    for (let i = 0; i < nodes.length; i++) {
      if (probe.comparePoint(nodes[i], 0) >= 0) return starts[i]
    }
  } catch {
    // 位置在文档里已经失效（正文被重写过）：当从头数
    return 0
  }
  const last = nodes[nodes.length - 1]
  return last ? starts[nodes.length - 1] + last.data.length : 0
}

/**
 * 用户这次选中的是词条的第几次出现（从 0 起）。
 *
 * 不能只拿 term 去匹配：同一个词在一段话里出现三回，用户在第三回上划词，
 * 标记却落在第一回——这正是「选中的字没被标、标到了上文的同一个字」。
 * 出现序号在正文没改之前一直有效（正文改了，渲染时会回落到第一次出现）。
 */
export function occurrenceAt(root: HTMLElement, term: string, range: Range): number {
  if (!term) return 0
  const stream = buildStream(root)
  const at = streamOffset(stream, range.startContainer, range.startOffset)
  let count = 0
  let from = 0
  for (;;) {
    const hit = findHit(stream, term, from)
    if (!hit || hit.start >= at) break
    count++
    from = hit.start + 1
  }
  return count
}

/** 在文字流里定位词条（首次出现）；找不到返回 null */
function findPieces(stream: TextStream, term: string): Piece[] | null {
  return findHit(stream, term)?.pieces ?? null
}

/** 把文字流上的区间摊回「哪个节点、节点内哪一段」 */
function clip(stream: TextStream, start: number, end: number): Piece[] {
  const out: Piece[] = []
  const { nodes, starts } = stream
  for (let i = 0; i < nodes.length; i++) {
    const from = starts[i]
    const to = from + nodes[i].data.length
    if (to <= start || from >= end) continue
    out.push({
      node: nodes[i],
      start: Math.max(0, start - from),
      end: Math.min(nodes[i].data.length, end - from),
    })
  }
  return out
}

/**
 * 把一个文本区间包成注解 span。
 *
 * 用 splitText 而不是 Range.surroundContents：后者的语义是「命中之后的内容留在原文本节点里」，
 * 跨节点时还依实现而异；splitText 则明确——原节点留下前半段，后半段成为新节点。
 * 于是从后往前逐段处理时，前面几段的节点内偏移始终有效。
 */
export function wrapPiece(doc: Document, p: Piece, anno: Annotation): HTMLElement | null {
  const node = p.node
  // 兜底：一段命中的几段各在不同文本节点里，正常走不到这里；
  // 但万一偏移算错，宁可少包一段，也不能让 splitText 抛出去把整篇正文搞没
  if (p.start >= node.data.length) return null
  const end = Math.min(p.end, node.data.length)
  node.splitText(end)
  const mid = node.splitText(p.start)
  const kind: AnnotationKind = anno.kind === 'note' ? 'note' : 'understand'
  const span = doc.createElement('span')
  span.className = kind === 'note' ? 'moji-anno moji-anno-note' : 'moji-anno'
  span.dataset.anno = anno.body
  span.dataset.annoTerm = anno.term
  span.dataset.annoKind = kind
  // 自定义样式（前景/背景/下划线/删除线/粗体/斜体）直接写内联样式。
  // 内联 background-color 天然覆盖样式表里 .moji-anno 的默认底纹，无需额外类。
  applyAnnotationStyle(span, anno.style)
  mid.replaceWith(span)
  span.appendChild(mid)
  return span
}

/**
 * 词条在渲染出的正文里还匹配得上吗。
 *
 * 注解只在匹配得上时才显示，因此存储层不能只拿源文 includes 判断——
 * 跨元素选择的词条（中间夹着 \*\*、[](…)、公式）在源文里根本不是一段连续文字。
 * 判断得放在渲染出来的 DOM 上做，这里就是那一份判断，供选择菜单与保存前调用。
 */
export function canAnnotate(root: HTMLElement, term: string): boolean {
  return !!findPieces(buildStream(root), term)
}

/**
 * 在渲染后的 DOM 上套用**一条**注解：按文档顺序把可注解的文字接成一条流，
 * 找到词条该标的那一次出现，再把命中的那几段分别包成 span。
 *
 * 只在文本节点内切分，因此不会切断标签，粗体/斜体等相邻样式完整保留；
 * 一个词条跨了几个元素，就包成几个 span（共用同一条注解，悬停任一段都弹同一个浮层）。
 * 词条在正文里已经找不到时返回 false（正文被改过就会这样），调用方据此跳过。
 */
export function applyAnnotation(root: HTMLElement, a: Annotation): boolean {
  // 每包一条都按**当前** DOM 重新走一遍文字流，而不是一次算完所有词条：
  // 词条互相包含时（先注解「勾股定理」再注解「股」），后一条会套在前一条外面，
  // 两条都看得见；若一次性算完再包，先包的那条会把文字切走，后一条再也对不上。
  const stream = buildStream(root)
  // 标到用户当初选的那一次出现（见 types 的 Annotation.occurrence）：
  // 同一个词在一段话里出现几回是常事，永远标第一次的话，用户在第三回上划的词
  // 就会被标到第一回——看着就是「标错了地方」。那一次已经不在了（正文被改过）
  // 就回落到第一次出现，总比整条注解不显示好。
  const hit = (a.occurrence ? nthHit(stream, a.term, a.occurrence) : null) ?? findHit(stream, a.term)
  if (!hit) return false
  // 同一条命中的几段各在不同文本节点里，互不影响；从后往前只是顺手保持偏移自洽
  for (let i = hit.pieces.length - 1; i >= 0; i--) wrapPiece(root.ownerDocument, hit.pieces[i], a)
  return true
}

/** 某个词条此刻在正文里的全部 span（一条注解可能跨元素，因此是复数） */
function spansOfTerm(root: HTMLElement, term: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.moji-anno')).filter(
    (el) => el.dataset.annoTerm === term,
  )
}

/** 元素的嵌套深度：拆注解时用来决定先后 */
function depthOf(el: Element): number {
  let d = 0
  for (let p = el.parentElement; p; p = p.parentElement) d++
  return d
}

/** 把 span 拆回普通文字（相邻文本节点合并，免得越包越碎） */
export function unwrapSpan(span: HTMLElement): void {
  const parent = span.parentNode
  if (!parent) return
  while (span.firstChild) parent.insertBefore(span.firstChild, span)
  parent.removeChild(span)
  parent.normalize()
}

/**
 * 把某个词条的注解 span 拆回普通文字。
 *
 * also 收的是「原本嵌在它里面的其它注解」：那些 span 拆外层时会被完整保留下来，
 * 但外层一拆一包，嵌套层次就跟全量 hydrate 的结果不一样了。与其解释这种差异，
 * 不如把它们一并标脏重包——重包顺序与全量 hydrate 完全相同，结果自然也相同。
 */
export function unwrapAnnotation(root: HTMLElement, term: string, also?: Set<string>): void {
  const spans = spansOfTerm(root, term)
  for (const span of spans) {
    for (const inner of span.querySelectorAll<HTMLElement>('.moji-anno')) {
      const t = inner.dataset.annoTerm
      if (t && t !== term) also?.add(t)
    }
  }
  // 从深到浅拆：先拆内层，外层 normalize 合并文本时不会把内层结构搅在一起
  spans.sort((a, b) => depthOf(b) - depthOf(a))
  for (const span of spans) unwrapSpan(span)
}

/**
 * 只改样式：位置与结构都不动，原地把内联样式换成新的一套。
 *
 * 要先整条清掉再套：applyAnnotationStyle 只写不删，「取消加粗 / 取消底色」这类
 * 改动不清旧的就不会消失。span 的 style 只由注解样式写入（见 wrapPiece），
 * 因此整条清掉是安全的。
 */
export function restyleAnnotation(root: HTMLElement, a: Annotation): void {
  for (const el of spansOfTerm(root, a.term)) {
    el.removeAttribute('style')
    applyAnnotationStyle(el, a.style)
  }
}

/** 只改释义文本/类型：换掉 dataset 与 class 即可，DOM 结构不动 */
export function retagAnnotation(root: HTMLElement, a: Annotation): void {
  const kind: AnnotationKind = a.kind === 'note' ? 'note' : 'understand'
  for (const el of spansOfTerm(root, a.term)) {
    el.dataset.anno = a.body
    el.dataset.annoKind = kind
    el.className = kind === 'note' ? 'moji-anno moji-anno-note' : 'moji-anno'
  }
}
