import type { Conversation } from '../agent/types'
import type { Drafts } from './drafts'
import type { Exam } from './exam'
import type { DocWorkspace } from './groups'
import type { ScheduleStore } from './schedule'
import type { StaticResource } from './static'
import type { StructureMap } from './structure'

/**
 * 探索式学习数据模型（v2）。
 *
 * 与上一版的关键差异：节点的「拆解」不再由 AI 全权负责，而是用户在文档里
 * 选中陌生概念后手动创建子节点。因此：
 * - description：概念简述，**由 Agent 自己写**（不再在创建节点时预生成）
 * - docs：一个节点带多份文档——教学文档（AI 撰写）与笔记文档（学习者与 AI 都能读写），
 *   见 DocKind；文档之间可以用 moji:doc 链接互相跳转
 * - goalId：归属的学习目标，决定侧栏分组与回溯根的起点
 *
 * 会话（context）的隔离单位是**目标**而不是节点：一个目标一份上下文，
 * 目标衍生出的所有节点共用它（见 agent/types 的 Conversation.goalId）。
 */

/**
 * 节点的掌握状态只有两种；改动权归 Agent（考试通过后置为 mastered）。
 *
 * 它回答的是「这个节点学完了没有」——一个用于放行/回溯的粗判据。
 * 「最近打开过没有」是另一件事，记在 KnowledgeNode.lastStudiedAt（见 learn/recents）。
 */
export type MasteryStatus = 'learning' | 'mastered'

/**
 * 一个节点带哪几份文档。
 *
 * - teaching：教学文档。Agent 讲解与推导的正文，界面上默认展示的就是它。
 * - note：笔记。学习者自己那份——摘录、疑问、自己的例子，Agent 也能读写
 *   （「把刚才讲的整理进我的笔记」这类要求就落到这里）。
 *
 * 教学文档与笔记是平级的：各有各的落盘文件、各自被单独改写，因此可以用 `moji:doc`
 * 链接互相跳转（见 lib/docLink）。区别在于**笔记不是一份而是多份**：一个节点可以有
 * 任意多份笔记，每份都是一个独立文件（见 NoteFile），可以新建、命名、改名、删除。
 * DocKind 里保留 'note' 是因为 Agent 的 api.doc 仍按这个词寻址（"笔记" / "笔记/名称"）。
 */
export const DOC_KINDS = ['teaching', 'note'] as const
export type DocKind = (typeof DOC_KINDS)[number]

export const DOC_LABEL: Record<DocKind, string> = {
  teaching: '教学文档',
  note: '笔记',
}

/**
 * 节点的文档集合。
 *
 * 现在只剩教学文档一份：笔记改成了「一节点多份独立文件」（见 NoteFile 与 node.notes），
 * 不再挤在这个 Record 里——两处各存一份内容必然会分家。
 */
export interface NodeDocs {
  teaching: string
}

export function emptyDocs(): NodeDocs {
  return { teaching: '' }
}

/**
 * 一份笔记：**一个独立文件**。
 *
 * id 是它的持久 uuid（节点宇宙里笔记节点的身份，见 learn/nodeKinds）——改名不改 id，
 * 页签、画布坐标、agent 句柄都靠它稳住。name 既是列表里显示的名字，也是磁盘上的
 * 文件名（`{节点}.notes/{name}.md`）——两者必须一致：用户在界面上改的就是文件名本身，
 * 否则「改名」会变成一句空话。因此它的取值一律过 sanitizeSegment（见 learn/notes 的
 * uniqueNoteName），非法字符在**创建/改名那一刻**就被换掉，而不是等到落盘时才悄悄变形。
 */
export interface NoteFile {
  /** 持久 uuid（创建时分配，改名不变）；老数据在读盘那一刻补上
   *   （见 files/nodeFile 的 contentOfParts / files/parse 的 readNotes） */
  id: string
  /** 笔记名 = 文件名（不含扩展名） */
  name: string
  /** Markdown 正文 */
  content: string
  createdAt: number
  updatedAt: number
}

export function isDocKind(v: unknown): v is DocKind {
  return v === 'teaching' || v === 'note'
}

/**
 * 一份超级文档：Agent 生成的**可交互 HTML 文档**，绑定在一个节点上。
 *
 * 与笔记（NoteFile）同构——一个节点可以有好几份——但它是完整的
 * HTML 而不是 Markdown：里面可以带 <style> 与 <script>。渲染走沙箱化的 iframe
 * （见 components/learn/SuperDocView），脚本**永远不会**跑在应用页面本身里；
 * 脚本里唯一对外的口子是 api.method.call(...)（见 learn/methods），
 * 它把调用转发回宿主执行目标级持久化的函数。
 *
 * id 是持久 uuid（节点宇宙里超级文档节点的身份，改名不变）；名字是显示与页签身份。
 * 只存在 state.json 里、不做磁盘镜像（笔记那种 {节点}.notes/*.md 的待遇）：
 * 它是给渲染器消费的交互件，不是要在文件管理器里直接打开的素材。
 */
export interface SuperDocFile {
  /** 持久 uuid（创建时分配）；老数据在读盘那一刻补上（见 files/nodeFile） */
  id: string
  name: string
  html: string
  createdAt: number
  updatedAt: number
}

/** 一个节点的全部超级文档；老节点没有这一项时按空数组处理 */
export function superDocsOf(node: { superdocs?: SuperDocFile[] }): SuperDocFile[] {
  return node.superdocs ?? []
}

/**
 * 一个目标的游离挂件池（见 LearnStore.detached）。
 * 实体在这里与「绑在某份文档的 parts 里」二选一：剪线 = 挪进池子（内容原样），
 * 绑定 = 挪出池子挂到宿主。id 全程不变——页签、坐标、agent 句柄都靠它稳住。
 */
export interface DetachedPool {
  notes: NoteFile[]
  superdocs: SuperDocFile[]
}

/* ---------- 大纲（outline）：每个目标一份，交互页消费 ---------- */

/**
 * 大纲里的一条子目标。
 *
 * key 是标题的归一化形式（normalizeKey）：它与节点创建时的 key 是同一套口径，
  所以「大纲里计划的这个子目标」与「真的建出来的那个节点」靠 key 对上号——
 * 同一目标内 key 唯一（addNode 按它去重），标题一致就必然命中。
 */
