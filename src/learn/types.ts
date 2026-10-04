import type { Conversation } from '../agent/types'
import type { ReasoningEffort } from '../ai/types'
import type { CheckinBook } from './checkin'
import type { Drafts } from './drafts'
import type { Exam } from './exam'
import type { DocWorkspace } from './groups'
import type { PomodoroStore } from './pomodoro'
import type { ReadingBook } from './reading'
import type { StaticResource } from './static'

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
 * 「学得怎么样」是另一件事，记在 KnowledgeNode.learning 里（见 LearningState）。
 */
export type MasteryStatus = 'learning' | 'mastered'

/* ---------- 学习状态（Learning State） ---------- */

/**
 * 学习者自评：对这个知识点，他自己觉得会多少。
 *
 * 为什么不只分「掌握 / 不掌握」：自评的意义在于把「不知道自己不知道」和
 * 「知道自己不会」分开——前者要探针去戳，后者直接补课就行。四档的措辞是
 * 学习者自己的话（「了解但不熟」「不确定」），不是系统的判定，所以它与 mastery
 * 是两件事，各存各的。
 */
export type SelfReport = 'mastered' | 'familiar' | 'unknown' | 'unsure'

export const SELF_REPORTS: readonly SelfReport[] = ['mastered', 'familiar', 'unknown', 'unsure']

export const SELF_REPORT_LABEL: Record<SelfReport, string> = {
  mastered: '掌握',
  familiar: '了解但不熟',
  unknown: '不会',
  unsure: '不确定',
}

/** 自评是谁给的：AI 只是推断，学习者点过的那一下才算确认（见 LearningState.selfBy） */
export type SelfSource = 'user' | 'ai'

/**
 * 一条错误记忆。
 *
 * 记的不是「错了哪道题」，而是「错成了什么样」：同一类错误再犯时只把次数加上去，
 * 于是「漏乘内部导数 ×3」这种反复出现的模式自己浮出来，下一次教学可以照着它设计。
 * pattern 是归一化后的说法（去空白、统一小写），同一个说法只有一条。
 */
export interface MistakeRecord {
  /** 错误的样子，如「漏乘内部导数」 */
  pattern: string
  /** 犯过几次 */
  count: number
  /** AI 推断的成因（可空），如「对内外函数的概念不稳定」 */
  cause?: string
  firstAt: number
  lastAt: number
  /** 已修复时刻：后续复习里这个错法答对了，由导师在落账时标上（再犯即清掉） */
  fixedAt?: number
}

/** 一次检验的种类：探针（随口一问）/ 考试（有卷）/ 回忆（合上讲给我听）/ 复习（间隔复习会话） */
export type CheckKind = 'probe' | 'exam' | 'recall' | 'review'

export const CHECK_KIND_LABEL: Record<CheckKind, string> = {
  probe: '探针',
  exam: '考试',
  recall: '回忆',
  review: '复习',
}

/**
 * 一次检验的记录。
 *
 * 三种检验问的是同一件事——「你到底会不会」，所以合成一条时间线：
 * 掌握度怎么走到今天的，翻这一串就看得出来。
 * 主动回忆没有分数，它给的是三分类（提及 / 遗漏 / 潜在误解），因此这两组字段并存。
 */
export interface CheckRecord {
  kind: CheckKind
  at: number
  /** 这一次考得怎么样（0~100）；回忆这类没算分时省略 */
  score?: number
  /** 主动回忆：讲到了的要点 */
  mentioned?: string[]
  /** 主动回忆：没讲到、但本该讲的 */
  missed?: string[]
  /** 主动回忆：讲错了的地方 */
  misconceptions?: string[]
  /** 探针或回忆的原问（考试没有这一项，试卷本身有题目） */
  question?: string
  /** 学习者当时的原话（截断保存） */
  answer?: string
  /** AI 的一句话结论 */
  note?: string
}

