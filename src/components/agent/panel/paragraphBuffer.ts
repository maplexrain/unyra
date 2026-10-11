/**
 * 消息正文分段缓冲切分。
 *
 * 优化点：
 * 1. 分段缓冲渲染：在流式生成期间，内容每累加一段（换行符分割段落）就解析输出一段；
 * 2. 块级完整性：代码围栏（``` / ~~~）、独立 KaTeX 公式块（$$）、Markdown 表格（|...|）
 *    以及引用块（>）内部的换行被完整保护，不被误切；
 * 3. 独立性：每个段落是独立的渲染单元，新段落追加时历史段落 0 重渲染；
 * 4. 渐进动效：新段落挂载时带有 CSS 不透明度与轻微位移进场动画。
 */

export interface SplitParagraphOptions {
  /** 是否处于流式生成中。若为 true，末尾尚未遇到换行符的半句会留在缓冲区中，等待后续 token 凑成整段 */
  streaming?: boolean
}

const FENCE_START_REGEX = /^(\s*)(`{3,}|~{3,})/
const FENCE_CLOSE_REGEX = /^(\s*)(`{3,}|~{3,})\s*$/

export function splitParagraphs(text: string, options?: SplitParagraphOptions): string[] {
  if (!text) return []
  const streaming = options?.streaming ?? false
  // 统一回车换行符
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const hasTrailingNewline = normalized.endsWith('\n')

  const segments: string[] = []
  let current: string[] = []
  let inCode = false
  let fenceChar = ''
  let fenceLen = 0
  let inMath = false
  let inTable = false
  let inQuote = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const isLast = i === lines.length - 1
    // 如果是最后一行，且处于流式中，且文本末尾没有换行符，说明该行还在生成中，尚未成段
    const isLineComplete = !isLast || !streaming || hasTrailingNewline

    // 1. 处于代码围栏内部
    if (inCode) {
      current.push(line)
      const closeMatch = line.match(FENCE_CLOSE_REGEX)
      if (closeMatch && closeMatch[2].charAt(0) === fenceChar && closeMatch[2].length >= fenceLen) {
        inCode = false
        if (isLineComplete) {
          segments.push(current.join('\n'))
          current = []
        }
      }
      continue
    }

    // 2. 处于独立 KaTeX 公式块内部 ($$)
    if (inMath) {
      current.push(line)
      if (line.trim() === '$$') {
        inMath = false
        if (isLineComplete) {
          segments.push(current.join('\n'))
          current = []
        }
      }
      continue
    }

    // 3. 代码围栏开启
    const openFenceMatch = line.match(FENCE_START_REGEX)
    if (openFenceMatch) {
      if (current.length > 0) {
        segments.push(current.join('\n'))
        current = []
      }
      inCode = true
      fenceChar = openFenceMatch[2].charAt(0)
      fenceLen = openFenceMatch[2].length
      current.push(line)
      continue
    }

    // 4. 独立公式块开启
    if (line.trim() === '$$') {
      if (current.length > 0) {
        segments.push(current.join('\n'))
        current = []
      }
      inMath = true
      current.push(line)
      continue
    }

    // 5. 空行（段落分隔）：终结当前积攒的内容
    if (line.trim() === '') {
      if (current.length > 0) {
        segments.push(current.join('\n'))
        current = []
      }
      inTable = false
      inQuote = false
      continue
    }

    // 6. Markdown 表格行 (|...|)
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|')
    if (isTableRow) {
      if (!inTable && current.length > 0) {
        segments.push(current.join('\n'))
        current = []
      }
      inTable = true
      current.push(line)
      continue
    } else if (inTable) {
      inTable = false
      segments.push(current.join('\n'))
      current = []
    }

    // 7. 引用行 (>...)
    const isQuoteRow = line.trim().startsWith('>')
    if (isQuoteRow) {
      if (!inQuote && current.length > 0) {
        segments.push(current.join('\n'))
        current = []
      }
      inQuote = true
      current.push(line)
      continue
    } else if (inQuote) {
      inQuote = false
      segments.push(current.join('\n'))
      current = []
    }

    // 8. 缩进延续行（列表或代码缩进），与上一行保持同一块
    const isIndented = /^(\s{2,}|\t)\S/.test(line)
    if (isIndented && current.length > 0) {
      current.push(line)
      continue
    }

    // 9. 普通单行 / 段落
    if (current.length > 0) {
      segments.push(current.join('\n'))
      current = []
    }
    current.push(line)
    if (isLineComplete) {
      segments.push(current.join('\n'))
      current = []
    }
  }

  // 流式结束（或静态历史消息），把缓冲区内残余内容全部作为最后一段输出
  if (!streaming && current.length > 0) {
    segments.push(current.join('\n'))
  }

  return segments.filter((s) => s.trim().length > 0)
}
