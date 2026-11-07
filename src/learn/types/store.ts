/**
 * 顶层 store 类型（纯搬运自 learn/types.ts，对外仍由 learn/types 门面原名转发）：
 * LearnStore 及页签滚动（DocScroll）、临时变量（TmpEntry / TmpStore）。
 * 跨域类型一律 `import type` 引入（types/ 的 node / tabs / media / essay /
 * memory / workflow，以及 learn 域外的 drafts / exam / groups / schedule /
 * static / structure / agent），不造成值级循环。
 */

import type { Conversation } from '../../agent/types'
import type { Drafts } from '../drafts'
import type { Exam } from '../exam'
import type { DocWorkspace } from '../groups'
import type { ScheduleStore } from '../schedule'
import type { StaticResource } from '../static'
import type { StructureMap } from '../structure'
import type {
  DependencyEdge,
  DetachedPool,
  KnowledgeNode,
  LearningGoal,
  MethodStore,
  OutlineEntity,
} from './node'
import type { FavoriteItem, AgentTabRef, LocalFile } from './tabs'
import type { FileNodeEntity, ProjectNodeEntity, VideoNodeEntity, VideoResource } from './media'
import type { EssayCommitStore, EssayDockRect, EssayStore } from './essay'
import type { MemoryStore } from './memory'
import type { WorkflowBook } from './workflow'

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
   * 项目节点（见 ProjectNodeEntity 与 learn/projects）：目标 × 真实路径的声明表。
   * 目标级数据，与视频节点同一档：落各自目标目录的 projects.json，目标没了整批带走。
   * 可选字段：旧数据没有它，全部使用处按 `?? []` 兜底。
   */
  projects?: ProjectNodeEntity[]
  /**
   * 文件节点（见 FileNodeEntity 与 learn/fileNodes）：目标 × 本地文件/网页的绑定。
   * 目标级数据，落各自目标目录的 file-nodes.json，目标没了整批带走。
   * 可选字段：旧数据没有它，全部使用处按 ?? [] 兜底。
   */
  fileNodes?: FileNodeEntity[]
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
