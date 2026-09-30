/**
 * 工具气泡（execute）要显示的那点东西：把参数与结果整理成人能读的样子。
 *
 * 为什么单独一层：这三件事都是**纯字符串变换**，与 React、与沙箱都无关，
 * 因此可以在 node 里逐条钉住（见 tests/toolView.test.ts）——而它们恰好是最容易
 * 出细节错的地方（少切一段注释、把字符串里的分号当成语句结尾，界面看着都"差不多"）。
 *
 * 三件事：
 * 1. executeArgs —— 从（可能还在流式接收中的）参数 JSON 里取出 body 与 description；
 * 2. formatJs    —— 把那段 JS 排成人看的样子；
 * 3. toolResultView —— 把结果拆成「正文 + 前后两段元信息」，元信息在界面上渲染成注释。
 */

/* ---------- 参数 ---------- */

export interface ExecuteArgs {
  /** 这一步要做什么，一句人话（气泡标题用它，不重复显示在正文里） */
  description: string
  /** 那段 JS 源码 */
  body: string
}

/**
 * 从一段**可能不完整**的 JSON 里抠出某个字符串字段（流式过程中参数是一点点长出来的）。
 *
 * 两种收尾都要认：收全了有收尾引号；没收完时值一直延伸到输入末尾——而且很可能
 * 正停在一个**没写完的转义符**上（一个孤零零的反斜杠收尾），那半个转义也得吃掉，
 * 否则整条匹配当场作废，界面上就是一片空白。
 */
function looseStringField(raw: string, field: string): string {
  const head = '"' + field + '"\\s*:\\s*"'
  const closed = new RegExp(head + '((?:[^"\\\\]|\\\\.)*)"').exec(raw)
  const m = closed ?? new RegExp(head + '((?:[^"\\\\]|\\\\.)*)\\\\?$').exec(raw)
  if (!m) return ''
  try {
    return JSON.parse('"' + m[1] + '"') as string
  } catch {
    // 转义序列还没收全：退回原样，至少把已经到达的部分显示出来
    return m[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
  }
}

/**
 * execute 的两个参数。
 *
 * 参数是**流式**长出来的：JSON.parse 在收完之前一直失败，而用户展开气泡想看的就是
 * 那段正在写的代码。所以解析失败时退回正则抠字段——正文能一段段长出来，而不是
 * 整段参数 JSON 原文（「{"body":"…」那种半截货）摊在眼前。
 */
export function executeArgs(raw: string): ExecuteArgs {
  if (!raw) return { description: '', body: '' }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>
      return {
        description: typeof o.description === 'string' ? o.description : '',
        body: typeof o.body === 'string' ? o.body : '',
      }
    }
  } catch {
    // 没解析成功：多半还没收完，走下面的宽松路径
  }
  return {
    // description 常写在 body 后面，收不到就是收不到，不猜
    description: looseStringField(raw, 'description'),
    body: looseStringField(raw, 'body'),
  }
}

/* ---------- 排版 ---------- */

/** 一行多长算"平铺"：超过它就值得掰开重排（80 是各家终端的常规宽度） */
const FLAT_WIDTH = 80

/** 去行尾空白、去掉首尾空行；整段被统一缩进过（模型常这么写）时把那一级去掉 */
function tidyLines(source: string): string[] {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  /*
   * 统一缩进只在**没有模板字符串**时才敢去：模板字符串里的空白是内容的一部分，
   * 整段去一级缩进等于把那几行字改了。这种情况宁可留着原样的缩进。
   */
  if (source.includes('\u0060')) return lines
  let min = Infinity
  for (const l of lines) {
    if (!l.trim()) continue
    min = Math.min(min, /^[ \t]*/.exec(l)?.[0].length ?? 0)
  }
  return min > 0 && min < Infinity ? lines.map((l) => l.slice(min)) : lines
}

/** 上一枚有效字符是不是"后面可以跟正则"的位置（经典的 JS 正则判定，够用） */
const REGEX_OK = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '<', '>', '~'])

/**
 * 把一行平铺的 JS 掰成多行。
 *
 * 只在 `{` `}` `;` 三处断——逗号不断：一行里塞二十个数字的数组被掰成二十行，
 * 比原来更难读。字符串、模板、注释、正则里的这些字符一律不算数（下面那台状态机）。
 */
