/**
 * **Markdown 文档插件** —— 插件里的一类（见 lib/plugins 的宿主）。
 *
 * 这一类管的是「文档里的语法与渲染」，一条插件可以认领三件事，按需组合：
 * 1. `fences` + `render`：认领若干**围栏语言**（```plot、```mermaid 里的那个词），
 *    把源码变成 HTML；
 * 2. `text`：**正文文字规则**——对「已经解析完的正文」做全篇的二次加工（引号染色、
 *    符号换色），详见 TextRule；
 * 3. `hydrate`：正文挂进 DOM 之后执行（画图、动态加载库），返回清理函数。
 *    这正是 ```plot 从第一天起的做法（见 lib/plot 与 lib/builtinPlugins）。
 *
 * 三条边界，都是被现有管线逼出来的，不是随便定的：
 * 1. **render 必须同步**。renderNote 是同步纯函数（产物按源文缓存，见 lib/markdown），
 *    里面塞不进 await。重活一律放 hydrate——那时 DOM 已经在了，库也可以按需 import。
 * 2. **render 的产物照样过 DOMPurify**。插件与正文共用一条消毒管线（见 lib/sanitize），
 *    插件不能因为「它是插件」就绕开检查。
 * 3. **hydrate 往 DOM 里写的东西不过消毒**。它拿的是 DOM API，宿主拦不住，
 *    所以给的是 ctx.html()（消毒）与 ctx.raw()（明确的信任声明）两个口子，作者自己选。
 *
 * 与宿主的分工：登记、开关、装载在 lib/plugins；这里只管这一类的**形状校验**与**派发**
 * （围栏查表、文字规则流水线、hydrate 遍历、样式注入）。
 */
import { t } from '../i18n'
import katex from 'katex'
import type { MarkedExtension } from 'marked'
import {
  definePluginCategory,
  onPluginRegistered,
  onPluginRemoved,
  pluginsOf,
  pluginsRevision,
  registerPlugin,
  type PluginBase,
} from './plugins'
import { sanitizeHtml } from './sanitize'
import { escapeHtml } from './htmlEscape'

/* ---------- HTML 小工具（插件 parse 期用） ---------- */

export { escapeHtml }

/**
 * 把一整段源码塞进 data-* 属性。
 *
 * 用 encodeURIComponent 而不是 HTML 转义：源码里什么都有（引号、换行、反引号），
 * 与 HTML 的转义规则互相干扰时最难查；编码之后属性里只剩安全字符，hydrate 再解回来。
 */
export function encodeAttr(s: string): string {
  return encodeURIComponent(s)
}

/** encodeAttr 的反向操作；属性不在时给空串 */
export function decodeAttr(raw: string | null | undefined): string {
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    // 手改过的 HTML 里可能是半截编码：原样返回好过抛异常
    return raw
  }
}

/* ---------- 这一类的插件形状 ---------- */

/** parse 期交给插件的工具 */
export interface PluginRenderContext {
  /** 文本转义 */
  escape: typeof escapeHtml
  /** 源码 → 可安全放进属性的字符串 */
  attr: typeof encodeAttr
}

/**
 * 宿主代加载的重库：插件脚本自己 import 不了包（见 lib/plugins 的 compilePlugin）。
 *
 * katex 是**静态**引入的：它本来就在主 chunk 里（lib/markdown 静态 import 了它），
 * 这里再写一次 import() 只会让打包器报一句「动态导入无效」——功能没差别，报告有。
 * function-plot（绘图库 ~800KB）继续按需加载：文档里没有图像时不该为它付出代价。
 */
const PLUGIN_LIBS: Record<string, () => Promise<unknown>> = {
  'function-plot': () => import('function-plot'),
  katex: () => Promise.resolve(katex),
}

export type PluginLibName = keyof typeof PLUGIN_LIBS

