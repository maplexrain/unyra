import type { DocKind } from '../learn/types'

/**
 * 节点链接：把文档里出现的概念替换成可点击的链接，指回它的知识节点。
 *
 * 链接语法沿用 Markdown 链接，href 用自定义协议：
 * - `moji:node/<nodeId>`：跳转到已存在的节点
 * - `moji:learn`：点击即「创建（或跳转）该概念的下级节点」，见下方交互大纲协议
 * 阅读态（节点笔记 / 超级导师回复）由 marked 渲染成 <a>，点击拦截后处理。
 */

export const NODE_LINK_SCHEME = 'moji:node/'

/**
 * 交互大纲协议：`[概念名](moji:learn "一句话说明")`。
 *
 * 用户选中词条「学习」是由用户驱动的；这个协议把主导权交给 AI——AI 在目标笔记里
 * 写一份大纲，每个概念都是一条这样的链接，用户点一下即「创建（或跳转）该概念的下级节点」，
 * 于是可以顺着 AI 排好的路径一路学下去，而不必自己在正文里找名词。
 *
 * 复用 Markdown 链接的语法与渲染管线（marked 解析、DOMPurify 放行 moji: 协议），
 * 链接的 title 作为该节点的初始描述（AI 借此交代「它为什么在这里」）。
 */
export const LEARN_LINK_SCHEME = 'moji:learn'

export function isLearnHref(href: string | null | undefined): boolean {
  if (!href) return false
  const h = href.trim().toLowerCase()
  return h === LEARN_LINK_SCHEME || h.startsWith(`${LEARN_LINK_SCHEME}?`)
}

/** 生成一条「点击学习」链接；hint 会写进 title 作为新节点的初始描述 */
export function learnLinkMarkdown(title: string, hint?: string): string {
  const h = hint?.trim()
  return h ? `[${title}](${LEARN_LINK_SCHEME} "${h}")` : `[${title}](${LEARN_LINK_SCHEME})`
}

/** 「点击学习」的处理注册表：由学习工作区注入「创建/跳转子节点」的实现 */
let learnHandler: ((term: string, hint: string) => void) | null = null
export function setLearnLinkHandler(fn: ((term: string, hint: string) => void) | null): void {
  learnHandler = fn
}
export function handleLearnLink(term: string, hint: string): void {
  learnHandler?.(term, hint)
}

/**
 * 渲染期的状态标注：`moji:learn` 链接分「已创建」与「未创建」两种。
 *
 * 未创建：点击会新建下级节点；已创建：该概念在本目标里已有节点，点击只是跳过去。
 * 两者行为不同，外观必须能区分，否则学习者不知道哪些已经开过头。
 * 判定依赖 store，故不在 renderNote（纯函数）里做，而在 DOM 提交后标注类名，
 * 与注解、函数图像同一套做法。
 */
export const LEARN_NEW_CLASS = 'moji-learn-new'
export const LEARN_KNOWN_CLASS = 'moji-learn-known'

/** 给 root 下所有 moji:learn 链接标注 created/not-created；isKnown 返回该词是否已有节点 */
export function markLearnLinks(root: HTMLElement, isKnown: (term: string) => boolean): number {
  const links = root.querySelectorAll('a[href]')
  let marked = 0
  for (const el of links) {
    if (!(el instanceof Element) || !isLearnHref(el.getAttribute('href'))) continue
    const term = learnTermOf(el)
    if (!term) continue
    const known = isKnown(term)
    el.classList.toggle(LEARN_KNOWN_CLASS, known)
    el.classList.toggle(LEARN_NEW_CLASS, !known)
    el.setAttribute('data-learn-state', known ? 'known' : 'new')
    marked++
  }
  return marked
}

/** 链接文字即概念名（去掉渲染用的后缀标记文本；标记由 CSS 生成，不在 textContent 里） */
export function learnTermOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 从一次点击里解析「点击学习」链接并触发；返回是否命中。
 * 词名取链接文字，说明取 title 属性（没有则为空串）。
 */
export function tryLearnLinkFromEvent(event: { target: EventTarget | null }): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const anchor = target.closest('a[href^="moji:learn"]')
  if (!anchor) return false
  if (!isLearnHref(anchor.getAttribute('href'))) return false
  const term = learnTermOf(anchor)
  if (!term) return false
  handleLearnLink(term, (anchor.getAttribute('title') ?? '').trim())
  return true
}

export function nodeLinkHref(nodeId: string): string {
  return `${NODE_LINK_SCHEME}${nodeId}`
}

export function nodeIdFromHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith(NODE_LINK_SCHEME)) return null
  const id = href.slice(NODE_LINK_SCHEME.length).trim()
  return id || null
}

