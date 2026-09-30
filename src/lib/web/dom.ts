/**
 * 网页 → 简树：**需要 DOM 的那一半**（只在渲染层跑，见 lib/web/page 的说明）。
 *
 * 这里只做三件事，判断性的活儿全部留给 lib/web/page 的纯函数：
 * 1. 用 DOMParser 把字节变成文档；
 * 2. 找出「正文那一块」（优先 article / main / role=main，否则挑最厚的那个块）；
 * 3. 递归成简树，路上丢掉脚本、样式、导航、广告、评论这些噪声。
 */

import { DROP_HINT, DROP_TAGS, textOf, type WebNode } from './page'

export interface ParsedPage {
  /** <title> 的文字（没有就空串） */
  title: string
  /** <meta name="description">（有就带上，它对模型判断「这页讲什么」很有用） */
  description: string
  /** 正文那一块转出来的简树 */
  tree: WebNode[]
}

/** 正文容器的候选，按可信度从高到低 */
const MAIN_SELECTORS = [
  'article',
  'main',
  '[role="main"]',
  '#content',
  '#main',
  '.post-content',
  '.article-content',
  '.entry-content',
  '.markdown-body',
  '.content',
]

/**
 * 说明：**不在这里补全相对地址**。
 *
 * 树里存的是原样的 href/src，补全发生在 treeToMarkdown 那一步（它拿得到 finalUrl）——
 * 于是「HTML → 树」这一步与地址无关，可以单独推理，也不会出现「补了一次又被相对化」的来回。
 */
export function parseWebPage(html: string): ParsedPage {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const title = (doc.querySelector('title')?.textContent ?? '').trim()
  const description = (doc.querySelector('meta[name="description"]')?.getAttribute('content') ?? '').trim()
  const main = mainOf(doc)
  return { title, description, tree: main ? convertChildren(main) : [] }
}

/**
 * 找正文容器。
 *
 * 为什么不是「写死 article」：大量博客与文档站没有 <article>，而有些站点把整页都塞进
 * 一个 article 里（连侧栏一起）。所以先按候选挑，挑不到就退到 body，
 * 再从 body 的直接子元素里挑**文字最多的那个**——导航与页脚通常比正文薄得多。
 */
function mainOf(doc: Document): Element | null {
  for (const sel of MAIN_SELECTORS) {
    const el = doc.querySelector(sel)
    if (el && textOf(convertChildren(el)).length > 200) return el
  }
  const body = doc.body
  if (!body) return null
  let best: Element | null = null
  let bestLen = 0
  for (const child of Array.from(body.children)) {
    if (shouldDrop(child)) continue
    const el = child as Element
    const len = textOf(convertChildren(el)).length
    if (len > bestLen) {
      bestLen = len
      best = el
    }
  }
  // 子元素都很薄（正文直接摊在 body 上）：那就整块 body
  return bestLen >= 200 ? best : body
}

function shouldDrop(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  if (DROP_TAGS.has(tag)) return true
  const sig = (el.getAttribute('class') ?? '') + ' ' + (el.getAttribute('id') ?? '')
  if (sig.trim() && DROP_HINT.test(sig)) return true
  if (el.hasAttribute('hidden')) return true
  if ((el.getAttribute('aria-hidden') ?? '').toLowerCase() === 'true') return true
  const style = (el.getAttribute('style') ?? '').replace(/\s+/g, '').toLowerCase()
  if (style.includes('display:none') || style.includes('visibility:hidden')) return true
  return false
}

function convertChildren(el: Element): WebNode[] {
  const out: WebNode[] = []
  const inOrderedList = el.tagName.toLowerCase() === 'ol'
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const text = node.nodeValue ?? ''
      // 纯空白在块之间没有意义；有字的段落原样留着（渲染时会折叠空白）
      if (text.trim()) out.push({ text })
      continue
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue
    const child = node as Element
    if (shouldDrop(child)) continue
    const tag = child.tagName.toLowerCase()
    const attrs: Record<string, string> = {}
    for (const name of ['href', 'src', 'alt', 'class', 'title']) {
      const v = child.getAttribute(name)
      if (v) attrs[name] = v
    }
    // 有序列表的项要编号：编号在渲染时按顺序数，所以在这里把「我是 ol 的孩子」记下来
    if (inOrderedList && tag === 'li') attrs.__ol = '1'
    out.push({ tag, attrs, children: convertChildren(child) })
  }
  return out
}
