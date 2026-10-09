import katex from 'katex'
import { marked } from 'marked'
import markedKatex from 'marked-katex-extension'
// 内置插件在导入时就登记（plot 就是其中一个）；用户插件在启动时登记（见 lib/plugins）
import './builtinPlugins'
import {
  activeTextRules,
  applyTextRules,
  onRenderPluginRegistered,
  pluginForFence,
  renderFenceWith,
  renderPluginsRevision,
} from './renderPlugins'
import { sanitizeHtml } from './sanitize'
import { isLocalPendingImageSrc } from './docImages'

/**
 * KaTeX 里没有字形度量的字符 → 等价的 LaTeX 写法。
 *
 * 有些字符 KaTeX 根本不认识（①②、圈字母、★、✓ 这类），一旦出现在公式里就会：
 * 1. 往控制台刷两条警告（strict 模式的 unknownSymbol + 无法关闭的
 *    「No character metrics」）；
 * 2. 因为没有度量，被按**零宽度**排版——相邻字形会叠在一起。
 *
 * KaTeX 的宏名允许是单个字符，于是这里把它们映射成等价写法，
 * 让公式里出现这些字符时既安静又排得开。展开一律套一层 \text{}：
 * \textcircled 只在文本模式成立，而字符既可能出现在 $…$ 里，
 * 也可能已经待在 \text{} 里，套一层才能在两种情况下都成立（\text 可嵌套）。
 *
 * 表里只收「有等价写法」的字符。像 ✗ ☆ ● ℃ 这类 KaTeX 给不出对应字形的，
 * 宁可留着警告，也不换成看起来相近、其实不是一个意思的符号。
 */
function buildKatexCharMacros(): Record<string, string> {
  const macros: Record<string, string> = {}
  // ⓪ 与 ①…⑳：圆圈数字
  for (let n = 0; n <= 20; n++) {
    macros[String.fromCodePoint(n === 0 ? 0x24ea : 0x245f + n)] = `\\text{\\textcircled{${n}}}`
  }
  // Ⓐ…Ⓩ / ⓐ…ⓩ：圆圈字母
  for (let i = 0; i < 26; i++) {
    const upper = String.fromCharCode(65 + i)
    const lower = String.fromCharCode(97 + i)
    macros[String.fromCodePoint(0x24b6 + i)] = `\\text{\\textcircled{${upper}}}`
    macros[String.fromCodePoint(0x24d0 + i)] = `\\text{\\textcircled{${lower}}}`
  }
  // ⑴…⒇ 与 ⒈…⒛：带括号/带点的编号
  for (let n = 1; n <= 20; n++) {
    macros[String.fromCodePoint(0x2473 + n)] = `(${n})`
    macros[String.fromCodePoint(0x2487 + n)] = `${n}.`
  }
  // 常见记号里 KaTeX 有等价字形的那些
  Object.assign(macros, {
    '✓': '\\text{\\checkmark}',
    '✔': '\\text{\\checkmark}',
    '★': '\\text{\\bigstar}',
    '•': '\\text{\\bullet}',
    'µ': '\\text{\\mu}',
    '′': '\\text{\\prime}',
    '″': '\\text{\\prime\\prime}',
    '○': '\\text{\\bigcirc}',
    '◆': '\\text{\\blacklozenge}',
    '◇': '\\text{\\lozenge}',
    '■': '\\text{\\blacksquare}',
    '□': '\\text{\\square}',
    '▲': '\\text{\\blacktriangle}',
    '△': '\\text{\\triangle}',
    '▼': '\\text{\\blacktriangledown}',
    '▽': '\\text{\\triangledown}',
  })
  return macros
}

export const KATEX_CHAR_MACROS = buildKatexCharMacros()

// nonStandard：允许公式紧贴中文字符（两侧无空格），符合中文书写习惯
// strict 关掉：笔记里会往公式里打 emoji / 中文（✅、变量名都是汉字），
// KaTeX 本来就渲染不出这些字符，默认的 strict:'warn' 只剩下刷控制台的份
marked.use(markedKatex({ throwOnError: false, nonStandard: true, macros: KATEX_CHAR_MACROS, strict: 'ignore' }))
marked.use({ gfm: true, breaks: true })

/* ---------- 围栏 → 插件 ---------- */

