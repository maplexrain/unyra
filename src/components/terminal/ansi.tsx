/**
 * Terminal ANSI Parser: 将终端输出中的 ANSI 转义序列转换为带样式的 React 节点。
 * 遵循 xterm / VS Code 集成终端标准配色规范。
 */

import React, { type ReactNode } from 'react'

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
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

/** 将含 ANSI 转义符的文本解析为 React 节点片段 */
export function renderAnsiText(rawText: string): ReactNode {
  if (!rawText) return null

  // 预先清洗非颜色控制码（光标显示隐藏、行清除等），避免污染显示
  const cleaned = rawText.replace(/\x1b\[\??[0-9;]*[a-zA-Z]/g, (match) => {
    return match.endsWith('m') ? match : ''
  })

  const tokens = cleaned.split(/(\x1b\[[0-9;]*m)/g)
  const elements: ReactNode[] = []
  let currentStyle: StyleState = {}

  tokens.forEach((token, index) => {
    if (!token) return

    const match = token.match(/^\x1b\[([0-9;]*)m$/)
    if (match) {
      const codes = (match[1] || '0').split(';').map(Number)
      for (const code of codes) {
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
        } else if (ANSI_COLOR_MAP[code]) {
          currentStyle.fg = ANSI_COLOR_MAP[code]
        } else if (ANSI_BG_MAP[code]) {
          currentStyle.bg = ANSI_BG_MAP[code]
        }
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

      elements.push(
        classNames ? (
          <span key={index} className={classNames}>
            {token}
          </span>
        ) : (
          <React.Fragment key={index}>{token}</React.Fragment>
        )
      )
    }
  })

  return <>{elements}</>
}
