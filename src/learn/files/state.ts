/** 这个文件负责什么：界面状态（state.json）的形状与写出——「上次看到哪儿」、页签、暂存区与本地文件那一份。 */

import type { Drafts } from '../drafts'
import { DEFAULT_SCHEDULE_SOUND } from '../schedule'
import type { DocKind, DocScroll, FavoriteItem, LearnStore, LearnTab, LocalFile, MemoryItem, WorkflowEntry } from '../types'

/**
 * 界面状态（相对用户目录的 state.json）。
 *
 * 它装的是「上次看到哪儿」：当前目标 / 节点 / 对话，以及**打开着哪些页签**、
 * 拖进来过哪些本地文件。与教学文档分开存：这些不是学习数据，丢了不影响学过的东西，
 * 但不该每次启动都从头来一遍——重开应用，上次开着的几个文档还在，这是页签的意义。
 *
 * 存进来的一律是原始值，校验交给 store 的 normalizeLearnStore：手改过的 state.json
 * 指向一个已经删掉的节点，是必须有兜底的（否则启动就白屏）。
 */
export interface LearnState {
  activeGoalId: string | null
  activeNodeId: string | null
  activeConversationId: string | null
  /** 文档区：分组 + 分割（见 learn/groups 的 DocWorkspace） */
  docArea?: unknown
  /** 旧字段：文档区只有一排页签时的平铺列表。保留只为读回旧文件（写出时不写） */
  tabs?: LearnTab[]
  /** 旧字段：那一排页签里激活的一个。理由同上 */
  activeTab?: string | null
  /** 暂存区：改了还没保存的正文，键是页签 id（见 learn/drafts） */
  drafts?: Drafts
  /** 每一份文档读到哪儿了（键 = 页签 id；见 learn/types 的 DocScroll） */
  docScroll?: DocScroll
  /** 最近打开过的本地文件 */
  localFiles?: LocalFile[]
  /** 收藏夹：文档与网页（见 learn/favorites） */
  favorites?: FavoriteItem[]
  /** 收藏分组的登记表（空组也要能存在；见 learn/favorites 的分组段） */
  favGroups?: string[]
  /**
   * 随笔窗口拖到哪儿、多大（见 learn/types 的 EssayDockRect）。
   * 与 docScroll 同一类：这台机器上的界面动作，不跟着别人的备份走。
   */
  essayDock?: unknown
  /**
   * 全局工作流（跨目标、跟着用户走；目标级的在各自目录的 workflow.json）。
   * 曾经还存过每条工作流的思考档位（efforts），2026-10-25 删除：档位全应用只有
   * 全局滑条一份。旧文件里的 efforts 键读回时直接忽略（见 parseDocs）。
   */
  workflows?: { global?: WorkflowEntry[] }
  /**
   * 记忆库里的**长期**那一半（见 learn/memory）。
   *
   * 长期记忆跨目标、跟着用户走，不属于任何一个目标的目录，所以和全局工作流一样存在这里；
   * 工作记忆按目标落在各自目录的 mind.json（见 buildDocs）。
   */
  memory?: { long?: MemoryItem[] }
  /**
   * 视频资源（见 learn/types 的 VideoResource）：用户级，整块存在这里。
   * 新字段进 state.json 要同时改三处：buildState（写）/ parseDocs（搬）/ normalize（读），
   * 少任何一处都是「写下去了、读不回来」——videos 就是在中间这层漏过。
   */
  videos?: unknown
  /**
   * 日程（见 learn/schedule）：提醒清单 + 铃声设置。同样**整块**存在这里——
   * 它是用户级数据（不挂目标），漏一个字段就等于「写下去了、读不回来」。
   */
  schedule?: unknown
  /** 旧字段：页签之前，「文档区在看教学文档还是笔记」。保留只为读回旧文件 */
  activeDoc?: DocKind
  /** agent 栏的页签（见 learn/agentTabs）。原样落盘，校验交给 normalizeLearnStore */
  agentTabs?: unknown
  /** agent 栏当前激活的页签（agentTabKey 的结果） */
  agentActiveTab?: unknown
}

export function buildState(store: LearnStore): Record<string, unknown> {
  return {
    version: 1,
    activeGoalId: store.activeGoalId,
    activeNodeId: store.activeNodeId,
    activeConversationId: store.activeConversationId,
    // 文档区（分组 + 分割，见 learn/groups）。旧版这里是平铺的 tabs / activeTab，
    // 写出的一律是新结构；旧文件由 groups 的 normalizeDocs 在读回来的路上折成单组
    docArea: store.docArea,
    drafts: store.drafts,
    // 读到哪儿了：空表不写（与专注同一条纪律——空字段只会让读代码的人以为这里存过东西）
    ...(Object.keys(store.docScroll ?? {}).length ? { docScroll: store.docScroll } : {}),
    localFiles: store.localFiles,
    // 收藏夹只在真有东西时写：空清单只会让人以为收藏过什么（与 workflows 同一条纪律）
    ...(store.favorites?.length ? { favorites: store.favorites } : {}),
    // 分组登记表只在真有组时写（与 favorites 同一条纪律）
    ...(store.favGroups?.length ? { favGroups: store.favGroups } : {}),
    // 全局工作流没有就不写：空清单只会让人以为登记过东西（与 mind.json / method.json 同一条纪律）。
    ...(store.workflows?.global?.length ? { workflows: { global: store.workflows.global } } : {}),
    /*
     * 长期记忆：只在真有条目时写（与 workflows 同一条纪律——空清单只会让人以为存过什么）。
     * 工作记忆不在这里：它按目标写在各自目录的 mind.json（见 buildDocs）。
     */
    ...(store.memory?.long?.length ? { memory: { long: store.memory.long } } : {}),
    // 日程：有条目、或铃声被改过才写（默认铃声不值得占字段；改过就得记住）
    ...(hasSchedule(store.schedule) ? { schedule: store.schedule } : {}),
    /*
     * 视频资源（见 learn/types 的 VideoResource）：与日程同一条纪律——有才写。
     * **这一行曾经漏过**：资源只在内存里，一落盘就没了（用户报「选集和进度不生效」）。
     * 新字段进 LearnStore 时记得同时补到这里，归一那头在 normalize/index。
     */
    ...(store.videos?.length ? { videos: store.videos } : {}),
    /*
     * agent 栏的页签：只在真有页签时写（与 favorites 同一条纪律）。
     * 激活项跟着页签走——没有页签时的 null 是默认值，不值得占一个字段。
     */
    ...(store.agentTabs?.length ? { agentTabs: store.agentTabs } : {}),
    ...(store.agentActiveTab ? { agentActiveTab: store.agentActiveTab } : {}),
    // 随笔窗口的位置与大小：拖过一次才写（没拖过就是默认值，不占字段）
    ...(store.essayDock ? { essayDock: store.essayDock } : {}),
  }
}

/**
 * 日程要不要写进 state.json：有条目，或者铃声不是默认那一档。
 *
 * 与上面同一条纪律（空结构不写），但多认一个条件：日程表可以是空的，
 * 而「我把铃声换成了钟声」这件事必须记住——它只活在这份文件里。
 */
const hasSchedule = (s?: { items: unknown[]; sound?: { preset?: string; volume?: number } }): boolean =>
  !!s &&
  (s.items.length > 0 ||
    (s.sound?.preset !== undefined && s.sound.preset !== DEFAULT_SCHEDULE_SOUND.preset) ||
    (s.sound?.volume !== undefined && s.sound.volume !== DEFAULT_SCHEDULE_SOUND.volume))
