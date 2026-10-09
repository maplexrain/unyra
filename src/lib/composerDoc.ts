/**
 * 对话输入框（contenteditable）的纯逻辑：`#[{…}]` 的就地展开与「编辑区 → 发送文本」。
 *
 * 输入框从 textarea 换成 contenteditable 是为了承载 chip：一枚 chip 是**一个整体**
 * （contenteditable=false，删就整删），而发送给模型的仍是纯文本——chip 按登记的
 * `#[{…}]` token 展开（语法与外观见 lib/chipSyntax）。序列化是纯函数，钉在单测里
 * （tests/composerDoc.test.ts）。
 */

import { buildChipHtml, splitChips } from './chipSyntax'

/** 页签 chip 的标记属性：serializeEditable 认它，别的元素一律当普通内容递归 */
const CHIP_ATTR = 'data-moji-doc-chip'

/**
 * 编辑区内容 → 发送文本。文字、换行（<br> 与块级元素）照实收，chip 展开成登记的
 * `#[{…}]` token——模型看到的就是系统提示词里那份引用语法。只认自己插进去的形态
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

/**
 * 把编辑区里打出来 / 粘进来的完整 `#[{…}]` 就地换成 chip 元素（解析不开的照旧是文字）。
 *
 * 程序化改 DOM 不会触发 input 事件，调用方（onEdit）改完自己同步镜像即可，不会重入。
 * IME 组合期间不要调：组合串还没定型，扫描替换会打断输入法。
 */
export function expandChipTokens(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const hits: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue && node.nodeValue.includes('#[')) hits.push(node as Text)
  }
  for (const node of hits) {
    const segments = splitChips(node.nodeValue ?? '')
    if (!segments.some((s) => s.kind === 'chip')) continue
    const frag = document.createDocumentFragment()
    for (const seg of segments) {
      if (seg.kind === 'text') {
        frag.appendChild(document.createTextNode(seg.text))
        continue
      }
      const holder = document.createElement('template')
      holder.innerHTML = buildChipHtml(seg.payload)
      frag.appendChild(holder.content)
    }
    node.replaceWith(frag)
  }
}

/**
 * 把一段文字插到**光标处**（语音识别的结果落进输入框走这条路）。
 *
 * 为什么不用 execCommand('insertText')：这棵树里有 chip（contenteditable=false 的整体元素），
 * 手插 Range 才能保证「chip 还在、光标落在插入的文字之后」这两件事都由我们自己说了算。
 * 插完派发一次 input：composer.value 那份镜像、斜杠菜单、占位符都靠它同步。
 *
 * 选区不在这个编辑区里（比如用户刚点完麦克风按钮）时插到末尾——那正是「接着写」的位置。
 */
export function insertTextAtCaret(el: HTMLElement, text: string): void {
  if (!text) return
  el.focus()
  const selection = window.getSelection()
  const inside = selection !== null && selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).startContainer)
  const range = inside && selection ? selection.getRangeAt(0) : document.createRange()
  if (!inside) range.selectNodeContents(el)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(range)
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
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
