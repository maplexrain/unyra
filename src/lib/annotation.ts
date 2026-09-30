/**
 * 「了解」/「笔记」注解的渲染期实现：在已经渲染好的 DOM 上把术语包成虚线样式，
 * 悬停弹出释义。**不改动 Markdown 源文**——若把注解写成 `[词](…)` 插进源文，
 * 被注解的词一旦落在粗体/斜体内部，插入的 `[` 会顶开强调定界符，
 * 使 `**` 退化成字面量。
 *
 * 匹配口径：词条是在「渲染后的文字流」上找的，可以跨元素、跨段落，词条里的空白
 * 允许在正文里落空（跨段落选择取到的空格、公式占掉的位置在正文里都没有对应字符）。
 * 词条本身也必须按同一口径从选区里取（见 selectionTerm），否则跨元素选择会连带把
 * 公式的排版字符取进来，两边永远对不上。
 *
 * 放在 lib 里而不是组件里，一是与 markdown/plot 的处理方式一致，
 * 二是可以脱离 React 单独验证 DOM 行为。
 */

/**
 * 本文件是 barrel：实现按职责拆在 lib/annotation/ 下，这里只把原来的导出原样转出去，
 * 调用方的 import 一行都不用改。
 *
 * - annotation/selectors.ts  「什么算文字」的口径（孔洞 / 占位 / 块级标签）
 * - annotation/dom.ts        文字流、定位、包裹与拆包、一条注解的套用与拆除
 * - annotation/patch.ts      增量补丁与编辑期的样式实时预览
 * - annotation/popup.ts      浮层（了解 / 笔记）的内容、定位与显隐，以及正文根上的事件接线
 */

export { applyAnnotation, canAnnotate, occurrenceAt, selectionTerm, unwrapAnnotation } from './annotation/dom'
export { endAnnotationPreview, previewAnnotationStyle, syncAnnotations } from './annotation/patch'
export { hydrateAnnotations, setAnnotationActions } from './annotation/popup'
export type { AnnotationActions } from './annotation/popup'
