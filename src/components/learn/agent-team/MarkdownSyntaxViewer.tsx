/**
 * Markdown 语法高亮查看器（MarkdownSyntaxViewer）
 *
 * 核心要求：
 * 1. 【不是解析渲染成 HTML 元素，仅语法高亮】：保留 Markdown 源代码的全部符号、
 *    空格、缩进和换行，像代码编辑器一样对标题符号（#）、列表符号（- / 1.）、
 *    加粗（**）、斜体（*）、行内代码（`）、围栏代码块（```）、引用（>）、
 *    方括号标签（【…】）等进行语法着色。
 * 2. 提升字体大小（text-[13px] ~ text-[13.5px]）与行距，保证清晰易读。
 * 3. 纯 React 节点渲染，无 XSS 隐患，复制时保持纯净 Markdown 文本。
 */

import React, { useMemo } from 'react'

interface MarkdownSyntaxViewerProps {
  /** 待高亮的 Markdown 纯文本 */
  content: string
  className?: string
}

/** 转义特殊字符生成安全的 key */
function hashKey(prefix: string, index: number, extra = ''): string {
  return `${prefix}-${index}-${extra.slice(0, 12)}`
}

/** 行内语法高亮解析器：将一行文本中的各种 Markdown 标记切分为带有色彩样式的 ReactNode 列表 */
function renderInlineMarkdown(text: string, lineKeyPrefix: string): React.ReactNode[] {
  if (!text) return [text]

  const nodes: React.ReactNode[] = []
  // 正则匹配：
  // 1. 【...】或 🚨...🚨 提示词特色高权标记
  // 2. `...` 行内代码
  // 3. **...** 粗体
  // 4. *...* 斜体
  // 5. [...](...) 链接
  // 6. <tag ...> HTML标签
  const inlineRegex =
    /(🚨+|【[^】]+】|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|<\/?[a-zA-Z][^>]*>)/g

  let lastIndex = 0
  let match: RegExpExecArray | null
  let count = 0

  while ((match = inlineRegex.exec(text)) !== null) {
    const matchIndex = match.index
    const matchedStr = match[0]

    // 匹配项之前的纯文本
    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex))
    }

    const key = `${lineKeyPrefix}-inline-${count++}`

    if (matchedStr.startsWith('🚨')) {
      // 警示红线符号
      nodes.push(
        <span key={key} className="text-rose-500 font-bold select-none">
          {matchedStr}
        </span>,
      )
    } else if (matchedStr.startsWith('【') && matchedStr.endsWith('】')) {
      // 【...】高权重提示词分节标记
      nodes.push(
        <span
          key={key}
          className="font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/10 px-1 py-0.5 rounded"
        >
          {matchedStr}
        </span>,
      )
    } else if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      // `code` 行内代码
      const codeContent = matchedStr.slice(1, -1)
      nodes.push(
        <span key={key} className="font-mono text-teal-600 dark:text-teal-400 bg-paper-deep/70 dark:bg-card/80 px-1 py-0.5 rounded border border-line/50">
          <span className="text-ink-faint select-none">`</span>
          {codeContent}
          <span className="text-ink-faint select-none">`</span>
        </span>,
      )
    } else if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
      // **bold** 粗体
      const boldContent = matchedStr.slice(2, -2)
      nodes.push(
        <span key={key} className="font-bold text-ink-strong">
          <span className="text-ink-faint font-normal select-none">**</span>
          {boldContent}
          <span className="text-ink-faint font-normal select-none">**</span>
        </span>,
      )
    } else if (matchedStr.startsWith('*') && matchedStr.endsWith('*')) {
      // *italic* 斜体
      const italicContent = matchedStr.slice(1, -1)
      nodes.push(
        <span key={key} className="italic text-ink">
          <span className="text-ink-faint not-italic select-none">*</span>
          {italicContent}
          <span className="text-ink-faint not-italic select-none">*</span>
        </span>,
      )
    } else if (matchedStr.startsWith('[') && matchedStr.includes('](')) {
      // [text](url) 链接
      const splitIdx = matchedStr.indexOf('](')
      const label = matchedStr.slice(1, splitIdx)
      const url = matchedStr.slice(splitIdx + 2, -1)
      nodes.push(
        <span key={key}>
          <span className="text-ink-faint select-none">[</span>
          <span className="text-blue-500 underline underline-offset-2">{label}</span>
          <span className="text-ink-faint select-none">](</span>
          <span className="text-ink-faint text-[0.9em]">{url}</span>
          <span className="text-ink-faint select-none">)</span>
        </span>,
      )
    } else if (matchedStr.startsWith('<') && matchedStr.endsWith('>')) {
      // HTML 标签片段
      nodes.push(
        <span key={key} className="font-mono text-purple-600 dark:text-purple-400">
          {matchedStr}
        </span>,
      )
    } else {
      nodes.push(matchedStr)
    }

    lastIndex = matchIndex + matchedStr.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

