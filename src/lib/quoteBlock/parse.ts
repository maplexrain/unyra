/**
 * quote 围栏源码解析。
 *
 * 职责：自定义标记模板的安全净化（sanitizeTemplate + SAFE_TAGS 白名单）、
 * 行列坐标语法解析（normalizeCoords / parseCoordinates）、
 * 单条规则解析（comment(...) / mark(...) / 兼容旧版 [xx:xx, xx:xx] => <template>），
 * 以及 ```quote 围栏整体解析（parseQuoteBlock：普通文本行 + @文件引用 + 规则收集）。
 */
import {
  DEFAULT_MARK_TEMPLATE,
  escapeHtml,
  type ParsedQuoteBlock,
  type QuoteItem,
  type QuoteMappingRule,
  type QuoteReference,
} from './types'

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
