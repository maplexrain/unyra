/**
 * quote 围栏：解析文档中的 ```quote 代码块为原文引用组件。
 *
 * 语法格式示例：
 * ```quote
 * 这是一段普通文本
 * @E:/demo/index.html(10-34){
 *   [15:5,16:7] => <strong>{{content}}</strong>
 * }
 * 以上代码片段来自xxx
 * ```
 *
 * 语法说明：
 * - 块内普通文本：正常作为说明文字展示；
 * - 以 @ 开头的行：原文引用指令 `@<filePath>(<startLine>-<endLine>)[{ <mappings> }]`；
 * - 行号从 1 开始（闭区间，支持 10-34、10~34、10至34、10到34、或单个数字 10）；
 * - { ... } 内支持多条映射规则：`[line1:col1, line2:col2] => template`；
 *   将指定行列范围映射包裹为带样式的 HTML 元素（如 <strong>、<mark> 等）；
 * - 样式规范：组件及内部所有元素严格采用直角风格（rounded-none），自适应主题色。
 */
import { t } from '../i18n'
import { decodeAttr, type PluginRenderContext } from './renderPlugins'

export interface QuoteMappingRule {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
  template: string
}

export interface QuoteReference {
  filePath: string
  startLine: number
  endLine: number
  rules: QuoteMappingRule[]
}

export type QuoteItem =
  | { type: 'text'; text: string }
  | { type: 'ref'; ref: QuoteReference }

export interface ParsedQuoteBlock {
  items: QuoteItem[]
}

export interface QuoteBlockHost {
  /** 读取文件文本（支持绝对路径或当前目标项目相对路径） */
  readFile: (filePath: string) => Promise<string | null> | string | null
  /** 当用户点击文件路径或“打开”按钮时触发 */
  onOpenFile?: (filePath: string, line?: number) => void
}

let currentQuoteHost: QuoteBlockHost | null = null
const quoteHostListeners = new Set<() => void>()

export function setQuoteBlockHost(host: QuoteBlockHost | null): void {
  if (currentQuoteHost === host) return
  currentQuoteHost = host
  for (const cb of quoteHostListeners) {
    try {
      cb()
    } catch (err) {
      console.warn('[quoteBlock] host listener error', err)
    }
  }
}

export function quoteBlockHost(): QuoteBlockHost | null {
  return currentQuoteHost
}

export function subscribeQuoteBlockHost(cb: () => void): () => void {
  quoteHostListeners.add(cb)
  return () => {
    quoteHostListeners.delete(cb)
  }
}

/** 转义 HTML 特殊字符 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 白名单内安全标签，禁止 script、iframe、事件绑定等 */
const SAFE_TAGS = new Set([
  'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'span', 'code',
  'ins', 'del', 'font', 'small', 'sub', 'sup',
])