/**
 * 一个知识节点的学习状态——各种新能力共用的那一层底座。
 *
 * 为什么收成一个对象而不是散在节点上的几个字段：它们是同一件事的不同侧面
 * （自评、掌握度、错题、检验、学习行为），彼此要一起读、一起算，界面上也一起展示。
 * 收在一起之后，「这个知识点学到哪了」是一次读盘、一份快照，而不是五个字段各查一遍。
 *
 * 全部字段可缺省：**没评估过就是没有**，不要用 0 分冒充「测过了，0 分」。
 */
export interface LearningState {
  /** 学习者自评（四档）；没问过就没有这一项 */
  self?: SelfReport
  /** 自评是谁给的：'ai' 是导师的推断，学习者点过那一下才算 'user' */
  selfBy?: SelfSource
  /** 掌握度 0~100：随自评、探针、考试、回忆与错题一起走 */
  mastery?: number
  /** 掌握度上一次为什么这么定（AI 写一句话，界面显示它，好让这个数字可追问） */
  masteryNote?: string
  /** 错误记忆：同一类错误累加次数 */
  mistakes?: MistakeRecord[]
  /** 检验时间线（新的在后）；只留最近若干条，见 MAX_CHECKS */
  checks?: CheckRecord[]
  /** 最近一次打开这个知识点的时间 */
  lastStudiedAt?: number
  /** 打开过几次 */
  visits?: number
}

/** 检验记录只留最近这么多条：它是「最近怎么样」的依据，不是账本 */
export const MAX_CHECKS = 12
/** 错误记忆的上限；超出后淘汰最久没再犯的那条 */
export const MAX_MISTAKES = 20

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
 * name 既是列表里显示的名字，也是磁盘上的文件名（`{节点}.notes/{name}.md`）——
 * 两者必须一致：用户在界面上改的就是文件名本身，否则「改名」会变成一句空话。
 * 因此它的取值一律过 sanitizeSegment（见 learn/notes 的 uniqueNoteName），
 * 非法字符在**创建/改名那一刻**就被换掉，而不是等到落盘时才悄悄变形。
 *
 * 没有 id：同一节点内名字唯一（uniqueNoteName 保证），(节点 id, 名字) 就是它的身份。
 * 存 id 反而会带来「名字是身份的副本、改一处忘一处」的问题；页签引用的也是名字，
 * 改名时由 renameNote 一起把页签改过去（见 learn/notes）。
 */