/** 生成本文中的节点链接 Markdown */
export function nodeLinkMarkdown(title: string, nodeId: string): string {
  return `[${title}](${nodeLinkHref(nodeId)})`
}

/**
 * 节点链接的点击回调注册表（模块级）。
 * 编辑器层与渲染层都通过它跳转，反馈因此与学习领域解耦。
 */
let handler: ((nodeId: string) => void) | null = null
export function setNodeLinkHandler(fn: ((nodeId: string) => void) | null): void {
  handler = fn
}
export function handleNodeLink(nodeId: string): void {
  handler?.(nodeId)
}

/** 从一次点击事件里解析节点链接并触发跳转；返回是否命中 */
export function tryNodeLinkFromEvent(event: { target: EventTarget | null }): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const anchor = target.closest('a[href^="moji:node/"]')
  if (!anchor) return false
  const id = nodeIdFromHref(anchor.getAttribute('href'))
  if (!id) return false
  handleNodeLink(id)
  return true
}

/* ---------- 文档间跳转 ---------- */

/**
 * 文档链接：`[文字](moji:doc/<文档名>)` 或 `[文字](moji:doc/<nodeId>/<文档名>)`。
 *
 * 一个节点带两份平级文档（教学文档与笔记文档），只靠 `moji:node/<id>` 说不清要跳到
 * 哪一份。省略 nodeId 就是「当前所在节点的这份文档」——这是最常用的一档：
 * 教学文档里写 `[整理到我的笔记](moji:doc/note)`，点一下就翻到同一节点的笔记文档；
 * 跨节点时用 nodeId：`[看它的笔记](moji:doc/3f2a…/note)`（模型从 api.node.list 拿到 id）。
 *
 * `moji:node/<id>` 保留不动，等价于「该节点的教学文档」，老文档里的链接照旧有效。
 */
export const DOC_LINK_SCHEME = 'moji:doc/'

/** href 里用的短名；中文与英文都认，容忍模型写「教学文档」这类全称 */
const DOC_SLUGS: Record<string, DocKind> = {
  teaching: 'teaching',
  note: 'note',
  教学: 'teaching',
  教学文档: 'teaching',
  笔记: 'note',
  笔记文档: 'note',
}

/** DocKind → href 里的短名（生成链接用，恒为 ASCII） */
export function docSlugOf(kind: DocKind): string {
  return kind === 'note' ? 'note' : 'teaching'
}

export function docKindFromSlug(raw: string): DocKind | null {
  return DOC_SLUGS[raw.trim().toLowerCase()] ?? DOC_SLUGS[raw.trim()] ?? null
}

/** 生成文档链接的 href；nodeId 省略表示「当前节点」 */
export function docLinkHref(kind: DocKind, nodeId?: string | null): string {
  const slug = docSlugOf(kind)
  return nodeId ? `${DOC_LINK_SCHEME}${nodeId}/${slug}` : `${DOC_LINK_SCHEME}${slug}`
}

export function docLinkMarkdown(title: string, kind: DocKind, nodeId?: string | null): string {
  return `[${title}](${docLinkHref(kind, nodeId)})`
}

/** 文档跳转的落点：行号 / 行区间 / 要选中的文字（见 parseDocHref 的 `#` 段） */
export interface DocJump {
  line?: number
  endLine?: number
  select?: string
}

/**
 * 解析 `#` 后面那一段跳转说明：`#L12`、`#L12-L20`、`#L12@选中的文字`、
 * 以及 `#L12-L20@选中的文字`。`L` 可省（`#12` 也认），文字里可以带空格（要 URL 编码）。
 * 认不出来就当没有跳转——链接照旧打开那份文档，不至于因为一个写错的片段点不动。
 */
