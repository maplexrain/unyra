/**
 * 函数表达式里的分数次幂改写。
 *
 * 为什么要有这个模块：
 * 文档里的 ```plot 默认走 function-plot 的**区间采样器**（interval-arithmetic-eval），
 * 它对 `x^(1/3)` 这类分数次幂无能为力——最后落到 interval-arithmetic 的 pow 里，
 * 那里只接受整数指数，遇到 1/3 就 console.warn 一句
 * "power is not an integer, you should use nth-root instead" 并返回**空集**。
 *
 * 危害不只是刷屏（一次绘制 = 每个采样区间警告一次，宽度 640 的图约 1280 条）：
 * 空集在采样器里的含义是「这一段函数没定义」，于是**整条曲线一个点都不画**。
 * 用户文档里 `1.25-x+x^(1/3)` 那张图因此是全空的。
 *
 * 库自己在警告里给了答案（use nth-root），这里就照做：
 *   x^(1/3)  → nthRoot(x,3)
 *   x^(2/3)  → nthRoot(x,3)^(2)
 *   x^(-1/3) → nthRoot(x,3)^(-1)
 * nthRoot 在两条采样路径（区间库与 built-in-math-eval）里都实现了，而且奇数次方根
 * 支持负数，所以改完比原写法**更准**：负半轴的曲线也画得出来。
 *
 * 以下情形不改写（宁可留个警告，也不能把意思改错）：
 * - 整数指数：库自己算得了（含 x^(4/2) 这种）；
 * - 分母超过 MAX_ROOT：多半不是人写的分数，改出来又慢又没意义；
 * - 小数指数找不到足够接近的分数（例如 x^0.333，谁也不知道他想写的是不是 1/3）；
 * - 乘方链（两侧还有 ^）：^ 是右结合，改写一处会改掉整串的意思，例如 x^(1/3)^2。
 */

/** 分母上限：超过它说明指数不是「人写的分数」，不改写 */
const MAX_ROOT = 64
/** 小数指数与所取分数的允许误差（相对值） */
const RATIO_EPS = 1e-6

type Fraction = { p: number; q: number }
type Exponent = Fraction & { end: number }

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
const RATIONAL_RE = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/
/** 名字/数字字符：往前找底时用得上 */
const WORD_RE = /[A-Za-z0-9_.]/

/**
 * 把 index 上的表达式字段里所有能安全改写的分数次幂换成 nthRoot 形式。
 * 是纯函数：同一份文档每次渲染得到同样的结果，也方便单测。
 */
export function rewritePowers(expr: string): string {
  if (!expr.includes('^')) return expr
  let out = ''
  let cursor = 0
  let i = 0
  let changed = false
  while (i < expr.length) {
    if (expr[i] !== '^') {
      i += 1
      continue
    }
    const exp = readExponent(expr, i + 1)
    const base = exp ? readBase(expr, i) : null
    if (!exp || !base) {
      i += 1
      continue
    }
    // 乘方链：x^(1/3)^2 里那个 1/3 其实是 x 的指数之底，改写会改掉结合顺序
    if (nonSpaceAt(expr, exp.end) === '^' || nonSpaceBefore(expr, base.start - 1) === '^') {
      i = exp.end
      continue
    }
    out += expr.slice(cursor, base.start)
    out += rootText(expr.slice(base.start, base.end), exp)
    cursor = exp.end
    i = exp.end
    changed = true
  }
  return changed ? out + expr.slice(cursor) : expr
}

/**
 * 归一化 data 里的表达式字段（fn/x/y/r 与 derivative.fn）。
 * 只返回改了表达式的**新对象**，其余字段按原样带过去，输入不被改动。
 */
export function normalizePlotData<T>(data: T): T {
  if (!Array.isArray(data)) return data
  const out = data.map((item) => {
    if (!item || typeof item !== 'object') return item
    const datum = { ...(item as Record<string, unknown>) }
    for (const key of ['fn', 'x', 'y', 'r']) {
      const value = datum[key]
      if (typeof value === 'string') datum[key] = rewritePowers(value)
    }
    const derivative = datum.derivative
    if (derivative && typeof derivative === 'object') {
      const d = derivative as Record<string, unknown>
      if (typeof d.fn === 'string') datum.derivative = { ...d, fn: rewritePowers(d.fn) }
    }
    return datum
  })
  return out as unknown as T
}

