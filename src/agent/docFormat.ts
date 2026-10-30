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

/** 格式 id。内置 hybrid | markdown | html，支持自定义扩展 */
export type DocFormatId = string

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
  /** 是否为用户自定义格式策略 */
  isCustom?: boolean
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

/** 获取所有文档格式策略列表（内置 + 自定义） */
export function allDocFormats(customDocFormats?: DocFormat[]): DocFormat[] {
  return [...DOC_FORMATS, ...(customDocFormats ?? [])]
}

/** 认一个 id（手改过的设置文件、旧数据里可能是别的字符串）；认不出就给默认的那个 */
export function docFormatOf(id: unknown, customDocFormats?: DocFormat[]): DocFormat {
  const all = allDocFormats(customDocFormats)
  return all.find((f) => f.id === id) ?? DOC_FORMATS[0]
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
 * hidden + mark：与 personaMessage 同一个形状家族，也是一条**提示词注入**
 * （inject: 'prompt'，不画分界条、并进过程组——见 agent/messageKind）。
 * id 由调用方给（宿主那一层才有 crypto.randomUUID）。
 * **role 是 assistant**：格式是「怎么做」的声明（见 personaMessage 的分工说明）。
 */
export function docFormatMessage(
  id: DocFormatId,
  at: number,
  uuid: string,
  customDocFormats?: DocFormat[],
): ConversationMessage {
  const format = docFormatOf(id, customDocFormats)
  return {
    id: uuid,
    role: 'assistant',
    parts: [{ type: 'text', text: format.instruction }],
    ts: at,
    hidden: true,
    mark: t('文档格式 · {0}', t(format.label)),
    docFormat: format.id,
    inject: 'prompt',
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

/**
 * 整篇写入教学文档的排版提醒：正文里一处排版痕迹都没有时，在回执里点一句。
 *
 * 为什么值得写在回执里：文档的质量**看不见**。模型交出一篇没有版式的纯文本，
 * 拿到的回执同样只是「正文 N 字」——它没有任何信号说明自己做砸了什么。
 * 提示词里的规范会被长对话冲淡，而回执是每一轮都摆在眼前的东西。
 *
 * **格式策略参与判定**：纯 Markdown 那一档整体不提——它的正文本来就不该有
 * class，提醒只会把模型往反方向推；混合与纯 HTML 下，HTML 的 class 与 Markdown
 * 的结构痕迹（引用 / 表格 / 图表围栏）都算「有排版」，一样都没有才算草稿。
 *
 * 三条边界，都是「别唠叨」：只认教学文档（笔记是学习者自己写的地方）；
 * 只认整篇写入（追加一段散文、改一处措辞本来就不该带排版）；太短的不算（先占个位很正常）。
 * format 由调用方传入（loadAgentSettings().docFormat）——本文件不能反过来依赖 settings。
 */

/** Markdown 侧的结构痕迹：行首引用块、表格行、plot 围栏（与 HTML 的 class 一起算「有排版」） */
const MD_STRUCTURE = /(?:^>|^\s*\|.*\||^```plot)/m

export function layoutHintOf(kind: 'teaching' | 'note', content: string, format: DocFormatId): string {
  if (kind !== 'teaching') return ''
  if (content.length < 400) return ''
  if (format === 'markdown') return ''
  if (/class\s*=/.test(content)) return ''
  if (MD_STRUCTURE.test(content)) return ''
  return (
    '\n（提醒：这份正文里一处排版痕迹都没有。教学文档要有结构——Markdown 的引用 / 表格 / 图表围栏，' +
    '或按「文档排版与视觉呈现」补上提示框 / 两栏 / 步骤 / 图表（以当前「文档格式」策略为准），' +
    '再整份写回一次。）'
  )
}
