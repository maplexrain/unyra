/**
 * 「询问」引文的定位与高亮。
 *
 * 用户消息气泡里显示选段引文（可点击），点击后回到笔记中把对应文字闪一下，
 * 让读者立刻知道这条消息在问什么。笔记组件与消息组件之间隔了好几层，
 * 沿用节点链接那套模块级回调注册：笔记组件挂载时登记，气泡点击时调用。
 *
 * 定位有两条路：**源文区间**（划词那一刻量好的坐标，见 lib/sourceMap）与
 * **文字匹配**（兜底）。前者优先——同一个词在正文里出现好几回时，
 * 文字匹配只会命中第一次，用户点第二处的引文却闪到第一处去。
 */

import { mapSourceToRange } from './sourceMap'
import { SKIP_SELECTOR } from './textNodes'

export interface QuoteRef {
  /** 选中的渲染态文字；也是位置量不出来时的兜底定位依据 */
  text: string
  /** 这段在 Markdown 源文里的字符区间（划词那一刻由 mapRangeToSource 量出） */
  start?: number
  end?: number
}

let handler: ((q: QuoteRef) => void) | null = null

/** 登记当前笔记的高亮实现；返回清理用（传 null 注销） */
export function setQuoteFocusHandler(fn: ((q: QuoteRef) => void) | null): void {
  handler = fn
}

/** 请求高亮一段引文；当前没有可定位的笔记时静默忽略 */
export function focusQuote(q: QuoteRef): boolean {
  if (!handler) return false
  handler(q)
  return true
}

/** 这些结构里的文字不参与定位：公式渲染后字形与源文不同，代码块也不宜高亮 */

const FLASH_CLASS = 'moji-quote-flash'
const FLASH_MS = 1600

/**
 * 在 root 中定位 needle 对应的文字并播放一次高亮动画。
 *
 * 选区可能跨多个文本节点/元素，因此先把文本节点拍平成一条字符串（空白折叠）
 * 再查找，并映射回 (node, offset) 构造 Range。动画用绝对定位的覆盖层而非
 * 包裹元素——root 的内容由 React 之外的代码托管，包裹会留下结构改动。
 */
export function flashText(root: HTMLElement, needle: string): boolean {
  const target = needle.replace(/\s+/g, ' ').trim()
  if (!target) return false
  const doc = root.ownerDocument
  const win = doc.defaultView
  if (!win) return false

  // 拍平：flat 的每个字符都记下它来自哪个文本节点、哪个字符偏移
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest(SKIP_SELECTOR)) return 2 /* FILTER_REJECT */
      return (node as Text).data ? 1 /* FILTER_ACCEPT */ : 2
    },
  })
  const points: Array<{ node: Text; offset: number }> = []
  let flat = ''
  let prevSpace = false
  let n = walker.nextNode()
  while (n) {
    const t = n as Text
    const s = t.data
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\u3000') {
        if (prevSpace) continue
        flat += ' '
        points.push({ node: t, offset: i })
        prevSpace = true
      } else {
        flat += ch
        points.push({ node: t, offset: i })
        prevSpace = false
      }
    }
    n = walker.nextNode()
  }

  // 选段若跨过公式/代码（被跳过），整串匹配会落空，退回较短的可靠前缀
  const candidates = [target]
  if (target.length > 24) candidates.push(target.slice(0, 24))
  let idx = -1
  let len = 0
  for (const c of candidates) {
    const at = flat.indexOf(c)
    if (at >= 0) {
      idx = at
      len = c.length
      break
    }
  }
  if (idx < 0) return false

  const start = points[idx]
  const last = points[idx + len - 1]
  const range = doc.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(last.node, last.offset + 1)
  return reveal(root, range)
}

/**
 * 高亮一条引文：**优先按源文区间回到原处**，量不出来才退回文字匹配。
 *
 * 区间是划词那一刻量好的，说的是「用户划的是这一处」；文字说的是「正文里有这么一段
 * 字」。同一个词出现好几回时只有前者分得清——这正是「询问的引用总落在最前面那处」
 * 那个 bug 的根子。
 */
export function flashQuote(root: HTMLElement, source: string, q: QuoteRef): boolean {
  if (typeof q.start === 'number' && typeof q.end === 'number' && q.end > q.start) {
    const range = mapSourceToRange(root, source, q.start, q.end)
    if (range) return reveal(root, range)
  }
  return flashText(root, q.text)
}

/** 把一段 Range 带到眼前并闪一下：两条定位路径共用它（滚动与作画只该有一份） */
function reveal(root: HTMLElement, range: Range): boolean {
  const win = root.ownerDocument.defaultView
  if (!win) return false
  const rect = range.getBoundingClientRect()
  const visible = rect.top >= 8 && rect.bottom <= win.innerHeight - 8
  if (!visible) range.startContainer.parentElement?.scrollIntoView({ block: 'center' })

  // scrollIntoView（非平滑）同步完成，下一帧 rect 已是滚动后的位置
  const draw = () => drawFlash(root.ownerDocument, win, range)
  if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(draw)
  else win.setTimeout(draw, 16)
  return true
}

function drawFlash(doc: Document, win: Window, range: Range): void {
  const raw = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
  const rects = raw.filter((r) => r.width > 0 && r.height > 0)
  if (!rects.length) {
    const r = range.getBoundingClientRect()
    if (r.width > 0 || r.height > 0) rects.push(r)
  }
  const layers = rects.map((r) => {
    const el = doc.createElement('div')
    el.className = FLASH_CLASS
    el.style.left = `${r.left - 3}px`
    el.style.top = `${r.top - 2}px`
    el.style.width = `${r.width + 6}px`
    el.style.height = `${r.height + 4}px`
    doc.body.appendChild(el)
    return el
  })
  if (!layers.length) return
  win.setTimeout(() => layers.forEach((el) => el.remove()), FLASH_MS)
}
