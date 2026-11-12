/**
 * 这个文件负责什么：教学正文落盘前的「公式损坏」校验（issue #198）。
 *
 * 为什么需要它：Agent 在 execute 脚本里常用普通模板字符串装整篇正文。LaTeX 只写单反斜杠时，
 * JavaScript 会先按转义表吃一遍：\t → 制表符、\f → 换页符、\b → 退格、\r → 回车，
 * 其余不认识的转义（\a、\m、\approx）直接丢掉反斜杠。等 editContent 收到字符串时公式已经坏了。
 * 更麻烦的是 KaTeX 对裸命令不报错——approx 会被当成 a·p·p·r·o·x 静默渲染，
 * 学习者看到的是 Fapprox1170 而不是一条错误，坏数据就这样悄悄落盘。
 *
 * 这里在提交 store 之前按「高置信度指纹」拦一道：命中就返回人话错误、正文原样不动，
 * 让 Agent 当场重写。判断刻意保守——宁可漏报，也不能误伤正常正文、代码块和 \text{…} 里的散文。
 */

/** 除 \t、\n、\r 之外的 C0 控制字符与 DEL：正常教学正文里不该出现 */
// eslint-disable-next-line no-control-regex -- 控制字符正是要挡掉的东西，这里的匹配是有意的
const HARD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** 孤立回车：\r\n 是正常换行，单独一个 \r 多半是 \rho 被吃掉了反斜杠 */
const BARE_CR = /\r(?!\n)/g

/**
 * 公式里裸出现就几乎只能是「反斜杠被 JS 吃掉」的命令。
 * 刻意不收 text / times / left / right / begin / end 这类英文常用词——它们会出现在 \text{…} 的散文里，
 * 收进来就会误伤；其中 \text 与 \times 的损坏形态是制表符，由下面的 TAB 检查兜住。
 */
const NAKED_COMMANDS = [
  // 结构
  'frac', 'dfrac', 'tfrac', 'sqrt',
  // 字体
  'mathbf', 'mathrm', 'mathbb', 'mathcal', 'mathit', 'mathsf', 'mathtt',
  'textbf', 'textit', 'textrm', 'textsf', 'texttt',
  // 关系与符号
  'approx', 'neq', 'leq', 'geq', 'cdot', 'cdots', 'infty', 'nabla',
  'overline', 'underline', 'widehat', 'widetilde', 'overrightarrow',
  'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow',
  'mapsto', 'emptyset', 'varnothing', 'propto', 'perp', 'parallel',
  // 排版
  'displaystyle', 'qquad', 'hspace', 'vspace', 'binom', 'pmod', 'bmod',
  'operatorname', 'overset', 'underset', 'stackrel', 'boxed',
] as const

const NAKED_COMMAND_RE = new RegExp(
  String.raw`(?<![\\A-Za-z])(?:${NAKED_COMMANDS.join('|')})(?![A-Za-z])`,
  'g',
)

/** 公式里这些命令的参数是散文（自然语言），里面的英文单词不参与「裸命令」判断 */
const TEXT_GROUP_OPEN = /\\(?:text|textbf|textit|textrm|textsf|texttt|operatorname)\{/y

/** 一条疑似损坏：行号 + 人话原因 + 附近原文（控制字符已可视化） */
export interface LatexFinding {
  line: number
  reason: string
  snippet: string
}

const VISIBLE_CONTROL: Record<number, string> = {
  0x00: '[NUL]',
  0x07: '[BEL]',
  0x08: '[BS]',
  0x09: '[TAB]',
  0x0b: '[VT]',
  0x0c: '[FF]',
  0x0d: '[CR]',
  0x1b: '[ESC]',
  0x7f: '[DEL]',
}

function hex(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0')
}

function controlReason(code: number): string {
  switch (code) {
    case 0x08:
      return '出现退格符 [BS]——多半是 \\beta、\\begin 的 \\b 被 JavaScript 当成退格'
    case 0x09:
      return '公式里出现制表符 [TAB]——多半是 \\text、\\times、\\theta、\\tau 的 \\t 被当成制表符'
    case 0x0b:
      return '出现垂直制表符 [VT]——多半是 \\vec、\\varphi 的 \\v 被当成转义'
    case 0x0c:
      return '出现换页符 [FF]——多半是 \\frac、\\phi 的 \\f 被当成换页符'
    case 0x0d:
      return '出现孤立的回车 [CR]——多半是 \\rho 的 \\r 被当成回车'
    default:
      return `出现控制字符 [U+${hex(code)}]`
  }
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** 取命中点附近的原文，把换行与控制字符换成可读标记——错误信息要能让 Agent 一眼定位 */
function snippetAt(text: string, index: number, radius = 24): string {
  const from = Math.max(0, index - radius)
  const to = Math.min(text.length, index + radius)
  // eslint-disable-next-line no-control-regex -- 这里就是要把控制字符换成可读标记
  return text.slice(from, to).replace(/[\u0000-\u001f\u007f]/g, (c) => {
    const code = c.charCodeAt(0)
    if (code === 10) return '⏎'
    return VISIBLE_CONTROL[code] ?? `[U+${hex(code)}]`
  })
}

/**
 * 把围栏代码块与行内代码替换成等长空白：代码里的 $、\t、approx 是代码，不是公式。
 * 等长替换保证下标仍能换算回原文行号。
 */
function maskCode(text: string): string {
  let fence: { ch: string; len: number } | null = null
  return text
    .split('\n')
    .map((line) => {
      if (fence) {
        const close = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
        if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null
        return ' '.repeat(line.length)
      }
      const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line)
      if (open) {
        fence = { ch: open[1][0], len: open[1].length }
        return ' '.repeat(line.length)
      }
      return line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
    })
    .join('\n')
}

interface MathSpan {
  /** 公式正文在原文里的起止（不含定界符） */
  start: number
  end: number
}

/** 找 $$…$$、$…$、\(…\)、\[…\] 四种定界符围出来的公式正文 */
function findMathSpans(src: string): MathSpan[] {
  const spans: MathSpan[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      const n = src[i + 1]
      if (n === '(' || n === '[') {
        const close = n === '(' ? '\\)' : '\\]'
        const end = src.indexOf(close, i + 2)
        if (end !== -1) {
          spans.push({ start: i + 2, end })
          i = end + 2
          continue
        }
      }
      i += 2
      continue
    }
    if (c !== '$') {
      i++
      continue
    }
    if (src[i - 1] === '\\') {
      i++
      continue
    }
    if (src[i + 1] === '$') {
      const end = src.indexOf('$$', i + 2)
      if (end === -1) {
        i += 2
        continue
      }
      spans.push({ start: i + 2, end })
      i = end + 2
      continue
    }
    // 行内公式不跨行；闭合符不能是被转义的 \$
    const nl = src.indexOf('\n', i + 1)
    let end = src.indexOf('$', i + 1)
    while (end !== -1 && src[end - 1] === '\\') end = src.indexOf('$', end + 1)
    if (end === -1 || (nl !== -1 && end > nl)) {
      i++
      continue
    }
    spans.push({ start: i + 1, end })
    i = end + 1
  }
  return spans
}