/** 过滤自定义模板中的危险标签与属性，并强制去除所有圆角样式 */
export function sanitizeTemplate(rawTemplate: string): string {
  let s = (rawTemplate ?? '').trim()
  if (!s) return '{{content}}'

  // 移除 script, iframe, object, embed 等
  s = s.replace(/<\s*(?:script|iframe|object|embed|style|meta|link)\b[\s\S]*?(?:<\/\s*(?:script|iframe|object|embed|style|meta|link)\s*>|$)/gi, '')
  // 移除 on* 属性 (如 onclick, onerror)
  s = s.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  // 移除 javascript: 伪协议
  s = s.replace(/\b(?:href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
  // 移除任何 rounded-* 类名以确保严格无圆角
  s = s.replace(/\brounded(?:-[a-z0-9]+)?\b/gi, 'rounded-none')

  // 检查标签名是否在安全列表内
  s = s.replace(/<\/?([a-zA-Z0-9_-]+)([^>]*)>/g, (full, tag: string, _attrs: string) => {
    const lowerTag = tag.toLowerCase()
    if (!SAFE_TAGS.has(lowerTag)) {
      return ''
    }
    return full
  })

  return s
}

/** 规范化单条映射规则字符串 */
export function parseMappingRule(ruleStr: string): QuoteMappingRule | null {
  const trimmed = ruleStr.trim().replace(/^,\s*/, '')
  if (!trimmed) return null

  // 匹配形式如 [15:5, 16:7] => <strong>{{content}}</strong>
  // 或 [15:5] => <strong>{{content}}</strong>
  // 或 [15:5 - 16:7] => ...
  const m = trimmed.match(/^\[\s*(\d+)\s*:\s*(\d+)\s*(?:[,\-~至到]\s*(\d+)\s*:\s*(\d+))?\s*\]\s*=>\s*(.+)$/)
  if (!m) return null

  const startLine = parseInt(m[1], 10)
  const startCol = parseInt(m[2], 10)
  const endLine = m[3] ? parseInt(m[3], 10) : startLine
  const endCol = m[4] ? parseInt(m[4], 10) : startCol
  let template = m[5].trim()

  // 如果是在单行大括号内可能留有末尾 '}'
  if (template.endsWith('}') && !template.endsWith('}}') && !template.includes('{{content}}')) {
    template = template.slice(0, -1).trim()
  } else if (template.endsWith('}') && template.includes('}}') && template.endsWith('}} }')) {
    template = template.slice(0, -2).trim()
  }

  // 保证区间有序
  let l1 = Math.max(1, startLine)
  let c1 = Math.max(1, startCol)
  let l2 = Math.max(1, endLine)
  let c2 = Math.max(1, endCol)
  if (l1 > l2 || (l1 === l2 && c1 > c2)) {
    const tmpL = l1
    const tmpC = c1
    l1 = l2
    c1 = c2
    l2 = tmpL
    c2 = tmpC
  }

  return {
    startLine: l1,
    startCol: c1,
    endLine: l2,
    endCol: c2,
    template: sanitizeTemplate(template),
  }
}

const BLOCK_CLOSE_RE = /(?<!\})\}\s*$/

/**
 * 解析 quote 围栏源码
 */
