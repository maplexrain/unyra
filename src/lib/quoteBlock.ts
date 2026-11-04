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
 */
import { t } from '../i18n'
import { decodeAttr, encodeAttr, type PluginRenderContext } from './renderPlugins'
import { highlight, type HighlightToken } from '../syntax/SyntaxHighlighter'
import { resolveLanguageId } from '../syntax/LanguageAliases'
import { tokenTypeOf, type TokenType } from '../syntax/Theme'

export const DEFAULT_MARK_TEMPLATE = '<mark class="moji-quote-mark">{{content}}</mark>'

export interface QuoteMappingRule {
  startLine: number
  startCol: number
  endLine: number
  endCol: number
  template: string
  comment?: string
}

export interface QuoteSection {
  startLine: number
  endLine: number
  rules: QuoteMappingRule[]
}

export interface QuoteReference {
  filePath: string
  startLine: number
  endLine: number
  rules: QuoteMappingRule[]
}

/** 格式化多段区间的行标徽章（如 "L83"、"L83–L85"、"L83, L85, L87"） */
export function formatSectionsBadge(sections: Array<{ startLine: number; endLine: number }>): string {
  if (!sections.length) return ''
  return sections
    .map((s) => (s.startLine === s.endLine ? `L${s.startLine}` : `L${s.startLine}–L${s.endLine}`))
    .join(', ')
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
  onOpenFile?: (filePath: string, startLine?: number, endLine?: number) => void
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
  if (!s) return DEFAULT_MARK_TEMPLATE

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

/** 从路径中嗅探适用的代码高亮语言 */
export function detectLanguageFromPath(filePath: string): string | null {
  const clean = filePath.split('?')[0].split('#')[0].trim()
  const lastDot = clean.lastIndexOf('.')
  if (lastDot <= 0) {
    const base = clean.split(/[/\\]/).pop()?.toLowerCase()
    if (base === 'dockerfile') return resolveLanguageId('dockerfile')
    return null
  }
  const ext = clean.slice(lastDot + 1).toLowerCase()
  return resolveLanguageId(ext)
}

function normalizeCoords(l1: number, c1: number, l2: number, c2: number) {
  let startLine = Math.max(1, l1)
  let startCol = Math.max(1, c1)
  let endLine = Math.max(1, l2)
  let endCol = Math.max(1, c2)
  if (startLine > endLine || (startLine === endLine && startCol > endCol)) {
    const tmpL = startLine
    const tmpC = startCol
    startLine = endLine
    startCol = endCol
    endLine = tmpL
    endCol = tmpC
  }
  return { startLine, startCol, endLine, endCol }
}

function parseCoordinates(inner: string): { startLine: number; startCol: number; endLine: number; endCol: number } | null {
  const s = inner.trim()
  if (!s) return null

  // A. 行:列 到 行:列 (如 15:5, 16:7 或 15:5 - 16:7 或 15:5 ~ 16:7 或 15:5至16:7)
  const mColonBoth = s.match(/^(\d+)\s*:\s*(\d+)\s*(?:[,\-~至到]|\s+to\s+)\s*(\d+)\s*:\s*(\d+)$/i)
  if (mColonBoth) {
    return normalizeCoords(
      parseInt(mColonBoth[1], 10),
      parseInt(mColonBoth[2], 10),
      parseInt(mColonBoth[3], 10),
      parseInt(mColonBoth[4], 10),
    )
  }

  // B. 单行内 列范围 行:起始列, 结束列 (如 15:5, 20 或 15:5 - 20)
  const mColonCol = s.match(/^(\d+)\s*:\s*(\d+)\s*(?:[,\-~至到]|\s+to\s+)\s*(\d+)$/i)
  if (mColonCol) {
    const line = parseInt(mColonCol[1], 10)
    return normalizeCoords(
      line,
      parseInt(mColonCol[2], 10),
      line,
      parseInt(mColonCol[3], 10),
    )
  }

  // C. 单点定位 行:列 (如 15:5)
  const mSinglePos = s.match(/^(\d+)\s*:\s*(\d+)$/)
  if (mSinglePos) {
    const line = parseInt(mSinglePos[1], 10)
    const col = parseInt(mSinglePos[2], 10)
    return normalizeCoords(line, col, line, col)
  }

  // D. 纯行区间 行-行 (如 15-20 或 15, 20)
  const mLineRange = s.match(/^(\d+)\s*(?:[,\-~至到]|\s+to\s+)\s*(\d+)$/i)
  if (mLineRange) {
    return normalizeCoords(
      parseInt(mLineRange[1], 10),
      1,
      parseInt(mLineRange[2], 10),
      999999,
    )
  }

  // E. 单整行 (如 15)
  const mSingleLine = s.match(/^(\d+)$/)
  if (mSingleLine) {
    const line = parseInt(mSingleLine[1], 10)
    return normalizeCoords(line, 1, line, 999999)
  }

  return null
}

/**
 * 解析 comment(坐标, 注解内容) 语法
 * 坐标格式与 mark 完全一致：支持 15:5, 16:7、15:5-16:7、15:5, 20、10-15、15 等；
 * 注解内容支持任意文本或成对引号。
 */
function parseCommentRule(trimmed: string, customTemplate: string | null): QuoteMappingRule | null {
  const commentMatch = trimmed.match(/^comment\s*\(\s*([\s\S]+?)\s*\)$/i)
  if (!commentMatch) return null

  const inner = commentMatch[1].trim()
  if (!inner) return null

  let coords: ReturnType<typeof parseCoordinates> = null
  let commentText = ''

  const commaIndices: number[] = []
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === ',') commaIndices.push(i)
  }

  // 1. 若至少有两个逗号，优先尝试以第 2 个逗号作为切分点（处理类似 15:5, 16:7 这种坐标内部有逗号的情况）
  if (commaIndices.length >= 2) {
    const splitIdx = commaIndices[1]
    const candidateCoords = inner.slice(0, splitIdx).trim()
    const candidateComment = inner.slice(splitIdx + 1).trim()
    const parsed = parseCoordinates(candidateCoords)
    if (parsed && candidateComment) {
      coords = parsed
      commentText = candidateComment
    }
  }

  // 2. 若尚未匹配且至少有 1 个逗号，尝试以第 1 个逗号作为切分点（处理 10-15 或 15:5-16:7 这种坐标无逗号的情况）
  if (!coords && commaIndices.length >= 1) {
    const splitIdx = commaIndices[0]
    const candidateCoords = inner.slice(0, splitIdx).trim()
    const candidateComment = inner.slice(splitIdx + 1).trim()
    const parsed = parseCoordinates(candidateCoords)
    if (parsed && candidateComment) {
      coords = parsed
      commentText = candidateComment
    }
  }

  if (!coords || !commentText) return null

  // 清除首尾可能包裹的成对引号
  const cleanedComment = commentText.replace(/^["'“‘]\s*|\s*["'”’]$/g, '').trim()
  const escapedComment = escapeHtml(cleanedComment)

  let template: string
  if (customTemplate) {
    template = sanitizeTemplate(customTemplate)
  } else {
    template = `<span class="moji-quote-comment cursor-help border-b border-dashed border-seal/80 bg-seal/10 hover:bg-seal/20 text-ink transition-colors" data-comment="${escapedComment}" title="${escapedComment}">{{content}}</span>`
  }

  return {
    ...coords,
    template,
    comment: cleanedComment,
  }
}

/** 规范化单条规则字符串，支持 comment(...)、mark(...) 与兼容旧版 [xx:xx, xx:xx] => <template> */
export function parseMappingRule(ruleStr: string): QuoteMappingRule | null {
  let trimmed = ruleStr.trim().replace(/^,\s*/, '')
  if (!trimmed) return null

  // 检查是否显式携带了 => template
  let customTemplate: string | null = null
  const arrowIdx = trimmed.indexOf('=>')
  if (arrowIdx !== -1) {
    customTemplate = trimmed.slice(arrowIdx + 2).trim()
    trimmed = trimmed.slice(0, arrowIdx).trim()
  }

  // 去除可能的单行大括号尾缀
  if (customTemplate) {
    if (customTemplate.endsWith('}') && !customTemplate.endsWith('}}') && !customTemplate.includes('{{content}}')) {
      customTemplate = customTemplate.slice(0, -1).trim()
    } else if (customTemplate.endsWith('}') && customTemplate.includes('}}') && customTemplate.endsWith('}} }')) {
      customTemplate = customTemplate.slice(0, -2).trim()
    }
  } else {
    if (trimmed.endsWith('}') && !trimmed.includes('}}')) {
      trimmed = trimmed.slice(0, -1).trim()
    }
  }

  // 1. 匹配 comment(...) 语法
  const commentRule = parseCommentRule(trimmed, customTemplate)
  if (commentRule) return commentRule

  const template = customTemplate ? sanitizeTemplate(customTemplate) : DEFAULT_MARK_TEMPLATE

  // 2. 匹配 mark(...) 语法
  const markMatch = trimmed.match(/^mark\s*\(\s*([\s\S]+?)\s*\)$/i)
  if (markMatch) {
    const coords = parseCoordinates(markMatch[1])
    if (coords) {
      return {
        ...coords,
        template,
      }
    }
    return null
  }

  // 3. 匹配中括号形式 [15:5, 16:7]
  const bracketMatch = trimmed.match(/^\[\s*([\s\S]+?)\s*\]$/)
  if (bracketMatch) {
    const coords = parseCoordinates(bracketMatch[1])
    if (coords) {
      return {
        ...coords,
        template,
      }
    }
    return null
  }

  return null
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
              // 单行即闭合，例如 { mark(15:5,16:7) }
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
      // 正在收集引用内部的标记规则
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

/**
 * 将标记规则与语法高亮 token 应用到指定行
 */
export function applyRulesToLine(
  lineText: string,
  lineNum: number,
  rules: QuoteMappingRule[],
  lineTokens?: HighlightToken[],
): string {
  const lineLen = lineText.length
  if (lineLen === 0) {
    const matching = rules.find((r) => r.startLine <= lineNum && lineNum <= r.endLine)
    if (matching) {
      if (matching.template.includes('{{content}}')) {
        return matching.template.replace(/\{\{content\}\}/g, '')
      }
      return matching.template
    }
    return ''
  }

  // 1. 收集适用于当前行的所有规则区间 (1-based cols -> 0-based index)
  interface ActiveRule {
    start: number // 0-based inclusive
    end: number   // 0-based exclusive
    template: string
  }
  const activeRules: ActiveRule[] = []
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
      activeRules.push({
        start: c1 - 1,
        end: c2,
        template: r.template,
      })
    }
  }

  // 2. 准备 tokens 切片
  interface NormalizedToken {
    start: number
    end: number
    type: TokenType
  }
  const normTokens: NormalizedToken[] = []
  if (lineTokens && lineTokens.length > 0) {
    let cursor = 0
    for (const t of lineTokens) {
      const tStart = t.startIndex
      const tEnd = tStart + t.text.length
      if (tStart > cursor) {
        normTokens.push({
          start: cursor,
          end: Math.min(tStart, lineLen),
          type: 'plain',
        })
      }
      if (tStart < lineLen) {
        normTokens.push({
          start: tStart,
          end: Math.min(tEnd, lineLen),
          type: tokenTypeOf(t.scopes),
        })
        cursor = Math.min(tEnd, lineLen)
      }
    }
    if (cursor < lineLen) {
      normTokens.push({
        start: cursor,
        end: lineLen,
        type: 'plain',
      })
    }
  } else {
    normTokens.push({
      start: 0,
      end: lineLen,
      type: 'plain',
    })
  }

  // 3. 收集所有关键点（切割边界）
  const cutPoints = new Set<number>([0, lineLen])
  for (const t of normTokens) {
    cutPoints.add(t.start)
    cutPoints.add(t.end)
  }
  for (const ar of activeRules) {
    cutPoints.add(ar.start)
    cutPoints.add(ar.end)
  }

  const sortedPoints = Array.from(cutPoints).filter((p) => p >= 0 && p <= lineLen).sort((a, b) => a - b)

  // 4. 对每个微段确定 tokenType 和 ruleTemplate
  interface Segment {
    start: number
    end: number
    text: string
    type: TokenType
    template: string | null
  }
  const segments: Segment[] = []
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const p1 = sortedPoints[i]
    const p2 = sortedPoints[i + 1]
    if (p1 >= p2) continue

    const text = lineText.slice(p1, p2)
    const tok = normTokens.find((t) => t.start <= p1 && p2 <= t.end)
    const type: TokenType = tok ? tok.type : 'plain'

    const rule = activeRules.find((r) => r.start <= p1 && p2 <= r.end)
    const template = rule ? rule.template : null

    segments.push({ start: p1, end: p2, text, type, template })
  }

  // 5. 按连续相同 template 分组渲染，保证 HTML 标签嵌套完全正确
  let result = ''
  let currentGroupTemplate: string | null = null
  let groupBufferHtml = ''
  let currentTokType: TokenType | null = null
  let tokBufferText = ''

  const flushToken = () => {
    if (!tokBufferText) return
    const escaped = escapeHtml(tokBufferText)
    if (currentTokType && currentTokType !== 'plain') {
      groupBufferHtml += `<span class="tok tok-${currentTokType}">${escaped}</span>`
    } else {
      groupBufferHtml += escaped
    }
    tokBufferText = ''
    currentTokType = null
  }

  const flushGroup = () => {
    flushToken()
    if (!groupBufferHtml) return
    if (currentGroupTemplate) {
      if (currentGroupTemplate.includes('{{content}}')) {
        result += currentGroupTemplate.replace(/\{\{content\}\}/g, groupBufferHtml)
      } else {
        const tagMatch = currentGroupTemplate.match(/^<([a-zA-Z0-9_-]+)([^>]*)>/)
        if (tagMatch) {
          result += `${currentGroupTemplate}${groupBufferHtml}</${tagMatch[1]}>`
        } else {
          result += `${currentGroupTemplate}${groupBufferHtml}`
        }
      }
    } else {
      result += groupBufferHtml
    }
    groupBufferHtml = ''
    currentGroupTemplate = null
  }

  for (const seg of segments) {
    if (seg.template !== currentGroupTemplate) {
      flushGroup()
      currentGroupTemplate = seg.template
    }
    if (seg.type !== currentTokType) {
      flushToken()
      currentTokType = seg.type
    }
    tokBufferText += seg.text
  }
  flushGroup()

  return result
}

