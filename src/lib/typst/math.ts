import katex from 'katex'

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
export function renderTypstMath(formula: string, displayMode: boolean): string {
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

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