export interface OutlineEntry {
  /** 归一化去重键（= normalizeKey(title)，由写入方自动生成，不由模型编） */
  key: string
  /** 子目标的标题（将来创建节点时就用它） */
  title: string
  /** 这个子目标学什么、为什么在这一层：导师规划时写给学习者看的一段话 */
  summary: string
}

/**
 * 一个目标的大纲。
 *
 * **它不是一份普通文档**：教学文档是 Markdown、源码与预览两种看法；大纲是结构化的
 * 计划（导语 + 子目标清单），页签里打开是一个交互页面——条目可以展开（展开的是
 * 那个子目标自己的大纲）、带着每个子目标的学习情况。落盘是每个节点一个
 * `{节点}.outline.json`（与教学文档 `{节点}.md` 一一配对，「创建节点时两份文件同时生成」）。
 *
 * **深度规矩（写进导师的指令，也写进这里）**：大纲只描述**直接子层级**，一层为止——
 * 爷爷知道儿子的存在，但不知道孙子的存在。孙辈出现在哪个大纲里，由子目标自己的
 * outline 负责；交互页展开子条目时读的正是那份 outline，逐层展开直到叶子。
 */
export interface OutlineDoc {
  /** 导语：这个目标本身是什么、路线怎么走（导师写的一两段话） */
  intro: string
  /** 直接子层级目标，顺序即学习顺序；只此一层（见上面的深度规矩） */
  children: OutlineEntry[]
  updatedAt: number
}

/** 建节点时同步生成的那份空大纲：教学文档与大纲两个文件在这一刻同时成形 */
export function emptyOutline(): OutlineDoc {
  return { intro: '', children: [], updatedAt: 0 }
}

/** 一个节点的大纲；老节点没有这一项时为 null（交互页据此显示「还没有大纲」） */
export function outlineOf(node: { outline?: OutlineDoc }): OutlineDoc | null {
  return node.outline ?? null
}

/**
 * **游离大纲**实体：不依附任何文档、独立长在树上的计划节点（分类层）。
 *
 * 与附身大纲（`node.outline`，文档先在、计划后补）是一对孪生：两者在节点宇宙里
 * 共用 `o:` 前缀的 uuid（游离实体的 id 就是 `o:` 后面那一段），画布与 agent 看到
 * 的是同一种「大纲节点」；区别只在**有没有宿主文档**——游离大纲没有内容文档卡，
 * 它下面的文档是子级（叶子），不是「它自己的正文」。上级大纲当分类、底层大纲当
 * 指导的分类树就靠它长出来。落盘在目标目录的 outlines.json（游离大纲与以游离
 * 大纲为起点的树边；一个目标一张都没有就不写文件）。
 */
export interface OutlineEntity {
  /** 实体 id：图上 uuid 是 `o:{id}`；与文档 id 同空间但不重叠（建时校验） */
  id: string
  goalId: string
  /** 显示名（没有宿主文档，标题自己管；附身大纲显示的是宿主文档的标题） */
  title: string
  /** 导语与目标项：形状与 OutlineDoc 相同（一层为止的规矩也相同） */
  intro: string
  children: OutlineEntry[]
  createdAt: number
  updatedAt: number
}

/**
 * 一条目标级持久化函数（method，见 learn/methods）。
 *
 * code 是一段**匿名 async 函数源码**（与 execute 的 body 同一种写法），
 * 第一个参数是 api（沙箱的整套 api），其余参数是调用方传的实参：
 *
 *     ((api, path, needle) => { ... return (await (await api.node.get(uuid)).content).teaching.includes(needle) })
 *
 * name 就是身份（同目标内唯一，create 同名覆盖）。它存在的意义是「复用」：
 * 超级文档的按钮调 api.method.call('函数名', 实参)，宿主编译执行并把结果送回去——
 * 函数体里照样能用 doc.read 那一整套，于是「查某文档有多少个句号」这类活
 * 写一次，任何一份超级文档都能调。
 */
export interface MethodEntry {
  name: string
  code: string
  createdAt: number
  updatedAt: number
}

/** 目标 id → 函数清单。跟着 state.json 一起落盘（与 minds 同一种归档方式） */
export type MethodStore = Record<string, MethodEntry[]>

/** 一个节点的全部笔记；老数据没有这一项时按空数组处理 */
export function notesOf(node: { notes?: NoteFile[] }): NoteFile[] {
  return node.notes ?? []
}

/**
 * 取某个节点的某份文档正文。
 *
 * 'note' 取的是**第一份笔记**：这个函数是给「只关心有没有内容 / 拿一段上下文」的调用方
 * 用的（Agent 的默认笔记、选段提问的上下文等）。要指名某一份笔记，走 learn/notes 的
 * findNote 或 paths 的「笔记/名称」寻址——别在这里加第二个参数，那会让「哪一份」这件事
 * 散到每个调用点上。
 */
export function docOf(node: { docs: NodeDocs; notes?: NoteFile[] }, kind: DocKind): string {
  if (kind === 'note') return node.notes?.[0]?.content ?? ''
  return node.docs?.teaching ?? ''
}

/**
 * 「了解」/「注解」：不建节点，只在正文某处挂一段释义或学习者自己的批注。
 *
 * 存在节点数据里而不是正文里，是为了不往 Markdown 源文插入任何语法——
 * 否则注解词若位于粗体/斜体内部，插入的链接会顶开强调定界符，
 * 导致 `**` 退化成字面量（见 MarkdownView 的渲染期注解）。
 */

/**
 * 注解来源：
 * - understand：选中后点「了解」，由 AI 生成的一两句短释义，只读
 * - note：选中后点「注解」，用户自己写的批注，支持 Markdown，可修改/删除
 *   （kind 的取值 'note' 是历史命名，界面上叫「注解」，与笔记文档是两回事）
 * 两者共用同一套悬停浮层；用户批注的浮层带操作按钮，因此是可交互的。
 */
export type AnnotationKind = 'understand' | 'note'

/**
 * 注解文字的显示样式：让用户给自己标记过的文字加视觉区分。
 *
 * 颜色只存调色板的 key（如 'seal'），渲染时映射成主题变量——
 * 这样深色模式自动适配，也避免把任意 CSS 写进数据。
 */