/** hydrate 期交给插件的工具 */
export interface PluginHydrateContext {
  /** 往元素里写 HTML，**过一遍 DOMPurify**。默认用它 */
  html(el: Element, html: string): void
  /** 同上但不消毒：只有插件自己生成的标记才配用它 */
  raw(el: Element, html: string): void
  /** 读回 encodeAttr 写进属性的源码 */
  readAttr(el: Element, name: string): string
  /** 按需加载宿主白名单里的库；名字不认识或加载失败给 null */
  load(name: PluginLibName): Promise<unknown>
}

/**
 * 一条**正文文字规则**：对「已经解析完的正文文字」做二次加工。
 *
 * 这是与围栏平行的第二条路，解决的是另一类需求：不是「一段语法对应一张图」，
 * 而是「正文里所有引号都染个色」「箭头换个颜色」这种**全篇生效**的小加工。
 * 因此它跑在 marked 的 text 令牌上（见 lib/markdown 的 text 渲染器）：
 * - 拿到的是**解析之后**的纯文字（`**加粗**` 已经是 strong 令牌、公式已经是 KaTeX 的 HTML），
 *   所以不必和 Markdown 语法打架；
 * - **代码块与行内代码天然不在里面**（它们是 code / codespan 令牌），不会把示例代码也染色；
 * - 命中的文字会被自动转义后包进 span：**这条路上注入不了标记**，插件只能给类名或样式。
 *
 * 因此样式只有两种给法：`wrap`（类名，自己配 CSS，或用插件自己的 css）与 `style`（内联样式，
 * 不必写 CSS）。两者都给就是 `<span class style>`。
 */
export interface TextRule {
  /** 要匹配的正文文字。建议带 g（不带也会按全部匹配处理） */
  match: RegExp
  /** 命中的文字包一层 <span class="…"> */
  wrap?: string
  /** 或者给这层 span 一个内联样式（例如 color:#c0392b）；与 wrap 可同时给 */
  style?: string
  /** 只包第 n 个捕获组（例如把 “引号” 里的**引号内文字**染色，引号本身留在外面） */
  group?: number
}

export interface RenderPlugin extends PluginBase {
  /** 认领的围栏语言，大小写不敏感 */
  fences?: string[]
  /** 源码 → 占位 HTML，**同步** */
  render?(source: string, ctx: PluginRenderContext): string
  /** DOM 提交后挂载；返回清理函数（取消在途渲染、丢掉观察者） */
  hydrate?(root: HTMLElement, ctx: PluginHydrateContext): void | (() => void)
  /** 正文文字规则：全篇生效的二次加工（见 TextRule） */
  text?: TextRule[]
  /**
   * 插件自己的样式表，注入到页面一次（全局生效）。
   * 只有 `text` 规则用 `wrap` 类名时才需要它；记得加前缀限定作用域。
   */
  css?: string
  /** 进阶：直接给 marked 的扩展对象（行内语法、自定义 renderer 走这里） */
  marked?: MarkedExtension[]
  /** 额外的一行摘要（设置页显示用；钩子之外的说明，例如「按需加载语法」） */
  summary?: string[]
}

/** 正文文字规则的校验：一条规则至少要能改变点什么（类名或样式），否则它只是白跑一遍正则 */
function normalizeTextRules(raw: unknown): TextRule[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) throw new Error(t('text 必须是数组'))
  const rules: TextRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new Error(t('text 里的每一条都必须是对象'))
    const r = item as Record<string, unknown>
    if (!(r.match instanceof RegExp)) throw new Error(t('text 规则缺少 match（正则）'))
    const wrap = typeof r.wrap === 'string' && r.wrap.trim() ? r.wrap.trim() : undefined
    const style = typeof r.style === 'string' && r.style.trim() ? r.style.trim() : undefined
    if (!wrap && !style) throw new Error(t('text 规则要有 wrap（类名）或 style（内联样式），否则什么都不会变'))
    const group = typeof r.group === 'number' && Number.isInteger(r.group) && r.group > 0 ? r.group : undefined
    rules.push({ match: r.match, wrap, style, group })
  }
  return rules.length ? rules : undefined
}

