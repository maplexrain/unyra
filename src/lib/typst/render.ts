/**
 * Typst 语法渲染器：
 * 将 Typst 标记语言（标题、行内格式、列表、函数块、数学公式等）编译渲染为结构化 HTML，
 * 并结合 KaTeX 输出高质量出版级学术公式与讲义排版。
 */

import katex from 'katex'
import { sanitizeHtml } from '../sanitize'

/** 将 Typst 风格的数学表达式转为 LaTeX/KaTeX 语法 */
export function convertTypstMathToLatex(math: string): string {
  let s = math.trim()

  // 转换 Typst 分组括号为 LaTeX 花括号：_ (expr) -> _{expr}, ^ (expr) -> ^{expr}
  s = s.replace(/_\s*\(([^()]+)\)/g, '_{$1}')
  s = s.replace(/\^\s*\(([^()]+)\)/g, '^{$1}')

  // 1. 常见符号与希腊字母对照
  const symbols: Array<[RegExp, string]> = [
    [/\b(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)\b/g, '\\$1'],
    [/\b(Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)\b/g, '\\$1'],
    [/\b(infinity|oo)\b/g, '\\infty'],
    [/\b(approx)\b/g, '\\approx'],
    [/\b(equiv)\b/g, '\\equiv'],
    [/\b(propto)\b/g, '\\propto'],
    [/\b(times)\b/g, '\\times'],
    [/\b(cdot|dot)\b/g, '\\cdot'],
    [/\b(div)\b/g, '\\div'],
    [/\b(plus\.minus|pm)\b/g, '\\pm'],
    [/\b(mp)\b/g, '\\mp'],
    [/\b(nabla)\b/g, '\\nabla'],
    [/\b(partial)\b/g, '\\partial'],
    [/\b(forall)\b/g, '\\forall'],
    [/\b(exists)\b/g, '\\exists'],
    [/\b(in)\b/g, '\\in'],
    [/\b(subset)\b/g, '\\subset'],
    [/\b(supset)\b/g, '\\supset'],
    [/\b(cap)\b/g, '\\cap'],
    [/\b(cup)\b/g, '\\cup'],
    [/!=|\beq\.not\b/g, '\\neq'],
    [/<=|\ble\b/g, '\\le'],
    [/>=|\bge\b/g, '\\ge'],
    [/<<|\bll\b/g, '\\ll'],
    [/>>|\bgg\b/g, '\\gg'],
    [/<==>|<=>/g, '\\iff'],
    [/==>|=>/g, '\\implies'],
    [/-->|->/g, '\\to'],
    [/<--|<-/g, '\\leftarrow'],
    [/\b(sqrt)\s*\(([^()]+)\)/g, '\\sqrt{$2}'],
    [/\b(frac)\s*\(([^(),]+),\s*([^()]+)\)/g, '\\frac{$2}{$3}'],
    [/\b(sum)\s*_\s*([^\s^]+)\s*\^\s*([^\s]+)/g, '\\sum_{$2}^{$3}'],
    [/\b(sum)\s*_\s*\(([^()]+)\)/g, '\\sum_{$2}'],
    [/\b(sum)\s*_\s*([^\s^]+)/g, '\\sum_{$2}'],
    [/\b(sum)\b/g, '\\sum'],
    [/\b(prod|product)\s*_\s*([^\s^]+)\s*\^\s*([^\s]+)/g, '\\prod_{$2}^{$3}'],
    [/\b(prod|product)\b/g, '\\prod'],
    [/\b(int|integral)\s*_\s*([^\s^]+)\s*\^\s*([^\s]+)/g, '\\int_{$2}^{$3}'],
    [/\b(int|integral)\b/g, '\\int'],
    [/\b(lim)\s*_\s*\(([^()]+)\)/g, '\\lim_{$2}'],
    [/\b(lim)\s*_\s*([^\s]+)/g, '\\lim_{$2}'],
  ]

  for (const [pattern, repl] of symbols) {
    s = s.replace(pattern, repl)
  }

  // 括号除法换算：形如 (a) / (b) -> \frac{a}{b}
  s = s.replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, '\\frac{$1}{$2}')
  // 简易除法：形如 a / b -> \frac{a}{b}
  s = s.replace(/([a-zA-Z0-9_\\]+)\s*\/\s*([a-zA-Z0-9_\\]+)/g, '\\frac{$1}{$2}')

  return s
}

