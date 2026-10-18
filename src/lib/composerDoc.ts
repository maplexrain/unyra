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
 * 语音输入的「实时落字器」：这一段的文字会随着识别结果不断被**整段替换**。
 *
 * 为什么不是每次 append 一段：分段识别每次给的是**这一段到目前为止的全文**，
 * 后面的结果还会修正前面的词（"这个" → "这一句"）。所以记住这一段第一次插在
 * 哪个文本节点、从第几个字符开始、上一次写的是什么，之后只替换这几个字符。
 * 用户手动改过这一段（节点内容对不上）就放弃替换、另起一段——宁可分成两段，
 * 也不覆盖用户自己写的东西。
 */
export interface VoiceTyping {
  /** 用这一段的**全文**替换上一次写进去的同段文字 */
  update(text: string): void
  /** 这一段定稿：下一次 update 在光标处另起一段 */
  commit(): void
}

export function beginVoiceTyping(el: HTMLElement): VoiceTyping {
  /** 这一段落在哪个文本节点、从第几个字符开始、上次写进去的全文 */
  let node: Text | null = null
  let from = 0
  let last = ''

  const selection = () => window.getSelection()

  /** 第一次：插到光标处（选区不在编辑区里就落到末尾），并记住落点 */
  const insert = (text: string): void => {
    el.focus()
    const sel = selection()
    const inside = sel !== null && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).startContainer)
    const range = inside && sel ? sel.getRangeAt(0) : document.createRange()
    if (!inside) {
      // 没有选区落在编辑区里：落到**末尾**接着写（不是清空整块！）
      range.selectNodeContents(el)
      range.collapse(false)
    }
    range.deleteContents()
    const n = document.createTextNode(text)
    range.insertNode(n)
    range.setStartAfter(n)
    range.collapse(true)
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(range)
    }
    node = n
    from = 0
    last = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** 光标本来就在这一段里（collapse 在节点上）时，跟着段尾走 */
  const caretToEnd = (n: Text): void => {
    const sel = selection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed || sel.anchorNode !== n) return
    const range = document.createRange()
    range.setStart(n, n.data.length)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  return {
    update(text: string): void {
      if (!text) return
      const n = node
      const intact =
        n !== null && n.isConnected && el.contains(n) && n.data.slice(from, from + last.length) === last
      if (!n || !intact) {
        insert(text)
        return
      }
      if (text === last) return
      n.replaceData(from, last.length, text)
      last = text
      caretToEnd(n)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    commit(): void {
      node = null
      from = 0
      last = ''
    },
  }
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
