/**
 * 这个文件负责：「哪些结构里的文字不参与定位」这一条口径——三处共用一份，但**故意有两档**。
 *
 * 为什么有两档而不是一份：两边的用途不同。
 * - 引文映射（lib/quoteFocus）与「渲染态 → 源文偏移」映射（lib/sourceMap）只处理**正文文字**，
 *   公式排版件与图形里的字符与源文不同形，跳过它们即可。
 * - 文档定位（lib/docDom）还要**落点**：按钮上不该落光标、也不该被当成「这一处」，
 *   所以它比上面那一档多两个选择器。
 *
 * 早先三处各写一遍字符串，其中 docDom 那份多两个选择器、注释却写着「与 lib/quoteFocus 的口径一致」——
 * 注释与代码对不上，下次谁想「顺手统一一下」就会把按钮的排除规则删掉。收在这里，差异是**显式**的。
 */

/** 公式排版件、代码块、函数图像：它们的文字与源文不同形，定位与映射一律跳过 */
export const SKIP_SELECTOR = 'pre, code, .katex, .katex-display, .moji-plot'

/** 定位用的那一档：在上面基础上再排掉按钮（光标不该落在按钮上，见 docDom 的用法） */
export const SKIP_SELECTOR_INTERACTIVE = SKIP_SELECTOR + ', button, [role=button]'
