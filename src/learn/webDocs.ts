/**
 * agent 读网页：抓取 → 正文 → （长的）落盘 / 回给模型。
 *
 * 分工写在三处，读这个文件之前先看一眼它们：
 * - 字节由**主进程**取（electron/web）：渲染层的 fetch 受同源策略约束，抓不了任意站点；
 * - 正文提取与 markdown 化在**渲染层**（lib/web/dom 要 DOMParser，lib/web/page 是纯函数）；
 * - 落盘走**当前用户**的 storage 前缀（users/<uid>/web/…），与资源库、图片同一套规矩。
 *
 * 为什么长的要落盘而不是直接塞回模型：一次 execute 的观察里塞两万字以上，正题就没地方了。
 * 落盘之后模型拿到的是「一页大纲 + 每节多少字」，它自己挑一节用 web.read 读——
 * 于是「读一页长文档」变成几次有目的的、可控的读取。
 */

import { native } from '../lib/native'
import { readText, userPath, writeJson, writeText } from '../lib/storage'
import { parseWebPage } from '../lib/web/dom'
import { WEB_INLINE_LIMIT, fileHeader, needsFile, outlineLines, sliceSection, treeToMarkdown } from '../lib/web/page'

/** 落盘目录（相对当前用户） */
const DIR = 'web'
/** 一次 web.read 最多回多少字：再多就该改读下一节了 */
const READ_LIMIT = 12_000
/** 大纲最多回几行：一页有几百个标题时，回执本身就成了噪声 */
const OUTLINE_MAX = 120

export interface WebDocMeta {
  uuid: string
  /** 请求的地址 */
  url: string
  /** 重定向之后真正读到的地址 */
  finalUrl: string
  title: string
  fetchedAt: number
  /** 正文多少字（markdown 之后） */
  chars: number
  /** 抓的时候被体积上限截断过 */
  truncated: boolean
  /** 大纲（`# 标题 - 本节字数`），落盘一份：读的时候不必再解析一遍 */
  outline: string[]
}

const metaRel = (uuid: string): string => DIR + '/' + uuid + '.json'
const bodyRel = (uuid: string): string => DIR + '/' + uuid + '.md'

/** 短 id：12 个十六进制字符，模型抄写、人眼核对都够用 */
function newId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

/**
 * api.web.webFetch(url)：抓一页，短的直接给全文，长的落盘后只给大纲。
 *
 * 无论长短都会落盘：模型可能过几轮才想起来要读第二节，而那会儿它手上只有 uuid。
 * 一次几 KB 的文本，比「回头再抓一次、还可能已经变了」便宜得多。
 */
export async function fetchForAgent(rawUrl: string): Promise<unknown> {
  const url = String(rawUrl ?? '').trim()
  if (!url) return { error: 'web.webFetch 需要一个网址，例如 https://example.com/a' }
  let res: Awaited<ReturnType<ReturnType<typeof native>['web']['fetch']>>
  try {
    res = await native().web.fetch(url)
  } catch (err) {
    return { error: '抓取通道不可用：' + (err instanceof Error ? err.message : String(err)) }
  }
  if (!res.ok) return { error: res.error }

  const parsed = res.kind === 'html' ? parseWebPage(res.text) : null
  const markdown = parsed ? treeToMarkdown(parsed.tree, res.finalUrl) : tidyText(res.text)
  if (!markdown.trim()) {
    return { error: '这一页没提取出正文（可能是纯前端渲染的页面，或者正文全在脚本里）', url: res.finalUrl }
  }
  const title = clip(parsed?.title || firstHeading(markdown) || res.finalUrl, 200)
  const fetchedAt = Date.now()
  const outline = outlineLines(markdown)
  const uuid = newId()
  const meta: WebDocMeta = {
    uuid,
    url,
    finalUrl: res.finalUrl,
    title,
    fetchedAt,
    chars: markdown.length,
    truncated: res.truncated,
    outline,
  }
  const saved = await save(uuid, meta, markdown)
  const base = {
    ok: true,
    uuid,
    url: res.finalUrl,
    title,
    chars: markdown.length,
    saved,
    ...(res.truncated ? { truncated: true } : {}),
    ...(parsed?.description ? { description: clip(parsed.description, 300) } : {}),
  }
  if (!needsFile(markdown)) {
    return {
      ...base,
      text: markdown,
      note:
        '（' + markdown.length + ' 字，全文在上面）需要再读某一节时用 web.read(uuid, "一级标题/二级标题")。' +
        (saved ? '' : '注意：这一次没能落盘，之后 web.read 读不到它。'),
    }
  }
  return {
    ...base,
    outline: outline.slice(0, OUTLINE_MAX),
    note:
      '这一页太长（' + markdown.length + ' 字，超过 ' + WEB_INLINE_LIMIT + '），正文已存成文件（uuid 见上），' +
      '这里只给你大纲：每行是「# 标题 - 这一节正文的字数」（不含子节）。' +
      '挑你真正需要的那一节，用 web.read(uuid, "一级标题/二级标题") 读它，别一次读完。',
  }
}

