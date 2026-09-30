/**
 * 查找匹配的纯逻辑。
 *
 * 单独成模块（而不是写在 FindBar 里）有两个理由：它是纯函数，Node 里能直接钉住
 * （「aaa 里找 aa 是 1 处还是 2 处」这种问题肉眼看不出来）；以及组件文件只该导出组件
 * （react/only-export-components）。
 */

/**
 * 扫出全部命中位置（半开区间 [start, end)）。
 *
 * **不重叠**：`aa` 在 `aaa` 里算 1 处而不是 2 处。重叠的命中会在同一段文字上叠两层
 * 高亮，反而看不出边界在哪；编辑器们（vscode、浏览器查找）也都是这么算的。
 * 大小写敏感由调用方决定：不敏感时两边一起折成小写，折完长度不变，因此下标仍然对得上。
 */
export function scanMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  if (!query) return out
  const hay = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at < 0) return out
    out.push([at, at + needle.length])
    from = at + needle.length
  }
}

/** 全部替换：按命中位置拼出新正文（不碰没命中的部分） */
export function replaceAllIn(text: string, hits: Array<[number, number]>, replacement: string): string {
  let out = ''
  let at = 0
  for (const [start, end] of hits) {
    out += text.slice(at, start) + replacement
    at = end
  }
  return out + text.slice(at)
}