/**
 * 围栏代码块先问注册表：有插件认领这个语言就交给它渲染；没有就返回 false，
 * 交回 marked 的默认渲染（普通代码块）——不认识的语法因此不会变成一片空白。
 *
 * 插件抛异常时同样退回代码块：一个写坏的插件不该让整篇文档渲染不出来
 * （renderFenceWith 内部接住异常并打了日志，这里只负责退化）。
 */
marked.use({
  renderer: {
    code({ text, lang }) {
      const name = (lang ?? '').trim().split(/\s+/)[0] ?? ''
      const plugin = pluginForFence(name)
      if (!plugin) return false
      return renderFenceWith(plugin, text) ?? false
    },
    /**
     * 就地图片（相对路径 / file:///）在**解析期就不发 src**：只标 data-moji-local-src。
     * 浏览器不会自己去请求它——生产里相对 src 会解析到安装目录、file: 会被 CSP 拦，
     * 控制台那串 ERR_FILE_NOT_FOUND 就是这么来的。水合（lib/docImages）按文档目录
     * 读字节后再把 src 贴回去。https/data/blob/moji: 照常发 src，各走各的通道。
     */
    image(token) {
      const href = (token.href ?? '').trim()
      if (!isLocalPendingImageSrc(href)) return false
      return (
        '<img data-moji-local-src="' + attrEscape(href) + '" alt="' + attrEscape(token.text ?? '') + '"' +
        (token.title ? ' title="' + attrEscape(token.title) + '"' : '') +
        ' loading="lazy">'
      )
    },
    /**
     * 手写 HTML 块里的公式（见上面「HTML 块里的公式」）：没有 $ 时原样返回，
     * 与 marked 的默认渲染逐字相同——绝大多数 HTML 块在这条路上零开销。
     */
    html(token) {
      return token.text.includes('$') ? mathInFragment(token.text) : token.text
    },
  },
})

/** 属性值转义（就地图片标记用；正文转义走 marked 自己的机制） */
function attrEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 正文文字：插件对「解析之后的文字」做二次加工（引号染色、符号换色这类，见
 * lib/renderPlugins 的 TextRule）。
 *
 * 为什么挂在这：marked 把正文切成了文字令牌——加粗、斜体、代码、公式各自是别的令牌，
 * 落在 text 上的就是一段**连续的文字**。插件因此不必和 Markdown 语法打架，
 * 代码块与行内代码也天然被排除在外（它们走 code / codespan，不会被染色）。
 *
 * 没有插件认领文字规则时返回 false，交回 marked 的默认渲染：绝大多数文档一条规则都没有，
 * 这条路上不该有任何开销——现在的渲染结果也就不会因为多了这个口子而变一个字节。
 */
marked.use({
  renderer: {
    text(token) {
      const rules = activeTextRules()
      if (!rules.length) return false
      // 与默认渲染一致的两条：带子令牌的交给解析器，已转义的原样输出
      //（token 也可能是 Escape——反斜杠转义出来的那个字符，它没有这两样，直接当文字处理）
      if (token.type === 'text') {
        if (token.tokens) return this.parser.parseInline(token.tokens)
        if (token.escaped) return token.text
      }
      return applyTextRules(token.text, rules)
    },
  },
})

/**
 * 插件的 marked 扩展（行内语法、自定义 renderer）在注册时装进去。
 * 订阅会把已注册的先补一遍，因此内置与用户插件谁先注册都不影响。
 */
onRenderPluginRegistered((plugin) => {
  if (plugin.marked?.length) marked.use(...plugin.marked)
})

