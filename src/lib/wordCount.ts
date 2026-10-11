/**
 * 本模块负责：文档字数统计逻辑。
 *
 * 区分两种统计模式：
 * 1. 编辑模式（源码视图）：统计源码字符数（排除纯空白字符）；
 * 2. 预览模式（渲染视图）：只统计用户实际看到的「可视文字」（过滤 Markdown 语法标记、
 *    HTML 标签、KaTeX 内部 MathML、代码运行按钮与输出等杂项）。
 */

/** 统计源码字符数（排除空白字符） */
export function countSourceWords(source: string): number {
  if (!source) return 0
  return source.replace(/\s/g, '').length
}

/** 待剔除的非正文/不可见/交互组件选择器 */
const EXCLUDE_SELECTORS = [
  'script',
  'style',
  'template',
  '.katex-mathml',
  '.moji-run-menu',
  '.moji-run-out',
  '.no-print',
]

/** 降级环境（如 Node 环境无 DOMParser 时）使用的块剔除正则 */
const BLOCK_CLEANERS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,
  /<span class="katex-mathml"[\s\S]*?<\/span>/gi,
  /<div class="moji-run-(?:menu|out)"[\s\S]*?<\/div>/gi,
]

const htmlWordCountCache = new Map<string, number>()
const HTML_WORD_CACHE_MAX = 64

/** 从渲染后的 HTML 字符串中提取可视文字字符数 */
export function countVisibleWordsFromHtml(html: string): number {
  if (!html || typeof html !== 'string') return 0
  const cached = htmlWordCountCache.get(html)
  if (cached !== undefined) return cached

  let count = 0
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      for (const sel of EXCLUDE_SELECTORS) {
        doc.querySelectorAll(sel).forEach((el) => el.remove())
      }
      const text = doc.body.textContent || ''
      count = text.replace(/\s/g, '').length
    } catch {
      // 降级到正则清洗
    }
  }

  if (count === 0 && html.trim()) {
    // 降级正则清洗
    let cleaned = html
    for (const re of BLOCK_CLEANERS) {
      cleaned = cleaned.replace(re, '')
    }
    cleaned = cleaned.replace(/<[^>]+>/g, '')
    count = cleaned.replace(/\s/g, '').length
  }

  if (htmlWordCountCache.size >= HTML_WORD_CACHE_MAX) {
    const oldest = htmlWordCountCache.keys().next().value
    if (oldest) htmlWordCountCache.delete(oldest)
  }
  htmlWordCountCache.set(html, count)
  return count
}

/** 从渲染容器 DOM 节点中提取实际可视文字字符数 */
export function countVisibleWords(container: HTMLElement | null, fallbackHtml?: string): number {
  if (fallbackHtml) {
    return countVisibleWordsFromHtml(fallbackHtml)
  }
  if (!container || typeof document === 'undefined') {
    return 0
  }
  try {
    const clone = container.cloneNode(true) as HTMLElement
    for (const sel of EXCLUDE_SELECTORS) {
      clone.querySelectorAll(sel).forEach((el) => el.remove())
    }
    const text = clone.textContent || ''
    return text.replace(/\s/g, '').length
  } catch {
    return 0
  }
}