/**
 * 对全部行应用规则与语法高亮，产出每行的行号与 HTML
 */
export function renderQuotedLines(
  fullContent: string,
  startLine: number,
  endLine: number,
  rules: QuoteMappingRule[],
  tokenLines?: HighlightToken[][],
): { lineNum: number; html: string; raw: string }[] {
  const allLines = fullContent.split(/\r?\n/)
  const total = allLines.length

  const s = Math.max(1, Math.min(startLine, total))
  const e = Math.max(s, Math.min(endLine, total))

  const results: { lineNum: number; html: string; raw: string }[] = []
  for (let l = s; l <= e; l++) {
    const raw = allLines[l - 1] ?? ''
    const lineTokens = tokenLines ? tokenLines[l - 1] : undefined
    const html = applyRulesToLine(raw, l, rules, lineTokens)
    results.push({ lineNum: l, html, raw })
  }
  return results
}

/**
 * 同步产出占位容器
 */
export function quoteBlock(source: string, ctx: PluginRenderContext): string {
  const parsed = parseQuoteBlock(source)

  // 合并相邻且引用同一文件的条目为一个代码片段组件
  type RenderGroup =
    | { type: 'text'; paragraphs: string[] }
    | { type: 'refGroup'; filePath: string; sections: QuoteSection[] }

  const groups: RenderGroup[] = []

  for (const item of parsed.items) {
    if (item.type === 'text') {
      const paragraphs = item.text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      if (paragraphs.length > 0) {
        groups.push({ type: 'text', paragraphs })
      }
    } else {
      const last = groups[groups.length - 1]
      if (last && last.type === 'refGroup' && last.filePath === item.ref.filePath) {
        last.sections.push({
          startLine: item.ref.startLine,
          endLine: item.ref.endLine,
          rules: item.ref.rules,
        })
      } else {
        groups.push({
          type: 'refGroup',
          filePath: item.ref.filePath,
          sections: [
            {
              startLine: item.ref.startLine,
              endLine: item.ref.endLine,
              rules: item.ref.rules,
            },
          ],
        })
      }
    }
  }

  let innerHtml = ''
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]
    if (group.type === 'text') {
      for (const p of group.paragraphs) {
        innerHtml += `<div class="moji-quote-text text-sm text-ink/90 leading-relaxed my-2.5 rounded-none font-sans">${ctx.escape(p)}</div>`
      }
    } else {
      const sectionsJson = JSON.stringify(group.sections)
      const firstStart = group.sections[0].startLine
      const lastEnd = group.sections[group.sections.length - 1].endLine
      const badgeText = formatSectionsBadge(group.sections)

      let displayPath = group.filePath
      try {
        if (displayPath.includes('%')) {
          displayPath = decodeURIComponent(displayPath)
        }
      } catch {}

      innerHtml +=
        `<div class="moji-quote-item my-3 border border-line/70 bg-paper/60 dark:bg-card/60 rounded-none overflow-hidden" ` +
        `data-file="${ctx.attr(group.filePath)}" data-start="${firstStart}" data-end="${lastEnd}" ` +
        `data-sections="${ctx.attr(sectionsJson)}">` +
        `<div class="moji-quote-header flex items-center justify-between px-3 py-1.5 border-b border-line/60 bg-surface/70 dark:bg-surface/40 text-xs font-sans rounded-none select-none">` +
        `<div class="flex items-center gap-2 min-w-0">` +
        `<svg class="w-3.5 h-3.5 text-ink-faint shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">` +
        `<rect x="4" y="2" width="16" height="20" stroke-width="1.8" fill="none"></rect>` +
        `<line x1="8" y1="7" x2="16" y2="7" stroke-width="1.8"></line>` +
        `<line x1="8" y1="12" x2="16" y2="12" stroke-width="1.8"></line>` +
        `<line x1="8" y1="17" x2="13" y2="17" stroke-width="1.8"></line>` +
        `</svg>` +
        `<button type="button" class="moji-quote-path truncate hover:text-seal font-medium text-ink transition-colors cursor-pointer rounded-none underline-offset-2 hover:underline" ` +
        `title="${ctx.escape(displayPath)}" data-action="open-file">` +
        `${ctx.escape(displayPath)}` +
        `</button>` +
        `<span class="moji-quote-badge text-[11px] px-1.5 py-0.5 text-ink-faint border border-line/50 bg-paper dark:bg-card rounded-none shrink-0 font-sans tabular-nums">` +
        `${ctx.escape(badgeText)}` +
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
        `<div class="moji-quote-body p-3 font-sans text-xs overflow-hidden rounded-none">` +
        `<div class="moji-quote-loading flex items-center gap-2 text-ink-soft animate-pulse rounded-none">` +
        `<svg class="w-4 h-4 animate-spin text-seal" fill="none" viewBox="0 0 24 24">` +
        `<circle class="opacity-25" cx="12" cy="12" r="10" stroke-width="4"></circle>` +
        `<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>` +
        `</svg>` +
        `<span>${ctx.escape(t('正在加载原文引用…'))}</span>` +
        `</div>` +
        `</div>` +
        `</div>`
    }
  }

  return (
    `<div class="moji-quote-block my-3 rounded-none">` +
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

/** 从 DOM item 中解析出当前引用的所有区间 (sections) */
function parseSectionsAttr(item: HTMLElement): QuoteSection[] {
  try {
    const rawSec = item.getAttribute('data-sections') ?? item.dataset.sections
    if (rawSec) {
      const parsed = JSON.parse(decodeAttr(rawSec))
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as QuoteSection[]
      }
    }
  } catch {}

  const startLine = parseInt(item.dataset.start ?? '1', 10)
  const endLine = parseInt(item.dataset.end ?? '1', 10)
  let rules: QuoteMappingRule[] = []
  try {
    const rawRules = item.getAttribute('data-rules') ?? item.dataset.rules ?? '[]'
    rules = JSON.parse(decodeAttr(rawRules)) as QuoteMappingRule[]
  } catch {
    rules = []
  }
  return [{ startLine, endLine, rules }]
}

