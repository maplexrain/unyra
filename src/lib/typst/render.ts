/**
 * Typst 语法渲染器：
 * 将 Typst 标记语言（函数块、布局命令、标题、行内格式、列表、数学公式等）编译渲染为结构化 HTML，
 * 并结合 KaTeX 输出高质量出版级学术公式与讲义排版。
 */

import { sanitizeHtml } from '../sanitize'
import { convertTypstMathToLatex, escapeHtml, renderTypstMath } from './math'
import { findMatchingBracket } from './scanner'
import { renderTypstFunction } from './functions'

export { convertTypstMathToLatex, renderTypstMath, escapeHtml }

interface HeadingConfig {
  numbering: boolean
}

/** 渲染 Typst 行内样式 */
export function renderInlineTypst(text: string): string {
  let s = text

  // #raw("...") or #raw[...] (兼容原始引号与转义后的 &quot; / &#39;)
  s = s.replace(
    /#raw\(\s*(?:"|'|&quot;|&#39;)(.*?)(?:"|'|&quot;|&#39;)\s*\)/g,
    '<code class="typst-code font-mono text-[0.88em] px-1.5 py-0.5 rounded bg-line/50 text-seal font-semibold">$1</code>',
  )
  s = s.replace(
    /#raw\[(.*?)\]/g,
    '<code class="typst-code font-mono text-[0.88em] px-1.5 py-0.5 rounded bg-line/50 text-seal font-semibold">$1</code>',
  )

  // 行内代码 `code`
  s = s.replace(
    /`([^`\n]+)`/g,
    '<code class="typst-code font-mono text-[0.88em] px-1.5 py-0.5 rounded bg-line/50 text-seal font-semibold">$1</code>',
  )

  // 粗体 *bold*
  s = s.replace(/\*([^*\n]+?)\*/g, '<strong class="typst-bold font-bold text-ink-strong">$1</strong>')

  // 斜体 _italic_
  s = s.replace(/(^|[^a-zA-Z0-9_])_([^_]+?)_(?=$|[^a-zA-Z0-9_])/g, '$1<em class="typst-italic italic">$2</em>')

  // 删除线 ~strike~
  s = s.replace(
    /(^|[^a-zA-Z0-9_])~([^~\n]+?)~(?=$|[^a-zA-Z0-9_])/g,
    '$1<del class="line-through text-ink-faint">$2</del>',
  )

  // #underline[...]
  s = s.replace(/#underline\[(.*?)\]/g, '<span class="underline underline-offset-4 decoration-line-strong">$1</span>')

  // 双破折号转 em-dash
  s = s.replace(/--/g, '—')

  // 超链接
  s = s.replace(
    /\bhttps?:\/\/[^\s<>()]+/g,
    (url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-seal underline underline-offset-2 hover:text-seal-deep">${url}</a>`,
  )

  return s
}