export function parseDocJump(raw: string | null | undefined): DocJump | null {
  if (!raw) return null
  const body = raw.replace(/^#/, '').trim()
  if (!body) return null
  const [rangePart, ...rest] = body.split('@')
  const select = rest.join('@').trim()
  const m = rangePart.trim().match(/^L?(\d+)(?:\s*-\s*L?(\d+))?$/i)
  const jump: DocJump = {}
  if (m) {
    jump.line = Number(m[1])
    if (m[2]) jump.endLine = Number(m[2])
  }
  if (select) jump.select = decodeURIComponent(select)
  return jump.line || jump.select ? jump : null
}

/**
 * 解析文档链接。认三种写法：
 * - `moji:doc/note`：当前节点的笔记文档（nodeId 为 null，由调用方补当前节点）
 * - `moji:doc/<nodeId>/note`：指定节点的笔记文档
 * - `moji:doc/<nodeId>`：指定节点的教学文档
 * 尾巴上可以跟一段跳转说明（`#L12` / `#L12-L20` / `@选中的文字`）：
 * 「打开那份文档，并滚到第 12 行、选中这一段」——讲解里指路比让用户自己翻要省事得多。
 * 解析不出来返回 null（交给后面的处理器或浏览器默认行为）。
 */
export function parseDocHref(href: string | null | undefined): ({ nodeId: string | null; kind: DocKind } & DocJump) | null {
  if (!href) return null
  const h = href.trim()
  if (!h.toLowerCase().startsWith(DOC_LINK_SCHEME)) return null
  const raw = h.slice(DOC_LINK_SCHEME.length)
  // 片段在 `#` 之后：先摘下来，剩下的才是路径（路径里本来就不该出现 #）
  const hashAt = raw.indexOf('#')
  const jump = hashAt >= 0 ? parseDocJump(raw.slice(hashAt)) : null
  const rest = (hashAt >= 0 ? raw.slice(0, hashAt) : raw).replace(/^\/+/, '').trim()
  const head = jump ?? {}
  if (!rest) return { nodeId: null, kind: 'teaching', ...head }
  const parts = rest.split('/').filter((p) => p.trim())
  const last = parts[parts.length - 1]
  const kind = docKindFromSlug(decodeURIComponent(last))
  if (kind) {
    const id = parts.slice(0, -1).join('/').trim()
    return { nodeId: id || null, kind, ...head }
  }
  return { nodeId: decodeURIComponent(rest), kind: 'teaching', ...head }
}

/** 文档链接的点击回调注册表（模块级）；nodeId 为 null 表示「当前节点」 */
let docHandler: ((target: { nodeId: string | null; kind: DocKind } & DocJump) => void) | null = null
export function setDocLinkHandler(fn: ((target: { nodeId: string | null; kind: DocKind } & DocJump) => void) | null): void {
  docHandler = fn
}
export function handleDocLink(target: { nodeId: string | null; kind: DocKind } & DocJump): void {
  docHandler?.(target)
}

/** 从一次点击事件里解析文档链接并触发；返回是否命中 */
export function tryDocLinkFromEvent(event: { target: EventTarget | null }): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const anchor = target.closest('a[href^="moji:doc/"]')
  if (!anchor) return false
  const parsed = parseDocHref(anchor.getAttribute('href'))
  if (!parsed) return false
  handleDocLink(parsed)
  return true
}

/* ---------- 相对路径的 markdown 文件链接 ---------- */

/**
 * 指向磁盘上另一份 markdown 的普通相对链接：`[docs/README.md](docs/README.md)`。
 *
 * 外部文件（拖进来的 md）互相引用时写的就是这种链接——repo 的 README 尤其如此。
 * 默认行为下 Electron 会把它当成页面导航（然后被主进程拦下，什么也不发生），
 * 所以在渲染层拦下来，转成「打开对应的标签页」：当前文档是外部文件就相对它解析路径，
 * 开一个本地文件页签；内部文档里则按路径的文件名匹配同名笔记。
 *
 * 只认 `.md` 后缀（用户定的）：图片、html、其它资源不在此列，各走各的路。
 */
let mdPathHandler: ((path: string) => void) | null = null
export function setMarkdownPathHandler(fn: ((path: string) => void) | null): void {
  mdPathHandler = fn
}
export function handleMarkdownPath(path: string): void {
  mdPathHandler?.(path)
}

