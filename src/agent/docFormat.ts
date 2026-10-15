import type { ConversationMessage } from './types'
import { t } from '../i18n'

/**
 * 文档格式策略：教学文档「怎么排、用什么写」的三种模式。
 *
 * **与导师人格同一套机制**（见 agent/persona 顶部那段说明）：不进系统提示词，
 * 而是以一条隐藏的 user 消息进入上下文。这么安排的理由与人格相同：
 *
 * 1. **前缀缓存**：系统提示词是上下文最前面那一段。格式写进去，用户每换一次格式，
 *    从第一个 token 起就与上一轮不同，服务端缓存整段作废——而格式恰恰是
 *    「一边聊一边换」的东西（这篇想要纯 Markdown，下一篇又想要排版丰富的讲义）。
 * 2. **不重发历史**：格式变了只需在切换到的那一刻补一句「从现在起按这种格式来」，
 *    之前的对话一条都不用重讲。
 *
 * 系统提示词里那份「以 Markdown 为主、HTML 只作补充」的排版规范（RICH_CONTENT_GUIDE）
 * 是固定的、不能动的——所以「纯 Markdown / 纯 HTML」这两种覆盖态尤其依赖这里
 * 的指令在上下文里把口径掰过来：指令里明确写了「覆盖系统提示词的排版规范」。
 *
 * 代价与人格一样：「什么时候补这一句」要有个准头（见 needsDocFormatAnnounce）——
 * 一条对话里只补一次，被压缩掉之后要能补回来。
 */

/** 三种格式的 id。存进设置与消息里，改名会让老数据认不出来，所以取语义化的短词 */
export type DocFormatId = 'hybrid' | 'markdown' | 'html'

export interface DocFormat {
  id: DocFormatId
  /** 列表里的名字：混合（Markdown 为主） / 纯 Markdown / 纯 HTML */
  label: string
  /** 短名：按钮提示与空间紧张处用 */
  short: string
  /** 一句话说明（二级菜单里的副标题） */
  desc: string
  /** 进入上下文的那一整段指令（自足：模型看不到别的解释） */
  instruction: string
}

/**
 * 混合（默认/推荐）：Markdown 为主、HTML 只作补充——**Markdown 能实现的一律用 Markdown**，
 * HTML 留给交互与复杂结构（两栏对照、提示框、时间轴、图表容器）。
 *
 * 它也要有自己的指令文本（而不是「默认就不注入」）：用户从别的格式切回来时，
 * 必须有一条新的指令把口径掰回默认，否则上下文里最后生效的还是旧格式的要求。
 */
const HYBRID = [
  '【文档格式 · 混合（Markdown 为主）】',
  '从现在起，你写的教学文档采用「混合」格式（这是默认/推荐策略）：**Markdown 能实现的一律用 Markdown，HTML 只作补充**——',
  '- 标题、段落、列表、强调、表格、引用、代码块：全部用标准 Markdown 语法表达；数学公式照旧用 LaTeX（$…$ / $$…$$）；',
  '- HTML + Tailwind 只用在 Markdown 做不到的地方：交互（按钮、折叠）与复杂结构（两栏对照、提示框、时间轴、图表容器）；',
  '- 用 HTML 时遵守正文排版规范（em 字号、主题令牌、宽度上限），完整配方见 doc-html 提示词模块。',
].join('\n')

/**
 * 纯 Markdown：整篇只用标准 Markdown 语法（含 LaTeX 与 ```plot），不写任何 HTML 元素。
 *
 * 指令里必须显式声明「覆盖系统提示词」——否则模型两头看到相反的要求，
 * 会在文档里折中出一锅夹生饭（半套 HTML 半套 Markdown）。
 * 「主流编辑器兼容」是这一档的硬要求：除了本应用的渲染器，写出来的正文
 * 还要能在 Obsidian / Typora / GitHub 这类地方原样渲染。
 */
const MARKDOWN = [
  '【文档格式 · 纯 Markdown】',
  '从现在起，你写的教学文档只用标准 Markdown 语法——**这条策略覆盖系统提示词里的排版规范：不写任何 HTML 元素**（标签、Tailwind 类、内联样式、内嵌 SVG 与动画，全都不用）：',
  '- 标题 #/##/###、强调 **……**、列表 -、引用 >、表格用 Markdown 表格、代码块用围栏；',
  '- 数学公式用 LaTeX（$…$ / $$…$$）；图形用 ```plot 等 Markdown 生态内的表达；',
  '- **兼容性优先**：只用主流 Markdown 编辑器（Obsidian / Typora / GitHub 等）都能识别的标准写法，不用方言扩展；',
  '- 需要排版层次时用 Markdown 自身的层级（引用块、分隔线、列表嵌套）表达；',
  '- 已有文档的局部修改保持它当前的写法；只有新建或整篇重写才完全按本策略。',
].join('\n')