export interface AnnotationStyle {
  /** 前景色（调色板 key） */
  fg?: string
  /** 背景色（调色板 key，渲染为低透明度底色） */
  bg?: string
  underline?: boolean
  strike?: boolean
  bold?: boolean
  italic?: boolean
}

export interface Annotation {
  /** 被注解的词 */
  term: string
  /** 悬停显示的释义，可含 Markdown 与 LaTeX */
  body: string
  /** 省略视为 understand（兼容旧数据） */
  kind?: AnnotationKind
  /** 文字样式（可选） */
  style?: AnnotationStyle
  /**
   * 词条是正文里第几次出现（从 0 起）。省略 = 第一次（兼容旧数据）。
   *
   * 没有它就只会标到第一次出现的那处：同一段话里「函数」出现了三回，
   * 用户在第三回上划词写笔记，标记却落在第一回——看着就像「标错了地方」。
   * 记的是出现序号而不是 DOM 位置：正文每次重渲染都是全新的节点，
   * 位置存不下来，序号在正文没改之前一直有效（正文改了则回落到第一次出现）。
   */
  occurrence?: number
}

export interface KnowledgeNode {
  id: string
  title: string
  /** 归一化去重键（normalizeKey 生成），在同一目标内唯一 */
  key: string
  /** 概念描述；由 Agent 写，供界面展示与「这是什么」的快速回看 */
  description: string
  /** 教学文档（AI 写的讲解正文），Agent 可读写 */
  docs: NodeDocs
  /**
   * 这个节点下的全部笔记，顺序即列表顺序（新建的追加在末尾）。
   * 每份都是一个独立文件，可以单独命名 / 改名 / 删除（见 NoteFile）。
   */
  notes: NoteFile[]
  /** 这个节点下的全部超级文档（可交互 HTML，见 SuperDocFile）；老数据没有按空数组处理 */
  superdocs?: SuperDocFile[]
  /**
   * 这个目标的大纲（见 OutlineDoc）。创建节点时与教学文档**同时**生成（一份空的大纲文件），
   * 内容由导师经大纲节点的 editContent 写入；老数据没有这一项，交互页按「还没有大纲」处理。
   */
  outline?: OutlineDoc
  /** 「了解」注解；渲染期套在正文对应词上，不改动 content */
  annotations: Annotation[]
  /**
   * 思维导图上这个节点自定义的底色（右键节点改色）。
   *
   * 存的是调色板的**名字**（见 components/learn/outline/mindmapTint 的 TINT_PALETTE），
   * 不是色值——色值跟着主题走（浅色/深色/纸色几套主题各有一套映射），存色值会在换主题时
   * 变成一块对不上号的颜色。没这一项就是「随分支走」（默认）。
   */
  tint?: string
  status: MasteryStatus
  /** 最近一次打开这个知识点的时间（「最近打开」排序用，见 learn/recents）；没打开过就没有 */
  lastStudiedAt?: number
  origin: 'ai' | 'user'
  goalId: string
  createdAt: number
  updatedAt: number
}

/**
 * 依赖边：from 依赖 to。from 是上层（较接近目标），to 是它的前置知识。
 *
 * 两端都是**树成员 id**：文档 = 节点 id；大纲 = `o:{大纲实体id}`（附身大纲的实体 id
 * 就是宿主文档 id，游离大纲是自己的 id）。`to` 以 `o:` 开头即「接在大纲卡上」的
 * 嵌套子级（分类链）；`from` 只在父级是**游离大纲**时才带 `o:` 前缀（附身大纲那一层
 * 的边仍以宿主文档 id 为准，画布上派生成「从它的大纲出发」）。
 */
export interface DependencyEdge {
  from: string
  to: string
  createdAt: number
  /** 下游对上游固定接口的认领（下游侧有效；挂件绑定不走树边，没有这个字段） */
  portKey?: string
}

export interface LearningGoal {
  id: string
  title?: string
  rootNodeId: string
  question: string
  createdAt: number
  updatedAt: number
}

/* ---------- 自由页签（像 vscode 那样） ---------- */

/**
 * 一个页签指向什么。
 *
 * 三种来源平级地摆在同一条页签栏上：节点的教学文档、节点的某一份笔记、以及磁盘上
 * 任意一个外部文件（拖进来或从本地文件列表点开的）。「页签」是**视图**的概念，
 * 与知识树没有从属关系——关掉一个教学文档的页签，节点本身照旧在树里。
 */