/** 把外部给的对象校验成这一类插件；不合法就抛一句能直接显示给用户的话 */
function normalize(o: Record<string, unknown>, id: string): RenderPlugin {
  if (o.fences !== undefined && !Array.isArray(o.fences)) throw new Error(t('fences 必须是数组'))
  const fences = Array.isArray(o.fences)
    ? [...new Set(o.fences.map((f) => (typeof f === 'string' ? f.trim().toLowerCase() : '')).filter(Boolean))]
    : []
  // 围栏语言是一对一的：两种语法抢同一个词，文档里该听谁的说不清，所以注册时就拒掉。
  // 查的是「已经登记进来的同类插件」——登记动作由宿主做，此刻新插件还没进注册表。
  for (const lang of fences) {
    const owner = pluginsOf('markdown').find((p) => (p as RenderPlugin).fences?.includes(lang))
    if (owner) throw new Error(t('围栏语言「{0}」已被插件「{1}」认领', lang, owner.name ?? owner.id))
  }
  if (fences.length && typeof o.render !== 'function') throw new Error(t('认领了围栏语言却没有 render()'))
  if (o.render !== undefined && typeof o.render !== 'function') throw new Error(t('render 必须是函数'))
  if (o.hydrate !== undefined && typeof o.hydrate !== 'function') throw new Error(t('hydrate 必须是函数'))
  const builtin = o.builtin === true
  // marked 的扩展装到全局 marked 上就摘不下来：带它的插件关不掉，所以不许做成内置的。
  // （用户插件只在启用时登记，重启后不登记就等于关掉了，没这个问题。）
  const marked = Array.isArray(o.marked) ? (o.marked as MarkedExtension[]) : undefined
  if (builtin && marked) throw new Error(t('内置插件不能带 marked 扩展（marked 的扩展装上去摘不下来，关不掉）'))
  const text = normalizeTextRules(o.text)
  const css = typeof o.css === 'string' && o.css.trim() ? o.css : undefined
  if (!fences.length && !o.hydrate && !marked && !text) {
    throw new Error(t('插件什么都没做（缺 fences / text / hydrate / marked）'))
  }
  return {
    id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : undefined,
    category: 'markdown',
    builtin,
    defaultEnabled: typeof o.defaultEnabled === 'boolean' ? o.defaultEnabled : builtin,
    origin: typeof o.origin === 'string' ? o.origin : undefined,
    fences,
    render: o.render as RenderPlugin['render'],
    hydrate: o.hydrate as RenderPlugin['hydrate'],
    text,
    css,
    marked,
    summary: Array.isArray(o.summary)
      ? (o.summary as unknown[]).filter((s): s is string => typeof s === 'string' && !!s.trim())
      : undefined,
  }
}

/** 设置页里那一行摘要：这个插件到底做了什么 */
function describe(plugin: PluginBase): string[] {
  const p = plugin as RenderPlugin
  const out: string[] = [...(p.summary ?? [])]
  if (p.fences?.length) out.push(p.fences.map((f) => '```' + f).join(' '))
  if (p.text?.length) out.push(t('{0} 条正文规则', p.text.length))
  if (p.hydrate) out.push(t('挂载 DOM'))
  if (p.marked?.length) out.push(t('marked 扩展'))
  return out
}

definePluginCategory({
  id: 'markdown',
  label: 'Markdown 文档插件',
  hint: '文档里的语法与渲染：认领围栏语言、加工正文文字、挂载 DOM。',
  normalize,
  describe,
  // 用户插件（数据目录里的 .js）不写 category 时按这一类算：那些文件本来就是写文档语法的
}, { fallback: true })

/* ---------- 这类插件自己的查表 ---------- */

const fenceOwner = new Map<string, RenderPlugin>()