export function parseQuoteBlock(source: string): ParsedQuoteBlock {
  const lines = (source ?? '').split(/\r?\n/)
  const items: QuoteItem[] = []

  let inRef = false
  let currentRef: QuoteReference | null = null
  let ruleBuffer: string[] = []
  let pendingTextLines: string[] = []

  const flushText = () => {
    if (pendingTextLines.length > 0) {
      const txt = pendingTextLines.join('\n').trim()
      if (txt) {
        items.push({ type: 'text', text: txt })
      }
      pendingTextLines = []
    }
  }

  const flushRef = () => {
    if (currentRef) {
      // 解析收集到的规则
      const ruleText = ruleBuffer.join('\n')
      // 按分号或换行拆分多条规则
      const rawRules = ruleText.split(/[\r\n;]+/).map((s) => s.trim()).filter(Boolean)
      for (const r of rawRules) {
        const rule = parseMappingRule(r)
        if (rule) currentRef.rules.push(rule)
      }
      items.push({ type: 'ref', ref: currentRef })
      currentRef = null
    }
    ruleBuffer = []
    inRef = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!inRef) {
      // 检查是否是引用起点 @path(...)
      if (trimmed.startsWith('@')) {
        flushText()

        // 匹配 @path(10-34) 或 @path(10-34){ ... }
        // 路径支持绝对/相对，允许空格
        const match = trimmed.match(/^@([^(]+)\(\s*(\d+)\s*(?:[,\-~至到]\s*(\d+))?\s*\)(?:\s*\{([\s\S]*))?$/)
        if (match) {
          const filePath = match[1].trim()
          const startNum = parseInt(match[2], 10)
          const endNum = match[3] ? parseInt(match[3], 10) : startNum
          const startLine = Math.max(1, Math.min(startNum, endNum))
          const endLine = Math.max(startLine, Math.max(startNum, endNum))
          const rest = match[4]

          currentRef = {
            filePath,
            startLine,
            endLine,
            rules: [],
          }

          if (rest !== undefined) {
            // 带有花括号
            if (BLOCK_CLOSE_RE.test(rest)) {
              // 单行即闭合，例如 { [15:5,16:7] => ... }
              const inside = rest.replace(BLOCK_CLOSE_RE, '').trim()
              if (inside) {
                ruleBuffer.push(inside)
              }
              flushRef()
            } else {
              // 多行模式，等待后续行出现 '}'
              inRef = true
              if (rest.trim()) {
                ruleBuffer.push(rest.trim())
              }
            }
          } else {
            // 没有花括号，直接完成引用定义
            flushRef()
          }
          continue
        }
      }

      // 普通文本行
      pendingTextLines.push(line)
    } else {
      // 正在收集引用内部的映射规则
      if (BLOCK_CLOSE_RE.test(trimmed)) {
        const beforeBrace = trimmed.replace(BLOCK_CLOSE_RE, '').trim()
        if (beforeBrace) {
          ruleBuffer.push(beforeBrace)
        }
        flushRef()
      } else {
        ruleBuffer.push(trimmed)
      }
    }
  }

  if (inRef) {
    flushRef()
  }
  flushText()

  return { items }
}

/** 单行内的局部替换区间 */
interface LineInterval {
  startCol: number
  endCol: number
  template: string
}

/**
 * 将映射规则应用到指定的一行文本中
 */
export function applyRulesToLine(
  lineText: string,
  lineNum: number,
  rules: QuoteMappingRule[],
): string {
  const lineLen = lineText.length
  if (lineLen === 0) {
    // 空行检查是否有跨行规则覆盖
    const matching = rules.find((r) => r.startLine <= lineNum && lineNum <= r.endLine)
    if (matching) {
      if (matching.template.includes('{{content}}')) {
        return matching.template.replace(/\{\{content\}\}/g, '')
      }
      return matching.template
    }
    return ''
  }

  // 收集适用于当前行的所有区间
  const intervals: LineInterval[] = []
  for (const r of rules) {
    if (lineNum < r.startLine || lineNum > r.endLine) continue

    let c1 = 1
    let c2 = lineLen

    if (r.startLine === r.endLine) {
      c1 = r.startCol
      c2 = r.endCol
    } else if (lineNum === r.startLine) {
      c1 = r.startCol
      c2 = lineLen
    } else if (lineNum === r.endLine) {
      c1 = 1
      c2 = r.endCol
    } else {
      c1 = 1
      c2 = lineLen
    }

    c1 = Math.max(1, Math.min(c1, lineLen))
    c2 = Math.max(1, Math.min(c2, lineLen))
    if (c1 <= c2) {
      intervals.push({ startCol: c1, endCol: c2, template: r.template })
    }
  }

  if (intervals.length === 0) {
    return escapeHtml(lineText)
  }

  // 按起始列排序
  intervals.sort((a, b) => a.startCol - b.startCol)

  // 组合切片并转义
  let result = ''
  let cursor = 1 // 1-indexed

  for (const iv of intervals) {
    if (iv.startCol > cursor) {
      result += escapeHtml(lineText.slice(cursor - 1, iv.startCol - 1))
    }
    if (iv.endCol >= cursor) {
      const sliceStart = Math.max(cursor, iv.startCol)
      const slice = lineText.slice(sliceStart - 1, iv.endCol)
      const escapedSlice = escapeHtml(slice)

      let renderedTag = ''
      if (iv.template.includes('{{content}}')) {
        renderedTag = iv.template.replace(/\{\{content\}\}/g, escapedSlice)
      } else {
        // 如果模板没有显式写 {{content}}，提取标签包裹
        const tagMatch = iv.template.match(/^<([a-zA-Z0-9_-]+)([^>]*)>/)
        if (tagMatch) {
          const tagName = tagMatch[1]
          renderedTag = `${iv.template}${escapedSlice}</${tagName}>`
        } else {
          renderedTag = `${iv.template}${escapedSlice}`
        }
      }
      result += renderedTag
      cursor = iv.endCol + 1
    }
  }

  if (cursor <= lineLen) {
    result += escapeHtml(lineText.slice(cursor - 1))
  }

  return result
}

/**
 * 对全部行应用映射规则，产出每行的行号与 HTML
 */
export function renderQuotedLines(
  fullContent: string,
  startLine: number,
  endLine: number,
  rules: QuoteMappingRule[],
): { lineNum: number; html: string; raw: string }[] {
  const allLines = fullContent.split(/\r?\n/)
  const total = allLines.length

  const s = Math.max(1, Math.min(startLine, total))
  const e = Math.max(s, Math.min(endLine, total))

  const results: { lineNum: number; html: string; raw: string }[] = []
  for (let l = s; l <= e; l++) {
    const raw = allLines[l - 1] ?? ''
    const html = applyRulesToLine(raw, l, rules)
    results.push({ lineNum: l, html, raw })
  }
  return results
}

/**
 * 同步产出占位容器
 */
export function quoteBlock(source: string, ctx: PluginRenderContext): string {
  const parsed = parseQuoteBlock(source)

  let innerHtml = ''
  for (let i = 0; i < parsed.items.length; i++) {
    const item = parsed.items[i]
    if (item.type === 'text') {
      const paragraphs = item.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      for (const p of paragraphs) {
        innerHtml += `<div class="moji-quote-text text-sm text-ink/90 leading-relaxed my-2.5 rounded-none font-sans">${ctx.escape(p)}</div>`
      }
    } else {
      const ref = item.ref
      const rulesJson = JSON.stringify(ref.rules)

      innerHtml +=
        `<div class="moji-quote-item my-3 border border-line/70 bg-paper/60 dark:bg-card/60 rounded-none overflow-hidden" ` +
        `data-file="${ctx.attr(ref.filePath)}" data-start="${ref.startLine}" data-end="${ref.endLine}" ` +
        `data-rules="${ctx.attr(rulesJson)}">` +
        `<div class="moji-quote-header flex items-center justify-between px-3 py-1.5 border-b border-line/60 bg-surface/70 dark:bg-surface/40 text-xs font-mono rounded-none select-none">` +
        `<div class="flex items-center gap-2 min-w-0">` +
        `<svg class="w-3.5 h-3.5 text-ink-faint shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">` +
        `<rect x="4" y="2" width="16" height="20" stroke-width="1.8" fill="none"></rect>` +
        `<line x1="8" y1="7" x2="16" y2="7" stroke-width="1.8"></line>` +
        `<line x1="8" y1="12" x2="16" y2="12" stroke-width="1.8"></line>` +
        `<line x1="8" y1="17" x2="13" y2="17" stroke-width="1.8"></line>` +
        `</svg>` +
        `<button type="button" class="moji-quote-path truncate hover:text-seal font-medium text-ink transition-colors cursor-pointer rounded-none underline-offset-2 hover:underline" ` +
        `title="${ctx.escape(ref.filePath)}" data-action="open-file">` +
        `${ctx.escape(ref.filePath)}` +
        `</button>` +
        `<span class="text-[11px] px-1.5 py-0.5 text-ink-faint border border-line/50 bg-paper dark:bg-card rounded-none shrink-0 font-mono">` +
        `L${ref.startLine}–L${ref.endLine}` +
        `</span>` +
        `</div>` +
        `<div class="flex items-center gap-1.5 shrink-0">` +
        `<button type="button" class="moji-quote-btn moji-quote-copy px-2 py-0.5 text-[11px] text-ink-soft hover:text-ink hover:bg-surface border border-line/60 rounded-none transition-colors" data-action="copy">` +
        `${ctx.escape(t('复制'))}` +
        `</button>` +
        `<button type="button" class="moji-quote-btn moji-quote-open px-2 py-0.5 text-[11px] text-ink-soft hover:text-ink hover:bg-surface border border-line/60 rounded-none transition-colors" data-action="open">` +
        `${ctx.escape(t('打开'))}` +
        `</button>` +
        `</div>` +
        `</div>` +
        `<div class="moji-quote-body p-3 font-mono text-xs overflow-x-auto rounded-none">` +
        `<div class="moji-quote-loading flex items-center gap-2 text-ink-soft animate-pulse rounded-none">` +
        `<svg class="w-4 h-4 animate-spin text-seal" fill="none" viewBox="0 0 24 24">` +
        `<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>` +
        `<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>` +
        `</svg>` +
        `<span>${ctx.escape(t('正在加载原文引用…'))}</span>` +
        `</div>` +
        `</div>` +
        `</div>`
    }
  }

  return (
    `<div class="moji-quote-block my-4 border-l-4 border-l-seal bg-surface/30 dark:bg-surface/15 border-y border-r border-line/60 rounded-none p-3 shadow-xs">` +
    innerHtml +
    `</div>`
  )
}

/** 内存缓存文件内容，避免频繁重复读取磁盘 */
const quoteFileCache = new Map<string, { content: string | null; at: number }>()
const inFlightFileReads = new Map<string, Promise<string | null>>()
const CACHE_TTL_MS = 10_000

async function fetchQuoteFile(host: QuoteBlockHost, filePath: string): Promise<string | null> {
  const now = Date.now()
  const cached = quoteFileCache.get(filePath)
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.content
  }

  const existing = inFlightFileReads.get(filePath)
  if (existing) return existing

  const req = (async () => {
    try {
      const content = await host.readFile(filePath)
      quoteFileCache.set(filePath, { content, at: Date.now() })
      return content
    } catch (err) {
      console.warn('[quoteBlock] readFile error', filePath, err)
      quoteFileCache.set(filePath, { content: null, at: Date.now() })
      return null
    } finally {
      inFlightFileReads.delete(filePath)
    }
  })()

  inFlightFileReads.set(filePath, req)
  return req
}