function expandFlat(line: string): { lines: string[]; breaks: number } {
  const out: Array<{ text: string; depth: number }> = []
  /** 语句级的分隔符个数（\`;\` 与 \`{\`）：够多才值得掰开，见 formatJs 的判据 */
  let breaks = 0
  let buf = ''
  let depth = 0
  let lineDepth = 0
  let state: 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' | 'regex' = 'code'
  let prev = ''

  const flush = () => {
    const text = buf.trim()
    if (text) out.push({ text, depth: lineDepth })
    buf = ''
    lineDepth = depth
  }

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    const next = line[i + 1] ?? ''
    if (state === 'code') {
      if (ch === '/' && next === '/') { state = 'line'; buf += ch; continue }
      if (ch === '/' && next === '*') { state = 'block'; buf += ch; continue }
      if (ch === '/' && (prev === '' || REGEX_OK.has(prev))) { state = 'regex'; buf += ch; continue }
      if (ch === "'") state = 'sq'
      else if (ch === '"') state = 'dq'
      else if (ch === '\u0060') state = 'tpl'
      else if (ch === '{') {
        buf += ch
        breaks++
        depth++
        flush()
        prev = ch
        continue
      } else if (ch === '}') {
        // 右括号自己起一行：先把前面攒的收掉，再让它落在上一层的缩进上
        flush()
        depth = Math.max(0, depth - 1)
        lineDepth = depth
        buf += ch
        const after = /^[^\S\n]*/.exec(line.slice(i + 1))?.[0] ?? ''
        const peek = line[i + 1 + after.length] ?? ''
        if (peek === '}' || peek === ';' || peek === '' || peek === ')') flush()
        prev = ch
        continue
      } else if (ch === ';') {
        buf += ch
        breaks++
        flush()
        prev = ch
        continue
      }
      buf += ch
      if (ch.trim()) prev = ch
      continue
    }
    buf += ch
    if (state === 'sq' && ch === "'" && line[i - 1] !== '\\') state = 'code'
    else if (state === 'dq' && ch === '"' && line[i - 1] !== '\\') state = 'code'
    else if (state === 'tpl' && ch === '\u0060' && line[i - 1] !== '\\') state = 'code'
    else if (state === 'line' && ch === '\n') state = 'code'
    else if (state === 'block' && ch === '*' && next === '/') { buf += next; i++; state = 'code' }
    else if (state === 'regex' && ch === '/' && line[i - 1] !== '\\') state = 'code'
  }
  flush()
  if (!out.length) return { lines: [], breaks }
  // 缩进从最浅的那一行算起：平铺的一行可能整行都嵌在某个块里
  const min = Math.min(...out.map((l) => l.depth))
  return { lines: out.map((l) => '  '.repeat(Math.max(0, l.depth - min)) + l.text), breaks }
}

/**
 * 把一段 JS 排成人看的样子。
 *
 * 两条路，判据是**它本来是不是多行的**：
 * - 本来就是多行：只做规范化（行尾空白、首尾空行、统一缩进）。模型写出来的代码
 *   通常已经分好行了，再动它只会把人家有意留的对齐（表格化的对象字面量）搞乱。
 * - 一整行平铺：掰开重排（见 expandFlat）。JSON 字符串里的换行是转义过的，
 *   模型偶尔会把整段代码写成一行，读的人只能看见一条横线。
 *
 * 平铺的一行也不是见着就掰：**语句分隔符少于两个、又不长**的就留着——
 * `return { a: 1 }` 掰成三行纯属添乱，而 `a(); b(); c()` 才真的需要。
 */
export function formatJs(source: string): string {
  const lines = tidyLines(source)
  if (!lines.length) return ''
  if (lines.length > 1) return lines.join('\n')
  const only = lines[0]
  const expanded = expandFlat(only)
  const worth = expanded.breaks >= 2 || only.length > FLAT_WIDTH
  return worth && expanded.lines.length > 1 ? expanded.lines.join('\n') : only
}

/* ---------- 结果 ---------- */

export interface ToolResultView {
  /** 头部的元信息（如"本次有 N 次调用没有生效"），界面上渲染成注释 */
  lead: string
  /** 正文：返回值本身 */
  body: string
  /** 尾部的元信息（本次调用统计、日志、附图说明），同样渲染成注释 */
  tail: string
  /** 正文的语言标记（json / text）；交给语法高亮那一层 */
  lang: string
}

/** 结果里那些"关于这次调用"的段落，都属于元信息（见 tools.ts 的 failureHeader / whatHappened） */
const LEAD_META = /^⛔ 本次有/
const TAIL_META = /^(本次调用：|日志：|（这次附上了)/

/** 按空行切段，同时记住每段在原文里的位置——摘掉几段时，剩下的字一个都不动 */
function paragraphs(text: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = []
  const sep = /\n{2,}/g
  let start = 0
  for (;;) {
    const m = sep.exec(text)
    if (!m) break
    out.push({ text: text.slice(start, m.index), start, end: m.index })
    start = m.index + m[0].length
  }
  out.push({ text: text.slice(start), start, end: text.length })
  return out
}

/** 正文是 JSON 就排版一下（工具回执大多是 safeJson 出来的），顺便把语言标成 json */
function prettyBody(text: string): { body: string; lang: string } {
  const trimmed = text.trim()
  if (!/^[{[]/.test(trimmed)) return { body: text, lang: 'text' }
  try {
    return { body: JSON.stringify(JSON.parse(trimmed), null, 2), lang: 'json' }
  } catch {
    // 解析不了（多半是被 clip 截断了）：原样显示，标成纯文本——按 JSON 染色只会红一片
    return { body: text, lang: 'text' }
  }
}

/**
 * 工具结果 → 三段。
 *
 * 元信息为什么单独摘出来：它们不是"返回值"，而是**关于这次调用本身的说明**
 * （调了哪些 api、日志、哪几次没生效）。与返回值混在一段里，读的人分不清
 * 哪句是数据、哪句是旁白；摘出来在界面上渲染成注释（// …），一眼就分得开。
 */
export function toolResultView(raw: string): ToolResultView {
  const text = raw.replace(/\r\n?/g, '\n')
  const parts = paragraphs(text)
  const lead: string[] = []
  const tail: string[] = []
  let from = 0
  let to = parts.length
  while (from < to && LEAD_META.test(parts[from].text.trim())) {
    lead.push(parts[from].text.trim())
    from++
  }
  while (to > from && TAIL_META.test(parts[to - 1].text.trim())) {
    tail.unshift(parts[to - 1].text.trim())
    to--
  }
  const body = from < to ? text.slice(parts[from].start, parts[to - 1].end).trim() : ''
  const pretty = prettyBody(body)
  return { lead: lead.join('\n'), body: pretty.body, tail: tail.join('\n'), lang: pretty.lang }
}
