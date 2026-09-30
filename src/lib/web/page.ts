/**
 * 网页正文：**与 DOM 无关的那一半**（纯函数，Node 里跑得动，用例钉得住）。
 *
 * 整条链是：主进程抓字节（electron/web）→ 渲染层用 DOMParser 变成一棵简树
 * （lib/web/dom）→ 这里把树写成 markdown、切出标题大纲与每一节的字数 →
 * 短的回给模型，长的落盘再用 web.read 按节读。
 *
 * 为什么要把「树 → markdown」这一步单独拿出来：它是这条链上唯一有判断的地方
 * （哪些标签成段、列表怎么编号、表格怎么排、代码块语言取哪个），而它恰好完全不需要
 * 浏览器——一棵手写的树就能把所有分支钉住。
 */

/** 解析出来的一棵树：元素带标签与属性，文本节点只有 text */
export type WebElement = { tag: string; attrs: Record<string, string>; children: WebNode[] }
export type WebNode = { text: string } | WebElement

/**
 * 整块丢掉的标签：对「读懂这一页」没有价值，留着只会把上下文撑满。
 * nav/aside/footer 这一类是**版面**，不是内容——正文提取的第一刀就砍它们。
 */
export const DROP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'canvas',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'option',
  'label',
  'nav',
  'aside',
  'footer',
  'dialog',
  'video',
  'audio',
  'source',
  'track',
  'link',
  'meta',
  'map',
  'object',
  'embed',
])

/**
 * class / id 里出现这些词，多半是导航、广告、评论、推荐位——整块丢掉。
 * 词边界用「非字母」来划，所以 `${...}` 这类拼出来的类名不会误伤 sidebar-ish 之类的真内容；
 * 宁可少丢（留下一点噪声）也不要多丢（把正文啃掉一块）。
 */
export const DROP_HINT =
  /(^|[^a-z])(nav|navbar|menu|sidebar|side-bar|footer|banner|advert|ads|promo|sponsor|comment|cookie|popup|modal|share|social|related|recommend|breadcrumb|pagination|subscribe|newsletter|toolbar|masthead)([^a-z]|$)/i

/** 段与段之间要断开的标签 */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'details',
  'div',
  'dd',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

export function isElement(n: WebNode): n is WebElement {
  return 'tag' in n
}

/** 树里所有文字拼起来（空白折叠）。用于「这一块有多少字」的判断 */
export function textOf(nodes: WebNode[]): string {
  const out: string[] = []
  for (const n of nodes) {
    if (isElement(n)) out.push(textOf(n.children))
    else out.push(n.text)
  }
  return out.join('').replace(/\s+/g, ' ').trim()
}

/* ---------- 树 → markdown ---------- */

interface Ctx {
  /** 列表缩进与序号：ol 要自己编号 */
  listDepth: number
  /** 当前在 ol 里，第几项（从 1 起） */
  index: number
}

export function treeToMarkdown(nodes: WebNode[], base = ''): string {
  const md = render(nodes, base, { listDepth: 0, index: 0 })
  return tidy(md)
}

