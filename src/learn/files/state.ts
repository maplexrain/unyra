/** 这个文件负责什么：界面状态（state.json）的形状与写出——「上次看到哪儿」、页签、暂存区与本地文件那一份。 */

import type { Drafts } from '../drafts'
import type { DocKind, DocScroll, FavoriteItem, LearnStore, LearnTab, LocalFile, WorkflowEffortSetting, WorkflowEntry } from '../types'

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
   * 全局工作流（跨目标、跟着用户走；目标级的在各自目录的 workflow.json）。
   * efforts 是每条工作流的思考档位配置（键 = id，内置与登记通吃）——同样全局一份，
   * 档位是「设置」不是学习数据，不随目标文件走。
   */
  workflows?: { global?: WorkflowEntry[]; efforts?: Record<string, WorkflowEffortSetting> }
  /*
   * 番茄钟（见 learn/pomodoro）**整块**存在 state.json 里，没有磁盘镜像，
   * 所以这里漏一个字段就等于「写下去了、读不回来」——曾经真漏过。
   *
   * 阅读记录与打卡曾经也在这儿，现在它们按目标落在各自目录（`{目标}/reading.json`、
   * `checkin.json`，见 learn/reading 的 ReadingBook）。旧的那两个字段**不再读**：
   * 改口径不迁移数据，从前那份用户级的账直接丢掉（见 parseDocs 里的说明）。
   */
  pomodoro?: unknown
  /** 旧字段：页签之前，「文档区在看教学文档还是笔记」。保留只为读回旧文件 */
  activeDoc?: DocKind
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
    // 读到哪儿了：空表不写（与番茄钟同一条纪律——空字段只会让读代码的人以为这里存过东西）
    ...(Object.keys(store.docScroll ?? {}).length ? { docScroll: store.docScroll } : {}),
    localFiles: store.localFiles,
    // 收藏夹只在真有东西时写：空清单只会让人以为收藏过什么（与 workflows 同一条纪律）
    ...(store.favorites?.length ? { favorites: store.favorites } : {}),
    // 分组登记表只在真有组时写（与 favorites 同一条纪律）
    ...(store.favGroups?.length ? { favGroups: store.favGroups } : {}),
    // 全局工作流没有就不写：空清单只会让人以为登记过东西（与 mind.json / method.json 同一条纪律）。
    // 档位配置（efforts）同理：一张空表不如没有——「这个字段存在」本身就是一种声明
    ...(store.workflows?.global?.length || (store.workflows?.efforts && Object.keys(store.workflows.efforts).length)
      ? {
          workflows: {
            ...(store.workflows?.global?.length ? { global: store.workflows.global } : {}),
            ...(store.workflows?.efforts && Object.keys(store.workflows.efforts).length
              ? { efforts: store.workflows.efforts }
              : {}),
          },
        }
      : {}),
    /*
     * 番茄钟也只在真有东西时才写。
     *
     * 这份 state.json 是**整份重写**的：一份空结构每次保存都要多写几百字节，
     * 而它承载的信息量是零。更实际的理由是——「这个字段存在」本身就是一种声明，
     * 空对象会让以后读代码的人以为这里存过什么。
     * （阅读与打卡不在这里：它们按目标写在各自目录里，见 buildDocs。）
     */
    ...(hasPomodoro(store.pomodoro) ? { pomodoro: store.pomodoro } : {}),
  }
}

const hasPomodoro = (p?: { current: unknown; log: unknown[] }): boolean =>
  !!p && (!!p.current || p.log.length > 0)
