/** 这个文件负责：阅读记录的数据形状——存进 state.json 的节 / 文档 / 节点 / 日，以及一次结算的增量。 */

/**
 * 停表的原因。分成三档（判据见 learn/attention 的 REAL_BREAKS）：
 * - **真的被打断**：blur（失焦）、hidden（隐藏/最小化）、tab（切页签、文档不在主位）、
 *   doc、exam —— 算 fragmentation；
 * - **静默**（idle）：还在读的位置上，只是没动。中性事实（多半是在想），记为 stalls；
 * - **不在读**（away）：切回来还没碰文档、在对话栏打字、宽限用完、导师栏占了主位。
 *   它既不算被打断也不算卡住，只是把「连续阅读」在那一段切开。
 * write（agent 正在写这份文档）只停表，哪一档都不算。
 */
export type BreakKind = 'blur' | 'hidden' | 'tab' | 'idle' | 'doc' | 'exam' | 'write' | 'away'
/** 交互印记：比时长可靠得多的「真的读了」证据 */
export type MarkKind = 'details' | 'learn' | 'annotate' | 'ask' | 'select' | 'note'

export interface SectionRead {
  /** 锚：归一化后的标题（见 sectionKey） */
  key: string
  /** 原样标题，显示用 */
  text: string
  /** 当时的顺序位：标题文字被改写时靠它与层级兜底认领 */
  index: number
  level: number
  /** 这一节摊到的有效毫秒（累计） */
  ms: number
  /** 进入过视口的最大比例 0~1（长节也能看出「只看了开头」） */
  reach: number
  marks: MarkKind[]
  firstAt: number
  lastAt: number
  /** 认领时只对上了位置、没对上文字：计划侧据此知道标题被改过 */
  fuzzy?: boolean
}

export interface DocReading {
  /** 全部节（含一次都没读到的）：没有记录与「读了 0 秒」是两件事，前者不在这里 */
  sections: SectionRead[]
  activeMs: number
  /** 上次见到的正文字数：算覆盖率与预估时长用 */
  words?: number
  doneAt?: number
}

export interface NodeReading {
  /** 按文档分开：'teaching' | 'note:名称' | 'sdoc:名称' */
  docs: Record<string, DocReading>
  activeMs: number
  firstAt: number
  lastAt: number
  opens: number
}

export interface MinuteTick {
  /** 这一分钟里的有效毫秒 */
  ms: number
  /** 这一分钟里滚过的正文字符数（估算 pace 用） */
  chars: number
  marks: number
  /** 这一分钟里发生的中断次数 */
  gaps: number
}

export interface ReadingBreak {
  at: number
  ms: number
  kind: BreakKind
}

export interface ReadingSession {
  id: string
  nodeId: string
  doc: string
  /** 学习日（'2026-09-20'） */
  day: string
  from: number
  to: number
  activeMs: number
  minutes: MinuteTick[]
  breaks: ReadingBreak[]
  sections: SectionRead[]
  /** 前瞻字段：这段阅读是否服务于某个计划块（番茄钟） */
  planId?: string
}

/** 一个学习日的汇总：打卡的账本 */
export interface DaySummary {
  day: string
  activeMs: number
  /** 这一天读过的节点（去重） */
  nodes: string[]
  /** 这一天的交互印记总数 */
  marks: number
}

export interface ReadingStore {
  version: number
  sessions: ReadingSession[]
  nodes: Record<string, NodeReading>
  days: Record<string, DaySummary>
}

/**
 * **按目标分开**的阅读账本：目标 id → 那个目标的账（见 learn/types 的 LearnStore.reading）。
 *
 * 为什么从用户级改成目标级：一个人同时学几门课是常态，把两门课的时长混在一条曲线上，
 * 「今天读了两小时」就既不是这门课的、也不是那门课的——学习计划和打卡都失去了意义。
 * 节点本来就属于某个目标，所以**事实（会话、每节点的记录）天生就是可归属的**，
 * 用户级的只是那些按天的汇总。
 *
 * 账本按目标落盘在各自的目标目录里（`{目标}/reading.json`，与 method.json 同一条纪律）：
 * 删掉一个目标，它的阅读记录跟着一起没了，不会在用户账上留下一份无主的时长。
 */
export interface ReadingBook {
  byGoal: Record<string, ReadingStore>
}

/**
 * 一次结算的增量。
 *
 * 全是**增量**而不是累计值：写入是「加上去」，于是重复结算、崩溃后重放都不会算两遍。
 * reach 例外（它是 max），marks 是并集。
 */
export interface ReadingDelta {
  sessionId: string
  nodeId: string
  doc: string
  day: string
  at: number
  activeMs: number
  /** 从会话第 minuteIndex 分钟起的增量桶 */
  minuteIndex: number
  minutes: MinuteTick[]
  breaks: ReadingBreak[]
  /** 本次有变化的节（ms 为增量，reach 为最新值；新出现的节 ms=0） */
  sections: SectionRead[]
  words?: number
  /** 打开事件：+1 */
  opens?: number
  planId?: string
}