/**
 * api.browser.read 的落点：**已在登录会话里打开的那一页** → markdown。
 *
 * 与 fetchForAgent 共用同一条管线（parseWebPage → treeToMarkdown → 落盘/大纲），
 * 区别只在 HTML 来源：那边主进程去抓字节，这边主进程从 live DOM 里取 outerHTML
 * （见 electron/app/webSession 的 web:readHtml）——登录后的页面、滚过之后的单页应用，
 * 抓取器拿不到的内容这里都拿得到。回执形状与 webFetch 一致，
 * 长文一样落盘进 users/<uid>/web/，模型用 web.read 按节读。
 */
export async function livePageForAgent(rawHtml: string, rawUrl: string): Promise<unknown> {
  const html = String(rawHtml ?? '')
  const url = String(rawUrl ?? '').trim()
  if (!html.trim()) return { error: '这一页没有内容可转（可能是空的起始页）' }
  const parsed = parseWebPage(html)
  const markdown = parsed ? treeToMarkdown(parsed.tree, url) : ''
  if (!markdown.trim()) {
    return { error: '这一页没提取出正文（可能是纯前端渲染的页面，或者正文全在脚本里）', url }
  }
  const title = clip(parsed?.title || firstHeading(markdown) || url, 200)
  const outline = outlineLines(markdown)
  const uuid = newId()
  const meta: WebDocMeta = {
    uuid,
    url,
    finalUrl: url,
    title,
    fetchedAt: Date.now(),
    chars: markdown.length,
    truncated: false,
    outline,
  }
  const saved = await save(uuid, meta, markdown)
  const base = {
    ok: true,
    uuid,
    url,
    title,
    chars: markdown.length,
    saved,
    ...(parsed?.description ? { description: clip(parsed.description, 300) } : {}),
  }
  if (!needsFile(markdown)) {
    return {
      ...base,
      text: markdown,
      note:
        '（' + markdown.length + ' 字，全文在上面）需要再读某一节时用 web.read(uuid, "一级标题/二级标题")。' +
        (saved ? '' : '注意：这一次没能落盘，之后 web.read 读不到它。'),
    }
  }
  return {
    ...base,
    outline: outline.slice(0, OUTLINE_MAX),
    note:
      '这一页太长（' + markdown.length + ' 字，超过 ' + WEB_INLINE_LIMIT + '），正文已存成文件（uuid 见上），' +
      '这里只给你大纲：每行是「# 标题 - 这一节正文的字数」（不含子节）。' +
      '挑你真正需要的那一节，用 web.read(uuid, "一级标题/二级标题") 读它，别一次读完。',
  }
}

/**
 * api.web.read(uuid, path)：读落盘网页的某一节。
 *
 * path 省略时从头给一段（并附大纲）；给了就按「一级/二级」这样的路径定位。
 * 找不到时**把大纲回给模型**——它据此换个说法再试，比猜一个近似的节好。
 */