/** 只对正文做公式归一化，围栏内（```plot 的 JSON、代码块）原样保留 */
function fixMath(source: string): string {
  return (
    source
      // 模型经工具参数传 LaTeX 时常见把转义多写一层（\\times 而非 \times、
      // \\[ 而非 \[），在 KaTeX 里 \\ 是换行、后续内容就成了普通字母。
      // 双反斜杠后面不是空白时才还原；真正的换行 \\ 后面跟的是空白/换行，不受影响。
      .replace(/\\\\(?![ \t\r\n])/g, '\\')
      // 行间公式要独占段落：marked 开着 breaks，单个换行会变成 <br> 把公式切碎，
      // 因此前后各留一个空行。
      .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
      .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body.trim()}$`)
  )
}

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/
/** 闭合围栏：围栏字符后只能是空白（CommonMark 不允许闭合行带 info 串） */
const FENCE_CLOSE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/

/**
 * 模型常把行内/行间公式写成 LaTeX 原生的 \( … \) 与 \[ … \]，
 * 而 marked-katex 只识别 $…$ 与 $$…$$。这里做一次等价替换，
 * 否则这类公式会以源码形式出现在正文里。
 * 成对出现才替换，避免误伤正文中孤立的转义括号。
 *
 * 按行扫描、跳过围栏代码块：否则代码块/plot JSON 里的反斜杠会被误改。
 */
export function normalizeMathDelimiters(source: string): string {
  const out: string[] = []
  let mode: 'text' | 'code' = 'text'
  let buf: string[] = []
  let fence: string | null = null

  const emit = () => {
    out.push(mode === 'code' ? buf.join('\n') : fixMath(buf.join('\n')))
    buf = []
  }

  for (const line of source.split('\n')) {
    if (mode === 'code') {
      buf.push(line)
      const close = line.match(FENCE_CLOSE)
      // 闭合围栏不能换字符：反引号围栏不会被波浪号闭合；长度也不得短于开栏
      if (close && fence && close[1][0] === fence[0] && close[1].length >= fence.length) {
        emit()
        mode = 'text'
        fence = null
      }
      continue
    }
    const open = line.match(FENCE_OPEN)
    if (open) {
      emit()
      mode = 'code'
      fence = open[1]
    }
    buf.push(line)
  }
  emit()
  return out.join('\n')
}

/* ---------- HTML 块里的公式 ---------- */

/**
 * 手写的 HTML 块（<figure>、<div class="…">、<figcaption> 这些）在 Markdown 里是
 * **原样透传**的：块内不再走行内解析，写在里面的 $…$ 到不了 marked-katex，
 * 只会以源码的样子显示出来（图注从前正是这么坏的）。
 *
 * 这里补一遍：在 html 渲染器里把块内文字的公式按同一套 KaTeX 渲染出来。
 * 挑 html 令牌而不是渲染完的整篇 HTML 再扫一遍，是因为那时已经分不清
 * 「这段文字来自 HTML 块」还是「来自 Markdown 正文」——后者早就由 marked-katex 处理过了。
 *
 * 放在消毒**之前**做：注入的是 KaTeX 自己产出的标记，接下来还要过一遍 DOMPurify，
 * 等于没绕过任何一道检查。
 */
/** 这些元素里的 $ 是字面量（代码），不该被当成公式 */
const MATH_SKIP_TAGS = new Set(['code', 'pre', 'script', 'style', 'annotation'])

/** $$…$$ 优先于 $…$：行间公式可以跨行，行内公式不跨行 */
const MATH_IN_TEXT = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g

function mathInText(text: string): string {
  if (!text.includes('$')) return text
  return text.replace(MATH_IN_TEXT, (raw: string, display?: string, inline?: string) => {
    const tex = (display ?? inline ?? '').trim()
    if (!tex) return raw
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display !== undefined,
        strict: 'ignore',
        // 与 marked-katex 用同一套字符宏，图注里的公式才不会又冒出警告
        macros: KATEX_CHAR_MACROS,
      })
    } catch {
      // 渲染不出来就原样留着：宁可看到源码，也不要让图注整段消失
      return raw
    }
  })
}

/** 只替换「标签之间的文字」，标签本身原样带过；代码元素里的一律不碰 */
function mathInFragment(fragment: string): string {
  const tag = /<\/?([a-zA-Z][\w-]*)\b[^>]*>/g
  let out = ''
  let last = 0
  let skip = 0
  let m: RegExpExecArray | null
  while ((m = tag.exec(fragment)) !== null) {
    const text = fragment.slice(last, m.index)
    out += skip > 0 ? text : mathInText(text)
    const name = m[1].toLowerCase()
    if (MATH_SKIP_TAGS.has(name)) skip += m[0].startsWith('</') ? -1 : 1
    out += m[0]
    last = m.index + m[0].length
  }
  const tail = fragment.slice(last)
  return out + (skip > 0 ? tail : mathInText(tail))
}

/* ---------- 渲染结果缓存 ---------- */

/**
 * renderNote 是纯函数：产物只由源文决定，与任何界面状态无关，因此可以按源文缓存。
 *
 * 为什么要缓存：一份公式多的教学文档，解析 + 消毒要几十毫秒——实测一份 196 个公式的
 * 文档渲染一次 55ms，其中 DOMPurify 消毒 37ms（三分之二）。这些工作发生在渲染期，
 * 直接卡住切换节点的交互。
 * 而同一段内容会被反复渲染——切走再切回来、AI 回复里的同一条消息、目录里同一级标题、
 * 笔记预览的每次开关——每次都从头再算一遍纯属浪费。
 *
 * 上限按「条数 + 总字符数」双重封顶：产物比源文大得多（公式会展开成十几倍的 HTML），
 * 只数条数会让内存随文档变大而失控；只数字符数又可能被海量小片段拖慢淘汰。
 * 淘汰用 Map 的插入顺序当 LRU：命中后重新插入，队首即最久未用。
 *
 * 键就是**源文本身**，插件版本（见 lib/renderPlugins 的 revision）挂在缓存项上。
 * 早先键是拼出来的 `插件版本 + 源文`：那每次查找都要新造一个「带整篇正文的字符串」，
 * 一份 100 KB 的文档就是每次渲染复制并哈希 100 KB（查找、命中后的重排、写入各一次），
 * 而这些查找本身是纯开销——源文是现成的、稳定的字符串，拿它当键能让引擎复用
 * 它自己缓存的哈希，命中率一模一样（同一个源串仍然命中同一项）。
 *
 * 版本对不上的条目当作没命中：源文相同而产物会变的唯一原因就是插件变了。
 * 不认这一条的话，刚启用的插件对已经渲染过的文档完全不起作用——缓存把旧产物原样还回来。
 * 用户插件要重启才生效，也正是为了让这里只认这一个变量。
 */
const RENDER_CACHE_MAX_ENTRIES = 64
const RENDER_CACHE_MAX_CHARS = 6 * 1024 * 1024

/** 缓存项：产物 + 它是哪个插件版本下算出来的（见上面键的说明） */
interface RenderCacheEntry {
  revision: number
  html: string
}

const renderCache = new Map<string, RenderCacheEntry>()
let renderCacheChars = 0

function cacheGet(source: string): string | undefined {
  const hit = renderCache.get(source)
  if (!hit || hit.revision !== renderPluginsRevision()) return undefined
  renderCache.delete(source)
  renderCache.set(source, hit)
  return hit.html
}

function cacheSet(source: string, html: string): void {
  // 同一份源文理论上只会走到这里一次（命中就返回了），但覆盖写也要把旧条目的账减掉，
  // 否则字符数会随调用次数虚高，缓存会被过早清空
  const prev = renderCache.get(source)
  if (prev !== undefined) renderCacheChars -= source.length + prev.html.length
  renderCache.set(source, { revision: renderPluginsRevision(), html })
  renderCacheChars += source.length + html.length
  while (
    (renderCache.size > RENDER_CACHE_MAX_ENTRIES || renderCacheChars > RENDER_CACHE_MAX_CHARS) &&
    renderCache.size > 1
  ) {
    const oldest = renderCache.keys().next().value as string
    const value = renderCache.get(oldest)
    renderCache.delete(oldest)
    renderCacheChars -= oldest.length + (value?.html.length ?? 0)
  }
}

export function renderNote(source: string): string {
  const cached = cacheGet(source)
  if (cached !== undefined) return cached
  const html = marked.parse(normalizeMathDelimiters(source), { async: false }) as string
  const sanitized = sanitizeHtml(html)
  cacheSet(source, sanitized)
  return sanitized
}

/**
 * GitHub 严格语义的渲染：**软换行不折行**（breaks 关掉），其余管线一模一样。
 *
 * 只给外部 md 文件用（LocalDoc 的预览）：那些文件多半来自别人的 repo，
 * 排版遵循 GFM——README 里相邻两行的徽章在 GitHub 上是并排一行行排开的，
 * 而节点文档与对话开着 breaks（中文书写习惯，单个换行就断行），照搬会把
 * 一排徽章竖着摞成一列。缓存键加前缀区分：同一份源文在两种语义下的产物不同，
 * 互不覆盖。
 */
export function renderNoteGfm(source: string): string {
  const key = 'gfm\u0000' + source
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  const html = marked.parse(normalizeMathDelimiters(source), { async: false, breaks: false }) as string
  const sanitized = sanitizeHtml(html)
  cacheSet(key, sanitized)
  return sanitized
}

/**
 * 行内渲染：与 renderNote 同一套解析，但若结果只有一个段落则去掉 <p> 外壳，
 * 让它能嵌在单行里（例如选择题选项，前面还要接序号）。
 */
export function renderInline(source: string): string {
  const html = renderNote(source)
  const m = html.match(/^<p>([\s\S]*)<\/p>\n?$/)
  return m ? m[1] : html
}
