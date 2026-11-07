/**
 * quote 块共享类型与基础工具。
 *
 * 职责：原文引用相关的数据结构定义（映射规则、区间、引用条目、解析结果、宿主接口）、
 * 默认标记模板常量，以及跨模块共用的小工具（escapeHtml、formatSectionsBadge）。
 * 本文件保持零内部依赖（不 import 其他 quoteBlock 模块），供解析/渲染/挂载各模块共享。
 */

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

/** 转义 HTML 特殊字符 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
