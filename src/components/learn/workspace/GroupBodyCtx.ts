import type { ComponentProps, Dispatch, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from 'react'
import type { DocView, FavoriteRef, KnowledgeNode, LearnStore, LearnTab, TabRef, WebTabMeta } from '../../../learn/types'
import type { TabOwners } from '../../../learn/groups'
import type { StructureMap } from '../../../learn/structure'
import type { ChipPayload } from '../../../lib/docChip'
import type { DocSource } from '../NodeNote'
import type { RecentOpen } from '../../../learn/recents'
import type { Props } from './constants'
import type { useDocSaveFlow } from './useDocSaveFlow'
import type { useTabDnd } from './useTabDnd'
import type { useScheduleFlow, useScheduleReminder } from './useScheduleFlow'
import type { useMemoryActions } from './useMemoryActions'
import type { useWorkflowStarters } from './useWorkflowStarters'
import type { usePresence } from '../../../lib/presence'
import type { useAgent } from '../../../learn/useAgent'
import type { loadAgentSettings } from '../../../agent/settings'
import type TabBar from '../TabBar'
import type WebTabLayer from '../web/WebTabLayer'
import type { EmptyDoc } from './chrome'
import type { DocPane } from './DocPane'
import type SuperDocView from '../SuperDocView'
import type { NodeDocActions, ExamActions } from '../ExplorerSidebar'
import type { CanvasChannelProps } from '../OutlineView'

type AgentApi = ReturnType<typeof useAgent>
type AgentSettings = ReturnType<typeof loadAgentSettings>
type SaveFlowApi = ReturnType<typeof useDocSaveFlow>
type TabDndApi = ReturnType<typeof useTabDnd>
type MemoryActionsApi = ReturnType<typeof useMemoryActions>
type StartersApi = ReturnType<typeof useWorkflowStarters>

type ComponentTabBarUnsaved = ComponentProps<typeof TabBar>['unsaved']
type ComponentWebTabOnCommit = ComponentProps<typeof WebTabLayer>['onCommitUrl']
type ComponentWebTabJumps = ComponentProps<typeof WebTabLayer>['pendingJumpsRef']
type ComponentEmptyDocTitleOf = ComponentProps<typeof EmptyDoc>['favoriteTitleOf']
type ComponentEmptyDocOpenRecent = ComponentProps<typeof EmptyDoc>['onOpenRecent']
type ComponentDocPaneNote = ComponentProps<typeof DocPane>['note']
type ComponentSuperOnMethodCall = ComponentProps<typeof SuperDocView>['onMethodCall']

/** 一枚常驻正文片的形状（renderGroup 按 group 分派，见 learn/resident） */
export interface ResidentPane {
  group: string
  tab: LearnTab
  node: KnowledgeNode
  source: DocSource
}

/**
 * 一格正文的完整渲染需要的宿主能力与派生值。
 *
 * 字段多，但分四类：store 派生（一次性喂入）、保存/编辑流回调、导航与打开器、
 * 各域动作对象。格内的二次派生（paneInfo、可见页签、常驻层过滤）在渲染函数内部现算，
 * 不经过宿主——它们是「这一格」的事。
 */
export interface GroupBodyCtx {
  groupId: string
  store: LearnStore
  docs: LearnStore['docArea']
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  onRootChanged: Props['onRootChanged']
  /* 页签编排派生 */
  tabOwners: TabOwners
  shownTabIds: Set<string>
  residentPanes: ResidentPane[]
  activeGoalId: string | null
  activeTab: LearnTab | null
  docView: DocView
  docSource: DocSource | null
  docPending: boolean
  unsavedIds: ComponentTabBarUnsaved
  tabTrails: Record<string, string>
  webMeta: Record<string, WebTabMeta>
  patchWebMeta: ComponentProps<typeof WebTabLayer>['onMeta']
  outlineFocus: { nodeId: string; nonce: number } | null
  handleOutlineFocusHandled: () => void
  /* 纯净阅读与随笔入口 */
  pure: boolean
  pureMoving: boolean
  toggleZen: () => void
  essayGoalId: string | null
  setEssayOpen: Dispatch<SetStateAction<boolean>>
  essayBtnRef: RefObject<HTMLButtonElement | null>
  /* 查找条 */
  findMode: 'find' | 'replace' | null
  findTick: number
  setFindMode: Dispatch<SetStateAction<'find' | 'replace' | null>>
  /* 保存/编辑流（useDocSaveFlow） */
  docSaving: boolean
  docSaveError: string | undefined
  localSaved: { path: string; text: string } | null
  localTicks: SaveFlowApi['localTicks']
  editDocSource: SaveFlowApi['editDocSource']
  stageLocalDraft: SaveFlowApi['stageLocalDraft']
  stageNewFileDraft: SaveFlowApi['stageNewFileDraft']
  saveDocNow: SaveFlowApi['saveDocNow']
  closeTab: SaveFlowApi['closeTab']
  setTabView: (tabId: string, view: DocView) => void
  rememberScroll: (key: string, top: number) => void
  docScale: number
  editorScale: number
  /* 页签栏动作 */
  activateTab: (tabId: string) => void
  reorderTabList: (groupId: string, ids: string[]) => void
  toggleTabPin: (groupId: string, tab: LearnTab) => void
  onTabDragMove: TabDndApi['onTabDragMove']
  onTabDrop: TabDndApi['onTabDrop']
  tabDrag: TabDndApi['tabDrag']
  tabDocPayload: (ref: TabRef) => ChipPayload | null
  openChipInGroup: (groupId: string) => (p: ChipPayload) => void
  /* 空白页 / 兜底卡片的就地打开（openInPlace 家族） */
  openNewFileInPlace: (groupId: string, tabId: string) => void
  pickLocalInPlace: (groupId: string, tabId: string) => void
  openWebInPlace: (groupId: string, tabId: string) => void
  openNewGoalInPlace: (groupId: string, tabId: string) => void
  /* 打开器 */
  openWebTab: (url: string) => void
  openBlankTab: () => string
  commitWebUrl: ComponentWebTabOnCommit
  pendingJumpsRef: ComponentWebTabJumps
  /* 收藏 */
  isTabFavorite: (ref: TabRef) => boolean
  toggleTabFavorite: (tab: Pick<LearnTab, 'id' | 'ref'>, extra?: { title?: string; icon?: string }) => void
  isUrlFavorite: (url: string) => boolean
  toggleUrlFavorite: (url: string, extra?: { title?: string; icon?: string }) => void
  favoriteTitleOf: ComponentEmptyDocTitleOf
  openFavorite: (ref: FavoriteRef) => void
  blankRecents: RecentOpen[]
  openRecent: ComponentEmptyDocOpenRecent
  /* 日程 / 记忆 / 导师设置 */
  scheduleActions: ReturnType<typeof useScheduleFlow>
  scheduleRinging: ReturnType<typeof useScheduleReminder>['ringing']
  memoryCreate: MemoryActionsApi['memoryCreate']
  memoryUpdate: MemoryActionsApi['memoryUpdate']
  memoryDelete: MemoryActionsApi['memoryDelete']
  memoryClearWork: MemoryActionsApi['memoryClearWork']
  agentSettings: AgentSettings
  hasKey: boolean
  debugWin: ReturnType<typeof usePresence>
  openContextTrace: () => void
  workflowRows: StartersApi['workflowRows']
  runWorkflowRow: StartersApi['runWorkflowRow']
  removeWorkflowRow: StartersApi['removeWorkflowRow']
  /* 正文域 */
  requestGenerateDoc: (n: KnowledgeNode) => void
  getNoteActions: (tabId: string, node: KnowledgeNode, source: DocSource) => ComponentDocPaneNote
  agent: AgentApi
  /* 画布 / 大纲 */
  updateStructure: (goalId: string, next: StructureMap) => void
  explorerDocs: NodeDocActions
  explorerExams: ExamActions
  canvasChannel: CanvasChannelProps
  /* 超级文档 method 桥 */
  runSuperMethod: ComponentSuperOnMethodCall
  /* 手势与挂点 */
  onDocPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  docMarkMoved: RefObject<boolean>
  docBox: RefObject<HTMLDivElement | null>
  groupHosts: RefObject<Map<string, HTMLElement>>
  stripHosts: RefObject<Map<string, HTMLElement | null>>
  /** 页签栏与 paneInfo 的试卷标题活查（改名后跟着新名字走） */
  examTabTitle: (examId: string, attemptId: string) => string | undefined
}
