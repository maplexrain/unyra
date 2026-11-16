/**
 * Terminal ANSI Parser: 将终端输出中的 ANSI 转义序列转换为带样式的 React 节点。
 * 遵循 xterm / VS Code 集成终端标准配色规范，并深度清洗 OSC、控制字符与光标控制码。
 */

import React, { type CSSProperties, type ReactNode } from 'react'
import { renderSemanticPlainText } from './terminalHighlight'

const ANSI_COLOR_MAP: Record<number, string> = {
  30: 'text-zinc-900 dark:text-zinc-400',
  31: 'text-rose-500 font-semibold',
  32: 'text-emerald-400 font-medium',
  33: 'text-amber-300 font-medium',
  34: 'text-sky-400 font-medium',
  35: 'text-fuchsia-400 font-medium',
  36: 'text-cyan-400 font-medium',
  37: 'text-zinc-200',
  90: 'text-zinc-500',
  91: 'text-rose-400 font-semibold',
  92: 'text-emerald-300 font-medium',
  93: 'text-amber-200 font-medium',
  94: 'text-sky-300 font-medium',
  95: 'text-fuchsia-300 font-medium',
  96: 'text-cyan-300 font-medium',
  97: 'text-white',
}

const ANSI_BG_MAP: Record<number, string> = {
  40: 'bg-zinc-900',
  41: 'bg-rose-950/60',
  42: 'bg-emerald-950/60',
  43: 'bg-amber-950/60',
  44: 'bg-sky-950/60',
  45: 'bg-fuchsia-950/60',
  46: 'bg-cyan-950/60',
  47: 'bg-zinc-200 text-zinc-900',
}

interface StyleState {
  fg?: string
  bg?: string
  colorStyle?: string
  bgStyle?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

/** 彻底清洗终端输出中的 OSC 标题码、光标移动码与无效控制字符 */
export function cleanTerminalText(raw: string): string {
  if (!raw) return ''
  return raw
    // 移除 OSC 序列 (如 \x1b]0;Title\x07 或 \x1b]9;...\x1b\)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // 移除字符集设定 (如 \x1b(B)
    .replace(/\x1b\([A-Za-z0-9]/g, '')
    // 移除除颜色样式 (m) 之外的所有光标/屏幕控制码 (如 \x1b[2K, \x1b[?25h, \x1b[H)
    .replace(/\x1b\[\??[0-9;]*[a-zA-Z]/g, (match) => {
      return match.endsWith('m') ? match : ''
    })
    // 移除不可见的控制字符（保留制表符 \t、换行符 \n 以及转义符 \x1b）
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f]/g, '')
    // 标准化回车换行
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/** 将含 ANSI 转义符的文本解析为 React 节点片段 */
export function renderAnsiText(rawText: string): ReactNode {
  if (!rawText) return null

  const cleaned = cleanTerminalText(rawText)
  const tokens = cleaned.split(/(\x1b\[[0-9;]*m)/g)
  const elements: ReactNode[] = []
  let currentStyle: StyleState = {}

  tokens.forEach((token, index) => {
    if (!token) return

    const match = token.match(/^\x1b\[([0-9;]*)m$/)
    if (match) {
      const parts = (match[1] || '0').split(';').map(Number)
      let i = 0
      while (i < parts.length) {
        const code = parts[i]
        if (code === 0) {
          currentStyle = {}
        } else if (code === 1) {
          currentStyle.bold = true
        } else if (code === 2) {
          currentStyle.dim = true
        } else if (code === 3) {
          currentStyle.italic = true
        } else if (code === 4) {
          currentStyle.underline = true
        } else if (code === 38 && parts[i + 1] === 2 && i + 4 < parts.length) {
          // 24-bit TrueColor 前景色: 38;2;R;G;B
          const r = parts[i + 2]
          const g = parts[i + 3]
          const b = parts[i + 4]
          currentStyle.colorStyle = `rgb(${r},${g},${b})`
          currentStyle.fg = undefined
          i += 4
        } else if (code === 48 && parts[i + 1] === 2 && i + 4 < parts.length) {
          // 24-bit TrueColor 背景色: 48;2;R;G;B
          const r = parts[i + 2]
          const g = parts[i + 3]
          const b = parts[i + 4]
          currentStyle.bgStyle = `rgb(${r},${g},${b})`
          currentStyle.bg = undefined
          i += 4
        } else if (code === 39) {
          currentStyle.fg = undefined
          currentStyle.colorStyle = undefined
        } else if (code === 49) {
          currentStyle.bg = undefined
          currentStyle.bgStyle = undefined
        } else if (ANSI_COLOR_MAP[code]) {
          currentStyle.fg = ANSI_COLOR_MAP[code]
          currentStyle.colorStyle = undefined
        } else if (ANSI_BG_MAP[code]) {
          currentStyle.bg = ANSI_BG_MAP[code]
          currentStyle.bgStyle = undefined
        }
        i++
      }
    } else {
      const classNames = [
        currentStyle.fg || '',
        currentStyle.bg || '',
        currentStyle.bold ? 'font-bold' : '',
        currentStyle.dim ? 'opacity-60' : '',
        currentStyle.italic ? 'italic' : '',
        currentStyle.underline ? 'underline' : '',
      ]
        .filter(Boolean)
        .join(' ')

      const inlineStyle: CSSProperties = {}
      if (currentStyle.colorStyle) inlineStyle.color = currentStyle.colorStyle
      if (currentStyle.bgStyle) inlineStyle.backgroundColor = currentStyle.bgStyle

      const hasInline = Object.keys(inlineStyle).length > 0

      elements.push(
        classNames || hasInline ? (
          <span key={index} className={classNames || undefined} style={hasInline ? inlineStyle : undefined}>
            {token}
          </span>
        ) : (
          <React.Fragment key={index}>{renderSemanticPlainText(token)}</React.Fragment>
        )
      )
    }
  })

  return <>{elements}</>
}