/** 主渲染入口：将 Typst 源文本转化为出版级排版 HTML */
export function renderTypst(source: string): string {
  if (!source || !source.trim()) {
    return '<div class="typst-empty text-ink-faint text-[12px] italic p-4 text-center">空文档</div>'
  }

  const codeSlots: string[] = []
  const mathSlots: string[] = []
  const blockSlots: string[] = []
  const inlineSlots: string[] = []

  let text = source

  // 1. 占位保护多行代码块 ```lang ... ```
  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const slotIdx = codeSlots.length
    const slotKey = `@@@TYPST_CODE_SLOT_${slotIdx}@@@`
    const escapedCode = escapeHtml(code.trim())
    const langLabel = lang
      ? `<span class="typst-code-lang absolute top-2 right-2.5 text-[10px] font-mono uppercase text-ink-faint/80 select-none">${escapeHtml(
          lang,
        )}</span>`
      : ''
    codeSlots.push(
      `<div class="typst-code-block relative my-3.5 rounded-lg border border-line bg-paper/60 p-3.5 font-mono text-[12px] overflow-x-auto leading-relaxed text-ink shadow-2xs">${langLabel}<pre class="m-0 font-mono"><code>${escapedCode}</code></pre></div>`,
    )
    return slotKey
  })

  // 2. 占位保护数学公式
  // 独立多行块级数学公式 $ \n math \n $
  text = text.replace(/(^|\n)\$\s*\n([\s\S]*?)\n\s*\$(?=\n|$)/g, (_, prefix, math) => {
    const slotIdx = mathSlots.length
    const slotKey = `@@@TYPST_MATH_SLOT_${slotIdx}@@@`
    mathSlots.push(
      `<div class="typst-math-block my-3.5 flex justify-center overflow-x-auto py-1">${renderTypstMath(
        math,
        true,
      )}</div>`,
    )
    return prefix + slotKey
  })

  // 独立单行块级数学公式 $ math $（两端留有空格）
  text = text.replace(/(^|\n)\s*\$\s+([^\n$]+?)\s+\$(?=\n|$)/g, (_, prefix, math) => {
    const slotIdx = mathSlots.length
    const slotKey = `@@@TYPST_MATH_SLOT_${slotIdx}@@@`
    mathSlots.push(
      `<div class="typst-math-block my-3 flex justify-center overflow-x-auto py-1">${renderTypstMath(math, true)}</div>`,
    )
    return prefix + slotKey
  })

  // 行内数学公式 $math$（两端紧贴内容）
  text = text.replace(/\$([^\s$\n](?:[^$\n]*?[^\s$\n])?)\$/g, (_, math) => {
    const slotIdx = mathSlots.length
    const slotKey = `@@@TYPST_MATH_SLOT_${slotIdx}@@@`
    mathSlots.push(`<span class="typst-math-inline inline-block px-0.5">${renderTypstMath(math, false)}</span>`)
    return slotKey
  })

  // 3. 扫描处理 Typst 函数调用（#align, #block, #table, #text 等）与 #set 指令
  const headingConfig: HeadingConfig = { numbering: false }
  let i = 0
  let processed = ''

  const renderContext = {
    renderSub: (content: string) => renderTypstFragment(content, headingConfig),
    renderInline: (content: string) => renderInlineTypst(escapeHtml(content)),
  }

  while (i < text.length) {
    if (text[i] === '#' && (i === 0 || text[i - 1] !== '\\')) {
      const rest = text.slice(i + 1)
      const idMatch = rest.match(/^[a-zA-Z_][a-zA-Z0-9_.-]*/)
      if (idMatch) {
        const fnName = idMatch[0]
        let cursor = i + 1 + fnName.length

        // #set / #show 指令解析（如 #set heading(numbering: "1.")）
        if (fnName === 'set' || fnName === 'show') {
          const subRest = text.slice(cursor).trimStart()
          const subMatch = subRest.match(/^[a-zA-Z0-9_.-]+/)
          if (subMatch) {
            const subName = subMatch[0]
            const openP = text.indexOf('(', cursor)
            if (openP !== -1) {
              const closeP = findMatchingBracket(text, openP, '(', ')')
              if (closeP !== -1) {
                const args = text.slice(openP + 1, closeP)
                if (subName === 'heading' && args.includes('numbering')) {
                  headingConfig.numbering = true
                }
                i = closeP + 1
                continue
              }
            }
          }
        }

        // 参数匹配
        let args: string | null = null
        if (text[cursor] === '(') {
          const matchP = findMatchingBracket(text, cursor, '(', ')')
          if (matchP !== -1) {
            args = text.slice(cursor + 1, matchP)
            cursor = matchP + 1
          }
        }

        let spaceCursor = cursor
        while (spaceCursor < text.length && /[ \t\r\n]/.test(text[spaceCursor])) {
          spaceCursor++
        }

        // 内容块匹配
        let body: string | null = null
        if (text[spaceCursor] === '[') {
          const matchB = findMatchingBracket(text, spaceCursor, '[', ']')
          if (matchB !== -1) {
            body = text.slice(spaceCursor + 1, matchB)
            cursor = matchB + 1
          }
        }

        const isBlockFn = ['align', 'block', 'rect', 'table', 'grid'].includes(fnName)
        if (isBlockFn && (args !== null || body !== null)) {
          const slotIdx = blockSlots.length
          const slotKey = `@@@TYPST_BLOCK_SLOT_${slotIdx}@@@`
          const rendered = renderTypstFunction(fnName, args, body, renderContext)
          blockSlots.push(rendered)
          processed += '\n' + slotKey + '\n'
          i = cursor
          continue
        }

        if (args !== null || body !== null) {
          const slotIdx = inlineSlots.length
          const slotKey = `@@@TYPST_INLINE_SLOT_${slotIdx}@@@`
          const rendered = renderTypstFunction(fnName, args, body, renderContext)
          inlineSlots.push(rendered)
          processed += slotKey
          i = cursor
          continue
        }
      }
    }
    processed += text[i]
    i++
  }

  // 4. 逐行解析块级元素（标题、列表、引用、段落）
  const lines = processed.split(/\r?\n/)
  const out: string[] = []
  let inUl = false
  let inOl = false
  const counters = [0, 0, 0, 0, 0, 0]

  const closeLists = () => {
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) {
      closeLists()
      continue
    }

    if (/^@@@TYPST_(CODE|MATH|BLOCK)_SLOT_\d+@@@$/.test(trimmed)) {
      closeLists()
      out.push(trimmed)
      continue
    }

    // 标题：= / == / === / ====
    const hMatch = line.match(/^(=+)\s+(.+)$/)
    if (hMatch) {
      closeLists()
      const level = Math.min(6, hMatch[1].length)
      counters[level - 1]++
      for (let k = level; k < counters.length; k++) counters[k] = 0
      const prefix = headingConfig.numbering
        ? level === 1
          ? `${counters[0]}. `
          : `${counters.slice(0, level).join('.')}. `
        : ''
      const titleText = renderInlineTypst(escapeHtml(hMatch[2].trim()))
      const headingStyles: Record<number, string> = {
        1: 'typst-h1 text-[22px] font-black tracking-tight text-ink-strong border-b border-line/60 pb-2.5 mt-6 mb-3',
        2: 'typst-h2 text-[17px] font-bold text-ink-strong border-b border-line/40 pb-1.5 mt-5 mb-2.5',
        3: 'typst-h3 text-[14.5px] font-bold text-ink-strong mt-4 mb-2',
        4: 'typst-h4 text-[13px] font-semibold text-ink-soft mt-3 mb-1.5',
      }
      const cls = headingStyles[level] ?? 'text-[13px] font-bold mt-2 mb-1'
      out.push(`<h${level} class="${cls}">${prefix}${titleText}</h${level}>`)
      continue
    }

    // 有序列表：+ item
    const olMatch = line.match(/^\s*\+\s+(.+)$/)
    if (olMatch) {
      if (!inOl) {
        closeLists()
        out.push('<ol class="typst-ol my-2 list-decimal pl-5 space-y-1 text-[13px] text-ink leading-relaxed">')
        inOl = true
      }
      out.push(`<li>${renderInlineTypst(escapeHtml(olMatch[1].trim()))}</li>`)
      continue
    }

    // 无序列表：- item
    const ulMatch = line.match(/^\s*-\s+(.+)$/)
    if (ulMatch) {
      if (!inUl) {
        closeLists()
        out.push('<ul class="typst-ul my-2 list-disc pl-5 space-y-1 text-[13px] text-ink leading-relaxed">')
        inUl = true
      }
      out.push(`<li>${renderInlineTypst(escapeHtml(ulMatch[1].trim()))}</li>`)
      continue
    }

    // 术语定义列表：/ Term: Description
    const defMatch = line.match(/^\s*\/\s*([^:]+):\s*(.+)$/)
    if (defMatch) {
      closeLists()
      const term = renderInlineTypst(escapeHtml(defMatch[1].trim()))
      const desc = renderInlineTypst(escapeHtml(defMatch[2].trim()))
      out.push(
        `<dl class="typst-dl my-2 flex items-baseline gap-2 text-[13px]"><dt class="font-bold text-ink-strong">${term}:</dt><dd class="text-ink">${desc}</dd></dl>`,
      )
      continue
    }

    // 引用块：> quote
    const quoteMatch = line.match(/^\s*>\s*(.+)$/)
    if (quoteMatch) {
      closeLists()
      out.push(
        `<blockquote class="typst-quote my-2.5 border-l-3 border-seal/60 pl-3.5 italic text-[12.5px] text-ink-soft">${renderInlineTypst(
          escapeHtml(quoteMatch[1]),
        )}</blockquote>`,
      )
      continue
    }

    // 普通段落
    closeLists()
    out.push(
      `<p class="typst-p my-2 text-[13px] leading-[1.8] text-ink">${renderInlineTypst(escapeHtml(trimmed))}</p>`,
    )
  }
  closeLists()

  // 5. 还原全部插槽
  let finalHtml = out.join('\n')
  finalHtml = finalHtml.replace(/@@@TYPST_BLOCK_SLOT_(\d+)@@@/g, (_, id) => blockSlots[Number(id)] || '')
  finalHtml = finalHtml.replace(/@@@TYPST_INLINE_SLOT_(\d+)@@@/g, (_, id) => inlineSlots[Number(id)] || '')
  finalHtml = finalHtml.replace(/@@@TYPST_CODE_SLOT_(\d+)@@@/g, (_, id) => codeSlots[Number(id)] || '')
  finalHtml = finalHtml.replace(/@@@TYPST_MATH_SLOT_(\d+)@@@/g, (_, id) => mathSlots[Number(id)] || '')

  // 6. 安全过滤并包装 Typst 学术排版容器
  const fullHtml = `<div class="typst-document moji-typst-paper font-sans text-ink selection:bg-seal/20">${finalHtml}</div>`
  return sanitizeHtml(fullHtml)
}

