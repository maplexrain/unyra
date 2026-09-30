/** 字符偏移 → 行/列（均从 1 开始） */
export function offsetToLineCol(source: string, offset: number): { line: number; col: number } {
  const before = source.slice(0, offset)
  const line = before.split('\n').length
  const col = offset - before.lastIndexOf('\n')
  return { line, col }
}

/** 把 Markdown / LaTeX 压成适合单行展示的纯文本片段 */
export function plainSnippet(md: string, max = 140): string {
  const s = md
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}
