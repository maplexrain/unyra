/**
 * 从长正文里取最后一行，给「思考中 / work 正在做什么」这类单行预览用。
 *
 * 末尾空白先剥掉——模型常以换行收尾，不剥的话「最后一行」永远是空的。
 * 只在末尾一个窗口里找，并最多留 240 字：思考正文可能是一条几十万字、没有换行的
 * 长串，整串参与排版会让浏览器为一个巨大的行盒算宽度，而可见的只有最后几十个字。
 */
const TAIL_KEEP = 240
const TAIL_WINDOW = 4000

export function lastLineOf(text?: string | null): string {
  if (!text || typeof text !== 'string') return ''
  const window = text.slice(Math.max(0, text.length - TAIL_WINDOW))
  const tail = window.replace(/\s+$/, '')
  if (!tail) return ''
  const i = Math.max(tail.lastIndexOf('\n'), tail.lastIndexOf('\r'))
  const line = i >= 0 ? tail.slice(i + 1) : tail
  return line.length > TAIL_KEEP ? line.slice(line.length - TAIL_KEEP) : line
}
