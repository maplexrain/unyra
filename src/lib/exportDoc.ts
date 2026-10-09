/**
 * 文档导出：把一份 Markdown 变成能拿走的文件（.md / .html / .pdf）。
 *
 * 这一层只管「产物长什么样」，不管「存到哪」——落盘与原生对话框在主进程
 * （见 electron/main.ts 的 file:saveText 与 file:exportPdf），这里产出的是纯字符串。
 *
 * 三种格式共用同一份正文，但走的路不一样：
 * - md：源文**原样**带走，一个字都不加工。要进 Git、要再导入回来，这一份才是真的；
 * - html / pdf：正文由 renderNote 渲染（与预览同一套解析），再补上渲染期才做得成的那几件事
 *   ——注解、资源图片、函数图像、moji: 内部链接。
 *
 * 两条贯穿全篇的取舍：
 *
 * 1. **公式走 MathML，不走 KaTeX 的 HTML**。KaTeX 的排版靠它自己那二十多个 woff2，
 *    想让一份 HTML 脱离应用还能正确显示公式，就得把字体一起 base64 带进文件（约 2MB）。
 *    而 KaTeX 默认同时产出 MathML（.katex-mathml），浏览器原生就能排——于是导出件里
 *    把 .katex-html 隐掉、把 .katex-mathml 放出来：零字体依赖，体积也不变（见 export.css）。
 *
 * 2. **函数图像搬的是预览里已经画好的那张图**。绘图库不进导出件（它自己就八百多 KB），
 *    所以只能把预览 DOM 里画好的 SVG 快照过来（见 plotSnapshots）。张数对不上就整批不贴，
 *    宁可少一张图，也不要把图贴到别的小节下面。
 */

import type { Annotation } from '../learn/types'
import { STATIC_SCHEME, uuidFromHref } from '../learn/static'
import { t } from '../i18n'
import { applyAnnotation } from './annotation'
import { highlightCodeIn } from './codeHighlight'
import { DOC_TW_CLASS, docTailwindCss } from './docTailwind'
import { renderNote } from './markdown'
import { escapeHtml } from './htmlEscape'
import EXPORT_CSS from './export.css?raw'

export type ExportFormat = 'md' | 'html' | 'pdf'

/** 导出件的配色：预览是深色时，导出的网页/PDF 也照深色来 */
export type ExportTheme = 'light' | 'dark'

/** PDF 纸张 */
export type ExportPageSize = 'A4' | 'A3' | 'Letter'

export interface ExportFormatInfo {
  id: ExportFormat
  label: string
  /** 一句话说明（选项卡片下面那行） */
  hint: string
  ext: string
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  {
    id: 'md',
    label: 'Markdown 源文件',
    ext: 'md',
    hint: '原样导出这份文档的源文：公式与图片引用都保持原样，适合再导入回来、或放进 Git 存档。',
  },
  {
    id: 'html',
    label: 'HTML 网页',
    ext: 'html',
    hint: '单文件网页：排版、公式、图片全部内嵌在里面，双击就能用浏览器打开，也能直接发给别人。',
  },
  {
    id: 'pdf',
    label: 'PDF 文档',
    ext: 'pdf',
    hint: '按纸张分页排好，适合打印或存档；公式用浏览器原生的 MathML 排，不依赖字体文件。',
  },
]

export const formatInfo = (id: ExportFormat): ExportFormatInfo =>
  EXPORT_FORMATS.find((f) => f.id === id) ?? EXPORT_FORMATS[0]

/* ---------- 文件名 ---------- */

/**
 * Windows 上不能出现在文件名里的字符；控制字符一并换成空格。
 *
 * 控制字符这一类是有意的（标题是从学习数据里来的，里面可能有换行、制表符，
 * 甚至从别处粘来的 \u0000），因此把 no-control-regex 这条挡掉。
 */
// eslint-disable-next-line no-control-regex
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/g

