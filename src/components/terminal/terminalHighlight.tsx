/**
 * terminalHighlight: 终端流文本语法与语义高亮引擎。
 * 1. 输入行实时词法染色：高亮命令动词、参数选项、子命令、字符串与路径；
 * 2. 输出流智能高亮：对未带 ANSI 样式的纯文本流自动提取 URL、Windows 绝对路径、错误、警告与成功标识。
 */

import React, { type ReactNode } from 'react'

const COMMON_COMMANDS = new Set([
  'npm', 'pnpm', 'yarn', 'npx', 'git', 'node', 'cd', 'ls', 'dir',
  'cat', 'clear', 'cls', 'mkdir', 'rm', 'cp', 'mv', 'echo', 'cargo',
  'rustc', 'python', 'pip', 'code', 'vim', 'vi', 'nano', 'docker',
  'kubectl', 'ssh', 'curl', 'wget', 'chcp', 'taskkill', 'powershell', 'pwsh', 'cmd', 'bash'
])

const COMMON_SUBCOMMANDS = new Set([
  'run', 'dev', 'build', 'start', 'test', 'install', 'add', 'remove',
  'commit', 'push', 'pull', 'checkout', 'branch', 'status', 'diff',
  'init', 'clone', 'publish', 'update', 'upgrade', 'format', 'lint', 'notice'
])

/**
 * 实时对终端命令行输入进行语法高亮染色并内嵌光标
 */
export function renderHighlightedInput(val: string, cursorPos: number): ReactNode {
  if (!val) {
    return (
      <span className="inline-block w-2 h-4.5 bg-ink text-paper animate-pulse align-middle" />
    )
  }

  // 对输入行做分词：保留空白与符号
  const tokens: { text: string; kind: 'cmd' | 'subcmd' | 'opt' | 'str' | 'path' | 'plain' | 'space' }[] = []
  const regex = /(\s+)|("[^"]*"?|'[^']*'?)|(--?[a-zA-Z0-9_\-]+)|([a-zA-Z]:\\[^\s]+|\/[^\s]+)|([^\s"'\-]+)/g
  let match: RegExpExecArray | null
  let isFirstToken = true

  while ((match = regex.exec(val)) !== null) {
    const [full, space, str, opt, path, word] = match
    if (space) {
      tokens.push({ text: full, kind: 'space' })
    } else if (str) {
      tokens.push({ text: full, kind: 'str' })
    } else if (opt) {
      tokens.push({ text: full, kind: 'opt' })
    } else if (path) {
      tokens.push({ text: full, kind: 'path' })
    } else if (word) {
      const lower = word.toLowerCase()
      if (isFirstToken && COMMON_COMMANDS.has(lower)) {
        tokens.push({ text: full, kind: 'cmd' })
        isFirstToken = false
      } else if (COMMON_SUBCOMMANDS.has(lower)) {
        tokens.push({ text: full, kind: 'subcmd' })
      } else if (isFirstToken) {
        tokens.push({ text: full, kind: 'cmd' })
        isFirstToken = false
      } else {
        tokens.push({ text: full, kind: 'plain' })
      }
    } else {
      tokens.push({ text: full, kind: 'plain' })
    }
  }

  const kindClasses: Record<string, string> = {
    cmd: 'text-amber-600 dark:text-amber-300 font-semibold',
    subcmd: 'text-emerald-600 dark:text-emerald-300 font-medium',
    opt: 'text-sky-600 dark:text-cyan-400 font-medium',
    str: 'text-amber-700 dark:text-amber-200/90',
    path: 'text-blue-600 dark:text-sky-300 underline decoration-sky-500/40',
    plain: 'text-ink',
    space: '',
  }

  // 将分词片段与光标位置重叠拼装
  let charCount = 0
  let cursorRendered = false
  const elements: ReactNode[] = []

  const cursorNode = (
    <span
      key="__cursor__"
      className="inline-block w-2 h-4.5 bg-ink text-paper animate-pulse align-middle"
    />
  )

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const start = charCount
    const end = charCount + t.text.length
    charCount = end

    if (!cursorRendered && cursorPos >= start && cursorPos <= end) {
      const offsetInToken = cursorPos - start
      const before = t.text.slice(0, offsetInToken)
      const after = t.text.slice(offsetInToken)
      cursorRendered = true

      elements.push(
        <span key={i} className={kindClasses[t.kind] || undefined}>
          {before}
          {cursorNode}
          {after}
        </span>
      )
    } else {
      elements.push(
        <span key={i} className={kindClasses[t.kind] || undefined}>
          {t.text}
        </span>
      )
    }
  }

  if (!cursorRendered) {
    elements.push(cursorNode)
  }

  return <>{elements}</>
}

/**
 * 对普通纯文本进行智能模式高亮（URL、路径、错误/警告/成功提示）
 */
export function renderSemanticPlainText(text: string): ReactNode {
  if (!text) return null

  // 正则拆分：URL、Windows 盘符路径、错误、警告、成功关键字
  const regex = /(https?:\/\/[^\s"'<>()[\]{}]+)|([A-Za-z]:\\[^\s"'<>()[\]{}]+)|(\b(?:error|Error|ERROR|fail|FAIL|failed|FAILED)\b)|(\b(?:warn|WARN|warning|Warning|WARNING)\b)|(\b(?:success|SUCCESS|passed|ready in)\b)/g
  const parts = text.split(regex)
  if (parts.length <= 1) {
    return text
  }

  return (
    <>
      {parts.map((p, idx) => {
        if (!p) return null
        if (/^https?:\/\//i.test(p)) {
          return (
            <span key={idx} className="text-sky-400 underline decoration-sky-500/50 hover:text-sky-300">
              {p}
            </span>
          )
        }
        if (/^[A-Za-z]:\\/.test(p)) {
          return (
            <span key={idx} className="text-teal-300/90 font-mono">
              {p}
            </span>
          )
        }
        if (/^(error|fail|failed)$/i.test(p)) {
          return (
            <span key={idx} className="text-rose-400 font-semibold">
              {p}
            </span>
          )
        }
        if (/^(warn|warning)$/i.test(p)) {
          return (
            <span key={idx} className="text-amber-300 font-medium">
              {p}
            </span>
          )
        }
        if (/^(success|passed|ready in)$/i.test(p)) {
          return (
            <span key={idx} className="text-emerald-400 font-medium">
              {p}
            </span>
          )
        }
        return <React.Fragment key={idx}>{p}</React.Fragment>
      })}
    </>
  )
}
