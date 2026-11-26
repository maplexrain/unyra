/**
 * 系统提示词的语义分块工具。
 *
 * 规则：**先分块，再拼装**。模型看到的每一类约束都应有明确的 XML 边界，
 * 避免 Markdown 长列表把身份、执行、工具、交付混成一锅；同时空块一律丢弃，
 * 不让某个声部因为缺少某段而留下空壳标签。
 *
 * 只包内容，不改内容：文案仍由各模块负责，tag 只回答「这一段属于什么」。
 */
export function promptBlock(
  tag: string,
  ...parts: Array<string | false | null | undefined>
): string {
  const body = parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n')
    .trim()
  if (!body) return ''
  return `<${tag}>\n${body}\n</${tag}>`
}