/**
 * Windows 的保留设备名：CON.md 这种**带后缀也一样**打不开，
 * 而文档标题恰好叫「CON」的概率不为零（外文资料里就有），因此要挡一下。
 */
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 文档标题 → 能当文件名的部分（不含后缀）。空标题、怪字符、超长都在这里收干净 */
export function fileBaseName(title: string): string {
  const cleaned = title
    .replace(BAD_NAME, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // 结尾的句点与空格在 Windows 上会被悄悄丢掉，先自己去掉，免得「建议的文件名」与实际存下来的不一致
    .replace(/[. ]+$/, '')
  // 64 个字符：中文标题一个字顶三个字节，再长就逼近路径长度限制了
  const name = (cleaned || t('未命名文档')).slice(0, 64).trim()
  return RESERVED_NAME.test(name) ? t('文档-{0}', name) : name
}

export const exportFileName = (title: string, format: ExportFormat): string =>
  fileBaseName(title) + '.' + formatInfo(format).ext

/* ---------- 拼一份完整的 HTML ---------- */

export { escapeHtml }

export interface HtmlDocInput {
  title: string
  /** 页头标题下面那行元信息（节点路径、文档种类、字数…） */
  meta: string[]
  /** 正文 HTML（见 exportBody） */
  body: string
  /**
   * 正文里 Tailwind 工具类的样式（见 exportBody 的 css 与 lib/docTailwind）。
   * 预览里那份是运行时注入 <head> 的，带不进文件；不给就整块不出现。
   */
  docCss?: string
  theme: ExportTheme
  /** 页脚右侧的落款（导出时间） */
  stamp: string
}

/**
 * 把正文拼成一份**自给自足**的 HTML：样式内嵌、图片是 data URL、公式是 MathML，
 * 整个文件不引用任何外部资源——断网、换机器、直接发给别人，看到的都是同一个样子。
 *
 * 用数组拼而不是模板串：正文本身可能很长（几十万字符），拼接次数越少越好；
 * 而且这里每一段都是确定的字面量，数组一眼就能看出产物的结构。
 */
export function standaloneHtml(input: HtmlDocInput): string {
  const out: string[] = [
    '<!doctype html>',
    '<html lang="zh-CN" data-theme="' + (input.theme === 'dark' ? 'dark' : 'light') + '">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="归一 Unyra">',
    '<title>' + escapeHtml(input.title) + '</title>',
    '<style>',
    EXPORT_CSS.trim(),
    '</style>',
  ]
  // 文档 Tailwind 那一份单独一块：它是按这篇文档的类名现算的，混进 EXPORT_CSS 会让人以为
  // 那份静态样式里本来就该有这些类。它的选择器全部带 .moji-doc-tw 前缀（见 lib/docTailwind），
  // 下面 <main> 上的这个类就是它的作用域。
  if (input.docCss) out.push('<style>', input.docCss, '</style>')
  out.push(
    '</head>',
    '<body>',
    '<div class="page">',
    '<header class="export-head">',
    '<div class="export-kicker">' + t('归一 UNYRA · 学习文档') + '</div>',
    '<h1 class="export-title">' + escapeHtml(input.title) + '</h1>',
  )
  if (input.meta.length) {
    out.push('<div class="export-meta">' + input.meta.map((m) => '<span>' + escapeHtml(m) + '</span>').join('') + '</div>')
  }
  out.push('</header>')
  out.push('<main class="note-preview ' + DOC_TW_CLASS + '">')
  out.push(input.body)
  out.push('</main>')
  out.push('<footer class="export-foot">')
  out.push('<span>' + t('由 归一 Unyra 导出') + '</span>')
  out.push('<span>' + escapeHtml(input.stamp) + '</span>')
  out.push('</footer>')
  out.push('</div>')
  out.push('</body>')
  out.push('</html>')
  out.push('')
  return out.join('\n')
}

/* ---------- 函数图像 ---------- */

/**
 * 预览里那张画好的图 → 可以搬进导出件的外层 HTML。
 *
 * 三处要修：
 * - 占位提示「正在绘制函数图像…」：图已经画好了，这句不该跟过去；
 * - 公式标签的 HTML 覆盖层（.moji-plot-label）：它的 left/top 是**按当时那个宽度**算的，
 *   换一个纸面宽度必然错位，因此整批去掉，并把被它藏起来的 SVG 原文字放回来；
 * - data-plot（原始 JSON）：导出件里没人再画它，留着只是把文件撑大。
 */
export function plotSnapshot(live: Element): string {
  const box = live.cloneNode(true) as HTMLElement
  box.querySelector('.moji-plot-hint')?.remove()
  for (const n of Array.from(box.querySelectorAll('.moji-plot-label'))) n.remove()
  for (const t of Array.from(box.querySelectorAll('text'))) {
    if ((t as SVGTextElement).style.display === 'none') (t as SVGTextElement).style.removeProperty('display')
  }
  box.removeAttribute('data-plot')
  return box.outerHTML
}

/**
 * 正文根里所有函数图像的快照，**按出现顺序**（与 exportBody 里的顺序一致，靠这个对齐）。
 * 还没画出来的（占位中、或画失败了）给空串，exportBody 遇到空串会跳过那一张。
 */
export function plotSnapshots(root: HTMLElement | null): string[] {
  if (!root) return []
  return Array.from(root.querySelectorAll('.moji-plot')).map((el) =>
    el.querySelector('svg') ? plotSnapshot(el) : '',
  )
}

/* ---------- 正文 ---------- */

/** 一条资源引用解析出来的东西：展示名 + （图片才有）data URL */
export interface ExportAsset {
  name: string
  url: string | null
}

export interface BodyInput {
  source: string
  /** 用户注解：导出件里保留（虚线 + title），它们是这份文档的一部分 */
  annotations?: Annotation[]
  /** 解析 moji:static 引用。没给就一律按「资源不在」处理 */
  resolveAsset?: (uuid: string) => Promise<ExportAsset | null>
  /** 见 plotSnapshots */
  plots?: string[]
  /** 关掉时图片不内嵌，只在原位留一句说明（导出件因此会小很多） */
  embedImages?: boolean
}

/**
 * 源文 → 正文 HTML。异步只因为一件事：内嵌图片要读盘。
 *
 * 这里**不再消毒**：renderNote 的产物已经过 DOMPurify，之后我们只做「把属性改成
 * 我们自己的值」这一件事（src / title / class），没有一处把外部文本拼进 HTML。
 */
/** 一次导出正文的产物：HTML 本身，以及它用到的 Tailwind 样式（见 BodyInput 的说明） */
export interface ExportBody {
  html: string
  /** 这篇正文用到的 Tailwind 工具类算出来的样式；正文里一个类名都没有时是空串 */
  css: string
}

export async function exportBody(input: BodyInput): Promise<ExportBody> {
  const root = document.createElement('div')
  root.innerHTML = renderNote(input.source)

  /* ❶ 代码块高亮：预览里那份颜色是 DOM 提交之后补的，导出件得自己补一次。
     必须**等它做完**再往下走——序列化发生在函数末尾。语法与结果都有缓存，
     预览里刚看过的代码块这里几乎不花时间。 */
  await highlightCodeIn(root)

  /* ① 注解：与预览同一套（见 lib/annotation），只是导出件里没有浮层，内容改挂在 title 上 */
  for (const a of input.annotations ?? []) applyAnnotation(root, a)
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('.moji-anno'))) {
    const body = el.dataset.anno
    if (body) el.title = body
    // data-anno* 是应用内部的钩子（悬停浮层靠它找内容），导出件里用不上，清掉
    delete el.dataset.anno
    delete el.dataset.annoTerm
    delete el.dataset.annoKind
  }

  /* ② 函数图像：把预览里画好的那张贴回同一个位置 */
  const slots = Array.from(root.querySelectorAll('.moji-plot'))
  const snaps = input.plots ?? []
  if (snaps.length === slots.length) {
    for (let i = 0; i < snaps.length; i++) if (snaps[i]) slots[i].outerHTML = snaps[i]
  }

  const assetOf = async (uuid: string | null): Promise<ExportAsset | null> => {
    if (!uuid || !input.resolveAsset) return null
    try {
      return await input.resolveAsset(uuid)
    } catch {
      // 读盘失败不该让整次导出垮掉：那一条退化成「未内嵌」的说明
      return null
    }
  }

  const embedImage = async (img: HTMLImageElement): Promise<void> => {
    const hit = await assetOf(uuidFromHref(img.getAttribute('src') ?? ''))
    if (hit?.url && input.embedImages !== false) {
      img.setAttribute('src', hit.url)
      return
    }
    // 内嵌不了（关了开关、资源不在、读盘失败）：换成一句说明，而不是留一个碎图标
    const alt = (img.getAttribute('alt') ?? '').trim()
    const note = document.createElement('span')
    note.className = 'moji-export-note'
    note.textContent = hit ? t('［图片 {0} 未内嵌］', hit.name) : alt ? t('［图片不在：{0}］', alt) : t('［图片不在］')
    img.replaceWith(note)
  }

  const markLink = async (a: HTMLAnchorElement): Promise<void> => {
    const hit = await assetOf(uuidFromHref(a.getAttribute('href') ?? ''))
    a.removeAttribute('href')
    a.classList.add('moji-x-link')
    // 链接自己的文字是作者写的说明，一律保留，只在后面补上「这是哪个文件」
    const note = document.createElement('span')
    note.className = 'moji-export-note'
    note.textContent = hit ? hit.name : t('资源不存在')
    a.appendChild(note)
  }

  /* ③ 资源引用。图片与链接一起并发处理：一份文档里引十几张图是常事 */
  await Promise.all([
    ...Array.from(root.querySelectorAll<HTMLImageElement>('img[src^="' + STATIC_SCHEME + '"]')).map(embedImage),
    ...Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="' + STATIC_SCHEME + '"]')).map(markLink),
  ])

  /* ④ 内部链接（moji:node / moji:learn / moji:doc）：它们指向应用里的东西，导出件里点不开。
        去掉 href 只留文字 —— 留着颜色反而骗人。资源链接在 ③ 里已经处理过了 */
  for (const a of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href^="moji:"]'))) {
    a.removeAttribute('href')
    a.classList.add('moji-x-link')
  }

  /* ⑤ 文档 Tailwind：正文里的工具类在导出件里也要有样式。放在最后一步算——
        前面几步（图像、链接、函数图像快照）会改写 DOM，按改写完的样子收类名才不会漏。 */
  const css = await docTailwindCss(root)
  return { html: root.innerHTML, css }
}
