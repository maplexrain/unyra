/**
 * 双栏实时预览：光标位置对应预览元素的高亮与滚动跟随
 */

export interface SourceLineInfo {
  lineNumber: number
  lineText: string
  totalLines: number
}

const ACTIVE_CLASS = 'split-preview-active-element'

/** 清洗源文行中的 Markdown 与 Typst 标记字符，提取纯文本用于精确匹配 */
export function cleanSourceLine(text: string): string {
  return text
    // 剔除 Typst 宏调用如 #text(...)[...]、#align(...)、#table(...) 等
    .replace(/#\w+(?:\([^)]*\))?\[?/g, '')
    // 剔除 Markdown 链接与图片 [alt](url) -> alt
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 剔除 Markdown 粗体/斜体/删除线/行内代码符号
    .replace(/[*_~`]{1,3}/g, '')
    // 剔除行首的列表符号、标题、引用、任务框、序号
    .replace(/^[\s>#*+-]+(?:\d+\.)?\s*(?:\[[ xX]\]\s*)?/, '')
    // 剔除 HTML 标签
    .replace(/<[^>]+>/g, '')
    // 剔除尾部可能多余的闭合符号与标点
    .replace(/[\]})#\s]+$/, '')
    .trim()
}

/**
 * 在预览容器内匹配并突出高亮与光标当前行对应的预览 DOM 元素
 */
export function highlightPreviewElement(
  container: HTMLElement | null,
  ratio: number,
  lineInfo?: SourceLineInfo,
): HTMLElement | null {
  if (!container) return null

  // 1. 查找所有可能的块级内容元素
  const rawCandidates = Array.from(
    container.querySelectorAll<HTMLElement>(
      '.note-preview p, .note-preview h1, .note-preview h2, .note-preview h3, .note-preview h4, .note-preview h5, .note-preview h6, .note-preview li, .note-preview pre, .note-preview table, .note-preview tr, .note-preview > *',
    ),
  ).filter((el) => {
    // 过滤掉不可见或过小的包装节点
    return el.offsetHeight > 0 && (el.textContent?.trim().length ?? 0) > 0
  })

  if (rawCandidates.length === 0) return null

  // 关键：剔除非叶子父容器（如包含 li 的 ul/ol、包含 p 的 blockquote/div），优先定位到具体段落/项目
  const candidates = rawCandidates.filter((el) => {
    const isBigContainer = ['UL', 'OL', 'BLOCKQUOTE', 'DIV', 'SECTION'].includes(el.tagName)
    if (isBigContainer) {
      const hasChildCandidate = rawCandidates.some((other) => other !== el && el.contains(other))
      if (hasChildCandidate) return false
    }
    return true
  })

  if (candidates.length === 0) return null

  let matched: HTMLElement | null = null
  const lineText = lineInfo?.lineText?.trim() ?? ''
  const cleanText = cleanSourceLine(lineText)

  // 2. 若当前行有实质文本内容，优先通过文本匹配
  if (cleanText.length >= 2) {
    const isHeading = /^#{1,6}\s|^\s*={1,6}\s/.test(lineText)
    const isList = /^[*+-]|\d+\.\s/.test(lineText)
    const isQuote = /^>\s/.test(lineText)
    // 截取前 28 个字符作为搜索核心特征（避免因行尾标点或排版差异导致不匹配）
    const searchSnippet = cleanText.length > 28 ? cleanText.slice(0, 28) : cleanText

    if (isHeading) {
      matched =
        candidates.find(
          (el) =>
            /^H[1-6]$/i.test(el.tagName) &&
            (el.textContent?.includes(searchSnippet) || searchSnippet.includes(el.textContent?.trim() ?? '')),
        ) ?? null
    } else if (isList) {
      matched =
        candidates.find(
          (el) => el.tagName === 'LI' && (el.textContent?.includes(searchSnippet) || searchSnippet.includes(el.textContent?.trim() ?? '')),
        ) ?? null
    } else if (isQuote) {
      matched =
        candidates.find(
          (el) =>
            (el.tagName === 'BLOCKQUOTE' || el.closest('blockquote')) &&
            el.textContent?.includes(searchSnippet),
        ) ?? null
    }

    if (!matched) {
      // 在所有候选元素中搜寻包含该段文本的元素
      const textMatches = candidates.filter((el) => el.textContent?.includes(searchSnippet))
      if (textMatches.length === 1) {
        matched = textMatches[0]
      } else if (textMatches.length > 1) {
        // 多处命中时按纵向相对位置选取最接近光标比例的那项
        const scrollH = container.scrollHeight || 1
        matched = textMatches.reduce((closest, cur) => {
          const curDiff = Math.abs(cur.offsetTop / scrollH - ratio)
          const closestDiff = Math.abs(closest.offsetTop / scrollH - ratio)
          return curDiff < closestDiff ? cur : closest
        })
      }
    }
  }

  // 3. 若文本未直接命中（如空行、公式、复合代码），按段落索引与高度比例定位最接近的段落元素
  if (!matched) {
    const expectedIdx = Math.max(0, Math.min(candidates.length - 1, Math.round(ratio * (candidates.length - 1))))
    matched = candidates[expectedIdx] ?? candidates[0]
  }

  // 4. 更新高亮 class
  const prevActive = container.querySelectorAll(`.${ACTIVE_CLASS}`)
  if (matched && matched.classList.contains(ACTIVE_CLASS) && prevActive.length === 1) {
    return matched
  }

  prevActive.forEach((el) => el.classList.remove(ACTIVE_CLASS))

  if (matched) {
    matched.classList.add(ACTIVE_CLASS)

    // 平滑可视区域保护：确保被高亮的元素处于可视区中
    const cRect = container.getBoundingClientRect()
    const mRect = matched.getBoundingClientRect()
    const PADDING = 36
    if (mRect.top < cRect.top + PADDING) {
      container.scrollTop -= cRect.top + PADDING - mRect.top
    } else if (mRect.bottom > cRect.bottom - PADDING) {
      container.scrollTop += mRect.bottom - (cRect.bottom - PADDING)
    }
  }

  return matched
}