function render(nodes: WebNode[], base: string, ctx: Ctx): string {
  const parts: string[] = []
  let index = 0
  for (const n of nodes) {
    if (!isElement(n)) {
      parts.push(n.text)
      continue
    }
    const tag = n.tag.toLowerCase()
    if (DROP_TAGS.has(tag)) continue
    switch (tag) {
      case 'br':
        parts.push('\n')
        break
      case 'hr':
        parts.push('\n\n---\n\n')
        break
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const level = Number(tag.slice(1))
        parts.push('\n\n' + '#'.repeat(level) + ' ' + inline(n.children, base) + '\n\n')
        break
      }
      case 'p':
      case 'figcaption':
      case 'summary':
      case 'dd':
      case 'dt':
        parts.push('\n\n' + inline(n.children, base) + '\n\n')
        break
      case 'blockquote':
        parts.push('\n\n' + render(n.children, base, ctx).trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n')
        break
      case 'pre':
        parts.push('\n\n' + codeBlock(n) + '\n\n')
        break
      case 'ul':
      case 'ol': {
        const inner = render(n.children, base, { listDepth: ctx.listDepth + 1, index: 0 })
        parts.push('\n\n' + inner + '\n')
        break
      }
      case 'li': {
        index += 1
        const marker = n.attrs.__ol === '1' ? index + '. ' : '- '
        const pad = '  '.repeat(Math.max(0, ctx.listDepth - 1))
        const body = render(n.children, base, { listDepth: ctx.listDepth, index: 0 }).trim()
        // 列表项里可能还有子列表（渲染出来自带换行）：只给第一行上标记，其余按缩进对齐
        const lines = body.split('\n')
        const head = pad + marker + (lines[0] ?? '')
        const rest = lines.slice(1).map((l) => (l.trim() ? pad + '  ' + l : l))
        parts.push('\n' + [head, ...rest].join('\n'))
        break
      }
      case 'table':
        parts.push('\n\n' + table(n, base) + '\n\n')
        break
      case 'img': {
        const alt = (n.attrs.alt ?? '').trim()
        const src = absolute(n.attrs.src ?? '', base)
        if (src) parts.push('![' + alt.replace(/[[\]]/g, '') + '](' + src + ')')
        break
      }
      default:
        parts.push(render(n.children, base, ctx))
    }
  }
  return parts.join('')
}

/** 行内内容：只管粗体/斜体/代码/链接/图片，其余按文字走 */
function inline(nodes: WebNode[], base: string): string {
  const out: string[] = []
  for (const n of nodes) {
    if (!isElement(n)) {
      out.push(n.text.replace(/\s+/g, ' '))
      continue
    }
    const tag = n.tag.toLowerCase()
    if (DROP_TAGS.has(tag)) continue
    if (tag === 'br') {
      out.push('\n')
      continue
    }
    if (tag === 'img') {
      const alt = (n.attrs.alt ?? '').trim()
      const src = absolute(n.attrs.src ?? '', base)
      if (src) out.push('![' + alt.replace(/[[\]]/g, '') + '](' + src + ')')
      continue
    }
    const body = inline(n.children, base)
    switch (tag) {
      case 'strong':
      case 'b':
        out.push(body.trim() ? '**' + body.trim() + '**' : '')
        break
      case 'em':
      case 'i':
        out.push(body.trim() ? '*' + body.trim() + '*' : '')
        break
      case 'code':
      case 'kbd':
      case 'samp':
        out.push(body.includes('`') ? body : '`' + body + '`')
        break
      case 'del':
      case 's':
        out.push(body.trim() ? '~~' + body.trim() + '~~' : '')
        break
      case 'a': {
        const text = body.trim()
        if (!text) break
        // 页内锚点（#…）退成纯文字：它只会把人带到同一页的另一处，模型不需要
        const raw = (n.attrs.href ?? '').trim()
        const href = raw.startsWith('#') ? '' : absolute(raw, base)
        out.push(href ? '[' + text + '](' + href + ')' : text)
        break
      }
      default:
        // 块级元素混进行内时（真实网页里很常见）：当成一个空格，别把两句话粘成一句
        out.push(BLOCK_TAGS.has(tag) ? ' ' + body + ' ' : body)
    }
  }
  return out.join('')
}