export type TabRef =
  /** 某个节点的教学文档 */
  | { kind: 'teach'; nodeId: string }
  /** 某个节点的某一份笔记（note 是笔记名，见 NoteFile） */
  | { kind: 'note'; nodeId: string; note: string }
  /** 某个节点的某一份超级文档（name 是它的名字，见 SuperDocFile） */
  | { kind: 'super'; nodeId: string; name: string }
  /**
   * 某一次考试的只读副本：卷子原件 + 那次作答 + 判分 + 错题讲解。
   * 认的是**考试**（attemptId），不是试卷——同一份卷子考两次，副本各是各的。
   */
  | { kind: 'exam'; nodeId: string; examId: string; attemptId: string }
  /**
   * 某个目标的大纲页（交互页面，见 OutlineDoc）。它不是源码/预览那种文档视图——
   * 渲染层见到它就走大纲自己的组件，不进 DocPane。
   */
  | { kind: 'outline'; nodeId: string; goalId?: string }
  /** 磁盘上的外部文件（绝对路径） */
  | { kind: 'local'; path: string; title?: string }
  /**
   * 工作区（项目）里的**内部文件**：nodeId 是它的工作区所属的节点（目标根节点就是
   * `docs/{目标}/workspace/`），seg 是**相对那个工作区目录**的路径（如 `项目A/README.md`）。
   *
   * 为什么存相对段而不是完整磁盘路径：节点目录会随标题改名跟着搬（见 learn/workspace）——
   * 存相对段，名字怎么改都还指得准。它与 local 的本质区别是**归属**：内部文件属于那个节点
   * 的目标（见 groups/goals 的 refOwner），打开时先过它的组（openGroupedDoc），
   * 跟着切目标收起 / 归队；外部文件不属于任何目标，也不进「本地文件」那套账。
   */
  | { kind: 'ws'; nodeId: string; seg: string }
  /**
   * 内置浏览器的网页页签（<webview>，见 electron/app/webSession 与 components/learn/web）。
   * url 是**当前**地址——页面每次主框架导航都回写进来，重启回到离开时的那一页；
   * key 是开签那一刻生成的唯一身份（learn/tabs 的 newWebKey），导航不换：
   * 同一个网址可以开两枚页签，空地址（起始页，url === ''）也可以同时开好几枚。
   */
  | { kind: 'web'; url: string; key: string }
  /**
   * 视频页签（见 components/video/VideoStudyTab）。两种形态：
   * - 带 videoId：**绑定**到一个视频资源（描述在 learn/types 的 VideoResource），
   *   页里没有输入组件，打开即自动解析；
   * - 不带 videoId：**创建**态（全局一份），只有输入框 + 插件匹配 + 创建按钮。
   * 页签持久化；解析结果不落盘（流地址带签名会过期，重开再解析）。
   *
   * goalId（可选）：这份视频被某个**视频节点**绑到那个目标名下时，页签跟着归进
   * 那个目标的页签组（见 groups/goals 的 refOwner）——打开它 = 打开那个组，
   * 组被收起（锚大纲关闭进停靠场）时它一起收。身份仍是 videoId（tabKey 不看 goalId），
   * 绑定关系变了重开一次页签就对齐。
   */
  | { kind: 'video'; videoId?: string; goalId?: string }
  /**
   * 插件开发文档页签：介绍插件契约与配置面板（见 components/plugins/PluginDoc）。
   * 跟着页签持久化（normalize 认它），内容全是静态文档，没有要落盘的状态。
   */
  | { kind: 'pluginDoc' }
  /**
   * 设置面板：文档区的一枚页签（不再是弹窗）。全局只有一份（tabKey 恒定），
   * 从哪个入口打开都是切到它；面板本身见 components/settings/SettingsPanel。
   * 它跟着 docArea 持久化——重启后还开在那儿，与「上次开着哪些页签」同一句话。
   */
  | { kind: 'settings' }
  /**
   * 用量统计页：同样全局一枚页签（入口在顶栏用户菜单）。它读的是「台账」
   * （ai/usageLog）而不是配置，所以不从设置里走；页面自己订阅台账重渲染。
   */
  | { kind: 'usage' }
  /**
   * 日程安排页：同样全局一枚页签（入口在顶栏日历按钮的悬停 tip，以及提醒弹层）。
   * 数据是用户级的 schedule（state.json，见 learn/schedule），不挂任何节点；
   * 它跟着 docArea 持久化——重启后还开在那儿，与「上次开着哪些页签」同一句话。
   */
  | { kind: 'schedule' }
  /**
   * 记忆管理页：导师写下的记忆（learn/memory 的 store.memory）的查看与编辑，
   * 入口在 agent 栏输入框的「+」菜单。**页签也按目标一枚**（tabKey = 'm:' + goalId）：
   * 打开时默认筛到该目标的工作记忆；长期记忆跨目标，这一页同样看得到。
   * 目标删掉时它的记忆页签一起关。kind 仍叫 'mind'——改名会让老用户开着的这枚页签
   * 在升级后凭空消失，而它承载的只是界面状态，不值得为名字付这个代价。
   */
  | { kind: 'mind'; goalId: string }
  /**
   * 超级导师设置页：对话压缩/工作流/开发者三块（原弹窗改的页签，见
   * components/agent/AgentSettingsPanel）。同样全局一枚，与全局设置是两份数据。
   */
  | { kind: 'agentSettings' }
  /** 空白页签（底页）：显示无页签引导卡片，用于快捷新建或作为保底页签 */
  | { kind: 'blank'; key: string }
  /**
   * **新建文件**页签：在空白页签上点「新建文件」得到的一枚临时编辑页。
   *
   * 它**还没有类型、也没有落点**——用户在空白页上点那一下说的只是「我要写点东西」，
   * 此刻答不上来「存成什么」。答案在保存那一步：选路径 + 文件名 + 后缀（默认 `.txt`），
   * 后缀一确定，它当场换成指向那个文件的 `local` 页签（见 useDocSaveFlow 的 draft 分支），
   * 于是「是什么类型」由后缀说话，不必在这里预设。
   *
   * 正文住在**暂存区**（learn/drafts，键就是页签 id），基准是空串：改一个字就出现
   * 「未保存」的圆点，保存则是一次明确的动作（Ctrl+S → 另存对话框）。它随 state.json
   * 一起落盘，所以关掉应用再打开，没保存的那半篇还在。
   */
  | { kind: 'draft'; key: string }

/**
 * agent 栏的页签指向什么（见 learn/agentTabs 与 components/agent/AgentTabStrip）。
 *
 * 固定聊天：栏上最左侧那枚**常驻页签**——纯聊天（无系统提示词、无工具、没有人格），
 * 不可关闭与拖拽，不落 store（界面在页签列表前合成置左）；会话住在
 * users/{uid}/free-chat.json（learn/freeChat），conversationId 记当前展示的那一段。
 * 目标级导师：一个目标一枚页签——上下文按目标隔离（graph/conversations），页签里
 * 可以在目标的几段对话之间切换（conversationId 记的是**当前展示**的那一段，
 * 为 null 表示还没有会话，激活时现场建）。
 * 子代理会话：页签随时可关（任务在后台继续跑，见 subagent/manager），所以
 * conversationId + sessionId 都要存——会话的渲染数据住在那一段导师对话上。
 */
export type AgentTabRef =
  | { kind: 'free'; conversationId: string | null }
  | { kind: 'goal'; goalId: string; conversationId: string | null }
  | { kind: 'sub'; conversationId: string; sessionId: string }

/** 文档区的视图：源码（可编辑）、预览（渲染后）与媒体预览（图片 / 音频 / 视频的本地文件） */
export type DocView = 'source' | 'preview' | 'media'

/**
 * web 页签的**活信息**：只活在会话里、不落盘（learn/state 的 buildState 不挑它）。
 * 标题与图标要等页面事件来了才有，页签栏拿 tabTitle 兜底出的域名先顶着（见 learn/tabs）。
 */
export interface WebTabMeta {
  url: string
  title?: string
  favicon?: string
  loading: boolean
  canBack: boolean
  canFwd: boolean
  error: string | null
}

