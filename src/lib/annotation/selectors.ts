/** 这个文件负责：正文里「什么算文字」的口径——不成其为文字的孔洞、取词时占位的元素、以及要补空格的块级标签。 */

/**
 * 这些结构在渲染出的正文里不成其为「文字」：公式排版后的字符与 LaTeX 源不同形
 * （还夹着隐藏的 MathML 文本），图形/图像/样式里的文字也不是正文。
 * 它们既不参与匹配，取词时也各占一个空格（见 selectionTerm）。
 *
 * 链接、行内代码、代码块**不在此列**：它们渲染出来就是纯文字，注解套上去照样正常显示。
 * 早先把 a / code 也排除在外，结果是「从链接中间划过去」的一次选择整段都注不上。
 */
export const HOLE_SELECTOR =
  '.katex, .katex-display, .moji-plot, svg, style, script, noscript, template'

/** 取词时用一个空格占位的元素：不落成文字的那些，外加图像与换行 */
export const SPACER_SELECTOR = `${HOLE_SELECTOR}, img, br, hr`

/** 块级结构：跨块选择时给词条补一个空格，词条读起来才还是两段话的样子 */
export const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
  'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])