/** 合并 DOM 中相邻且引用同一文件的 quote 块 */
function mergeAdjacentQuoteElements(root: HTMLElement): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.moji-quote-block'))
  for (let i = 0; i < blocks.length; i++) {
    const curBlock = blocks[i]
    if (!curBlock.isConnected) continue

    let nextNode = curBlock.nextSibling
    while (nextNode && nextNode.nodeType === Node.TEXT_NODE && !nextNode.textContent?.trim()) {
      nextNode = nextNode.nextSibling
    }

    if (nextNode && nextNode.nodeType === Node.ELEMENT_NODE) {
      const nextEl = nextNode as HTMLElement
      if (nextEl.classList.contains('moji-quote-block')) {
        const curItems = Array.from(curBlock.querySelectorAll<HTMLElement>('.moji-quote-item'))
        const nextItems = Array.from(nextEl.querySelectorAll<HTMLElement>('.moji-quote-item'))
        if (curItems.length > 0 && nextItems.length > 0) {
          const lastCurItem = curItems[curItems.length - 1]
          const firstNextItem = nextItems[0]

          const file1 = lastCurItem.getAttribute('data-file')
          const file2 = firstNextItem.getAttribute('data-file')

          if (file1 && file1 === file2) {
            const sec1 = parseSectionsAttr(lastCurItem)
            const sec2 = parseSectionsAttr(firstNextItem)
            const mergedSecs = [...sec1, ...sec2]

            lastCurItem.setAttribute('data-sections', encodeAttr(JSON.stringify(mergedSecs)))
            const badgeEl = lastCurItem.querySelector('.moji-quote-badge')
            if (badgeEl) {
              badgeEl.textContent = formatSectionsBadge(mergedSecs)
            }

            firstNextItem.remove()

            // 将 nextEl 剩余的所有子节点（若有）合并移动到 curBlock
            const remaining = Array.from(nextEl.children)
            for (const child of remaining) {
              curBlock.appendChild(child)
            }
            nextEl.remove()

            // 重新检验合并后的当前块
            i--
          }
        }
      }
    }
  }
}

