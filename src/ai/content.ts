/**
 * 消息内容的中立表示与各家协议的翻译。
 *
 * 一条消息的内容有两种形态：
 * - **纯文本**（绝大多数）：直接就是那个字符串；
 * - **文本 + 图片**：片段数组。这是「中立」表示——不知道发给谁，
 *   只描述「有一段文字、有一张图（mime + base64）」。
 *
 * 为什么要中立层：同一段对话历史会被反复重放，而用户可以随时换提供商与模型
 * （OpenAI 兼容 / Anthropic / Responses 三家的图片字段完全不同）。历史里存任何
 * 一家的线格式，换一家就得改写历史——前缀缓存当场全部作废，用户还要为同一段
 * 对话重新付一次全价。所以历史里存中立形态，翻译只发生在**发请求的那一刻**。
 *
 * 图片按 base64 存（不含 \`data:\` 前缀）：三家的编码方式都是 base64，
 * 差别只在包在哪一层字段里，见下面三个 toXxx。
 */

import type { ChatContent, ChatContentPart } from './types'

/** 文本片段 */
export const textPart = (text: string): ChatContentPart => ({ type: 'text', text })

/** 图片片段；data 是不含 data: 前缀的 base64 */
export const imagePart = (mime: string, data: string): ChatContentPart => ({ type: 'image', mime, data })

/** 组装成 data URL（OpenAI 与 Responses 走这个字段） */
export const dataUrl = (mime: string, data: string): string => `data:${mime};base64,${data}`

const isParts = (c: ChatContent): c is ChatContentPart[] => Array.isArray(c)

/** 统一成片段数组；纯文本变一个文本片段，null 变空数组 */
export function asParts(content: ChatContent): ChatContentPart[] {
  if (content === null || content === undefined) return []
  if (typeof content === 'string') return content ? [textPart(content)] : []
  return content
}

/**
 * 只取文字。工具结果、系统提示词、以及任何不支持图片的协议都走它——
 * 宁可退化成纯文本，也不要让一条请求因为图片字段而整条发不出去。
 */
export function plainText(content: ChatContent): string {
  if (typeof content === 'string') return content
  if (!content) return ''
  return content
    .filter((p): p is Extract<ChatContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

export const hasImages = (content: ChatContent): boolean =>
  isParts(content) && content.some((p) => p.type === 'image')

/**
 * 内容的**原始**重量（字符数）：文字按长度、图片按 base64 长度。
 * 用于「这条内容本身多大」，不要拿它当上下文预算——见 budgetChars。
 */
export function contentChars(content: ChatContent): number {
  if (typeof content === 'string') return content.length
  if (!content) return 0
  return content.reduce((sum, p) => sum + (p.type === 'text' ? p.text.length : p.data.length), 0)
}

/**
 * 一张图在历史预算里的**当量**（按字符计）。
 *
 * 为什么不按 base64 长度折算：一张 300KB 的截图 base64 之后是 40 万字符，比整个
 * 历史预算（20 万）还大。而裁剪是从最旧开始**整条**丢的——要甩掉这张图，就得把它
 * 之前的每一条都丢掉，最后还是不够，于是连它和本次提问一起丢掉，25 条历史归零
 * （实测：base64 超过约 17.6 万字符就开始啃历史，超过 20 万直接清空）。
 * 各家按分辨率计价，量级在几百到一千多 token，取一个固定当量即可
 * （与 ai/types 估算用量时的 1100 token 同一数量级）。
 */
const IMAGE_BUDGET_CHARS = 4400

/**
 * 内容在历史预算里的重量：文字照实算，图片按**张数**折算。
 *
 * 这样一张图最多占掉预算的百分之几，丢历史时会先丢整条图消息、而不是把
 * 「图之前的所有内容」一起拖下去。真要比这个更省，就该在挂图之前缩图，
 * 而不是指望裁剪逻辑兜住。
 */
export function budgetChars(content: ChatContent): number {
  if (typeof content === 'string') return content.length
  if (!content) return 0
  return content.reduce(
    (sum, p) => sum + (p.type === 'text' ? p.text.length : IMAGE_BUDGET_CHARS),
    0,
  )
}

/* ---------- 各协议的翻译 ---------- */

/**
 * 下面三个 toXxx 的返回类型是**结构化**的：它们描述的正是那家协议的字段，
 * 但定义留在这里（而不是反过来依赖各协议模块），这样 content.ts 不用认识
 * anthropic.ts / responses.ts，各适配器也能直接把这些块塞进自己的类型里。
 */

/** OpenAI 兼容的 content 块 */
export type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** Anthropic 的 image 块（text 块沿用各模块自己的写法） */
export type AnthropicImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

/** Command Code 网关的 image 块：**裸 data URL**，没有 source 包装 */
export type CcImagePart = { type: 'image'; image: string }

/** Responses 的 content 块 */
export type ResponsesContentBlock =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }

/**
 * OpenAI 兼容（chat/completions）：
 * 纯文本发字符串——这是兼容性最好、也是绝大多数中转唯一认的形态；
 * 只有真的带图时才发数组，图片写成 image_url 的 data URL。
 */
export function toOpenAiContent(content: ChatContent): string | OpenAiContentPart[] {
  const parts = asParts(content)
  if (!parts.some((p) => p.type === 'image')) return plainText(content)
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image_url', image_url: { url: dataUrl(p.mime, p.data) } },
  )
}

/**
 * Anthropic（Messages）：content 一律是块数组，图片是独立的 image 块，
 * base64 放在 source 里（不用 data URL）。
 */
export function toAnthropicBlocks(
  content: ChatContent,
): Array<{ type: 'text'; text: string } | AnthropicImageBlock> {
  return asParts(content).map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } },
  )
}

/**
 * Responses：user 项的 content 是 input_text / input_image 块数组，
 * 图片同样用 data URL，但字段名是 input_image。
 */
/**
 * Command Code 网关：user 的 content 可以是字符串，也可以是 [text, image] 块数组，
 * 图片写成**裸 data URL**（`{ type: 'image', image: 'data:…' }`）——它与 Anthropic
 * 同源但去掉了 source 包装（网关自己会归一化）。
 *
 * 这一路的格式不是猜的：本仓库的对齐参考实现里写明了这个形状
 * （见文件头的参考实现链接）。只有文字时仍旧发字符串，与网关的常规对话一致。
 */
export function toCcParts(
  content: ChatContent,
): string | Array<{ type: 'text'; text: string } | CcImagePart> {
  const parts = asParts(content)
  if (!parts.some((p) => p.type === 'image')) return plainText(content)
  return parts.map((p) =>
    p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image', image: dataUrl(p.mime, p.data) },
  )
}

export function toResponsesContent(content: ChatContent): string | ResponsesContentBlock[] {
  const parts = asParts(content)
  if (!parts.some((p) => p.type === 'image')) return plainText(content)
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'input_text', text: p.text }
      : { type: 'input_image', image_url: dataUrl(p.mime, p.data) },
  )
}
