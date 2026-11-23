/**
 * 聊天气泡的 Markdown 预处理：`@角色名` 与裸 URL 转成 Markdown 链接。
 *
 * 单独成模块，既方便单测，也避免 BubbleRichText 同时导出组件和普通函数
 * 触发 fast-refresh 警告。
 */

/** 气泡里 @ 角色的自定义链接协议前缀（sanitize 的 moji: 白名单内） */
export const MENTION_SCHEME = 'moji:mention/'

/** 正则元字符转义：角色名可能带 `+`、`.` 等字符 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `@名字` → Markdown 链接；名字按长度降序，避免短名先吃掉长名 */
function markMentions(text: string, names: string[]): string {
  const valid = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!valid.length || !text.includes('@')) return text
  const re = new RegExp('@(' + valid.map(escapeRegExp).join('|') + ')', 'g')
  return text.replace(re, (_m, name: string) => `[@${name}](${MENTION_SCHEME}${encodeURIComponent(name)})`)
}

/**
 * 裸 URL → Markdown 链接。只处理 http(s)://，并避开已有 Markdown 链接的 URL，
 * 避免 `[文字](https://…)` 被二次包一层。
 */
function markBareUrls(text: string): string {
  return text.replace(
    /(^|[\s（【])((?:https?:\/\/)[^\s<>"'）)】]+)(?=$|[\s，。！？、；：）)】])/g,
    (_m, lead: string, url: string) => lead + '[' + url + '](' + url + ')',
  )
}

/** 气泡正文 → Markdown 源文（纯函数，方便单测） */
export function bubbleMarkdownSource(text: string, names: string[] = []): string {
  if (!text) return ''
  /*
   * 代码块里的 @ 与 URL 不转换：那些是代码，不是聊天指令。按围栏/行内代码切成普通段
   * 与代码段，只处理普通段。
   */
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((part, i) => (i % 2 === 1 ? part : markBareUrls(markMentions(part, names))))
    .join('')
}