let activeQuoteTip: HTMLElement | null = null

function removeActiveQuoteTip(): void {
  if (activeQuoteTip) {
    activeQuoteTip.remove()
    activeQuoteTip = null
  }
}

/** 为所有被 comment 标注的文本绑定鼠标悬浮提示气泡 */
function attachCommentTooltips(container: HTMLElement): void {
  const commentEls = container.querySelectorAll<HTMLElement>('.moji-quote-comment')
  for (const el of commentEls) {
    const comment = el.dataset.comment || el.getAttribute('title') || ''
    if (!comment) continue

    el.addEventListener('mouseenter', () => {
      removeActiveQuoteTip()
      el.removeAttribute('title')

      const tip = document.createElement('div')
      tip.className =
        'moji-quote-tip fixed z-50 max-w-xs px-2.5 py-1.5 text-xs text-ink bg-card border border-line-strong/80 shadow-lg rounded-none pointer-events-none select-none transition-opacity duration-150'
      tip.textContent = comment

      document.body.appendChild(tip)
      activeQuoteTip = tip

      const rect = el.getBoundingClientRect()
      const tipRect = tip.getBoundingClientRect()

      let left = rect.left + rect.width / 2 - tipRect.width / 2
      const vw = typeof window !== 'undefined' ? (window.innerWidth || 1024) : 1024
      left = Math.max(8, Math.min(left, vw - tipRect.width - 8))

      let top = rect.top - tipRect.height - 6
      if (top < 8) {
        top = rect.bottom + 6
      }

      tip.style.left = `${Math.round(left)}px`
      tip.style.top = `${Math.round(top)}px`
    })

    el.addEventListener('mouseleave', () => {
      el.setAttribute('title', comment)
      removeActiveQuoteTip()
    })
  }
}

