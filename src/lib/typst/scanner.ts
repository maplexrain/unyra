/**
 * Typst 语法括号匹配与样式参数解析器
 */

/** 匹配配对括号（处理字符串与引号嵌套） */
export function findMatchingBracket(
  str: string,
  start: number,
  openChar: string = '(',
  closeChar: string = ')',
): number {
  if (str[start] !== openChar) return -1
  let depth = 0
  let inString = false
  let stringChar = ''
  for (let i = start; i < str.length; i++) {
    const ch = str[i]
    const prev = i > 0 ? str[i - 1] : ''
    if (inString) {
      if (ch === stringChar && prev !== '\\') inString = false
      continue
    }
    if ((ch === '"' || ch === "'") && prev !== '\\') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** 按未嵌套的顶层逗号切割参数列表 */
export function splitTopLevel(str: string, sep: string = ','): string[] {
  const parts: string[] = []
  let depthP = 0
  let depthB = 0
  let inString = false
  let stringChar = ''
  let start = 0

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    const prev = i > 0 ? str[i - 1] : ''
    if (inString) {
      if (ch === stringChar && prev !== '\\') inString = false
      continue
    }
    if ((ch === '"' || ch === "'") && prev !== '\\') {
      inString = true
      stringChar = ch
      continue
    }
    if (ch === '(') depthP++
    else if (ch === ')') depthP--
    else if (ch === '[') depthB++
    else if (ch === ']') depthB--
    else if (ch === sep && depthP === 0 && depthB === 0) {
      parts.push(str.slice(start, i).trim())
      start = i + 1
    }
  }
  if (start < str.length) {
    const last = str.slice(start).trim()
    if (last) parts.push(last)
  }
  return parts
}

/** 提取 Typst 颜色表示（如 rgb("#666") 或纯色名） */
export function parseColor(val: string): string {
  if (!val) return ''
  const rgbMatch = val.match(/rgb\(\s*["']?([^"')]+)["']?\s*\)/)
  if (rgbMatch) return rgbMatch[1].trim()
  return val.replace(/["']/g, '').trim()
}

/** 解析 Typst 命名参数并转化为内联 CSS 样式声明 */
export function parseStyleArgs(argsStr: string | null): string {
  if (!argsStr) return ''
  const styles: string[] = []
  const parts = splitTopLevel(argsStr)

  for (const part of parts) {
    const idx = part.indexOf(':')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()

    if (key === 'size') {
      styles.push(`font-size: ${val}`)
    } else if (key === 'weight') {
      styles.push(`font-weight: ${val.replace(/["']/g, '')}`)
    } else if (key === 'fill') {
      const c = parseColor(val)
      if (c) styles.push(`color: ${c}`)
    } else if (key === 'stroke') {
      // stroke: 0.5pt + rgb("#999") 或 stroke: (left: 2pt + rgb("#a8432f"))
      if (val.startsWith('(') && val.endsWith(')')) {
        const inner = val.slice(1, -1)
        const subParts = splitTopLevel(inner)
        for (const sub of subParts) {
          const sIdx = sub.indexOf(':')
          if (sIdx !== -1) {
            const side = sub.slice(0, sIdx).trim()
            const sVal = sub.slice(sIdx + 1).trim()
            const strokeParts = sVal.split('+').map((x) => x.trim())
            const width = strokeParts[0] || '1px'
            const color = parseColor(strokeParts[1] || '#999')
            styles.push(`border-${side}: ${width} solid ${color}`)
          }
        }
      } else {
        const strokeParts = val.split('+').map((x) => x.trim())
        const width = strokeParts[0] || '1px'
        const color = parseColor(strokeParts[1] || '#999')
        styles.push(`border: ${width} solid ${color}`)
      }
    } else if (key === 'inset') {
      // inset: 8pt 或 inset: (left: 8pt, y: 6pt)
      if (val.startsWith('(') && val.endsWith(')')) {
        const inner = val.slice(1, -1)
        const subParts = splitTopLevel(inner)
        for (const sub of subParts) {
          const sIdx = sub.indexOf(':')
          if (sIdx !== -1) {
            const side = sub.slice(0, sIdx).trim()
            const sVal = sub.slice(sIdx + 1).trim()
            if (side === 'x') {
              styles.push(`padding-left: ${sVal}; padding-right: ${sVal}`)
            } else if (side === 'y') {
              styles.push(`padding-top: ${sVal}; padding-bottom: ${sVal}`)
            } else {
              styles.push(`padding-${side}: ${sVal}`)
            }
          }
        }
      } else {
        styles.push(`padding: ${val}`)
      }
    } else if (key === 'radius') {
      styles.push(`border-radius: ${val}`)
    } else if (key === 'font') {
      const cleanFont = val.replace(/[()[\]"']/g, '')
      if (cleanFont) styles.push(`font-family: ${cleanFont}`)
    }
  }

  return styles.join('; ')
}