/** 把 \text{…} / \operatorname{…} 等散文参数抹成等长空白，保留下标 */
function stripTextGroups(body: string): string {
  const out = body.split('')
  let i = 0
  while (i < body.length) {
    TEXT_GROUP_OPEN.lastIndex = i
    const m = TEXT_GROUP_OPEN.exec(body)
    if (!m) {
      i++
      continue
    }
    let depth = 0
    let j = i + m[0].length - 1
    for (; j < body.length; j++) {
      if (body[j] === '{') depth++
      else if (body[j] === '}') {
        depth--
        if (depth === 0) {
          j++
          break
        }
      }
    }
    for (let k = i; k < j; k++) out[k] = ' '
    i = j
  }
  return out.join('')
}

/** 一条坏公式往往同时命中多个指纹；留一点余量就够说明问题，也避免病态正文把扫描拖成 O(n²) */
const MAX_FINDINGS = 20

/** 扫出全部疑似损坏；空数组表示没看出问题 */
export function findLatexDamage(teaching: string): LatexFinding[] {
  const findings: LatexFinding[] = []
  const add = (index: number, reason: string) => {
    if (findings.length >= MAX_FINDINGS) return
    findings.push({ line: lineOf(teaching, index), reason, snippet: snippetAt(teaching, index) })
  }

  for (const m of teaching.matchAll(HARD_CONTROL)) {
    const index = m.index ?? 0
    add(index, controlReason(teaching.charCodeAt(index)))
  }
  for (const m of teaching.matchAll(BARE_CR)) add(m.index ?? 0, controlReason(0x0d))

  const masked = maskCode(teaching)
  for (const span of findMathSpans(masked)) {
    const cleaned = stripTextGroups(masked.slice(span.start, span.end))
    for (let k = 0; k < cleaned.length; k++) {
      if (cleaned.charCodeAt(k) === 0x09) add(span.start + k, controlReason(0x09))
    }
    NAKED_COMMAND_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = NAKED_COMMAND_RE.exec(cleaned))) {
      add(
        span.start + m.index,
        `公式里的 ${m[0]} 没写反斜杠（裸命令）——渲染器会把它当成一串字母相乘，多半是 \\${m[0]} 的反斜杠被吃掉了`,
      )
    }
  }

  findings.sort((a, b) => a.line - b.line)
  return findings
}

/**
 * 给 editContent 用的错误文案：没问题返回 null，有问题返回可直接展示给 Agent 的整段说明。
 */
export function latexDamageError(teaching: string): string | null {
  const findings = findLatexDamage(teaching)
  if (!findings.length) return null
  const shown = findings.slice(0, 3).map((f) => `• 第 ${f.line} 行：${f.reason}\n  附近原文：${f.snippet}`)
  const more = findings.length > shown.length ? `\n…另有 ${findings.length - shown.length} 处同类问题。` : ''
  return [
    `正文未写入：检测到 ${findings.length} 处疑似公式损坏。`,
    ...shown,
    more,
    '修法：在 execute 脚本里用 String.raw`…` 包住正文（模板里的反引号写成 \\`、美元加大括号写成 \\${），',
    '或者把 LaTeX 的每个反斜杠都双写成 \\\\；改完重新调用 editContent。',
  ]
    .filter(Boolean)
    .join('\n')
}