/** 渲染嵌套在函数内容块内的局部片段 */
function renderTypstFragment(fragment: string, headingConfig: HeadingConfig): string {
  let text = fragment
  const renderContext = {
    renderSub: (content: string) => renderTypstFragment(content, headingConfig),
    renderInline: (content: string) => renderInlineTypst(escapeHtml(content)),
  }

  let i = 0
  let out = ''
  while (i < text.length) {
    if (text[i] === '#' && (i === 0 || text[i - 1] !== '\\')) {
      const rest = text.slice(i + 1)
      const idMatch = rest.match(/^[a-zA-Z_][a-zA-Z0-9_.-]*/)
      if (idMatch) {
        const fnName = idMatch[0]
        let cursor = i + 1 + fnName.length

        let args: string | null = null
        if (text[cursor] === '(') {
          const matchP = findMatchingBracket(text, cursor, '(', ')')
          if (matchP !== -1) {
            args = text.slice(cursor + 1, matchP)
            cursor = matchP + 1
          }
        }

        let spaceCursor = cursor
        while (spaceCursor < text.length && /[ \t\r\n]/.test(text[spaceCursor])) {
          spaceCursor++
        }

        let body: string | null = null
        if (text[spaceCursor] === '[') {
          const matchB = findMatchingBracket(text, spaceCursor, '[', ']')
          if (matchB !== -1) {
            body = text.slice(spaceCursor + 1, matchB)
            cursor = matchB + 1
          }
        }

        if (args !== null || body !== null) {
          out += renderTypstFunction(fnName, args, body, renderContext)
          i = cursor
          continue
        }
      }
    }
    out += text[i]
    i++
  }

  return renderInlineTypst(out)
}
