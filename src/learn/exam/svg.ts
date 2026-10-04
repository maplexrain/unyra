/**
 * 试卷配图的消毒（exam 领域的纯函数，有单测）。
 *
 * 题目里的 image 字段是模型写的 SVG 源码，渲染时走 dangerouslySetInnerHTML——
 * 它是「画出来的题面」，不是可信 HTML：script、事件属性、foreignObject（里面能包
 * 任意 HTML）、javascript: 与外链 href，这些口子必须在入库前剥干净。
 * 正则消毒对「我们要挡的东西」够用：SVG 里的注入只有这几条路，而源码本来就是
 * 模型刚写的一小段图，不是任意网页。
 */

/** 一段配图的长度上限：超过它基本不是「一道题的图」，是模型跑飞了 */
const MAX_CHARS = 200_000

/** 从任意文本里抠出第一段 <svg>…</svg>；模型爱在图外面再包 ``` 围栏或说明文字 */
function extractSvg(raw: string): string | null {
  const start = raw.search(/<svg[\s>]/i)
  if (start < 0) return null
  const end = raw.toLowerCase().lastIndexOf('</svg>')
  if (end <= start) return null
  return raw.slice(start, end + 6)
}

/**
 * 消毒一段配图。不合法（没有 svg 根、超长）返回 null——调用方拿它给模型一句
 * 「该写成什么」，而不是静默丢掉。
 */
export function sanitizeExamSvg(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const svg = extractSvg(raw)
  if (!svg || svg.length > MAX_CHARS) return null
  return svg
    // 能执行代码或把任意 HTML 带进页面的元素，连内容一起剪掉
    .replace(/<(script|foreignObject|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed)\b[^>]*>/gi, '')
    // 事件属性（onload= 之类，带不带引号都收）
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // 链接只留页内引用（#id）与图片 data URL：javascript: 与外链从这里进不来
    .replace(/\s(xlink:)?href\s*=\s*("(?!#|data:image\/)[^"]*"|'(?!#|data:image\/)[^']*'|[^\s>]+)/gi, '')
    .trim()
}