/** 渲染 Typst 单个数学公式 */
function renderTypstMath(formula: string, displayMode: boolean): string {
  try {
    const latex = convertTypstMathToLatex(formula)
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
    })
  } catch {
    return `<span class="typst-math-fallback font-mono text-[12px] text-seal">${escapeHtml(formula)}</span>`
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 渲染 Typst 行内样式 */
function renderInlineTypst(text: string): string {
  let s = text
  // 粗体 *bold*
  s = s.replace(/\*([^*\n]+)\*/g, '<strong class="typst-bold font-bold text-ink-strong">$1</strong>')
  // 斜体 _italic_
  s = s.replace(/\b_([^_]+)_\b/g, '<em class="typst-italic italic">$1</em>')
  // 行内代码 `code`
  s = s.replace(/`([^`\n]+)`/g, '<code class="typst-code font-mono text-[0.88em] px-1.5 py-0.5 rounded bg-line/50 text-seal font-semibold">$1</code>')
  // 删除线 ~strike~
  s = s.replace(/~([^~\n]+)~/g, '<del class="line-through text-ink-faint">$1</del>')
  // #underline[...]
  s = s.replace(/#underline\[(.*?)\]/g, '<span class="underline underline-offset-4 decoration-line-strong">$1</span>')
  // 超链接
  s = s.replace(/\bhttps?:\/\/[^\s<>()]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-seal underline underline-offset-2 hover:text-seal-deep">${url}</a>`)
  return s
}