/**
 * 纯 HTML：整篇用 HTML 表达（本项目此前版本的默认排版策略），
 * 唯一例外是数学公式——保持 $…$ / $$…$$ 的 LaTeX 形式。
 */
const HTML = [
  '【文档格式 · 纯 HTML】',
  '从现在起，你写的教学文档整篇用 HTML 表达：除数学公式外，一切内容都用 HTML 标签书写，不借助 Markdown 兜底渲染——',
  '- 标题 <h2>/<h3>、段落 <p>、列表 <ul>/<ol>/<li>、强调 <strong>/<em>、行内代码 <code>、表格 <table>，全部带 Tailwind 字号与墨色类；',
  '- 布局、提示框、时间轴、图表、动画一律走 HTML 配方（见 doc-html 提示词模块）；',
  '- **唯一例外是数学公式**：照旧圈在 $…$ / $$…$$ 里用 LaTeX 写，不受「全 HTML」约束；',
  '- 已有文档的局部修改保持它当前的写法；只有新建或整篇重写才完全按本策略。',
].join('\n')

export const DOC_FORMATS: DocFormat[] = [
  {
    id: 'hybrid',
    label: '混合（Markdown 为主）',
    short: '混合',
    desc: 'Markdown 优先，HTML 只做交互与复杂结构',
    instruction: HYBRID,
  },
  {
    id: 'markdown',
    label: '纯 Markdown',
    short: 'Markdown',
    desc: '只用 Markdown 语法（含 LaTeX / plot），最大兼容',
    instruction: MARKDOWN,
  },
  {
    id: 'html',
    label: '纯 HTML',
    short: 'HTML',
    desc: '整篇 HTML 表达，仅公式保留 $$',
    instruction: HTML,
  },
]

/** 默认格式。老设置文件里没有这一项时按它走 */
export const DEFAULT_DOC_FORMAT: DocFormatId = 'hybrid'

/** 认一个 id（手改过的设置文件、旧数据里可能是别的字符串）；认不出就给默认的那个 */
export function docFormatOf(id: unknown): DocFormat {
  return DOC_FORMATS.find((f) => f.id === id) ?? DOC_FORMATS[0]
}

/**
 * 这一段对话里，当前格式**交代过了没有**。
 *
 * 与 needsPersonaAnnounce 同一条判据：活着的消息里有没有一条带着这个格式 id 的——
 * 失活的（已经折进摘要）不算，那些消息不再进上下文，模型根本看不见它们。
 * 所以压缩之后格式会自动补一次，长对话聊到一半不会悄悄变回默认排版。
 */
export function needsDocFormatAnnounce(messages: ConversationMessage[], id: DocFormatId): boolean {
  return !messages.some((m) => !m.retired && m.docFormat === id)
}

/**
 * 那条「从现在起按这种格式写」的隐藏消息。
 *
 * hidden + mark：与 personaMessage 同一个形状家族——用户看得见一条分界条
 * （知道导师换了写法），正文只在上下文里。id 由调用方给（宿主那一层才有 crypto.randomUUID）。
 */
export function docFormatMessage(id: DocFormatId, at: number, uuid: string): ConversationMessage {
  const format = docFormatOf(id)
  return {
    id: uuid,
    role: 'user',
    parts: [{ type: 'text', text: format.instruction }],
    ts: at,
    hidden: true,
    mark: t('文档格式 · {0}', t(format.label)),
    docFormat: format.id,
  }
}

/**
 * 内容触发的提示词模块在当前格式下要不要注入（见 learn/ai/promptModules 的
 * promptModuleForContent 与 agent/sandbox/execute 的注入点）。
 *
 * 目前只有一条规矩：**纯 Markdown 策略下不注入 doc-html**——那份模块整篇是
 * HTML + Tailwind 的排版配方，与策略直接冲突；把它注进去，模型会在两条相反
 * 的要求之间折中。别的模块（plot-forms、rich-animation 等）与格式无关，照旧。
 */
export function docFormatAllowsModule(key: string, format: DocFormatId): boolean {
  return !(format === 'markdown' && key === 'doc-html')
}