/**
 * 一个打开的页签。
 *
 * id 由 tabKey(ref) 算出（见 learn/tabs），因此「同一个目标」在列表里只可能出现一次——
 * 重复打开只是把它激活，不会多出一个页签。
 */
export interface LearnTab {
  /** 稳定 key（tabKey 的结果），页签列表与激活态都按它比对 */
  id: string
  ref: TabRef
  /**
   * 用户在这个页签上手动选过的视图。省略 = 按文件类型给默认值
   * （md / html 默认预览，其余默认源码，见 learn/tabs 的 viewOf）。
   * 记在页签上而不是全局一个开关：在 a.md 上切成源码，不该让 b.md 也跟着变。
   */
  view?: DocView
  createdAt: number
}

/**
 * 本地文件列表里的一条：拖进归一浏览过的外部文件。
 *
 * 只记路径与「最近打开时间」，**不复制文件内容**：拖进来的文件仍然住在原处，
 * 归一只是打开它看一眼、必要时改一改（源码视图）。把它拷进数据目录会造成
 * 两份内容各自演化，用户下次在原文件里改的东西就再也对不上了。
 */
export interface LocalFile {
  /** 绝对路径：这份文件的唯一身份 */
  path: string
  /** 文件名（含扩展名），列表里显示它 */
  name: string
  /** 最近一次打开的时间；列表按它倒序 */
  openedAt: number
}

/**
 * 收藏夹里的一条指向什么（见 learn/favorites）。
 *
 * 与 TabRef 同构，只有网页不同：收藏认**网址**而不是开签那一刻的 key——
 * 收藏的是「这个页面」，同一网址开几枚页签、关了再开，都是同一条收藏。
 */
export type FavoriteRef =
  /** 某个节点的教学文档 */
  | { kind: 'teach'; nodeId: string }
  /** 某个节点的某一份笔记（名字就是身份，见 NoteFile） */
  | { kind: 'note'; nodeId: string; note: string }
  /** 某个节点的某一份超级文档（名字就是身份，见 SuperDocFile） */
  | { kind: 'super'; nodeId: string; name: string }
  /** 某一次考试的只读副本（认考试，与页签同一口径） */
  | { kind: 'exam'; nodeId: string; examId: string; attemptId: string }
  /** 某个目标的大纲页 */
  | { kind: 'outline'; nodeId: string; goalId?: string }
  /** 磁盘上的外部文件（绝对路径） */
  | { kind: 'local'; path: string; title?: string }
  /**
   * 一个网页（内置浏览器；认网址）。收藏那一刻顺手记下页面的**标题与站点图标**——
   * 网页标题没有活的数据源可查（文档改名有节点可查，页面标题只在打开时才知道），
   * 收藏夹里要显示它们就只能存（见 learn/favorites）。缺了（页面还没加载完就收藏了）
   * 显示域名兜底；两者都不参与身份（favoriteKey 只比网址）。
   */
  | { kind: 'web'; url: string; title?: string; icon?: string }

/**
 * 一条收藏：指向什么 + 什么时候收藏的（列表按收藏先后排）。
 * group 是**分组文件夹**的名字（网页收藏的管理用，见 learn/favorites）：缺了 = 没有分组、
 * 躺在收藏区顶层。它不参与身份（favoriteKey 只比指向），改组名只是原地换字符串。
 */
export type FavoriteItem = FavoriteRef & { at: number; group?: string }

/**
 * 一个视频资源：**创建时确定**的「插件 + 输入 + 插件专属数据」。
 *
 * 与「视频页签」的关系：页签只记 id，资源记内容。所以页签关掉再开、换机器带
 * state.json 走，都能复原；资源被删则页签显示「已删除」的占位。
 *
 * fields 是插件在 createFields 里声明的**每个视频各自的**数据（例如画质），
 * 解析时与插件全局配置合并进 host.settings（同键以这里为准）——插件不需要
 * 区分两份配置从哪来。
 */
export interface VideoResource {
  id: string
  /** 处理它的插件的声明 id（插件被删时视频仍列着，解析会报插件不存在） */
  pluginId: string
  /** 插件显示名的快照（列表里不依赖插件是否还装着） */
  pluginName?: string
  /** 创建时的输入（原样交给插件 match / resolve） */
  input: string
  /** createFields 的值（创建时填好，之后不再改） */
  fields?: Record<string, string | number | boolean>
  /** 列表显示名：创建时取输入截断，解析成功后由插件给的标题覆盖 */
  title: string
  /**
   * 选集状态（**通用状态归宿主**）：用户在合集 / 分 P 列表里最终停在的那一项。
   * source 是那一项能被插件再认领的输入串（如带 ?p=N 的链接）；没选过就是创建时
   * 的 input。重开页签按它解析——「上次看的那一集」也在进度里，见下。
   */
  selection?: { source: string; title?: string }
  /**
   * 播放进度（**通用状态归宿主**）：上次播放到哪儿，打开绑定页签时自动跳回。
   * source 记住这是**哪一项**的进度（换选集后旧进度不再乱套到新一集上当续播）。
   * 播放器自身的偏好（音量 / 倍速 / 静音）属于本机，不在这里（见 VideoPlayer 的
   * localStorage）；插件专属的状态放 fields。
   */
  progress?: { source?: string; positionMs: number; updatedAt: number }
  /**
   * **被哪些视频节点引用着**（见 store.videoNodes 的 VideoNodeEntity）：绑定是双向的——
   * 节点记 videoId，资源这边记引用它的节点 id。这一份是**镜像**（读盘归一时从
   * videoNodes 重建），引用判定的唯一事实源仍是 store.videoNodes；写操作
   * （bind / 解绑 / 删节点）两边同一次提交一起动。
   */
  boundTo?: string[]
  /**
   * 视频总结（一个动作生成的内容总结 + 语义分段，见 learn/video/summarize）：
   * **按选集 source** 存（合集 / 分 P 每一项的字幕各不相同），一项一份。
   * 进度条上的分段点与底部区（字幕/总结/视频分段）都读它；生成过就不再生成。
   * 两段都可缺省（手改的数据允许残缺，界面按缺失兜底）。
   */
  recaps?: Record<string, VideoRecap>
  createdAt: number
  updatedAt?: number
}