/** nthRoot(base,q)^p 的写法；|p|<=1 时省掉多余的乘方 */
function rootText(base: string, exp: Exponent): string {
  const root = `nthRoot(${base},${exp.q})`
  return exp.p === 1 ? root : `${root}^(${exp.p})`
}

/** 读 ^ 右边那段指数文字；是整数、或认不出分数时返回 null（交给库自己处理） */
function readExponent(src: string, from: number): Exponent | null {
  const i = skipSpace(src, from)
  let text: string
  let end: number
  if (src[i] === '(') {
    const close = matchParen(src, i)
    if (close < 0) return null
    text = src.slice(i + 1, close)
    end = close + 1
  } else {
    const m = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/.exec(src.slice(i))
    if (!m) return null
    text = m[0]
    end = i + m[0].length
  }
  const frac = toFraction(text)
  return frac ? { ...frac, end } : null
}

/** 指数文字化成既约分数；整数（含 x^(4/2)）与认不出的都返回 null */
function toFraction(text: string): Fraction | null {
  const t = text.trim()
  const m = RATIONAL_RE.exec(t)
  let value: number
  if (m) {
    const den = Number(m[2])
    if (den === 0) return null
    value = Number(m[1]) / den
  } else if (NUMBER_RE.test(t)) {
    value = Number(t)
  } else {
    return null
  }
  if (!Number.isFinite(value) || Number.isInteger(value)) return null
  return approximate(value)
}

/** 用连分数找一个分母不超过 MAX_ROOT 的分数逼近 value；找不到返回 null */
function approximate(value: number): Fraction | null {
  const sign = value < 0 ? -1 : 1
  const v = Math.abs(value)
  // 收敛项的分子分母递推：h/k = a*h1+h2 / a*k1+k2
  let hm2 = 0
  let hm1 = 1
  let km2 = 1
  let km1 = 0
  let x = v
  for (let i = 0; i < 16; i += 1) {
    const a = Math.floor(x)
    const h = a * hm1 + hm2
    const k = a * km1 + km2
    if (k > MAX_ROOT) break
    hm2 = hm1
    hm1 = h
    km2 = km1
    km1 = k
    if (Math.abs(h / k - v) <= RATIO_EPS) return { p: sign * h, q: k }
    const rest = x - a
    if (rest <= Number.EPSILON) break
    x = 1 / rest
  }
  return null
}

/**
 * 找 ^ 左边那个「底」的范围：变量名、数字、函数调用 sin(x)、括号组 (1+x)。
 * 找不到（例如 `*` 直接挨着 ^）返回 null。
 */
function readBase(src: string, caret: number): { start: number; end: number } | null {
  let end = caret
  while (end > 0 && isSpace(src[end - 1])) end -= 1
  if (end === 0) return null
  let start: number
  if (src[end - 1] === ')') {
    const open = matchParenBack(src, end - 1)
    if (open < 0) return null
    start = open
  } else {
    if (!WORD_RE.test(src[end - 1])) return null
    start = end - 1
  }
  // 括号组前面可能是函数名（sin(...)），一起算进底里
  let j = start
  while (j > 0 && WORD_RE.test(src[j - 1])) j -= 1
  return { start: j, end }
}

/** 从 open 处的 '(' 往后找配对的 ')'，返回其下标；没配上返回 -1 */
function matchParen(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1
    else if (src[i] === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** 从 close 处的 ')' 往前找配对的 '('，返回其下标；没配上返回 -1 */
function matchParenBack(src: string, close: number): number {
  let depth = 0
  for (let i = close; i >= 0; i -= 1) {
    if (src[i] === ')') depth += 1
    else if (src[i] === '(') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function skipSpace(src: string, from: number): number {
  let i = from
  while (i < src.length && isSpace(src[i])) i += 1
  return i
}

/** from 起第一个非空白字符；到头返回空串 */
function nonSpaceAt(src: string, from: number): string {
  const i = skipSpace(src, from)
  return i < src.length ? src[i] : ''
}

/** index 起往前第一个非空白字符；到头返回空串 */
function nonSpaceBefore(src: string, index: number): string {
  let i = index
  while (i >= 0 && isSpace(src[i])) i -= 1
  return i >= 0 ? src[i] : ''
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
}