/**
 * 所有插件的正文文字规则拼成的一条流水线；插件增删时清掉重建。
 * 缓存在这里是因为 text 渲染器**每个文字令牌都要问一次**，不能每次都新建数组。
 */
let textRulesCache: TextRule[] | null = null

/** 插件自己的样式表注入后留下的 <style>，关掉时要一起收走 */
const styleTags = new Map<string, HTMLStyleElement>()

function injectCss(plugin: RenderPlugin): void {
  if (!plugin.css || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.mojiPlugin = plugin.id
  style.textContent = plugin.css
  document.head.appendChild(style)
  styleTags.set(plugin.id, style)
}

function removeCss(plugin: RenderPlugin): void {
  styleTags.get(plugin.id)?.remove()
  styleTags.delete(plugin.id)
}

// 登记/注销时维护这一类的派生状态：围栏归谁、文字规则流水线、注入的样式
onPluginRegistered((plugin) => {
  if (plugin.category !== 'markdown') return
  const p = plugin as RenderPlugin
  for (const lang of p.fences ?? []) fenceOwner.set(lang, p)
  textRulesCache = null
  injectCss(p)
})

onPluginRemoved((plugin) => {
  if (plugin.category !== 'markdown') return
  const p = plugin as RenderPlugin
  for (const lang of p.fences ?? []) if (fenceOwner.get(lang) === p) fenceOwner.delete(lang)
  textRulesCache = null
  removeCss(p)
})

/** 这一类的插件，按登记顺序 */
export const renderPlugins = (): RenderPlugin[] => pluginsOf('markdown') as RenderPlugin[]

/** 某个围栏语言归谁管；没人认领给 undefined */
export const pluginForFence = (lang: string): RenderPlugin | undefined => fenceOwner.get(lang.toLowerCase())

/** 插件版本号：文档渲染的缓存键里带着它（见 lib/markdown） */
export const renderPluginsRevision = (): number => pluginsRevision()

/**
 * 登记一个 markdown 文档插件。id、围栏语言与已有插件撞了就抛异常
 * （调用方决定是报错还是跳过）。用户插件在启动时登记一次，改了插件要重启才生效。
 */
export function registerRenderPlugin(raw: unknown, fallbackId = ''): RenderPlugin {
  return registerPlugin(raw, fallbackId) as RenderPlugin
}

/** 「有新插件登记」的订阅（lib/markdown 用它把 marked 扩展装进去） */
export function onRenderPluginRegistered(cb: (plugin: RenderPlugin) => void): void {
  onPluginRegistered((plugin) => {
    if (plugin.category === 'markdown') cb(plugin as RenderPlugin)
  })
}

/* ---------- 解析期派发 ---------- */

const RENDER_CTX: PluginRenderContext = { escape: escapeHtml, attr: encodeAttr }

/**
 * 用插件渲染一段围栏。**这里把插件的异常接住**：一个插件写坏了不该让整篇文档
 * 渲染不出来，退化成代码块（交给 marked 默认渲染）比一片空白强。
 */
export function renderFenceWith(plugin: RenderPlugin, source: string): string | null {
  if (!plugin.render) return null
  try {
    const html = plugin.render(source, RENDER_CTX)
    return typeof html === 'string' ? html : null
  } catch (err) {
    console.warn(`插件「${plugin.id}」渲染失败`, err)
    return null
  }
}

/** 所有插件认领的文字规则，按登记顺序拼成一条流水线；没人认领时是空数组 */
export function activeTextRules(): TextRule[] {
  if (!textRulesCache) {
    const all: TextRule[] = []
    for (const p of renderPlugins()) if (p.text?.length) all.push(...p.text)
    textRulesCache = all
  }
  return textRulesCache
}

/**
 * 把规则作用在一段**已经解析完的正文文字**上，返回 HTML。
 *
 * 三件事的顺序不能换：
 * 1. **先匹配、后转义**：这时候引号还是引号，不是 &quot;——插件写的正则是给人看的，
 *    不该逼它去猜 HTML 实体的写法；
 * 2. 规则之间**先到先得**：一段文字被前面的规则包住了，后面的规则就不再碰它。
 *    不这么做就会出现 span 套 span，同一段字被染两遍；
 * 3. 没命中的部分原样转义输出，**与 marked 的默认行为逐字节一致**——
 *    插件没命中时，正文不该因为走了这条路而变样（这条有用例钉着）。
 */
export function applyTextRules(text: string, rules: TextRule[]): string {
  const hits: Array<{ start: number; end: number; html: string }> = []
  for (const rule of rules) {
    // 正则不带 g 也要全文匹配：lastIndex 在一个共用实例上会互相干扰，所以每次重新造一个
    const re = rule.match.global ? rule.match : new RegExp(rule.match.source, rule.match.flags + 'g')
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      // 空匹配（例如 /(?=x)/）会原地打转，跳过它
      if (m[0] === '') {
        re.lastIndex++
        continue
      }
      const start = m.index
      const end = start + m[0].length
      if (hits.some((h) => start < h.end && end > h.start)) continue
      hits.push({ start, end, html: ruleHtml(rule, m) })
    }
  }
  if (!hits.length) return escapeHtml(text)
  hits.sort((a, b) => a.start - b.start)
  let out = ''
  let at = 0
  for (const h of hits) {
    out += escapeHtml(text.slice(at, h.start)) + h.html
    at = h.end
  }
  return out + escapeHtml(text.slice(at))
}