/**
 * DOM 提交后异步挂载原文引用与交互事件
 */
export function hydrateQuotes(root: HTMLElement): () => void {
  let unsub: (() => void) | null = null

  const run = () => {
    const items = root.querySelectorAll<HTMLElement>('.moji-quote-item:not([data-hydrated="true"])')
    if (!items.length) return

    const host = quoteBlockHost()
    if (!host) {
      if (!unsub) {
        unsub = subscribeQuoteBlockHost(() => {
          run()
        })
      }
      return
    }

    if (unsub) {
      unsub()
      unsub = null
    }

    for (const item of items) {
      if (item.dataset.hydrated === 'true') continue

      const rawFile = item.getAttribute('data-file') ?? item.dataset.file ?? ''
      const filePath = decodeAttr(rawFile)
      const startLine = parseInt(item.dataset.start ?? '1', 10)
      const endLine = parseInt(item.dataset.end ?? '1', 10)
      let rules: QuoteMappingRule[] = []
      try {
        const rawRules = item.getAttribute('data-rules') ?? item.dataset.rules ?? '[]'
        rules = JSON.parse(decodeAttr(rawRules)) as QuoteMappingRule[]
      } catch {
        rules = []
      }

      const bodyEl = item.querySelector<HTMLElement>('.moji-quote-body')
      const pathBtn = item.querySelector<HTMLElement>('.moji-quote-path')
      const openBtn = item.querySelector<HTMLElement>('.moji-quote-open')
      const copyBtn = item.querySelector<HTMLElement>('.moji-quote-copy')

      const handleOpen = () => {
        if (host.onOpenFile) {
          host.onOpenFile(filePath, startLine)
        }
      }

      if (pathBtn) pathBtn.onclick = handleOpen
      if (openBtn) openBtn.onclick = handleOpen

      void fetchQuoteFile(host, filePath).then((content) => {
        item.dataset.hydrated = 'true'
        if (!bodyEl) return

        if (content === null || content === undefined) {
          bodyEl.innerHTML =
            `<div class="flex items-center gap-2 text-xs text-ink-faint rounded-none">` +
            `<svg class="w-4 h-4 text-ink-faint shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">` +
            `<circle cx="12" cy="12" r="10" stroke-width="1.5"/>` +
            `<path stroke-width="1.5" d="m15 9-6 6m0-6 6 6"/>` +
            `</svg>` +
            `<span>${t('无法读取引用的源文件（{0}）', filePath || '未知路径')}</span>` +
            `</div>`
          return
        }

        const lines = renderQuotedLines(content, startLine, endLine, rules)
        if (!lines.length) {
          bodyEl.innerHTML =
            `<div class="text-xs text-ink-faint rounded-none">` +
            `<span>${t('指定行区间无内容（文件共 {0} 行）', content.split(/\r?\n/).length)}</span>` +
            `</div>`
          return
        }

        let linesHtml = ''
        const rawLinesText: string[] = []

        for (const line of lines) {
          rawLinesText.push(line.raw)
          linesHtml +=
            `<div class="moji-quote-line flex hover:bg-surface/50 transition-colors rounded-none">` +
            `<span class="moji-quote-line-no select-none text-right font-mono text-[11px] text-ink-faint/60 w-10 pr-3 mr-3 border-r border-line/40 shrink-0 rounded-none">${line.lineNum}</span>` +
            `<span class="moji-quote-line-code font-mono text-xs text-ink/90 whitespace-pre overflow-x-visible rounded-none">${line.html}</span>` +
            `</div>`
        }

        bodyEl.innerHTML = `<div class="moji-quote-code select-text rounded-none leading-5">${linesHtml}</div>`

        if (copyBtn) {
          copyBtn.onclick = () => {
            const textToCopy = rawLinesText.join('\n')
            void navigator.clipboard.writeText(textToCopy).then(() => {
              const prev = copyBtn.textContent
              copyBtn.textContent = t('已复制')
              setTimeout(() => {
                copyBtn.textContent = prev
              }, 1500)
            })
          }
        }
      })
    }
  }

  run()

  return () => {
    if (unsub) {
      unsub()
      unsub = null
    }
  }
}