function codeBlock(n: WebElement): string {
  const code = firstTag(n, 'code') ?? n
  const cls = code.attrs.class ?? n.attrs.class ?? ''
  const lang = /(?:language|lang|highlight-source)-([a-z0-9+#]+)/i.exec(cls)?.[1] ?? ''
  const body = textOf([code]).replace(/\n{3,}/g, '\n\n')
  return '```' + lang + '\n' + body + '\n```'
}

function table(n: WebNode, base: string): string {
  const rows: string[][] = []
  let header = false
  const walk = (node: WebNode): void => {
    if (!isElement(node)) return
    const tag = node.tag.toLowerCase()
    if (tag === 'tr') {
      const cells: string[] = []
      let hasTh = false
      for (const c of node.children) {
        if (!isElement(c)) continue
        const ct = c.tag.toLowerCase()
        if (ct !== 'td' && ct !== 'th') continue
        if (ct === 'th') hasTh = true
        cells.push(inline(c.children, base).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim())
      }
      if (cells.some((c) => c)) rows.push(cells)
      if (hasTh && rows.length === 1) header = true
      return
    }
    if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot') for (const c of node.children) walk(c)
  }
  walk(n)
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (cells: string[]): string => '| ' + Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ') + ' |'
  const out = [line(rows[0])]
  if (header) out.push('| ' + Array.from({ length: width }, () => '---').join(' | ') + ' |')
  for (const row of rows.slice(1)) out.push(line(row))
  return out.join('\n')
}

function firstTag(n: WebNode, tag: string): WebElement | null {
  if (!isElement(n)) return null
  if (n.tag.toLowerCase() === tag) return n
  for (const c of n.children) {
    const hit = firstTag(c, tag)
    if (hit) return hit
  }
  return null
}

/**
 * 相对地址补全成绝对地址（模型要能顺着链接继续读）。
 *
 * 只认 http/https：javascript:、mailto:、data: 这些对「顺着读下去」毫无用处，
 * 留在正文里只会让模型浪费一次调用去试。补不出来就当成没有链接。
 */
export function absolute(href: string, base: string): string {
  const raw = href.trim()
  if (!raw) return ''
  try {
    const u = new URL(raw, base || undefined)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : ''
  } catch {
    return ''
  }
}

/**
 * 收尾：太多空行、行尾空格、列表前后粘在一起——都是网页转过来最常见的毛病。
 * 只做「不会改变意思」的整理。
 */
function tidy(md: string): string {
  return md
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '')
}

/* ---------- 标题大纲与每一节的字数 ---------- */

export interface WebHeading {
  /** 第几级（1~6） */
  level: number
  /** 标题文字（去掉了 markdown 记号的纯文本） */
  text: string
  /** 标题行在正文里的起止偏移 */
  start: number
  bodyStart: number
  /** 这一节**自己的**正文有多少字（不含子节的正文） */
  chars: number
}

/** 标题行的纯文本：去掉 #、行内记号与链接壳，只留能对得上的字 */
export function headingPlain(text: string): string {
  return text
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, (m) => (/^!/.test(m) ? '' : m.replace(/^\[|\]\([^)]*\)$/g, '')))
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 扫出所有标题（跳过围栏代码块与行内代码）。
 *
 * 为什么跳过代码块：文档里常有一段 shell 注释 `# 安装`，那不是标题——
 * 大纲里混进这种东西，agent 会去读一段根本不存在的章节。
 */
export function headingsOf(markdown: string): WebHeading[] {
  const lines = markdown.split('\n')
  const out: WebHeading[] = []
  let offset = 0
  let fence = false
  for (const line of lines) {
    const lineStart = offset
    offset += line.length + 1
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    out.push({
      level: m[1].length,
      text: headingPlain(m[2]),
      start: lineStart,
      bodyStart: offset,
      chars: 0,
    })
  }
  // 每一节的字数：从它的正文起点，到下一个「同级或更高级」标题之前，扣掉子标题那一行
  for (let i = 0; i < out.length; i++) {
    let end = markdown.length
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].level <= out[i].level) {
        end = out[j].start
        break
      }
    }
    const own = markdown.slice(out[i].bodyStart, end)
    // 子节整段扣掉：只留这一节自己的正文
    let cut = own
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].level <= out[i].level) break
      const rel = out[j].start - out[i].bodyStart
      if (rel >= 0) {
        cut = cut.slice(0, rel)
        break
      }
    }
    out[i].chars = cut.replace(/\s+/g, ' ').trim().length
  }
  return out
}