/** 一条规则命中后的 HTML：整段（或指定的捕获组）包进带类名/样式的 span，文字一律转义 */
function ruleHtml(rule: TextRule, m: RegExpExecArray): string {
  const attrs =
    (rule.wrap ? ` class="${escapeHtml(rule.wrap)}"` : '') +
    (rule.style ? ` style="${escapeHtml(rule.style)}"` : '')
  const span = (s: string): string => `<span${attrs}>${escapeHtml(s)}</span>`
  if (!rule.group) return span(m[0])
  const inner = m[rule.group]
  if (inner === undefined || inner === '') return escapeHtml(m[0])
  // 只包捕获组：组前后那部分（例如引号本身）原样留在 span 外面
  const at = m[0].indexOf(inner)
  if (at < 0) return span(m[0])
  return escapeHtml(m[0].slice(0, at)) + span(inner) + escapeHtml(m[0].slice(at + inner.length))
}

/* ---------- 挂载期派发 ---------- */

const HYDRATE_CTX: PluginHydrateContext = {
  html: (el, html) => {
    el.innerHTML = sanitizeHtml(html)
  },
  raw: (el, html) => {
    el.innerHTML = html
  },
  readAttr: (el, name) => decodeAttr(el.getAttribute(name)),
  load: async (name) => {
    const loader = PLUGIN_LIBS[name]
    if (!loader) {
      console.warn(`插件请求了不在白名单里的库：${name}`)
      return null
    }
    try {
      return await loader()
    } catch (err) {
      console.warn(`库 ${name} 加载失败`, err)
      return null
    }
  },
}

/**
 * 挂载 root 内所有插件产物；返回一个把它们的清理函数串起来的函数。
 * MarkdownView 每次重建正文都会重新挂一次（与 lib/plot 的 hydratePlots 同一时机）。
 */
export function hydrateRenderPlugins(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  for (const plugin of renderPlugins()) {
    if (!plugin.hydrate) continue
    try {
      const cleanup = plugin.hydrate(root, HYDRATE_CTX)
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    } catch (err) {
      console.warn(`插件「${plugin.id}」挂载失败`, err)
    }
  }
  return () => {
    for (const fn of cleanups) {
      try {
        fn()
      } catch (err) {
        console.warn('插件清理失败', err)
      }
    }
  }
}
