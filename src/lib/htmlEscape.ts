/**
 * HTML 文本转义：一处口径，两处使用。
 *
 * exportDoc（导出一份能拿走的 .html）与 renderPlugins（插件 parse 期拼出的 HTML 片段）
 * 各带了一份逐字相同的实现与映射表，于是收在这里。
 *
 * 为什么 syntax/Theme 那一份**不并过来**：它自己写明是有意重复——语法层不该反过来
 * 依赖渲染/插件那些模块。这里只放导出与插件共用的这一份。
 *
 * 转义表只有这五个字符（& < > " '）：够用在两处——文本节点里，以及带引号的属性值里。
 */
export const HTML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** 文本转义：插进正文里的字面量都该先过它 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c] as string)
}