export interface NoteFile {
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
 * 与笔记（NoteFile）同构——一个节点可以有好几份，名字就是身份——但它是完整的
 * HTML 而不是 Markdown：里面可以带 <style> 与 <script>。渲染走沙箱化的 iframe
 * （见 components/learn/SuperDocView），脚本**永远不会**跑在应用页面本身里；
 * 脚本里唯一对外的口子是 api.method.call(...)（见 learn/methods），
 * 它把调用转发回宿主执行目标级持久化的函数。
 *
 * 只存在 state.json 里、不做磁盘镜像（笔记那种 {节点}.notes/*.md 的待遇）：
 * 它是给渲染器消费的交互件，不是要在文件管理器里直接打开的素材。
 */
export interface SuperDocFile {
  name: string
  html: string
  createdAt: number
  updatedAt: number
}

/** 一个节点的全部超级文档；老节点没有这一项时按空数组处理 */
export function superDocsOf(node: { superdocs?: SuperDocFile[] }): SuperDocFile[] {
  return node.superdocs ?? []
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
 * 一条目标级持久化函数（method，见 learn/methods）。
 *
 * code 是一段**匿名 async 函数源码**（与 execute 的 body 同一种写法），
 * 第一个参数是 api（沙箱的整套 api），其余参数是调用方传的实参：
 *
 *     ((api, path, needle) => { ... return api.doc.find(path, needle) })
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

/** 复习阶段：默认间隔的档位（+1/+3/+7/+14/+30 天）。是默认计划，不是绝对规则 */
export type ReviewStage = 'd1' | 'd3' | 'd7' | 'd14' | 'd30'

/** 一次阶段复习的紧凑记录（每档只留最近几条）：数量级为主，细节在检验时间线与错误记忆里 */
export interface ReviewStageHistoryEntry {
  at: number
  /** 这一阶段问了几个点 */
  items: number
  /** 其中没答上 / 答错的几个 */
  missed: number
  note?: string
}

export interface ReviewStageState {
  stage: ReviewStage
  /** 计划到期时刻（学习完成日 + 默认间隔） */
  dueAt: number
  /** 完成时刻；没完成就没有。**到了期没做也保持待复习**——不自动顺延 */
  doneAt?: number
  /** 跳过并入：完成更靠后的阶段时，此前未完成的阶段记上它（不做三次补课） */
  mergedInto?: ReviewStage
  history?: ReviewStageHistoryEntry[]
}

export interface ReviewExtraTask {
  id: string
  /** 针对哪个薄弱点（一句话，说法与错误记忆对齐） */
  focus: string
  dueAt: number
  doneAt?: number
  note?: string
}

/**
 * 一个节点的复习计划（逻辑与常量见 learn/review）。
 * 节点状态**首次**变为「已掌握」时由系统自动创建；老节点没有，复习面板上可手动补建。
 * groupId 是「合并复习组」的标记：强相关的节点经导师问过用户后合到一起复习。
 */
export interface ReviewPlan {
  createdAt: number
  stages: ReviewStageState[]
  groupId?: string
  extra?: ReviewExtraTask[]
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
   * 内容由导师经 api.outline.write 写入；老数据没有这一项，交互页按「还没有大纲」处理。
   */
  outline?: OutlineDoc
  /** 「了解」注解；渲染期套在正文对应词上，不改动 content */
  annotations: Annotation[]
  status: MasteryStatus
  /** 学习状态（自评 / 掌握度 / 错误记忆 / 检验记录 / 学习行为）；没评估过就没有这一项 */
  learning?: LearningState
  /** 复习计划（见 learn/review）：状态首次变 mastered 时系统自动建；没有就是「还没有计划」 */
  review?: ReviewPlan
  origin: 'ai' | 'user'
  goalId: string
  createdAt: number
  updatedAt: number
}

/** 依赖边：from 依赖 to。from 是上层（较接近目标），to 是它的前置知识。 */
export interface DependencyEdge {
  from: string
  to: string
  createdAt: number
}

export interface LearningGoal {
  id: string
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
  | { kind: 'outline'; nodeId: string }
  /** 磁盘上的外部文件（绝对路径） */
  | { kind: 'local'; path: string }
  /**
   * 内置浏览器的网页页签（<webview>，见 electron/app/webSession 与 components/learn/web）。
   * url 是**当前**地址——页面每次主框架导航都回写进来，重启回到离开时的那一页；
   * key 是开签那一刻生成的唯一身份（learn/tabs 的 newWebKey），导航不换：
   * 同一个网址可以开两枚页签，空地址（起始页，url === ''）也可以同时开好几枚。
   */
  | { kind: 'web'; url: string; key: string }

/** 文档区的两种视图：源码（可编辑）与预览（渲染后） */
export type DocView = 'source' | 'preview'

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
  | { kind: 'outline'; nodeId: string }
  /** 磁盘上的外部文件（绝对路径） */
  | { kind: 'local'; path: string }
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

export interface LearnStore {
  version: 2
  nodes: KnowledgeNode[]
  edges: DependencyEdge[]
  goals: LearningGoal[]
  /** 一个目标可挂多个对话；每个对话只属于一个目标（目标下所有节点共用上下文） */
  conversations: Conversation[]
  /** 考试记录（每份只属于一个节点，可回溯查看只读） */
  exams: Exam[]
  /** 临时变量：按节点分组，带过期时间（见 lib/tmpStore） */
  tmp: TmpStore
  /**
   * 长期记忆：按目标分组（见 learn/mind）。**可选字段**：旧 state.json 里没有它，
   * 读回来的旧数据不必补——所有使用处都按 `?? []` 兜底，写入时自然会带上。
   */
  minds?: MindStore
  /**
   * 目标级持久化函数（method.*，见 learn/methods）。可选字段，理由同 minds：
   * 旧数据没有它，读回来按 `?? []` 兜底。
   */
  methods?: MethodStore
  /**
   * 工作流登记表（wf.*，见 learn/workflows）。可选字段，理由同 methods。
   * global 存进 state.json（跨目标跟着用户走）；byGoal 存进各自目标目录的 workflow.json。
   */
  workflows?: WorkflowBook
  /**
   * 文档有效阅读记录（见 learn/reading），**按目标分开**：目标 id → 那个目标的账。
   *
   * 它是学习计划、注意力评级（learn/attention）与打卡（learn/checkin）共同的事实底座。
   * 分目标是因为「今天读了两小时」这句话必须属于某一门课才有意义（见 ReadingBook 的说明）；
   * 落盘在各自的目标目录（`{目标}/reading.json`），不再进 state.json。
   */
  reading?: ReadingBook
  /** 打卡账本（见 learn/checkin），**按目标分开**：目标 id → 那个目标的账 */
  checkin?: CheckinBook
  /** 番茄钟（见 learn/pomodoro）：正在跑的那一段 + 跑完的专注记录。可选，理由同上 */
  pomodoro?: PomodoroStore
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
 * 一条长期记忆（mind，见 learn/mind）。
 *
 * 与 tmp 的分界：tmp 服务于一次编排里的中间结果（按节点、会过期）；
 * mind 是导师对「这个人、这个目标」长期有效的判断与偏好（按目标、不过期）。
 * 关键边界：记忆**不会**被拼进系统提示词或任何消息——agent 需要时必须主动
 * api.mind.read，这是需求明确的约束（自动注入会让上下文逐轮漂移，前缀缓存
 * 跟着遭殃；更重要的是，记忆该由 agent 自己决定何时取用）。
 */
export interface MindEntry {
  id: string
  /** 稳定的主题名（如「学习者偏好」「目标背景」）；给了 key 再写同 key 会覆盖 */
  key?: string
  text: string
  createdAt: number
  updatedAt: number
}

/** 目标 id → 记忆条目。跟着 state.json 一起落盘 */
export type MindStore = Record<string, MindEntry[]>

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
 * 工作流的思考档位设置（三态）：'default' 用内置推荐档（BUILTIN_DEFS 里的 effort），
 * 'chat' 跟随聊天滑条（输入框右下角那个，只对聊天发起的轮直接生效），
 * 其余是固定四档之一。省略时内置视作 'default'、登记的视作 'chat'
 * （解析见 learn/workflows 的 resolveWorkflowEffort）。
 */
export type WorkflowEffortSetting = 'default' | 'chat' | ReasoningEffort

/**
 * 工作流登记表：global 是**跨目标**的一层（跟着用户走，存 state.json）；
 * byGoal 按目标归档（存各自目标目录的 workflow.json，与 method.json 同层同纪律）。
 * 内置工作流不在这里——它们的指令在代码里（learn/workflows 的 BUILTIN_DEFS）。
 */
export interface WorkflowBook {
  global: WorkflowEntry[]
  byGoal: Record<string, WorkflowEntry[]>
  /**
   * 每条工作流的思考档位配置（键 = 工作流 id，内置与登记通吃），存 state.json 的
   * workflows.efforts——**全局一份**，不随目标文件走：档位是「设置」不是学习数据。
   * 登记被删除时同步删键（见 removeWorkflow）；幽灵键由 normalize 剪掉。
   */
  efforts?: Record<string, WorkflowEffortSetting>
}

export const MASTERY_LABEL: Record<MasteryStatus, string> = {
  learning: '学习中',
  mastered: '已掌握',
}

export type { Conversation }
