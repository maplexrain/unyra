/**
 * 双栏实时预览：光标位置对应预览元素的高亮与滚动跟随
 */

export interface SourceLineInfo {
  lineNumber: number
  lineText: string
  totalLines: number
}

const ACTIVE_CLASS = 'split-preview-active-element'

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
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(
      '.note-preview > *, .note-preview p, .note-preview h1, .note-preview h2, .note-preview h3, .note-preview h4, .note-preview h5, .note-preview h6, .note-preview li, .note-preview blockquote, .note-preview pre, .note-preview table',
    ),
  ).filter((el) => {
    // 过滤掉不可见或过小的包装节点
    return el.offsetHeight > 0 && el.textContent?.trim().length
  })

  if (candidates.length === 0) return null

  let matched: HTMLElement | null = null
  const lineText = lineInfo?.lineText?.trim() ?? ''
  const cleanText = lineText.replace(/^[\s>#*+-]+(?:\d+\.)?\s*/, '').trim()

  // 2. 若当前行有实质文本内容，优先通过文本匹配
  if (cleanText.length >= 2) {
    const isHeading = /^#{1,6}\s/.test(lineText)
    const isList = /^[*+-]|\d+\.\s/.test(lineText)
    const isQuote = /^>\s/.test(lineText)

    if (isHeading) {
      matched =
        candidates.find(
          (el) =>
            /^H[1-6]$/i.test(el.tagName) &&
            (el.textContent?.trim().includes(cleanText) || cleanText.includes(el.textContent?.trim() ?? '')),
        ) ?? null
    } else if (isList) {
      matched =
        candidates.find(
          (el) => el.tagName === 'LI' && el.textContent?.trim().includes(cleanText),
        ) ?? null
    } else if (isQuote) {
      matched =
        candidates.find(
          (el) =>
            (el.tagName === 'BLOCKQUOTE' || el.closest('blockquote')) &&
            el.textContent?.trim().includes(cleanText),
        ) ?? null
    }

    if (!matched) {
      // 在所有候选元素中搜寻包含该段文本的元素
      const textMatches = candidates.filter((el) => el.textContent?.includes(cleanText))
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

  // 3. 若文本未直接命中（如空行、公式、复合代码），按纵向高度比例定位最接近的块元素
  if (!matched) {
    const scrollH = container.scrollHeight || 1
    const targetY = ratio * scrollH
    matched = candidates.reduce((closest, cur) => {
      const curDiff = Math.abs(cur.offsetTop - targetY)
      const closestDiff = Math.abs(closest.offsetTop - targetY)
      return curDiff < closestDiff ? cur : closest
    })
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
