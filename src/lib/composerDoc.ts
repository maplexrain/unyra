/**
 * 对话输入框（contenteditable）的纯逻辑：页签 chip 的 DOM 形态与「编辑区 → 发送文本」。
 *
 * 输入框从 textarea 换成 contenteditable 只为了一件事：页签拖进来要变成一枚**元素**
 * （可整体删除、不可拆开编辑），而发送给模型的仍是纯文本——chip 按登记的 token
 * （页签的路径信息）展开。序列化是纯函数，钉在单测里（tests/composerDoc.test.ts）。
 */

import type { DocChipPayload } from './docChip'

/** 页签 chip 的标记属性：serializeEditable 认它，别的元素一律当普通内容递归 */
const CHIP_ATTR = 'data-moji-doc-chip'

/** escape & < > "：chip 的属性与文字、粘进来的正文都来自文件名与网页，什么字符都可能有 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 一枚页签 chip 的 HTML（插入 contenteditable 用）。后面的空格让连续两枚 chip 不贴死 */
export function chipHtml(doc: DocChipPayload): string {
  const cls =
    'inline-flex max-w-[260px] items-center rounded-md bg-line/60 px-1.5 py-0.5 ' +
    'align-baseline text-[12px] leading-5 text-ink-soft'
  return (
    `<span class="${cls}" ${CHIP_ATTR}="1" data-token="${escapeHtml(doc.token)}"` +
    ` title="${escapeHtml(doc.token)}" contenteditable="false">${escapeHtml(doc.label)}</span>&nbsp;`
  )
}

/**
 * 编辑区内容 → 发送文本。文字、换行（<br> 与块级元素）照实收，chip 展开成登记的
 * token——模型看到的就是「@docs/…」这样的路径信息。只认自己插进去的形态
 * （文字、<br>、chip、粘贴拍平出的 div/p），不需要一个通用的 HTML 反解析器。
 */
export function serializeEditable(root: Element): string {
  let out = ''
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (el.hasAttribute(CHIP_ATTR)) {
      out += el.getAttribute('data-token') ?? ''
      return
    }
    if (el.tagName === 'BR') {
      out += '\n'
      return
    }
    // 粘贴或拖放可能带进块级壳：换行照实算，内容递归收
    if ((el.tagName === 'DIV' || el.tagName === 'P') && out && !out.endsWith('\n')) out += '\n'
    for (const child of Array.from(el.childNodes)) walk(child)
  }
  for (const child of Array.from(root.childNodes)) walk(child)
  return out
}

/** 光标推到编辑区末尾并聚焦：「接着写」的位置——Ctrl+Q 聚焦、拖进页签都落在这里 */
export function placeCaretEnd(el: HTMLElement): void {
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** 光标是否停在整个编辑内容的末尾（幽灵补全只在末尾出现） */
export function caretAtEnd(el: HTMLElement): boolean {
  const sel = window.getSelection()
  const anchor = sel?.anchorNode
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || !anchor || !el.contains(anchor)) return false
  const probe = document.createRange()
  probe.selectNodeContents(el)
  try {
    probe.setEnd(anchor, sel.anchorOffset)
  } catch {
    return false
  }
  return probe.toString().length === 0
}
