/**
 * 学习域核心节点类型（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * 掌握状态、文档种类、教学文档 / 笔记 / 超级文档、游离挂件池、大纲、目标级持久化函数、
 * 注解与随文便签、知识节点、依赖边与学习目标。跨域引用一律 `import type`，避免值级循环。
 */

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

/**
 * 教学文档中的随文便签（Notepad）。
 *
 * 数据完全记录在节点上（node.notepads），绝不污染或篡改教学文档原文（node.docs.teaching）。
 */
export interface DocNotepadItem {
  id: string
  content: string
  /** 对应插入在正文第几个渲染块之后（-1 表示最顶部，0 表示第 0 个块之后，依此类推） */
  blockIndex: number
  createdAt: number
  updatedAt: number
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
   * 随文便签（Notepad）集合；每个元素插在正文指定 blockIndex 处，数据完全独立于正文原文。
   */
  notepads?: DocNotepadItem[]
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

export const MASTERY_LABEL: Record<MasteryStatus, string> = {
  learning: '学习中',
  mastered: '已掌握',
}
