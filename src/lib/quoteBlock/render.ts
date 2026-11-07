/**
 * quote 块渲染。
 *
 * 职责：从路径嗅探高亮语言（detectLanguageFromPath）、
 * 将标记规则与语法高亮 token 应用到行（applyRulesToLine / renderQuotedLines），
 * 以及生成 quote 块的占位容器 HTML（quoteBlock：文件头徽章、复制/打开按钮与加载态，
 * 实际内容由 hydrate 模块异步填充）。
 */
import { t } from '../../i18n'
import type { PluginRenderContext } from '../renderPlugins'
import type { HighlightToken } from '../../syntax/SyntaxHighlighter'
import { resolveLanguageId } from '../../syntax/LanguageAliases'
import { tokenTypeOf, type TokenType } from '../../syntax/Theme'
import { parseQuoteBlock } from './parse'
import { escapeHtml, formatSectionsBadge, type QuoteMappingRule, type QuoteSection } from './types'

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