/** 链接的 href 是不是「指向一份 markdown 文件的相对链接」；`#片段` 允许带在尾巴上 */
export function markdownPathFromHref(href: string | null | undefined): string | null {
  if (!href) return null
  const h = href.trim()
  if (!h || h.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return null
  // 去掉 `#片段`：锚点说明跟着文件走不了（另一份文档的标题对不上这一份），先只管开文件
  const path = (h.split('#')[0] ?? '').trim()
  if (!path || !path.toLowerCase().endsWith('.md')) return null
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** 从一次点击事件里解析 markdown 路径链接并触发；返回是否命中 */
export function tryMarkdownPathFromEvent(event: { target: EventTarget | null }): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const anchor = target.closest('a[href]')
  if (!anchor) return false
  const path = markdownPathFromHref(anchor.getAttribute('href'))
  if (!path) return false
  handleMarkdownPath(path)
  return true
}


/* ---------- 超级文档跳转 ---------- */

/**
 * 超级文档链接：`[文字](moji:super/文档名)` 或 `[文字](moji:super/<nodeId>/文档名)`。
 *
 * 一份超级文档要指给用户看「本节点的另一份实验/工具」，靠 ui.superdoc（那是 agent 的
 * api）不行——点击发生在文档里。省略 nodeId 即「当前这份超级文档所在的节点」，
 * 这是常用档：实验说明里写 `[对照组实验](moji:super/对照%E7%BB%84)`，点一下就翻过去；
 * 跨节点时写 nodeId：`[那边的演示](moji:super/3f2a…/演示)`（id 从 api.node.list 拿）。
 * 文档名会 encodeURIComponent（名字里的空格、斜杠都会破坏 markdown 链接）。
 * 渲染在超级文档的沙箱 iframe 里时，点击由 BRIDGE 拦截后转回宿主处理（同一套解析）。
 */
export const SUPER_LINK_SCHEME = 'moji:super/'

export function superLinkHref(name: string, nodeId?: string | null): string {
  return SUPER_LINK_SCHEME + (nodeId ? encodeURIComponent(nodeId) + '/' : '') + encodeURIComponent(name)
}

export function superLinkMarkdown(title: string, name: string, nodeId?: string | null): string {
  return `[${title}](${superLinkHref(name, nodeId)})`
}

/** href 的一段解码；不是合法的百分号编码就原样返回（手写的中文链接没编码也能用） */
function decodePart(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** 解析超级文档链接；解析不出来返回 null（交给后面的处理器或浏览器默认行为） */
export function parseSuperHref(href: string | null | undefined): { nodeId: string | null; name: string } | null {
  if (!href) return null
  const h = href.trim()
  if (!h.toLowerCase().startsWith(SUPER_LINK_SCHEME)) return null
  const rest = h.slice(SUPER_LINK_SCHEME.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return { nodeId: null, name: decodePart(rest).trim() }
  return {
    nodeId: decodePart(rest.slice(0, slash)).trim() || null,
    name: decodePart(rest.slice(slash + 1)).trim(),
  }
}

/** 超级文档链接的点击回调注册表（模块级）；nodeId 为 null 表示「当前这份超级文档所在的节点」 */
let superHandler: ((target: { nodeId: string | null; name: string }) => void) | null = null
export function setSuperLinkHandler(fn: ((target: { nodeId: string | null; name: string }) => void) | null): void {
  superHandler = fn
}
export function handleSuperLink(target: { nodeId: string | null; name: string }): void {
  superHandler?.(target)
}

/** 从一次点击事件里解析超级文档链接并触发；返回是否命中 */
export function trySuperLinkFromEvent(event: { target: EventTarget | null }): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const anchor = target.closest('a[href^="moji:super"]')
  if (!anchor) return false
  const parsed = parseSuperHref(anchor.getAttribute('href'))
  if (!parsed) return false
  handleSuperLink(parsed)
  return true
}

/** 匹配 markdown 链接（非图片），用于在文本中定位节点链接 */
export const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\n]*)\]\(([^)\s]*)\)/g

/* ---------- 「了解」注解 ---------- */
/*
 * 注解**不写进 Markdown 源文**：它存在节点数据的 annotations 里，
 * 渲染完成后再在 DOM 上把术语包成虚线样式（见 MarkdownView）。
 * 早期版本往源文插入 `[词](moji:anno/…)` 链接，一旦被注解的词位于
 * 粗体/斜体内部，插入的 `[` 会顶开强调定界符，使 `**` 退化成字面量。
 */

/**
 * 只读文档里选中的词条 → 在 Markdown 源文中把它的首次出现替换成节点链接。
 * 跳过代码块、行内代码与已有链接，避免破坏既有结构。
 * 找不到可替换位置时返回原源文。
 */
export function replaceTermWithLink(source: string, term: string, nodeId: string): string {
  const needle = term.trim()
  if (!needle) return source

  const blocked: Array<{ from: number; to: number }> = []
  const fence = /```[\s\S]*?```|~~~[\s\S]*?~~~/g
  for (let m = fence.exec(source); m; m = fence.exec(source)) blocked.push({ from: m.index, to: m.index + m[0].length })
  const inlineCode = /`[^`\n]*`/g
  for (let m = inlineCode.exec(source); m; m = inlineCode.exec(source)) blocked.push({ from: m.index, to: m.index + m[0].length })
  MARKDOWN_LINK_RE.lastIndex = 0
  for (let m = MARKDOWN_LINK_RE.exec(source); m; m = MARKDOWN_LINK_RE.exec(source)) {
    blocked.push({ from: m.index, to: m.index + m[0].length })
  }
  const isBlocked = (from: number, to: number) => blocked.some((b) => from < b.to && to > b.from)

  let idx = source.indexOf(needle)
  while (idx >= 0) {
    if (!isBlocked(idx, idx + needle.length)) {
      return source.slice(0, idx) + nodeLinkMarkdown(needle, nodeId) + source.slice(idx + needle.length)
    }
    idx = source.indexOf(needle, idx + 1)
  }
  return source
}
