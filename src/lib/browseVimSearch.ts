import PinyinModule from 'pinyin-match'

export interface TextChunk {
  node: Text
  start: number
  end: number
}

export interface MatchSpan {
  start: number
  end: number
}

export interface SearchResult {
  total: number
  index: number
  range: Range | null
  pattern: string
  wrapped?: boolean
}

/** 收集容器内所有可见文本节点及其全局字符偏移量 */
export function collectDocTextChunks(root: HTMLElement): { fullText: string; chunks: TextChunk[] } {
  const chunks: TextChunk[] = []
  let fullText = ''

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('button, input, textarea, select, [data-ignore-caret], .modal-scrim, [role="dialog"]')) {
        return NodeFilter.FILTER_REJECT
      }
      const s = window.getComputedStyle(parent)
      if (s.display === 'none' || s.visibility === 'hidden') {
        return NodeFilter.FILTER_REJECT
      }
      if (!node.textContent || node.textContent.length === 0) {
        return NodeFilter.FILTER_SKIP
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let current = walker.nextNode() as Text | null
  while (current) {
    const text = current.textContent || ''
    const start = fullText.length
    fullText += text
    const end = fullText.length
    chunks.push({ node: current, start, end })
    current = walker.nextNode() as Text | null
  }

  return { fullText, chunks }
}

/**
 * 在文本中查找所有匹配项：
 * 1. 尝试以正则表达式进行全局匹配 (gi)；
 * 2. 使用拼音库 pinyin-match 查找拼音与汉字匹配；
 * 3. 普通文本不区分大小写匹配；
 * 4. 合并去重并按 start 升序排序。
 */
export function findSearchMatches(fullText: string, pattern: string): MatchSpan[] {
  const trimmed = pattern.trim()
  if (!trimmed || !fullText) return []

  const spans: MatchSpan[] = []
  const seenKeys = new Set<string>()

  const addSpan = (start: number, end: number) => {
    if (start < 0 || end <= start || end > fullText.length) return
    const key = `${start}:${end}`
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      spans.push({ start, end })
    }
  }

  // 1. 正则匹配尝试
  try {
    const regex = new RegExp(trimmed, 'gi')
    let match: RegExpExecArray | null
    let guard = 0
    while ((match = regex.exec(fullText)) !== null && guard < 5000) {
      guard++
      const start = match.index
      const end = start + match[0].length
      if (match[0].length > 0) {
        addSpan(start, end)
      } else {
        regex.lastIndex++
      }
    }
  } catch {
    // pattern 包含不合法正则语法，继续后续拼音与子串匹配
  }

  // 2. 拼音匹配（全拼、简拼匹配汉字内容）
  try {
    const cjkRegex = /[\u4e00-\u9fa5]+/g
    let cjkMatch: RegExpExecArray | null
    let cjkGuard = 0
    while ((cjkMatch = cjkRegex.exec(fullText)) !== null && cjkGuard < 5000) {
      cjkGuard++
      const cjk = cjkMatch[0]
      const base = cjkMatch.index
      let off = 0
      let segGuard = 0
      while (off < cjk.length && segGuard < 1000) {
        segGuard++
        const m = PinyinModule.match(cjk.slice(off), trimmed)
        if (!m || typeof m !== 'object' || !Array.isArray(m)) break
        const [mStart, mEnd] = m
        if (typeof mStart !== 'number' || typeof mEnd !== 'number' || mEnd < mStart) break
        const absStart = base + off + mStart
        const absEnd = base + off + mEnd + 1
        addSpan(absStart, absEnd)
        off += mStart + 1
      }
    }
    // 全文兜底扫描一次
    let offset = 0
    let rem = fullText
    let guard = 0
    while (offset < fullText.length && guard < 5000) {
      guard++
      const m = PinyinModule.match(rem, trimmed)
      if (!m || typeof m !== 'object' || !Array.isArray(m)) break
      const [mStart, mEnd] = m
      if (typeof mStart !== 'number' || typeof mEnd !== 'number' || mEnd < mStart) break
      addSpan(offset + mStart, offset + mEnd + 1)
      offset += mStart + 1
      rem = fullText.slice(offset)
    }
  } catch {
    // pinyin-match 异常降级
  }

  // 3. 普通字面量大小写不敏感匹配
  const lowerFull = fullText.toLowerCase()
  const lowerPattern = trimmed.toLowerCase()
  let subIdx = lowerFull.indexOf(lowerPattern)
  let subGuard = 0
  while (subIdx !== -1 && subGuard < 5000) {
    subGuard++
    addSpan(subIdx, subIdx + lowerPattern.length)
    subIdx = lowerFull.indexOf(lowerPattern, subIdx + Math.max(1, lowerPattern.length))
  }

  return spans.sort((a, b) => a.start - b.start || a.end - b.end)
}