/** 视频的一段语义分段：从哪个时间戳开始、讲了什么（进度条上的分段点） */
export interface VideoChapter {
  /** 这一段的开始时间（整数毫秒，对准转录段的时间轴） */
  startMs: number
  /** 这一段的内容概述（一句话，给悬停信息用） */
  summary: string
}

/**
 * 一份「视频总结」：**一个动作**生成的内容总结 + 语义分段（按选集 source 存）。
 * 总结是这个视频讲了什么的一段话；分段把内容按话题切开，变成进度条上的分段点。
 */
export interface VideoRecap {
  /** 视频内容描述（一段连贯的话） */
  summary?: string
  /** 语义分段（进度条分段点 + 底部「视频分段」页签的行） */
  chapters?: VideoChapter[]
}

/**
 * 视频节点（节点宇宙的游离类型）：把**一个学习目标**与**一个视频资源**绑在一起。
 * 只作为游离实体存在（不进大纲树——它是「这门课配这个视频」的引用，不是知识结构），
 * 一个目标可以有多枚，同一个视频也可以被多个目标各自绑一枚。
 */
export interface VideoNodeEntity {
  /** 节点宇宙身份（无前缀，与笔记 / 试卷同一款拼法） */
  id: string
  goalId: string
  /** 绑定的视频资源 id；null = 空节点（刚从 palette 落下，还没选视频） */
  videoId: string | null
  createdAt: number
  updatedAt: number
}

export interface LearnStore {
  version: 2
  nodes: KnowledgeNode[]
  edges: DependencyEdge[]
  goals: LearningGoal[]
  /** 一个目标可挂多个对话；每个对话只属于一个目标（目标下所有节点共用上下文） */
  conversations: Conversation[]
  /** 考试记录（每份只属于一个节点，可回溯查看只读） */
  exams: Exam[]
  /**
   * 游离挂件池：剪了线、还没绑过（或宿主已不在）的笔记与超级文档，按目标归档。
   * **可选字段**：旧数据没有它，按空池兜底。游离的试卷不走这里——它就在 exams 里，
   * 宿主 id 悬空（指向已不在的节点）即是游离；那是它唯一的账本，别处再存一份会对不上。
   * 落盘在各目标目录的 detached.json（这个目标一个游离件都没有就不写文件）。
   */
  detached?: Record<string, DetachedPool>
  /**
   * 游离大纲池（不依附文档的计划实体，见 OutlineEntity）：与 detached 同一纪律的
   * 可选字段，旧数据没有它按空池兜底；使用处一律 `?? []`。
   */
  outlines?: OutlineEntity[]
  /**
   * 视频节点池（目标 × 视频的绑定，见 VideoNodeEntity）：同样按目标归档、落盘在
   * 各目标目录的 video-nodes.json；可选字段，理由同 outlines。
   */
  videoNodes?: VideoNodeEntity[]
  /** 临时变量：按节点分组，带过期时间（见 lib/tmpStore） */
  tmp: TmpStore
  /**
   * 记忆库：长期（跨目标）+ 工作（按目标）两类，见 learn/memory。
   * **可选字段**：旧 state.json 里没有它，读回来的旧数据不必补——使用处一律
   * `?? { long: [], work: {} }` 兜底，写入时自然会带上。
   */
  memory?: MemoryStore
  /**
   * 目标级持久化函数（method.*，见 learn/methods）。可选字段，理由同 minds：
   * 旧数据没有它，读回来按 `?? []` 兜底。
   */
  methods?: MethodStore
  /**
   * 目标级随笔（见 learn/essays）。可选字段，理由同 methods。
   * 落盘在各自目标目录的 essay.json（这个目标一条都没有就不写文件）。
   */
  essays?: EssayStore
  /**
   * 随笔提交记录（见 learn/essayCommits）。可选字段，理由同 essays。
   * 与随笔同一份 essay.json：提交是「这一批随笔被封存的那一刻」，分开存反而会失去对应关系。
   */
  essayCommits?: EssayCommitStore
  /** 随笔窗口拖到哪儿、多大（界面状态，跟 state.json 走；见 EssayDockRect） */
  essayDock?: EssayDockRect
  /**
   * 工作流登记表（wf.*，见 learn/workflows）。可选字段，理由同 methods。
   * global 存进 state.json（跨目标跟着用户走）；byGoal 存进各自目标目录的 workflow.json。
   */
  workflows?: WorkflowBook
  /**
   * 结构图（见 learn/structure）：目标 id → 那个目标的节点表与连线。
   *
   * 它替代了旧的「大纲树布局」——树的位置是算出来的，图的位置是用户拖的，必须存下来。
   * 落盘在各自的目标目录（`{目标}/structure.json`），与 essay.json / method.json 同一层：
   * 它是「这门课的结构」，目标没了就该跟着没。可选字段：旧数据没有它，
   * 由数据迁移脚本（见 lib/migration 的 m_0_6_3_to_0_7_0）从旧树铺出来。
   */
  structure?: Record<string, StructureMap>
  /**
   * 日程（见 learn/schedule）：用户级的提醒清单 + 铃声设置。
   *
   * 与专注记录同一档：整块存在 state.json 里，不挂任何目标——「今天 19:30 复习」
   * 与「在学哪门课」无关，删掉目标也不该带走它。可选，理由同上（旧数据没有这个字段）。
   */
  schedule?: ScheduleStore
  /**
   * 视频资源（见 learn/videos）：用户创建的「绑定住的视频来源」。
   * 与日程同一档——用户级、整块存 state.json、不挂任何节点；删目标不该带走它。
   * 视频页签按 video.id 绑定；插件与输入在创建时确定，之后不再让用户重填。
   */
  videos?: VideoResource[]
  /**
   * 目标级资源库的清单：目标 id → 资源列表（见 learn/static）。
   * 只放元数据，文件本体在 `{目标}/static/` 下——与图片引用一样的取舍：
   * 结构化字段进内存与清单，字节留在磁盘上。
   */
  resources: Record<string, StaticResource[]>
  activeGoalId: string | null
  activeNodeId: string | null
  activeConversationId: string | null
  /**
   * 文档区：**分组 + 分割**（见 learn/groups）。
   *
   * 「打开着哪些文档、每一格看的是哪一个、格子之间怎么摆」全在这里。它属于「界面状态」
   * 而不是「学习数据」，但和历史一样跟 store 一起存进 state.json：关掉应用再打开，
   * 上次开着的那几个文档、怎么分屏的，都还是那个样子——这是 vscode 式页签的一半意义。
   *
   * 从前这里是平铺的 tabs + activeTab 两个字段（一个页签栏、一个激活项）；
   * 能分割之后它们不足以表达「哪一格」，于是收进 DocWorkspace（读旧数据时自动折成单组）。
   */
  docArea: DocWorkspace
  /**
   * 暂存区：改了还没保存的正文，键是页签 id（见 learn/drafts）。
   *
   * 与页签放在同一份 state.json 里：没保存的改动与「开着哪些文档」是同一类东西
   * （都是界面状态），分两处存会多出一条「谁先落盘」的规则，而它们本该一起回来。
   */
  drafts: Drafts
  /**
   * 每一份文档**读到哪儿了**：键 = 页签 id，值 = 滚动位置（px）。
   *
   * 键用的是页签 id，因为页签本身就是从 state.json 回来的（重启之后还是同一个 id）——
   * 位置跟着它走，重开应用才回得到原来那一段。不记的话每次打开都从头开始，
   * 长文档要重新找位置（见 lib/docScroll）。
   */
  docScroll: DocScroll
  /** 最近拖进来 / 打开过的本地文件（新的在前）；空列表时侧栏不显示这一区 */
  localFiles: LocalFile[]
  /**
   * 收藏夹：文档与网页（见 learn/favorites）。**可选字段**：旧 state.json 里没有它，
   * 读回来的旧数据不必补——所有使用处都按 `?? []` 兜底。侧栏的「收藏」区、页签右键菜单
   * 与网页地址栏的星标都在它里面增删；指向已删除东西的收藏由 normalize 在读盘时剪掉。
   */
  favorites?: FavoriteItem[]
  /**
   * 收藏的**分组文件夹**登记表（名字清单，见 learn/favorites）。组名同时长在成员身上
   * （FavoriteItem.group），这里登记的是「组本身」——空组（还没移进任何收藏）也要能存在，
   * 「新建分组」按钮创建的就是它。**可选字段**：旧 state.json 里没有它，`?? []` 兜底。
   */
  favGroups?: string[]
  /**
   * agent 栏开着的页签（见 learn/agentTabs）。**可选字段**：旧 state.json 里没有它，
   * 读回来的旧数据不必补。与 docArea 同一类「界面状态」：关掉应用再打开，
   * 上次开着哪几位导师、正看着哪一位，都还是那个样子。
   */
  agentTabs?: AgentTabRef[]
  /** agent 栏当前激活的页签（agentTabKey 的结果）；null = 没有选中项（页签也为空时） */
  agentActiveTab?: string | null
}