/** 标题树 → 一行一节的文本（给模型看的那种：`# 一级标题 - 10`） */
export function outlineLines(markdown: string, maxDepth = 6): string[] {
  return headingsOf(markdown)
    .filter((h) => h.level <= maxDepth)
    .map((h) => '#'.repeat(h.level) + ' ' + h.text + ' - ' + h.chars)
}

/**
 * 按「一级/二级」这样的路径切出一节。
 *
 * 匹配规则（从宽到严，够用就好）：先按纯文本全等，再按包含（大小写不敏感）。
 * 找不到就把大纲回给调用方——模型据此换一个说法再试，而不是瞎猜一个近似的节。
 */
export function sliceSection(
  markdown: string,
  path: string,
): { ok: true; heading: WebHeading; text: string; subheadings: string[] } | { ok: false; error: string; outline: string[] } {
  const heads = headingsOf(markdown)
  const outline = outlineLines(markdown)
  const wanted = path
    .split('/')
    .map((s) => headingPlain(s))
    .filter(Boolean)
  if (!wanted.length) return { ok: false, error: 'web.read 的 path 是空的：要么不传（从头读），要么写「一级标题/二级标题」', outline }
  let scope = heads
  let hit: WebHeading | null = null
  for (const want of wanted) {
    const found = matchHeading(scope, want)
    if (!found) {
      return {
        ok: false,
        error: '没有找到标题「' + want + '」。可用的章节见 outline（写成「一级/二级」这种路径）',
        outline,
      }
    }
    hit = found
    // 下一段只能在它的子树里找：同名的二级标题在别的章里很常见
    scope = subtreeOf(heads, found)
  }
  if (!hit) return { ok: false, error: '没有找到这一节', outline }
  const idx = heads.indexOf(hit)
  let end = markdown.length
  for (let j = idx + 1; j < heads.length; j++) {
    if (heads[j].level <= hit.level) {
      end = heads[j].start
      break
    }
  }
  return {
    ok: true,
    heading: hit,
    text: markdown.slice(hit.start, end).trim(),
    subheadings: subtreeOf(heads, hit)
      .filter((h) => h.level > hit!.level)
      .map((h) => '#'.repeat(h.level) + ' ' + h.text + ' - ' + h.chars),
  }
}

/**
 * 找标题：先全等，再「标题里包含它」。
 *
 * **故意不做反向包含**（「要查的名字里包含某个标题」）：那种宽松匹配会让
 * 「没有这一节」命中标题「一」，于是模型以为自己读到了想要的那一节，
 * 实际上读的是别处——错得还很安静。找不到就把大纲回给它，让它换个说法。
 */
function matchHeading(heads: WebHeading[], want: string): WebHeading | null {
  const w = want.toLowerCase()
  return heads.find((h) => h.text.toLowerCase() === w) ?? heads.find((h) => h.text.toLowerCase().includes(w)) ?? null
}

function subtreeOf(heads: WebHeading[], root: WebHeading): WebHeading[] {
  const idx = heads.indexOf(root)
  if (idx < 0) return []
  const out: WebHeading[] = []
  for (let j = idx + 1; j < heads.length; j++) {
    if (heads[j].level <= root.level) break
    out.push(heads[j])
  }
  return out
}

/* ---------- 阈值：短的直接给，长的落盘 ---------- */

/**
 * 多长算「长」：超过它就不把全文塞回模型，而是落盘 + 只给大纲树
 * （阈值是拍出来的：一次 execute 的观察里塞两万字以上，后面的正题就没地方了）。
 */
export const WEB_INLINE_LIMIT = 24_000

export function needsFile(markdown: string): boolean {
  return markdown.length > WEB_INLINE_LIMIT
}

/** 落盘文件的正文头：让「用记事本打开这个 md」也能看出它是哪一页 */
export function fileHeader(meta: { url: string; title: string; fetchedAt: number }): string {
  return (
    '<!-- 归一 Unyra 抓取的网页正文：' + meta.title + ' -->\n' +
    '<!-- 来源：' + meta.url + ' -->\n' +
    '<!-- 抓取时间：' + new Date(meta.fetchedAt).toISOString() + ' -->\n\n'
  )
}