/** 将匹配全局偏移量映射为 DOM Range */
export function createRangeFromSpan(chunks: TextChunk[], span: MatchSpan): Range | null {
  if (chunks.length === 0) return null

  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const chunk of chunks) {
    if (!startNode && span.start >= chunk.start && span.start < chunk.end) {
      startNode = chunk.node
      startOffset = span.start - chunk.start
    }
    if (span.end > chunk.start && span.end <= chunk.end) {
      endNode = chunk.node
      endOffset = span.end - chunk.start
      break
    }
  }

  // 边界保护：若尾部恰好位于末尾
  if (startNode && !endNode && span.end >= chunks[chunks.length - 1].end) {
    const last = chunks[chunks.length - 1]
    endNode = last.node
    endOffset = last.node.textContent?.length || 0
  }

  if (!startNode || !endNode) return null

  try {
    const range = document.createRange()
    range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length || 0))
    range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length || 0))
    return range
  } catch {
    return null
  }
}

/** 浏览模式下 Vim 搜索状态管理单例 */
class BrowseVimSearchState {
  private pattern = ''
  private root: HTMLElement | null = null
  private chunks: TextChunk[] = []
  private spans: MatchSpan[] = []
  private currentIndex = -1
  private backward = false

  /** 在指定容器执行新搜索 */
  search(root: HTMLElement, pattern: string, backward = false): SearchResult {
    this.root = root
    this.pattern = pattern.trim()
    this.currentIndex = -1
    this.backward = backward

    if (!this.pattern) {
      this.clear()
      return { total: 0, index: -1, range: null, pattern: '' }
    }

    const { fullText, chunks } = collectDocTextChunks(root)
    this.chunks = chunks
    this.spans = findSearchMatches(fullText, this.pattern)

    if (this.spans.length === 0) {
      this.updateCssHighlights(null)
      return { total: 0, index: -1, range: null, pattern: this.pattern }
    }

    // 默认落在第一处匹配（反向则落在最后一处）
    this.currentIndex = backward ? this.spans.length - 1 : 0
    const span = this.spans[this.currentIndex]
    const range = createRangeFromSpan(this.chunks, span)
    this.updateCssHighlights(range)

    return {
      total: this.spans.length,
      index: this.currentIndex,
      range,
      pattern: this.pattern,
    }
  }

  /** 跳转至下一处匹配 (n) */
  next(fallbackRoot?: HTMLElement): SearchResult {
    return this.step(this.backward ? -1 : 1, fallbackRoot)
  }

  /** 跳转至上一处匹配 (N) */
  prev(fallbackRoot?: HTMLElement): SearchResult {
    return this.step(this.backward ? 1 : -1, fallbackRoot)
  }

  private step(direction: number, fallbackRoot?: HTMLElement): SearchResult {
    if ((this.spans.length === 0 || !this.root || !this.root.isConnected) && fallbackRoot && this.pattern) {
      this.search(fallbackRoot, this.pattern, this.backward)
    }
    if (this.spans.length === 0 || !this.root) {
      return { total: 0, index: -1, range: null, pattern: this.pattern }
    }
    let wrapped = false
    this.currentIndex += direction
    if (this.currentIndex >= this.spans.length) {
      this.currentIndex = 0
      wrapped = true
    } else if (this.currentIndex < 0) {
      this.currentIndex = this.spans.length - 1
      wrapped = true
    }
    const span = this.spans[this.currentIndex]
    const range = createRangeFromSpan(this.chunks, span)
    this.updateCssHighlights(range)
    return {
      total: this.spans.length,
      index: this.currentIndex,
      range,
      pattern: this.pattern,
      wrapped,
    }
  }

  /** 通过 CSS Custom Highlight API 实时为文档中的全部命中 Range 绘制高亮 */
  private updateCssHighlights(activeRange: Range | null): void {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
    const H = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!H) return

    const css = (CSS as unknown as { highlights: { set: (k: string, v: unknown) => void; delete: (k: string) => void } }).highlights
    if (!this.pattern || this.spans.length === 0 || this.chunks.length === 0) {
      try {
        css.delete('browse-vim-search')
        css.delete('browse-vim-search-active')
      } catch {}
      return
    }

    try {
      const allRanges: Range[] = []
      for (const span of this.spans) {
        const r = createRangeFromSpan(this.chunks, span)
        if (r) allRanges.push(r)
      }
      if (allRanges.length > 0) {
        css.set('browse-vim-search', new H(...allRanges))
      } else {
        css.delete('browse-vim-search')
      }

      if (activeRange) {
        css.set('browse-vim-search-active', new H(activeRange))
      } else {
        css.delete('browse-vim-search-active')
      }
    } catch {
      // 容错降级
    }
  }

  clear(): void {
    this.pattern = ''
    this.root = null
    this.chunks = []
    this.spans = []
    this.currentIndex = -1
    this.updateCssHighlights(null)
  }

  hasActiveSearch(): boolean {
    return Boolean(this.pattern.trim())
  }

  getPattern(): string {
    return this.pattern
  }
}

export const browseVimSearch = new BrowseVimSearchState()

type SearchHandler = (pattern: string, backward?: boolean, silent?: boolean) => void

let searchHandler: SearchHandler | null = null

export function setBrowseSearchHandler(handler: SearchHandler | null): void {
  searchHandler = handler
}

export function dispatchBrowseSearch(pattern: string, backward?: boolean, silent = false): boolean {
  if (searchHandler) {
    searchHandler(pattern, backward, silent)
    return true
  }
  return false
}