/**
 * 页签 id → 滚动位置。源码视图用「页签 id + #src」另存一份：
 * 同一份文档的编辑位置与阅读位置是两回事，共用一格会互相拽。
 */
export type DocScroll = Record<string, number>

/** 一条临时变量：值与「什么时候失效」放在一起，读的时候顺手判断 */
export interface TmpEntry {
  value: unknown
  /** 过期时刻（毫秒时间戳）；0 表示永不过期 */
  expiresAt: number
  createdAt: number
}

/** 节点 id → 键 → 条目。不落进笔记正文，也不进对话上下文 */
export type TmpStore = Record<string, Record<string, TmpEntry>>

/**
 * 记忆的类型（见 learn/memory）。
 *
 * - `work`（工作 / 短期记忆）：**目标级**，记录这个目标里「发生了什么 / 要做什么 /
 *   怎么做 / 过程怎么样 / 结果怎么样」。只有这个目标的会话读得到；agent 觉得它是
 *   信息负担时可以随手删掉。
 * - `long`（长期记忆）：**跨目标**，记聊天中对用户的印象、作息、重要约定。
 *   任何目标都读得到，也因此**不能随手删**（删除要显式确认，见 memory.delete）。
 */
export type MemoryType = 'work' | 'long'

/**
 * 一条记忆（见 learn/memory）。
 *
 * 与 tmp 的分界：tmp 服务于一次编排里的中间结果（按节点、会过期）；
 * 记忆是跨对话有效的东西（不过期）。关键边界：记忆**不会**被拼进系统提示词或任何
 * 消息——agent 需要时必须主动 api.memory.list / get，这是需求明确的约束
 * （自动注入会让上下文逐轮漂移，前缀缓存跟着遭殃；更重要的是，记忆该由 agent
 * 自己决定何时取用）。
 */
export interface MemoryItem {
  /** 唯一标识：api.memory.update / delete 都按它认条目 */
  uuid: string
  /** 关键词：检索与展示用（一条记忆可以挂多个） */
  keys: string[]
  /** 标题：一行说清这条记忆是什么 */
  title: string
  /** 详细内容（Markdown 纯文本，给人与模型读） */
  content: string
  /** 创建时间（毫秒） */
  createAt: number
  /** 最后更新时间（毫秒） */
  updateAt: number
  type: MemoryType
}

/**
 * 记忆库。
 *
 * 两种类型分两处放，因为它们的**作用域不同**：
 * - `long` 跨目标，跟着用户走 → state.json（不属于任何一个目标的目录）；
 * - `work` 按目标归档 → `docs/{目标}/mind.json`（与 chat.json 同层，目标删了它跟着没）。
 *
 * 文件名沿用 `mind.json`：那是上一版「长期记忆」的落点，换个名字等于把老用户的记忆
 * 扔在磁盘上读不回来（读侧按老形状兼容，见 learn/files/parse）。
 */
export interface MemoryStore {
  long: MemoryItem[]
  work: Record<string, MemoryItem[]>
}

/**
 * 一条随笔（见 learn/essays）：**目标级**的随手记，没有标题、不挂节点。
 *
 * 与 MemoryItem 的区别：记忆是**导师**写给自己（或关于学习者）的判断，只有 agent 主动
 * api.memory.list / get 才看得到；随笔是**人写给自己**的，就摆在文档区右下角那个小窗口里。
 */
