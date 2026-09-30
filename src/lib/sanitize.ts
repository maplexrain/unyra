/**
 * 渲染结果的消毒（DOMPurify）。
 *
 * 单独成一个模块，是因为它有两个调用方：正文渲染（lib/markdown）与插件的 DOM
 * 挂载工具（lib/renderPlugins）。两处必须用**同一份**白名单——插件的产物与正文的
 * 产物最终待在同一个 DOM 里，白名单分家就等于按松的那一份算。
 */
import DOMPurify from 'dompurify'

/**
 * 放行自定义的 moji:node/ 协议（知识节点链接），其余 URL 仍走默认白名单
 */
const ALLOWED_URI = /^(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|moji|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$)/i

/**
 * Agent 写的教学文档允许内嵌少量 SVG 与 CSS 动画做辅助教学，
 * 默认白名单会砍掉这些，因此显式补充：
 * - SVG 动画：SMIL 的 <animate>/<animateTransform>/<animateMotion>/<set>，
 *   以及默认列表里缺的 SMIL 属性 from / to / calcMode
 * - 交互：<details>/<summary>（默认已放行）、复选框
 * - FORCE_BODY：内容以 <style> 开头时，DOMPurify 默认会把首元素当 head 内容丢掉；
 *   FORCE_BODY 强制它落进 body，文档开头的样式表才不会消失
 *
 * 副作用：允许 <style> 意味着文档里的 CSS 会作用于整个页面。这属于「Agent 内容可信」的
 * 显式取舍——它本就是由用户配置的模型生成、写入自己笔记的，与允许内联 style 同源。
 * 提示词里也要求：CSS 必须加唯一前缀限定作用域。
 */
const SVG_ANIM_TAGS = ['animate', 'animateTransform', 'animateMotion', 'set']
const SVG_ANIM_ATTRS = ['from', 'to', 'calcMode']

/**
 * KaTeX 会把公式的 LaTeX 源原样留在 <annotation encoding="application/x-tex"> 里，
 * 而 DOMPurify 的默认 MathML 白名单把 annotation 归在「不允许」那一档。
 * 它只是一段纯文本（没有属性、没有子元素），留着既不增加攻击面，
 * 又让「公式的源」在渲染结果里可查——标题大纲正是靠它把标题里的公式还原出来的
 * （见 lib/outline 的 headingText）。
 */
const KATEX_TAGS = ['annotation']

export const SANITIZE_CONFIG = {
  ALLOWED_URI_REGEXP: ALLOWED_URI,
  ADD_TAGS: [...SVG_ANIM_TAGS, ...KATEX_TAGS],
  ADD_ATTR: [...SVG_ANIM_ATTRS],
  FORCE_BODY: true,
} satisfies Parameters<typeof DOMPurify.sanitize>[1]

/** 消毒一段 HTML。渲染管线里**所有**外部文本都必须先从这儿过。 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}