/**
 * DOM 提交后异步挂载原文引用与交互事件
 */
export function hydrateQuotes(root: HTMLElement): () => void {
  let unsub: (() => void) | null = null

  // 1. 合并相邻且引用同一文件的 quote 块
  mergeAdjacentQuoteElements(root)

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
      let filePath = decodeAttr(rawFile)
      try {
        if (filePath.includes('%')) {
          filePath = decodeURIComponent(filePath)
        }
      } catch {}

      const sections = parseSectionsAttr(item)
      const firstStart = sections[0]?.startLine ?? 1
      const lastEnd = sections[sections.length - 1]?.endLine ?? firstStart

      const bodyEl = item.querySelector<HTMLElement>('.moji-quote-body')
      const pathBtn = item.querySelector<HTMLElement>('.moji-quote-path')
      const openBtn = item.querySelector<HTMLElement>('.moji-quote-open')
      const copyBtn = item.querySelector<HTMLElement>('.moji-quote-copy')

      const handleOpen = () => {
        if (host.onOpenFile) {
          host.onOpenFile(filePath, firstStart, lastEnd)
        }
      }

      if (pathBtn) pathBtn.onclick = handleOpen
      if (openBtn) openBtn.onclick = handleOpen

      void fetchQuoteFile(host, filePath).then(async (content) => {
        item.dataset.hydrated = 'true'
        if (!bodyEl) return

        if (content === null || content === undefined) {
          const displayFailedPath = filePath || '未知路径'
          bodyEl.innerHTML =
            `<div class="flex items-start gap-2 text-xs text-ink-faint rounded-none whitespace-pre-wrap break-words break-all">` +
            `<svg class="w-4 h-4 text-ink-faint shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">` +
            `<circle cx="12" cy="12" r="10" stroke-width="1.5"/>` +
            `<path stroke-width="1.5" d="m15 9-6 6m0-6 6 6"/>` +
            `</svg>` +
            `<span>${t('无法读取引用的源文件（{0}）', displayFailedPath)}</span>` +
            `</div>`
          return
        }

        // 代码语法高亮（根据文件后缀嗅探语言）
        let tokenLines: HighlightToken[][] | undefined = undefined
        const langId = detectLanguageFromPath(filePath)
        if (langId) {
          try {
            const highlighted = await highlight(content, langId)
            if (!highlighted.plain && highlighted.lines.length > 0) {
              tokenLines = highlighted.lines
            }
          } catch (err) {
            console.warn('[quoteBlock] highlight error', err)
          }
        }

        // 对每一个引用区间分别渲染行与规则
        const renderedSections: Array<{
          startLine: number
          endLine: number
          lines: Array<{ lineNum: number; html: string; raw: string }>
        }> = []

        for (const sec of sections) {
          const lines = renderQuotedLines(content, sec.startLine, sec.endLine, sec.rules, tokenLines)
          if (lines.length > 0) {
            renderedSections.push({
              startLine: sec.startLine,
              endLine: sec.endLine,
              lines,
            })
          }
        }

        if (!renderedSections.length) {
          bodyEl.innerHTML =
            `<div class="text-xs text-ink-faint rounded-none">` +
            `<span>${t('指定行区间无内容（文件共 {0} 行）', content.split(/\r?\n/).length)}</span>` +
            `</div>`
          return
        }

        let linesHtml = ''
        const rawLinesText: string[] = []

        for (let sIdx = 0; sIdx < renderedSections.length; sIdx++) {
          const sec = renderedSections[sIdx]

          // 相邻两段行号不连续时展示紧凑极简跳行指示
          if (sIdx > 0) {
            const prevSec = renderedSections[sIdx - 1]
            if (sec.startLine > prevSec.endLine + 1) {
              linesHtml +=
                `<div class="moji-quote-gap flex items-center gap-2 my-1 text-[10px] text-ink-faint/40 select-none">` +
                `<span class="min-w-[2.25rem] text-right pr-2 mr-2.5">···</span>` +
                `<span class="h-px bg-line/30 flex-1"></span>` +
                `</div>`
            }
          }

          for (const line of sec.lines) {
            rawLinesText.push(line.raw)
            linesHtml +=
              `<div class="moji-quote-line flex items-start hover:bg-surface/50 transition-colors rounded-none">` +
              `<button type="button" class="moji-quote-line-no select-none text-right font-sans tabular-nums text-[11px] text-ink-faint/60 hover:text-seal hover:bg-seal/10 min-w-[2.25rem] pr-2 mr-2.5 border-r border-line/40 shrink-0 rounded-none pt-0.5 cursor-pointer transition-colors" title="${t('跳转到第 {0} 行', line.lineNum)}" data-line="${line.lineNum}">` +
              `${line.lineNum}` +
              `</button>` +
              `<span class="moji-quote-line-code font-sans text-xs text-ink whitespace-pre-wrap break-words break-all min-w-0 flex-1 rounded-none leading-5">${line.html}</span>` +
              `</div>`
          }
        }

        bodyEl.innerHTML = `<div class="moji-quote-code select-text rounded-none leading-5">${linesHtml}</div>`

        // 绑定行号点击直接跳转源文件对应行号
        const lineButtons = bodyEl.querySelectorAll<HTMLButtonElement>('.moji-quote-line-no')
        for (const btn of lineButtons) {
          btn.onclick = (e) => {
            e.stopPropagation()
            const lineNo = parseInt(btn.dataset.line ?? '1', 10)
            if (host.onOpenFile) {
              host.onOpenFile(filePath, lineNo, lineNo)
            }
          }
        }

        // 挂载 comment 注解 hover 提示气泡
        attachCommentTooltips(bodyEl)

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
    removeActiveQuoteTip()
    if (unsub) {
      unsub()
      unsub = null
    }
  }
}

/**
 * 教学 Agent 的 quote 原文引用块语法指引（用于系统提示词与指引）。
 */
export const QUOTE_SYNTAX_GUIDE = `原文引用块：用三个反引号 + quote 精准引用源文件内容与高亮关键代码，支持根据文件后缀自适应语法高亮与行内文字标记。
【使用直觉与铁律】：收敛成直觉——“我要讲的东西刚好本地有，那我就引用它，让用户知道我在讲哪里”。不要仅在带用户读文章读项目时才使用，在任何教学讲解、代码剖析、概念推演等场景中，只要本地有源码、材料或文档，都应主动多使用 quote 语法精准引用核心行进行对照解析！
语法格式：
\`\`\`quote
这是一段前置说明普通文本
@文件路径(起始行-结束行){
  mark(起始行:起始列, 结束行:结束列)
  comment(起始行:起始列, 结束行:结束列, 注解说明内容)
}
以上代码片段来自xxx
\`\`\`
- 块内普通文本：非 @ 开头的行作为普通文本展示，用于解释说明、段落过渡或背景交待。
- 原文引用行：以 @ 开头，格式为 \`@<文件路径>(<起始行>-<结束行>)\`，支持可选的花括号 \`{ ... }\` 包裹标记规则。
  · 文件路径：支持绝对路径（如 \`E:/demo/index.html\`）或工作区/项目相对路径（如 \`src/index.ts\`、\`workspace/article.md\`）；系统会自动根据文件扩展名（.js, .ts, .py, .html, .rs 等）展示对应的代码语法高亮。
  · 行号范围：如 \`(10-34)\`（1 起始闭区间，支持 10-34、10~34、10至34、或单个数字 10）；
  · 标记规则：位于 \`{ ... }\` 内：
    1) \`mark(起始行:起始列, 结束行:结束列)\`：对指定文字添加背景高亮标记色（亦支持单行列区间 \`mark(行:起始列, 结束列)\` 或全行标记 \`mark(行号)\`）。
    2) \`comment(起始行:起始列, 结束行:结束列, 注解内容)\`：对指定文字添加注解标记，用户鼠标悬停时会弹出注解提示框（亦支持 \`comment(行:起始列, 结束列, 注解内容)\` 或全行批注 \`comment(行号, 注解内容)\`）。
  · 直角规范：严禁使用圆角样式，组件与高亮标记严格保持直角设计风格！
- 连续同文件引用优化：如果相邻引用属于同一个文件的不同行号，系统会自动合并为一个精炼的文件片段组件，以行号区分展示，用户点击行号即可直接跳转源文件对应位置。同一个 quote 块内可以包含多段普通文本与多个 @ 原文引用，形成图文对照的精读笔记。`
