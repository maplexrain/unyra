/**
 * quote 围栏：解析文档中的 ```quote 代码块为原文引用组件。
 *
 * 语法格式示例：
 * ```quote
 * 这是一段普通文本
 * @E:/demo/index.html(10-34){
 *   mark(15:5, 16:7)
 * }
 * 以上代码片段来自xxx
 * ```
 *
 * 语法说明：
 * - 块内普通文本：正常作为说明文字展示；
 * - 以 @ 开头的行：原文引用指令 `@<filePath>(<startLine>-<endLine>)[{ <markRules> }]`；
 * - 行号从 1 开始（闭区间，支持 10-34、10~34、10至34、10到34、或单个数字 10）；
 * - { ... } 内支持多条标记规则：`mark(line1:col1, line2:col2)`；
 *   将指定行列范围进行样式标记高亮（背景高亮色跟随主题），同时与源文件语法高亮结合；
 * - 样式规范：组件及内部所有元素严格采用直角风格（rounded-none），自适应主题色。
 *
 * 实现已按职责拆分至 ./quoteBlock/ 目录（types / host / guide / parse / render / hydrate），
 * 本文件仅作为门面转发原有导出（原名原序），调用方无需改动。
 */

// 共享类型、常量与基础小工具
export {
  DEFAULT_MARK_TEMPLATE,
  formatSectionsBadge,
  escapeHtml,
} from './quoteBlock/types'
export type {
  QuoteMappingRule,
  QuoteSection,
  QuoteReference,
  QuoteItem,
  ParsedQuoteBlock,
  QuoteBlockHost,
} from './quoteBlock/types'

// 宿主（QuoteBlockHost）全局状态
export {
  setQuoteBlockHost,
  quoteBlockHost,
  subscribeQuoteBlockHost,
} from './quoteBlock/host'

// 源码解析：模板净化 / 坐标与规则 / 围栏解析
export {
  sanitizeTemplate,
  parseMappingRule,
  parseQuoteBlock,
} from './quoteBlock/parse'

// 渲染：语言嗅探 / 行规则与高亮 / 占位容器 HTML
export {
  detectLanguageFromPath,
  applyRulesToLine,
  renderQuotedLines,
  quoteBlock,
} from './quoteBlock/render'

// DOM 挂载与交互
export { hydrateQuotes } from './quoteBlock/hydrate'

// 教学 Agent 语法指引
export { QUOTE_SYNTAX_GUIDE } from './quoteBlock/guide'