export async function readForAgent(rawId: string, rawPath?: string): Promise<unknown> {
  const key = String(rawId ?? '').trim()
  const path = typeof rawPath === 'string' ? rawPath.trim() : ''
  if (!key) return { error: 'web.read 需要 webFetch 回执里的 uuid' }
  const uuid = key.replace(/^web\//, '').replace(/\.(md|json)$/i, '')
  const meta = await loadMeta(uuid)
  if (!meta) {
    return {
      error:
        '没有这一份网页（uuid: ' + uuid + '）。uuid 一定是 webFetch 回执里的那一个；' +
        '如果那一页是刚抓的、这次却读不到，重新 webFetch 一次即可。',
    }
  }
  const rel = userPath(bodyRel(uuid))
  const body = rel ? await readText(rel) : null
  if (!body) return { error: '这一份网页的正文文件不见了（uuid: ' + uuid + '）：重新 webFetch 一次' }
  const info = { uuid, title: meta.title, url: meta.finalUrl, chars: meta.chars, fetchedAt: meta.fetchedAt }

  if (!path) {
    const head = body.slice(0, READ_LIMIT)
    return {
      ok: true,
      ...info,
      text: head,
      outline: meta.outline.slice(0, OUTLINE_MAX),
      note:
        body.length > READ_LIMIT
          ? '上面是开头一段（共 ' + meta.chars + ' 字）。接着读请指定小节：web.read(uuid, "一级标题/二级标题")'
          : '这是全文。',
    }
  }

  const cut = sliceSection(body, path)
  if (!cut.ok) return { error: cut.error, uuid, title: meta.title, outline: cut.outline.slice(0, OUTLINE_MAX) }
  const text = cut.text.slice(0, READ_LIMIT)
  const rest = cut.text.length - text.length
  return {
    ok: true,
    ...info,
    section: cut.heading.text,
    sectionChars: cut.text.length,
    returned: text.length,
    text,
    ...(cut.subheadings.length ? { subheadings: cut.subheadings.slice(0, 60) } : {}),
    note:
      rest > 0
        ? '这一节还有 ' + rest + ' 字没返回：用更细的二级标题再读一次（见 subheadings）'
        : '这一节读完了（共 ' + cut.text.length + ' 字）。',
  }
}

/* ---------- 落盘 ---------- */

async function save(uuid: string, meta: WebDocMeta, markdown: string): Promise<boolean> {
  const relMeta = userPath(metaRel(uuid))
  const relBody = userPath(bodyRel(uuid))
  if (!relMeta || !relBody) return false
  try {
    const head = fileHeader({ url: meta.finalUrl, title: meta.title, fetchedAt: meta.fetchedAt })
    const okMeta = await writeJson(relMeta, meta)
    const okBody = await writeText(relBody, head + markdown + '\n')
    return okMeta && okBody
  } catch (err) {
    console.warn('[web] 落盘失败：', err)
    return false
  }
}

async function loadMeta(uuid: string): Promise<WebDocMeta | null> {
  if (!/^[0-9a-f]{6,32}$/i.test(uuid)) return null
  const rel = userPath(metaRel(uuid))
  if (!rel) return null
  const text = await readText(rel)
  if (!text) return null
  try {
    const meta = JSON.parse(text) as WebDocMeta
    if (!meta || typeof meta !== 'object' || !meta.uuid) return null
    return { ...meta, outline: Array.isArray(meta.outline) ? meta.outline : [] }
  } catch {
    return null
  }
}

/* ---------- 小工具 ---------- */

/** 纯文本响应（text/plain、markdown…）：只做空白整理，不动内容 */
function tidyText(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function firstHeading(markdown: string): string {
  const m = /^#{1,3}\s+(.+)$/m.exec(markdown)
  return m ? m[1].trim() : ''
}

function clip(text: string, limit: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > limit ? t.slice(0, limit) + '…' : t
}
