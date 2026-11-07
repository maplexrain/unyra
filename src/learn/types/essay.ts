/**
 * 随笔域类型（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * 随笔条目与归档（EssayEntry / EssayStore）、随笔提交（EssayCommitChange /
 * EssayCommit / EssayCommitStore）、随笔窗口（EssayDockState / EssayDockRect /
 * DockNoteItem）。本文件不依赖其他 types/ 子模块。
 */

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