/**
 * 教学 Agent 的 quote 原文引用块语法指引（用于系统提示词与指引）。
 */
export const QUOTE_SYNTAX_GUIDE = `原文引用块：用三个反引号 + quote 精准引用源文件内容与高亮关键代码，支持混合普通文本说明。
语法格式：
\`\`\`quote
这是一段前置说明普通文本
@文件路径(起始行-结束行){
  [起始行:起始列, 结束行:结束列] => <strong>{{content}}</strong>
}
以上代码片段来自xxx
\`\`\`
- 块内普通文本：非 @ 开头的行作为普通文本展示，用于解释说明、段落过渡或背景交待。
- 原文引用行：以 @ 开头，格式为 \`@<文件路径>(<起始行>-<结束行>)\`，支持可选的花括号 \`{ ... }\` 包裹映射规则。
  · 文件路径：支持绝对路径（如 \`E:/demo/index.html\`）或相对于已声明项目节点的相对路径（如 \`src/index.ts\`）；
  · 行号范围：如 \`(10-34)\`（1 起始闭区间，支持 10-34、10~34、10至34、或单个数字 10）；
  · 映射规则：位于 \`{ ... }\` 内，格式为 \`[l1:c1, l2:c2] => <标签>{{content}}</标签>\`（行列号均从 1 开始），将指定行列范围包裹为样式元素（如 <strong>、<em>、<mark>、<span class="..."> 等）。严禁使用圆角样式，必须保持直角设计风格！
- 同一个 quote 块内可以包含多段普通文本与多个 @ 原文引用，形成图文对照的精读笔记。适合在带读工程源码、文章论文逐段精读、核心算法高亮剖析时使用。`;