export function MarkdownSyntaxViewer({ content, className = '' }: MarkdownSyntaxViewerProps) {
  const lines = useMemo(() => content.split('\n'), [content])

  return (
    <pre
      tabIndex={0}
      className={`max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.8] text-ink-soft select-text outline-none p-4 rounded-b-lg ${className}`}
    >
      <code>
        {(() => {
          let inCodeBlock = false

          return lines.map((line, idx) => {
            const lineKey = hashKey('line', idx, line)

            // 检查代码围栏 ```
            const fenceMatch = line.match(/^(\s*)(```+)([\w-]*)(.*)$/)
            if (fenceMatch) {
              const [, indent, fence, lang, rest] = fenceMatch
              if (!inCodeBlock) {
                inCodeBlock = true
                return (
                  <div key={lineKey} className="text-ink-faint bg-paper-deep/40 -mx-2 px-2 py-0.5 rounded-t">
                    <span>{indent}</span>
                    <span className="text-seal/80 font-bold select-none">{fence}</span>
                    {lang && <span className="text-amber-600 dark:text-amber-400 font-semibold ml-1">{lang}</span>}
                    {rest && <span>{rest}</span>}
                    {'\n'}
                  </div>
                )
              } else {
                inCodeBlock = false
                return (
                  <div key={lineKey} className="text-ink-faint bg-paper-deep/40 -mx-2 px-2 py-0.5 rounded-b mb-1">
                    <span>{indent}</span>
                    <span className="text-seal/80 font-bold select-none">{fence}</span>
                    {lang && <span>{lang}</span>}
                    {rest && <span>{rest}</span>}
                    {'\n'}
                  </div>
                )
              }
            }

            // 如果在代码块内部
            if (inCodeBlock) {
              return (
                <div key={lineKey} className="bg-paper-deep/40 -mx-2 px-2 text-sky-600 dark:text-sky-300">
                  {line}
                  {'\n'}
                </div>
              )
            }

            // 空行
            if (!line.trim()) {
              return (
                <div key={lineKey} className="h-4">
                  {line}
                  {'\n'}
                </div>
              )
            }

            // 1. 标题语法 (# ~ ######)
            const headingMatch = line.match(/^(\s*)(#{1,6})(\s+)(.*)$/)
            if (headingMatch) {
              const [, indent, hashes, space, text] = headingMatch
              const level = hashes.length
              const isH1 = level === 1
              const isH2 = level === 2

              return (
                <div
                  key={lineKey}
                  className={`flex flex-wrap items-baseline mt-2 mb-1 ${
                    isH1 ? 'text-[15px]' : isH2 ? 'text-[14px]' : 'text-[13.5px]'
                  }`}
                >
                  <span>{indent}</span>
                  <span className="font-bold text-amber-500 dark:text-amber-400 select-none">
                    {hashes}
                  </span>
                  <span>{space}</span>
                  <span className="font-bold text-ink-strong">
                    {renderInlineMarkdown(text, lineKey)}
                  </span>
                  {'\n'}
                </div>
              )
            }

            // 2. 引用块 (> ...)
            const quoteMatch = line.match(/^(\s*)(>+)(\s*)(.*)$/)
            if (quoteMatch) {
              const [, indent, quotes, space, text] = quoteMatch
              return (
                <div key={lineKey} className="border-l-2 border-seal/40 pl-2 text-ink-soft bg-seal/5 py-0.5 my-0.5 rounded-r">
                  <span>{indent}</span>
                  <span className="text-seal/60 font-bold select-none">{quotes}</span>
                  <span>{space}</span>
                  <span>{renderInlineMarkdown(text, lineKey)}</span>
                  {'\n'}
                </div>
              )
            }

            // 3. 分割线 (--- / *** / ___)
            if (/^\s*[-*_]{3,}\s*$/.test(line)) {
              return (
                <div key={lineKey} className="py-2">
                  <div className="h-px bg-line-strong/60 w-full" />
                  {'\n'}
                </div>
              )
            }

            // 4. 无序列表 (- / * / +)
            const ulistMatch = line.match(/^(\s*)([-*+])(\s+)(.*)$/)
            if (ulistMatch) {
              const [, indent, bullet, space, text] = ulistMatch
              return (
                <div key={lineKey} className="flex items-baseline">
                  <span>{indent}</span>
                  <span className="text-seal/80 font-bold select-none">{bullet}</span>
                  <span>{space}</span>
                  <div className="flex-1">{renderInlineMarkdown(text, lineKey)}</div>
                  {'\n'}
                </div>
              )
            }

            // 5. 有序列表 (1. / 2.)
            const olistMatch = line.match(/^(\s*)(\d+\.)(\s+)(.*)$/)
            if (olistMatch) {
              const [, indent, num, space, text] = olistMatch
              return (
                <div key={lineKey} className="flex items-baseline">
                  <span>{indent}</span>
                  <span className="text-seal font-medium select-none tabular-nums">{num}</span>
                  <span>{space}</span>
                  <div className="flex-1">{renderInlineMarkdown(text, lineKey)}</div>
                  {'\n'}
                </div>
              )
            }

            // 普通段落行（带行内语法解析）
            return (
              <div key={lineKey} className="text-ink-soft">
                {renderInlineMarkdown(line, lineKey)}
                {'\n'}
              </div>
            )
          })
        })()}
      </code>
    </pre>
  )
}