/** 主渲染入口：将 Typst 源文本转化为出版级排版 HTML */
export function renderTypst(source: string): string {
  if (!source || !source.trim()) {
    return '<div class="typst-empty text-ink-faint text-[12px] italic p-4 text-center">空文档</div>'
  }

  // 1. 占位保护表
  const mathSlots: string[] = []
  const codeSlots: string[] = []

  let processed = source

  // 提取多行代码块 ```lang ... ```
  processed = processed.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const slotIdx = codeSlots.length
    const slotKey = `@@@TYPST_CODE_SLOT_${slotIdx}@@@`
    const escapedCode = escapeHtml(code.trim())
    const langLabel = lang ? `<span class="typst-code-lang absolute top-2 right-2.5 text-[10px] font-mono uppercase text-ink-faint/80 select-none">${escapeHtml(lang)}</span>` : ''
    codeSlots.push(
      `<div class="typst-code-block relative my-3.5 rounded-lg border border-line bg-paper/60 p-3.5 font-mono text-[12px] overflow-x-auto leading-relaxed text-ink shadow-2xs">${langLabel}<pre class="m-0 font-mono"><code>${escapedCode}</code></pre></div>`,
    )
    return slotKey
  })

  // 提取独立块级数学公式 $ math $（按 Typst 规范：两端有空格或换行，通常占独立行）
  processed = processed.replace(/(^|\n)\$\s*\n([\s\S]*?)\n\s*\$(?=\n|$)/g, (_, prefix, math) => {
    const slotIdx = mathSlots.length
    const slotKey = `@@@TYPST_MATH_SLOT_${slotIdx}@@@`
    mathSlots.push(`<div class="typst-math-block my-3.5 flex justify-center overflow-x-auto py-1">${renderTypstMath(math, true)}</div>`)
    return prefix + slotKey
  })

  processed = processed.replace(/(^|\n)\s*\$\s+([^\n$]+?)\s+\$(?=\n|$)/g, (_, prefix, math) => {
    const slotIdx = mathSlots.length
    const slotKey = `@@@TYPST_MATH_SLOT_${slotIdx}@@@`
    mathSlots.push(`<div class="typst-math-block my-3 flex justify-center overflow-x-auto py-1">${renderTypstMath(math, true)}</div>`)
    return prefix + slotKey
  })

  // 提取行内数学公式 $math$（两端紧贴内容，无空白）
  processed = processed.replace(/\$([^\s$\n](?:[^$\n]*?[^\s$\n])?)\$/g, (_, math) => {
    const slotIdx = mathSlots.length
    const slotKey = `@@@TYPST_MATH_SLOT_${slotIdx}@@@`
    mathSlots.push(`<span class="typst-math-inline inline-block px-0.5">${renderTypstMath(math, false)}</span>`)
    return slotKey
  })

  // 2. 逐行解析块级元素
  const lines = processed.split(/\r?\n/)
  const out: string[] = []
  let inUl = false
  let inOl = false

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // 注释行忽略
    if (trimmed.startsWith('//')) continue

    // 空行
    if (!trimmed) {
      closeLists()
      continue
    }

    // 检查插槽单行
    if (/^@@@TYPST_(CODE|MATH)_SLOT_\d+@@@$/.test(trimmed)) {
      closeLists()
      out.push(trimmed)
      continue
    }

    // 标题：= / == / === / ====
    const headingMatch = line.match(/^(=+)\s+(.+)$/)
    if (headingMatch) {
      closeLists()
      const level = Math.min(6, headingMatch[1].length)
      const text = renderInlineTypst(escapeHtml(headingMatch[2].trim()))
      const headingStyles: Record<number, string> = {
        1: 'typst-h1 text-[22px] font-black tracking-tight text-ink-strong border-b border-line/60 pb-2.5 mt-6 mb-3',
        2: 'typst-h2 text-[17px] font-bold text-ink-strong border-b border-line/40 pb-1.5 mt-5 mb-2.5',
        3: 'typst-h3 text-[14.5px] font-bold text-ink-strong mt-4 mb-2',
        4: 'typst-h4 text-[13px] font-semibold text-ink-soft mt-3 mb-1.5',
      }
      const cls = headingStyles[level] ?? 'text-[13px] font-bold mt-2 mb-1'
      out.push(`<h${level} class="${cls}">${text}</h${level}>`)
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
      out.push(`<li>${renderInlineTypst(escapeHtml(ulMatch[1]))}</li>`)
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
      out.push(`<li>${renderInlineTypst(escapeHtml(olMatch[1]))}</li>`)
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

    // Typst 引用块：> quote
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

    // Typst 内置 callout 块：#rect[...] / #block[...]
    const blockMatch = line.match(/^#(rect|block)(\([^)]*\))?\[([\s\S]*?)\]$/)
    if (blockMatch) {
      closeLists()
      out.push(
        `<div class="typst-callout my-3 rounded-lg border border-line-strong/40 bg-paper/50 p-3 text-[12.5px] leading-relaxed text-ink shadow-2xs">${renderInlineTypst(
          escapeHtml(blockMatch[3]),
        )}</div>`,
      )
      continue
    }

    // 普通段落
    closeLists()
    out.push(`<p class="typst-p my-2 text-[13px] leading-[1.8] text-ink">${renderInlineTypst(escapeHtml(line))}</p>`)
  }

  closeLists()

  // 3. 还原插槽
  let html = out.join('\n')

  html = html.replace(/@@@TYPST_CODE_SLOT_(\d+)@@@/g, (_, idx) => codeSlots[Number(idx)] ?? '')
  html = html.replace(/@@@TYPST_MATH_SLOT_(\d+)@@@/g, (_, idx) => mathSlots[Number(idx)] ?? '')

  // 4. 安全过滤并包装 Typst 学术排版容器
  const fullHtml = `<div class="typst-document moji-typst-paper font-sans text-ink selection:bg-seal/20">${html}</div>`
  return sanitizeHtml(fullHtml)
}