export interface EssayEntry {
  id: string
  /**
   * 标题：随笔**不再按日期当唯一标识**（想开几条就开几条），认这条随笔靠 id，认名字靠标题。
   * 默认取创建那天的日期（见 learn/essays 的 defaultEssayTitle），随时可改。
   */
  title: string
  /** 正文（Markdown）。列表与下拉里摆在标题后面的是它抹平后的预览 */
  text: string
  /** 写下的时刻：排序依据（新的在前），不再承担「归到哪一天」的身份作用 */
  createdAt: number
  updatedAt: number
}

/** 目标 id → 随笔清单（新的在前）。落盘在各自目标目录的 essay.json */
export type EssayStore = Record<string, EssayEntry[]>

/**
 * 一次随笔提交里「动过的一份笔记」。
 *
 * 由宿主在整理前后对比 store 得出（见 learn/essayCommits 的 noteFingerprint / diffNoteChanges），
 * **不靠模型自报**——模型说「我改了 A」而实际改的是 B 时，记录仍然是真的。
 */
export interface EssayCommitChange {
  nodeId: string
  /** 提交时的节点标题（之后节点改名了，也看得懂当时动的是哪儿） */
  nodeTitle: string
  /** 笔记名（一个节点可以有多份笔记） */
  noteName: string
  kind: 'created' | 'updated'
}

/**
 * 一次随笔提交：**快照 + 整理结果**，像一次 git commit。
 *
 * - 快照里是提交那一刻的随笔全文：之后随笔被改写、删除，这一份仍然是当时的原样；
 * - Agent 把这批随笔整理进知识树对应节点的笔记，`changes` 记下它实际动了哪几份；
 * - `status` 说清这次整理跑到哪了（应用在整理途中被关掉时，读回来会当作「未完成，可重试」）。
 */
export interface EssayCommit {
  id: string
  /** 提交时刻：也是「哪些随笔还没提交」的分界（updatedAt > at 的算新改动） */
  at: number
  /** 提交说明（用户写，或默认的「随笔整理 · 日期」） */
  message: string
  /**
   * 快照：提交那一刻的随笔（标题 + 正文，都是当时的原样）。
   * title 是后加的：旧提交里没有，界面按提交日期回退显示。
   */
  snapshot: Array<{ id: string; createdAt: number; text: string; title?: string }>
  status: 'running' | 'done' | 'error'
  /** Agent 整理后实际动过的节点笔记 */
  changes: EssayCommitChange[]
  /**
   * Agent 对这次提交的评论（Markdown，**首行是标题**），整理完由宿主从回复里按约定
   * 标记抠出来（见 learn/essayCommits 的 parseEssayComment）；没写 / 没解析到就没有。
   * 提交记录的 timeline 节点只显示「日期 + 评论标题」，全文要点开详情看。
   */
  comment?: string
  /** 失败原因（没配 AI、模型报错、中途被关掉……） */
  error?: string
}

/** 目标 id → 提交记录（新的在前）。落盘在各自目标目录的 essay.json 里 */
export type EssayCommitStore = Record<string, EssayCommit[]>

/**
 * 随笔窗口的状态（位置几何 + 当前二级页面状态持久化）。
 *
 * 属于**界面状态**（跟 state.json 走），不是学习数据：
 * - x, y, w, h：窗口坐标与尺寸
 * - activeTab：当前顶部的固定 tab（'essay' | 'note'）
 * - essayEditingId：正在编辑的随笔 id（'__blank__' 为空白预备，null 为列表页）
 * - noteTarget：正在查看/编辑的笔记定位（{ nodeId, noteName, goalId? }，null 为列表页）
 * - noteViewMode：笔记二级页面的视图模式（'edit' | 'preview'）
 */
export interface EssayDockState {
  x: number
  y: number
  w: number
  h: number
  activeTab?: 'essay' | 'note'
  essayEditingId?: string | null
  noteTarget?: {
    goalId?: string
    nodeId: string
    noteName: string
  } | null
  noteViewMode?: 'edit' | 'preview'
}

export type EssayDockRect = EssayDockState

/** 随笔窗口中汇总的各节点笔记条目 */
export interface DockNoteItem {
  goalId: string
  goalTitle: string
  nodeId: string
  nodeTitle: string
  name: string
  content: string
  updatedAt: number
  createdAt: number
}



/**
 * 一条工作流（见 learn/workflows）：**不由用户消息直接驱动**的任务模板。
 * 关键边界与 mind 一致——它**不进系统提示词**；被触发时 instruction 才以一条
 * user 消息整段进入上下文（隐藏消息，界面是一条分界条）。
 */
export interface WorkflowEntry {
  /** 稳定 id（wf_ 前缀）；触发与删除都认它，名字也能指名（大小写不敏感） */
  id: string
  /** 列表与分界条上显示的名字；同级内唯一，同名登记即覆盖 */
  name: string
  /** 一句话说明它是干什么的（列表展示 + wf.list 给模型看） */
  description: string
  /** 触发时以 user 角色整段进入上下文的完整任务指令 */
  instruction: string
  /**
   * 规程提示词（**可选**，动态提示词注入）：每次触发都要在场的「这套流程怎么干」的稳定知识
   * 与 instruction 分开——它按 wf:<id> 作键注入，**同一上下文只注一次**；之后再次触发只发
   * instruction（见 useAgent.runWorkflow 与 learn/ai/promptModules）。没写就没有这一块。
   */
  prompt?: string
  createdAt: number
  updatedAt: number
}

/**
 * 工作流登记表：global 是**跨目标**的一层（跟着用户走，存 state.json）；
 * byGoal 按目标归档（存各自目标目录的 workflow.json，与 method.json 同层同纪律）。
 * 内置工作流不在这里——它们的指令在代码里（learn/workflows 的 BUILTIN_DEFS）。
 * 思考档位曾经有每条工作流的三态配置（workflows.efforts），2026-10-25 删除：
 * 档位全应用只有全局滑条一份（翻面会让服务商整体换缓存，见 learn/effortGuard）。
 */
export interface WorkflowBook {
  global: WorkflowEntry[]
  byGoal: Record<string, WorkflowEntry[]>
}

export const MASTERY_LABEL: Record<MasteryStatus, string> = {
  learning: '学习中',
  mastered: '已掌握',
}

export type { Conversation }
