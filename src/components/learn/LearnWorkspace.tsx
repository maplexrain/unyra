/*
 * 学习工作区（宿主）：目标 → 节点树 → 选中节点进入「文档 + 超级导师」两列。
 * 节点由用户在文档里选中陌生词汇创建；创建后原文替换为可点击的节点链接，
 * 剩下的事（标题、描述、正文）都交给 Agent，界面当场就有反馈。
 *
 * 这个文件是**编排层**：它持有「现在看什么」（页签）、把 store 派生成界面要的形状、
 * 把 Agent 与界面接起来，最后把 JSX 拼出来。成块的机制都住在 workspace/ 下：
 *
 * - useSideColumns / SplitRow —— 两列的宽度、收起、对调与骨架；
 * - useDocSaveFlow             —— 暂存、保存、关页签确认、外部改动冲突；
 * - useExportFlow              —— 导出弹窗与 md / html / pdf 三条路；
 * - useTabDnd                  —— 页签拖拽分屏与格间分割线；
 * - examTools                  —— 注入给 Agent 的 api.exam.* 工具；
 * - useLinkHandlers            —— moji:node / doc / super 三种链接的跳转；
 * - useLibraryActions          —— 笔记与本地文件的动作；
 * - useConceptActions          —— 选区上的学习 / 了解 / 注解 / 询问；
 * - useFocusFlow               —— 专注模式动作；
 * - useWorkflowStarters        —— 一切「交给导师工作流跑」的启动器。
 *
 * renderGroup / renderLayout 刻意留在这里（见它们头上的说明）。
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { ExternalLink, Globe, Maximize2, Minimize2 } from 'lucide-react'
import type {
  DocKind,
  DocView,
  DockNoteItem,
  EssayCommit,
  EssayDockRect,
  EssayEntry,
  FavoriteRef,
  KnowledgeNode,
  LearnStore,
  LearnTab,
  TabRef,
  WebTabMeta,
  LearningGoal,
  ProjectNodeEntity,
} from '../../learn/types'
import { notesOf } from '../../learn/types'
import {
  favoriteKey,
  favoriteKeyOfTab,
  favoriteRefOfTab,
  favoriteTitle,
  removeFavorite as removeFromFavorites,
  removeFavoriteGroup,
  renameFavoriteGroup,
  renameWebFavorite,
  setFavoriteGroup,
  createFavoriteGroup,
  tabRefOfFavorite,
  toggleFavorite as toggleInFavorites,
} from '../../learn/favorites'
import { recentOpens, type RecentOpen } from '../../learn/recents'
import { getOutlineSlot } from '../../lib/outline'
import {
  PUBLIC_OWNER,
  activateIn,
  activeIdsOf,
  allStoredTabs,
  allTabs,
  claimTab,
  closeIds,
  closeIn,
  findTab,
  focusTabsInGroup,
  focusedGroup,
  focusedTab,
  goalTabsOf,
  groupIdOfTab,
  isAnchorOutline,
  openAnchorOutline,
  openGroupedDoc,
  openInGroup,
  openOutlineTab,
  patchTab,
  reconcileOwners,
  refOwner,
  reorderIn,
  setFocus,
  settle,
  visibleTabs,
  withGroup,
  withOwners,
  withParked,
  type DocLayout,
  type TabOwners,
} from '../../learn/groups'
import { makeBlankTab, makeTab, newBlankKey, newDraftKey, newWebKey, tabKey, tabNodeId, tabTitle, tabTrail, fileNameOf as localFileNameOf } from '../../learn/tabs'
import { setZenActive } from '../../learn/zen'
import { closeGoalTabGroupStore } from '../../learn/groups/goalTabGroupOps'
import { pickLocalFiles, readLocalFile } from '../../lib/localFiles'
import { addLocalFile } from '../../learn/localfiles'
import { normalizeWebInput } from '../../learn/webUrl'
import type { BrowserDeps } from '../../learn/web/browserOps'
import {
  addConversation,
  conversationTitle,
  conversationById,
  deleteConversation,
  deleteGoal,
  deleteMessage,
  deleteNode,
  ensureConversation,
  goalSubtreeIds,
  latestConversation,
  resolveDisplayedConversation,
  nodeById,
  normalizeKey,
  removeExam,
  touchNode,
  updateMessageText,
  deleteNote,
  writeNote,
} from '../../learn/graph'
import {
  agentTabCloseBlock,
  agentTabCloseSet,
  agentTabKey,
  reorderAgentTabs,
  removeAgentTab,
  removeAgentTabsOfGoals,
  upsertAgentTab,
  visibleAgentTabs,
  withAgentTabs,
  type AgentTabCloseBlock,
} from '../../learn/agentTabs'
import type { AgentTabRef } from '../../learn/types'
import type { StructureMap } from '../../learn/structure'
import { resolveProjectRoot } from '../../learn/projects'
import type { TabCloseMode } from '../../learn/tabs'
import { attemptBrief, examAttempted, examTotalPoints } from '../../learn/exam'
import type { Exam } from '../../learn/exam'
import { useExamBridge } from '../../learn/useExamBridge'
import { captureExamDelete, captureNodeDelete } from '../../learn/undo'
import { makeConversation, nodeDocRel } from '../../learn/store'
import { loadAgentSettings, saveAgentSettings, subscribeAgentSettings } from '../../agent/settings'
import { subscribeDrops } from '../../agent/contextDebug'
import { personaOf } from '../../agent/persona'
import { docFormatOf } from '../../agent/docFormat'
import AgentSettingsPanel from '../AgentSettingsPanel'
import MindPanel from '../agent/MindPanel'
import { addFreeConversation, deleteFreeConversation, freeConversationById, getFreeConversations, subscribeFreeChat } from '../../learn/freeChat'
import { clearWorkMemories, createMemory, deleteMemory, updateMemory, type MemoryInput, type MemoryPatch } from '../../learn/memory'
import ExportDialog from './ExportDialog'
import FloatWindow from '../FloatWindow'
import { usePresence } from '../../lib/presence'
import ExamCopyView from './ExamCopyView'
import { OutlinePane } from './workspace/OutlinePane'
import StructOverlay from './workspace/StructOverlay'
import { NodeService, type GNodeKind } from '../../learn/nodeKinds'
import { noteEntityOf } from './workspace/panes'
import { pruneImages } from '../../learn/images'
import { queueOf, shouldEnqueue } from '../../learn/agentQueue'
import {
  cachedResourceUrl,
  findResource,
  loadResourceImage,
  revealResource,
  subscribeResources,
} from '../../learn/static'
import { nodePathOf, resolveNode } from '../../learn/paths'
import { setPlotFixHandler } from '../../lib/plot'
import { nodeDocPath } from '../../learn/files'
import { createNodeDocImageResolver, type LocalImageResolver } from '../../lib/docImages'
import { revealLocalFile, revealPath, revealUserPath, userAbsPath, listUserDir, mkdirUserPath, moveUserPath, copyUserPath, writeUserText, readUserText, userAbsPrefix } from '../../lib/storage'
import { wsAllocateName, wsNameOk, wsRefOfRel, wsRelOf, wsRelOfTab } from '../../learn/workspace'
import { notifyWsChanged } from './explorer/wsChanges'
import { setStaticView } from '../../lib/staticView'
import {
  useAppearance,
} from '../../lib/appearance'
import { useLearnStore } from '../../learn/useLearnStore'
import { useShortcut } from '../../lib/useShortcut'

import {
  handleSuperLink,
  parseSuperHref,
} from '../../lib/nodeLink'
import { syncProxyHosts } from '../../ai/http'
import {
  activeLabel,
  allProviderBaseUrls,
  globalEffort,
  globalSummary,
  hasApiKey,
  loadAiSettings,
  saveAiSettings,
  supportsImage,
} from '../../ai/settings'
import { REASONING_LABEL, type ReasoningEffort } from '../../ai/types'
import { useAgent } from '../../learn/useAgent'
import ExplorerSidebar, {
  type ExamActions,
  type NodeDocActions,
} from './ExplorerSidebar'
import { requestReveal } from './explorer/reveal'
import { focusAgentInput } from '../../lib/agentFocus'
import { moveTabMark, resetTabMark } from '../../lib/tabMark'
import { setChipOpener, type ChipPayload } from '../../lib/docChip'
import { openExternalLink, setWebLinkHandler } from '../../lib/externalLink'
import { tabRefFromChip } from '../../learn/chipRef'
import { CHIP_MIME, parseChipJson } from '../../lib/chipSyntax'
import TabBar from './TabBar'
import WebTabLayer, { type WebTab } from './web/WebTabLayer'
import VideoTabLayer, { type VideoTab } from '../video/VideoTabLayer'
import type { VideoCreateDraft } from '../video/VideoStudyTab'
import PluginDoc from '../plugins/PluginDoc'
import { setPluginDocOpener } from '../../lib/pluginDoc'
import { resolveVideoSource } from '../../lib/videoPlugins'
import { setVideoBlockHost, cleanVideoNodeUuid, type VideoBlockData, type VideoEpisodeItem } from '../../lib/videosBlock'
import { setQuoteBlockHost } from '../../lib/quoteBlock'
import { focusWebAddress } from './web/addressFocus'
import FindBar from './FindBar'
import SuperDocView from './SuperDocView'
import { readSuperDoc } from '../../learn/superdocs'
import { superDocsOf } from '../../learn/types'
import { findMethod, runMethodEntry } from '../../learn/methods'
import { learnSandboxOps } from '../../learn/useAgent'
import { buildStandaloneApi } from '../../agent/tools'
import { isElectron, isWeb, native } from '../../lib/native'
import DocFloat from './DocFloat'
import LocalDoc from './LocalDoc'
import DraftDoc from './DraftDoc'
import SourceEditor from './SourceEditor'
import EssayDock from './essay/EssayDock'
import { createEssay, deleteEssay, updateEssay } from '../../learn/essays'
import {
  changesSummary,
  commitFeed,
  commitsOf,
  createEssayCommit,
  diffNoteChanges,
  noteFingerprint,
  parseEssayComment,
  updateEssayCommit,
} from '../../learn/essayCommits'
import { useDoubleShift } from '../../lib/useDoubleShift'
import type { DocSource } from './NodeNote'
import ConfirmDialog from '../ConfirmDialog'
import { AgentTabPane } from './workspace/AgentTabPane'
import SettingsPanel from '../settings/SettingsPanel'
import UsagePanel from '../settings/UsagePanel'
import { SchedulePage } from '../schedule/SchedulePage'
import AgentTabStrip from '../agent/AgentTabStrip'
import ContextDebugger from '../agent/ContextDebugger'
import { resetPrefixGate } from '../../agent/prefixGate'
import { setEffortNotice } from '../../learn/effortGuard'
import { docAreaElement, locateNeedle, scrollToDoc, visibleDocBody } from '../../lib/docDom'
import { localRevealKey, nodeRevealKey, requestSourceReveal } from '../../lib/docReveal'
import { readRecentTabs, residentIds } from '../../learn/resident'
import type { UiPointRequest } from '../../agent/tools'
import type { AskAnswers } from '../../agent/tools'
import type { Conversation, PendingFile, PendingImage } from '../../agent/types'
import type { Props } from './workspace/constants'
import { SRC_SCROLL_SUFFIX, SIDE_ANIM_MS } from './workspace/constants'
import { ZONE_BOX } from './workspace/drag'
import { examDeleteWarn } from './workspace/labels'
import { conceptKeysOf, emptyNote, examCopyOf, paneInfo, paneOf } from './workspace/panes'
import { DocPane } from './workspace/DocPane'
import { ScheduleDock } from './workspace/docks'
import ToolsButton from '../tools/ToolsButton'
import ScreenshotModal from '../tools/ScreenshotModal'
import { EmptyDoc, Topbar } from './workspace/chrome'
import { CreateGoalDialog } from './workspace/CreateGoalDialog'
import { useSideColumns } from './workspace/useSideColumns'
import SplitRow from './workspace/SplitRow'
import { useDocSaveFlow } from './workspace/useDocSaveFlow'
import { useExportFlow } from './workspace/useExportFlow'
import { useTabDnd } from './workspace/useTabDnd'
import { useLinkHandlers } from './workspace/useLinkHandlers'
import { useLibraryActions } from './workspace/useLibraryActions'
import { useExplorerUndo } from './workspace/useExplorerUndo'
import { useConceptActions } from './workspace/useConceptActions'
import { useScheduleFlow, useScheduleReminder } from './workspace/useScheduleFlow'
import { useWorkflowStarters } from './workspace/useWorkflowStarters'
import { examNeedingWork, makeExamDeps } from './workspace/examTools'
import { hasExamFigures, selfCheckExamFigures } from './workspace/examImageCheck'
import { t } from '../../i18n'

/**
 * 每个目标「最近被看过哪个节点」：agent 页签是目标级的，发送目标却是节点——
 * 用户在文档区看过哪个节点，导师那一轮就冲着哪个节点去（没看过的目标回落到它的总目标）。
 *
 * 走**模块级槽**而不是 ref：agentView 在渲染期读它，而渲染期读 ref 会犯 react-compiler
 * 的 refs 线（与 OutlineHandle 的槽同一套解法）。它是「最后落点」的缓存，不进页签、
 * 不持久化，重启后回落各目标的总节点；写入只发生在 retargetNode（事件路径）。
 */
const goalFocusByGoal = new Map<string, string>()

/**
 * 没有随笔时的空数组：**同一个常量**。
 * 每次渲染现造一个 `[]` 会让 EssayDock 的 props 每次都变（它没有 memo，但列表要重排一遍）。
 */
const EMPTY_ESSAYS: EssayEntry[] = []
/** 没有提交记录时的空数组：理由同上（同一个常量，避免每次渲染都换引用） */
const EMPTY_COMMITS: EssayCommit[] = []
/** 没有当前目标时的笔记表：同一个空数组，避免每次渲染都造新引用 */
const EMPTY_DOCK_NOTES: DockNoteItem[] = []

/**
 * 一枚页签当前归哪个目标（按页签 **id** 反查）。
 *
 * 与 groups/goals 的 refOwner 同一份判据，只是那边收的是 TabRef、这里收的是 id。
 * 归属表里查不到时退回现算（页签自己带着 nodeId），保证「这个页签是不是本目标的」
 * 永远有答案——拿不准时按「不是」算，于是切目标照样会把它收起来。
 */
function ownerOfTabId(s: LearnStore, tabId: string, owners: TabOwners): string {
  for (const [owner, ids] of Object.entries(owners)) if (ids.includes(tabId)) return owner
  const tab = findTab(s.docArea, tabId)
  return tab ? refOwner(tab.ref, (nodeId) => nodeById(s, nodeId)?.goalId ?? null) : PUBLIC_OWNER
}

export default function LearnWorkspace({
  user,
  onRootChanged,
  onOpenUser,
  onSignOut,
  onToast,
  onOpenUpdate,
  onOpenNotice,
  onOpenLan,
}: Props) {
  const { store, set, getLatest, patchQuiet, flush } = useLearnStore()
  /*
   * 页签：文档区「现在看什么」全由它决定。
   *
   * 能分割之后，页签分住在好几格里（见 learn/groups），于是这里派生出下面到处要读的三样：
   * - tabs：全部页签，按**布局顺序**排（左格那一排在前，右格的接上）；
   * - activeTab：**焦点格**里显示的那一个——正文、导出、保存读的都是它；
   * - docs.layout / docs.groups：界面按它把几格摆出来（见下面的 renderLayout）。
   */
  const docs = store.docArea
  const [outlineFocus, setOutlineFocus] = useState<{ nodeId: string; nonce: number } | null>(null)
  /** 全部页签，按**布局顺序**排——它仍是「页签是否已被打开过」的判据（见 openTab / 常驻名额） */
  const tabs = useMemo(() => allTabs(docs), [docs])
  const activeTab = useMemo(() => focusedTab(docs), [docs])
  const activeTabId = activeTab?.id ?? null

  /**
   * **当前目标**：页签栏按它过滤（见 groups/goals）。
   *
   * 取的是 store.activeGoalId——它由 retargetNode 在每次「看某个目标的文档」时对齐，
   * 因此点侧栏某个目标节点、点大纲里的节点、点某个目标下的教学文档，落点都是它。
   * 目标都被删光时是 null，那时只看得见公共页签（设置 / 外部文件）。
   */
  const tabGoalId = store.activeGoalId
  /** 节点 → 它属于哪个目标；页签归属现算时用它（见 groups/goals 的 refOwner） */
  const goalOfNode = useCallback(
    (nodeId: string) => nodeById(getLatest(), nodeId)?.goalId ?? null,
    [getLatest],
  )
  /**
   * 归属表：**保底补全**后再交出去。
   *
   * 正常路径上它已经在读盘时补好了（见 store/normalize），但运行时也可能出现没登记的
   * 页签（新加一种页签类型而忘了在 refOwner 里登记、或某个入口绕过了 claimTab）——
   * 这里再过一次 reconcileOwners，保证「看不到的页签」这件事不会发生。
   */
  const tabOwners = useMemo(
    () => reconcileOwners(docs.tabOwners, tabs, goalOfNode),
    [docs.tabOwners, tabs, goalOfNode],
  )
  /**
   * 当前该显示的页签（公共 + 当前目标）。页签栏读它，正文区仍按「格」渲染——
   * 一格里同时混着公共与目标页签是正常的（正是需求里那条栏的样子）。
   */
  /**
   * 每一格**正在看**的那一片（分屏时同时有好几片）。
   *
   * 它们是页签栏的保底名额（见 visibleTabs 的 pinned）：左右两半各看一个目标是分屏的常态，
   * 而「正文在眼前、它的页签却不在栏上」最难解释——用户会以为那份文档丢了。
   */
  const paneActiveIds = useMemo(() => new Set(activeIdsOf(docs)), [docs])
  const shownTabs = useMemo(
    () => visibleTabs(tabs, tabOwners, tabGoalId, paneActiveIds),
    [tabs, tabOwners, tabGoalId, paneActiveIds],
  )
  const shownTabIds = useMemo(() => new Set(shownTabs.map((t) => t.id)), [shownTabs])

  /**
   * agent 自己的设置（压缩阈值等）。
   *
   * 走 useSyncExternalStore 而不是 useState+effect：它是模块级缓存（见 agent/settings），
   * 在独立窗口里改了之后宿主这边的快照要能跟着变——订阅是唯一能拿到那次通知的口子。
   */
  const agentSettings = useSyncExternalStore(subscribeAgentSettings, loadAgentSettings)
  const [createGoalOpen, setCreateGoalOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  /*
   * 学习状态与试卷**都没有应用内的窗口**：两块都是文档区右上角悬浮组里的一块 tip
   * （鼠标经过即展开，见 components/learn/DocFloat），试卷的作答在独立的考试窗口里
   * （见 learn/useExamBridge 与 ExamWindow）。所以这里没有它们的开关。
   */
  /** 上下文比对调试器：悬浮窗口（可拖动），只在开发者模式里打开（见 AgentSettingsPanel 的开发者分页） */
  const debugWin = usePresence()
  const openContextDebugger = debugWin.setOpen
  // 命中骤降定格成报告时自动弹出（开发者开关开着才弹；见 agent/contextDebug 与 ToolsTab 的开关）
  useEffect(
    () =>
      subscribeDrops(() => {
        if (loadAgentSettings().dev.contextDebugger) openContextDebugger(true)
      }),
    [openContextDebugger],
  )
  // 思考档位唯一性守卫的提醒出口（探针在 useAgent 注册，见 learn/effortGuard）：
  // 用户手动切档且已有带上下文的对话时，提醒一句「下一轮全价重算」
  useEffect(() => {
    setEffortNotice(() => {
      onToast(t('思考档位已切换：已有上下文的对话下一轮将无法命中服务商缓存，将整段重算'))
    })
    return () => setEffortNotice(null)
  }, [onToast])
  /**
   * 上下文轨迹：**独立的 Electron 窗口**（与考试窗口同一套结构，见 electron/app/traceWindow）。
   * 主窗口是数据拥有者：打开时把当前激活会话整份递过去，开着期间随数据变化持续 push；
   * 窗口关掉（onClosed）就停。轨迹是只读的，那边没有任何回发通道。
   */
  const [traceWinOpen, setTraceWinOpen] = useState(false)
  const storeConvRef = useRef(store)
  storeConvRef.current = store
  const openContextTrace = useCallback(() => {
    const s = storeConvRef.current
    const conv = s.conversations.find((c) => c.id === s.activeConversationId) ?? null
    void native()
      .traceHost.open(conv)
      .then((r) => {
        if (r.ok) setTraceWinOpen(true)
      })
      .catch(() => {})
  }, [])
  // 窗口开着：会话数据一变就推一份（activate 会话切换、流式里程碑落库都会走到）
  useEffect(() => {
    if (!traceWinOpen) return
    const s = storeConvRef.current
    native()
      .traceHost.push(s.conversations.find((c) => c.id === s.activeConversationId) ?? null)
    // 依赖里不放 store 整体（每次轮转都换引用）——只盯 conversations 与激活会话两个字段
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceWinOpen, store.conversations, store.activeConversationId])
  useEffect(() => native().traceHost.onClosed(() => setTraceWinOpen(false)), [])
  /*
   * 文档区查找 / 替换条：null = 关着，'find' = 只有查找行，'replace' = 展开替换行。
   * focusTick 每次按快捷键都 +1：条子开着时再按一次 Ctrl+F，要把焦点抢回查找框。
   */
  const [findMode, setFindMode] = useState<'find' | 'replace' | null>(null)
  const [findTick, setFindTick] = useState(0)
  /*
   * 手动保存（Ctrl+S）的两个瞬时状态：正在写、写失败了。
   * 「有没有未保存的改动」不看它们，看暂存区里有没有这一份（见 draft）。
   * 状态留在这里（renderGroup 的编辑器底栏要显示），写入动作在 useDocSaveFlow。
   */
  const [docSaving, setDocSaving] = useState(false)
  const [docSaveError, setDocSaveError] = useState<string | undefined>(undefined)
  /**
   * 刚保存成功的那一版本地文件正文。
   *
   * LocalDoc 打开时读到的那一份是它的基准，而保存之后磁盘上已经是新的了——
   * 不把新的这一版交下去，撤掉暂存的那一刻编辑器会回落到打开时读到的旧内容。
   */
  const [localSaved, setLocalSaved] = useState<{ path: string; text: string } | null>(null)
  // 删除确认：pendingDelete 非空时弹出确认框（删谁只删谁，问一句再删；根文档=整个目标）
  const [pendingDelete, setPendingDelete] = useState<{
    nodeId: string
    title: string
    isRoot: boolean
    count: number
  } | null>(null)
  /**
   * 删除试卷：**分两档**。
   *
   * 没考过的（含出错的废稿）一次确认就删——那只是一份没人用过的题目；
   * 考过的是学习记录（作答、输入顺序、单题耗时、切屏、判分、错题讲解），
   * 所以第一档只负责**把会连带删掉的东西列清楚**，第二档才是真的删。
   */
  const [pendingExamDelete, setPendingExamDelete] = useState<Exam | null>(null)
  const [examDeleteStage, setExamDeleteStage] = useState<'warn' | 'final'>('final')
  // 删除笔记确认：笔记是独立文件，删掉就是真的删了，问一句再说
  const [pendingNoteDelete, setPendingNoteDelete] = useState<{ nodeId: string; name: string } | null>(null)
  // 删除超级文档确认：它是导师生成的交互件（常配着 method 函数），删前问一句
  const [pendingSuperDelete, setPendingSuperDelete] = useState<{ nodeId: string; name: string } | null>(null)
  /** 切换过场要用的容器：动画只加在正文那一层上，悬浮组不跟着晃 */
  const docBox = useRef<HTMLDivElement | null>(null)

  // 挂载时按当前用户的配置同步一次代理白名单：
  // 每个用户的提供商地址各不相同（自定义中转尤其），换用户后必须重新同步，
  // 否则主进程还留着上一个用户的名单，新地址会被 403 拦掉。
  useEffect(() => {
    void syncProxyHosts(allProviderBaseUrls())
  }, [])

  const activeNodeId = store.activeNodeId
  const activeNode = activeNodeId ? (nodeById(store, activeNodeId) ?? null) : null
  const activeGoal =
    store.goals.find((g) => g.id === store.activeGoalId) ??
    store.goals.find((g) => g.id === activeNode?.goalId) ??
    null
  const activeGoalId = activeGoal?.id ?? null

  /*
   * 节点宇宙浮层（快捷键 learn.structPopout，默认 F1，浮层本体见 workspace/StructOverlay）：
   * 当前页签不是大纲时，按键把这个目标的宇宙弹成文档区上方的浮层；再按一次或 Esc 收回。
   * 目标从当前页签绑定的节点现查，查不到落回当前目标；连目标都没有就 toast 指路。
   */
  const [structOverlayGoal, setStructOverlayGoal] = useState<string | null>(null)
  const toggleStructOverlay = useCallback(() => {
    if (structOverlayGoal) {
      setStructOverlayGoal(null)
      return
    }
    const ref = activeTab?.ref
    if (ref && ref.kind === 'outline') return
    const nid = ref ? tabNodeId(ref) : null
    const tabNode = nid ? nodeById(store, nid) : null
    const gid = tabNode?.goalId ?? activeGoalId
    if (!gid) {
      onToast(t('先建一个学习目标，才有节点宇宙可看'))
      return
    }
    setStructOverlayGoal(gid)
  }, [structOverlayGoal, activeTab, store, activeGoalId, onToast])
  useShortcut('learn.structPopout', { down: toggleStructOverlay })

  /* ---------- 实用工具箱：屏幕截图 ---------- */
  const [screenshotImage, setScreenshotImage] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  const handleStartScreenshot = useCallback(async () => {
    if (isCapturing) return
    setIsCapturing(true)
    try {
      const bridge = native()
      // 1. Electron 桌面端优先调起系统层级全屏截图窗口
      if (bridge.tools?.openScreenshot) {
        const res = await bridge.tools.openScreenshot()
        if (!res.ok) {
          onToast(res.error || t('未能启动截图'))
        }
        return
      }

      // 2. WebUI 模式通过服务端/浏览器捕获并在工作区唤起全屏编辑
      if (bridge.tools?.captureScreen) {
        const res = await bridge.tools.captureScreen()
        if (res.ok) {
          setScreenshotImage(res.dataUrl)
        } else {
          onToast(res.error || t('未能获取截图画面'))
        }
      } else {
        onToast(t('当前环境不支持屏幕截图'))
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : t('截图启动失败'))
    } finally {
      setIsCapturing(false)
    }
  }, [isCapturing, onToast])

  /**
   * 顶栏标题只在文档区确实存在目标根大纲时显示。activeNodeId 是导师上下文，关闭文档后
   * 可能仍然保留；如果不加这道门，文档区已经空了，Topbar 却会继续显示旧目标标题。
   */
  const hasTargetTabs = useMemo(() => {
    if (!activeGoal) return false
    const owners = store.docArea.tabOwners
    const goalOfNode = (nodeId: string) =>
      nodeById(store, nodeId)?.goalId ?? (store.goals.some((g) => g.id === nodeId) ? nodeId : null)
    return goalTabsOf(owners, tabs, goalOfNode, activeGoal.id).length > 0
  }, [activeGoal, store, tabs])
  const topbarGoalQuestion = hasTargetTabs ? (activeGoal?.title || activeGoal?.question || '') : ''

  /*
   * 记忆的写入口（见 learn/memory）：**目标由调用方给**——工作记忆落进哪个目标，
   * 由页签携带的 goalId 或设置页里的选择决定，不随活动目标漂移；长期记忆跨目标，
   * 根本没有归属这回事。
   *
   * 四个回调都是「纯函数 + set」：校验、上限、作用域搬家全在 learn/memory 里，
   * 界面只管把用户填的东西交下去（与 workflows / essays 同一套做法）。
   */
  const memoryCreate = (input: MemoryInput) => {
    set(createMemory(getLatest(), input))
  }
  const memoryUpdate = (uuid: string, patch: MemoryPatch) => {
    set(updateMemory(getLatest(), uuid, patch))
  }
  const memoryDelete = (uuid: string) => {
    set(deleteMemory(getLatest(), uuid))
  }
  const memoryClearWork = (goalId: string) => {
    set(clearWorkMemories(getLatest(), goalId))
  }

  /*
   * agent 栏的页签（见 learn/agentTabs）：agent 面板「现在看谁」全由它决定。
   *
   * 页签与文档区的页签是两回事：文档区回答「眼前读着哪份文档」，agent 页签回答
   * 「正跟哪位导师说话」——打开某个目标下的文档会把它的导师页签自动开好并置前
   * （见 retargetNode），但反过来点导师页签不动文档区。两条线在 retargetNode 汇合。
   */
  const agentTabs = useMemo(() => store.agentTabs ?? [], [store.agentTabs])
  /*
   * 固定聊天页签：栏上最左、常驻、不落 store——每一轮渲染在列表前合成一枚。
   * 它展示的会话 = freeConvId（点选/新建时记下），丢了就回落到最近一段。
   */
  const freeChats = useSyncExternalStore(subscribeFreeChat, getFreeConversations)
  const [freeConvId, setFreeConvId] = useState<string | null>(null)
  const currentFreeConvId =
    freeConvId && freeConversationById(freeConvId) ? freeConvId : (freeChats[0]?.id ?? null)
  const freeTabRef = useMemo<AgentTabRef>(
    () => ({ kind: 'free', conversationId: currentFreeConvId }),
    [currentFreeConvId],
  )
  /*
   * agent 页签**跟着目标走**（见 learn/agentTabs 的 visibleAgentTabs）：
   * 栏上只画当前目标名下的导师与子代理，切换目标时那一栏跟着换。
   * 子代理的归属按它那段对话算（谁派出去的就属于谁），因此 `goalOfConversation` 由这里注入。
   */
  const goalOfConversation = useCallback(
    (id: string) => conversationById(store, id)?.goalId ?? null,
    [store],
  )
  const goalAgentTabs = useMemo(
    () => visibleAgentTabs(agentTabs, store.activeGoalId, goalOfConversation),
    [agentTabs, store.activeGoalId, goalOfConversation],
  )
  /** 页签条看到的列表 = 固定页签置左 + 本目标的页签原序 */
  const stripTabs = useMemo(() => [freeTabRef, ...goalAgentTabs], [freeTabRef, goalAgentTabs])
  /**
   * 面板常挂的列表：**所有**页签（不按目标过滤）。
   *
   * 栏上按目标过滤是「别把话说错人」，面板不跟着过滤是另一件事——输入框里打到一半的
   * 话是组件自己的 state（不落盘），面板一卸载就没了。切走一个目标再切回来，
   * 半句话还在不在，差别就在这一行。
   */
  const agentPanes = useMemo(() => [freeTabRef, ...agentTabs], [freeTabRef, agentTabs])
  const activeAgentTab = useMemo(() => {
    if (store.agentActiveTab === 'free') return freeTabRef
    const hit = goalAgentTabs.find((t) => agentTabKey(t) === store.agentActiveTab)
    if (hit) return hit
    /*
     * 记着的激活项不在这个目标名下（切了目标、或它是别家目标的子代理）：
     * 落到本目标这一枚——导师是跟着目标走的，切了目标却还对着上一个目标的导师说话最危险。
     * 本目标一枚都没有时也必须回到固定聊天：固定聊天是 Agent 栏的底座，不能因为目标导师
     * 被关闭或旧的 activeAgentTab 失效而让整块 Agent 区消失。
     */
    return goalAgentTabs.find((t) => t.kind === 'goal') ?? freeTabRef
  }, [goalAgentTabs, store.agentActiveTab, freeTabRef])
  const activeAgentTabId = activeAgentTab ? agentTabKey(activeAgentTab) : null
  /**
   * 激活页签解析出的面板视图：目标级页签 → 那个目标当前展示的会话 + 落点节点；
   * 子代理页签 → 它的父会话（subagent 的数据都住在导师对话上）与它自己的会话 id。
   */
  const agentView = useMemo(() => {
    if (!activeAgentTab) return null
    if (activeAgentTab.kind === 'free') {
      // 固定聊天没有目标/节点/子代理：这里只给出会话 id（agentTabProps 的 free 分支自己解析）
      return {
        tab: activeAgentTab,
        goalId: null as string | null,
        nodeId: null as string | null,
        conversationId: activeAgentTab.conversationId,
        sessionId: null as string | null,
      }
    }
    if (activeAgentTab.kind === 'sub') {
      const conv = conversationById(store, activeAgentTab.conversationId)
      return {
        tab: activeAgentTab,
        goalId: conv?.goalId ?? null,
        nodeId: conv ? (goalFocusByGoal.get(conv.goalId) ?? null) : null,
        conversationId: activeAgentTab.conversationId,
        sessionId: activeAgentTab.sessionId as string | null,
      }
    }
    const goal = store.goals.find((g) => g.id === activeAgentTab.goalId) ?? null
    // 页签里记的会话丢了（被删过会话）就回落到该目标当前显示或最近的一段
    const convId =
      activeAgentTab.conversationId &&
      conversationById(store, activeAgentTab.conversationId)?.goalId === activeAgentTab.goalId
        ? activeAgentTab.conversationId
        : (resolveDisplayedConversation(store, activeAgentTab.goalId) ?? null)
    const fallbackFocusId =
      goal?.rootNodeId ||
      store.nodes.find((n) => n.goalId === activeAgentTab.goalId)?.id ||
      null
    const focusId = goalFocusByGoal.get(activeAgentTab.goalId) ?? fallbackFocusId
    return {
      tab: activeAgentTab,
      goalId: activeAgentTab.goalId,
      nodeId: focusId || null,
      conversationId: convId,
      sessionId: null as string | null,
    }
    // goalFocusByGoal 是模块级槽：读它不参与依赖（它的更新总伴随 store 变化，渲染会跟上）
  }, [activeAgentTab, store])

  /** 激活的目标级页签的目标 id（子代理页签不参与） */
  const activeGoalTabId = activeAgentTab?.kind === 'goal' ? activeAgentTab.goalId : null
  /**
   * 目标级页签必须有会话可看：激活页签解析不出会话（目标还没开过讲、或旧备份里
   * 目标没有会话）就现场建一段。会话是「每目标至少一段」的（deleteConversation 的兜底），
   * 这里是唯一可能真空的地方。
   */
  useEffect(() => {
    if (!activeGoalTabId) return
    const s = getLatest()
    if (latestConversation(s, activeGoalTabId)) return
    const ensured = ensureConversation(s, activeGoalTabId)
    set(ensured.store)
  }, [activeGoalTabId, getLatest, set])

  /**
   * 侧栏里该高亮哪一个节点。**它跟着页签走**，不是「上次点过的节点」——
   * 关掉某个节点的教学文档页签，那个节点就不再是选中样式（这正是需求要的行为）。
   */
  const selectedNodeId = activeTab ? tabNodeId(activeTab.ref) : null
  /** 有未保存改动的页签 id（页签栏据此把关闭键画成一颗圆点） */
  const unsavedIds = useMemo(() => new Set(Object.keys(store.drafts)), [store.drafts])

  /**
   * 试卷副本页签的标题：「《卷名》 9/20 · 8/12」。
   * 一份卷子可以考很多次，标题里必须带上那一次是哪一次，否则一排副本页签长得一模一样。
   */
  const examTabTitle = useCallback(
    (examId: string, attemptId: string): string | undefined => {
      const exam = store.exams.find((e) => e.id === examId)
      const attempt = exam?.attempts.find((a) => a.id === attemptId)
      if (!exam || !attempt) return undefined
      const when = new Date(attempt.startedAt)
      const brief = attemptBrief(exam, attempt)
      const score = brief.score === null ? '' : ' · ' + brief.score + '/' + examTotalPoints(exam)
      return exam.title + ' ' + (when.getMonth() + 1) + '/' + when.getDate() + score
    },
    [store.exams],
  )

  /**
   * 网页页签活信息的镜像。tabDocPayload 声明在 webMeta（下面 web 块）之前，
   * hook 闭包引用后声明的 const 会犯 react-compiler 的前向引用——经 ref 晚绑定，
   * 每次渲染由 web 块的回填 effect 刷新（与 openTabRef 同一套做法）。
   */
  const webMetaRef = useRef<Record<string, WebTabMeta>>({})

  /**
   * 页签拖进对话输入框时交给它的那份引用（见 lib/chipSyntax 的 ChipPayload）：
   * 带上宿主知道的全部字段——nodeId 让打开时免于反查，path 给导师的 doc.* 接口与
   * #[{…}] 文本形态用，title 是显示名。网页页签也拖得出引用：一枚 web chip。
   */
  const tabDocPayload = useCallback((ref: TabRef): ChipPayload | null => {
    const s = getLatest()
    const title = tabTitle(ref, (id) => nodeById(s, id)?.title, examTabTitle, (vid) => s.videos?.find((v) => v.id === vid)?.title)
    if (ref.kind === 'local') return { type: 'local', path: ref.path, title }
    // 工作区内部文件：ws 型引用带磁盘路径（chipRef 的两种写法都认）与 nodeId，
    // 点击免于按路径反查——「不能当外部文件看」在引用这一层就是**不是 local 型**
    if (ref.kind === 'ws') {
      return { type: 'ws', path: wsRelOfTab(s, ref) ?? undefined, nodeId: ref.nodeId, title }
    }
    if (ref.kind === 'web') {
      // 起始页没有可引用的东西；网页引用带网址与活标题（没拿到标题时 chipLabel 显示域名兜底）
      if (!ref.url) return null
      const m = webMetaRef.current[tabKey(ref)]
      return { type: 'web', url: ref.url, ...(m?.title ? { title: m.title } : {}) }
    }
    if (ref.kind === 'exam') {
      return { type: 'attempt', nodeId: ref.nodeId, examId: ref.examId, attemptId: ref.attemptId, title }
    }
    // 系统页（设置/用量/记忆/导师设置/新建目标）没有可引用的 chip 形态：从文档区拖不出引用；
    // 新建文件页签同样没有——它还没有落点，引用一个「还不存在的文件」没有意义
    if (
      ref.kind === 'video' ||
      ref.kind === 'pluginDoc' ||
      ref.kind === 'settings' ||
      ref.kind === 'usage' ||
      ref.kind === 'schedule' ||
      ref.kind === 'mind' ||
      ref.kind === 'agentSettings' ||
      ref.kind === 'blank' ||
      ref.kind === 'draft'
    )
      return null
    const docPath = (kind: 'teaching' | 'note' | 'outline', note?: string): string | undefined =>
      nodeDocPath(s, ref.nodeId, { kind, ...(note ? { note } : {}) }) ?? undefined
    if (ref.kind === 'teach') return { type: 'doc', nodeId: ref.nodeId, path: docPath('teaching'), title }
    if (ref.kind === 'note') {
      return { type: 'note', nodeId: ref.nodeId, note: ref.note, path: docPath('note', ref.note), title: ref.note }
    }
    if (ref.kind === 'outline') return { type: 'outline', nodeId: ref.nodeId, path: docPath('outline'), title }
    return { type: 'super', nodeId: ref.nodeId, name: ref.name, path: docPath('teaching'), title: ref.name }
  }, [getLatest, examTabTitle])

  /**
   * 同名页签的**路径后缀**（键 = 页签 id）。
   *
   * 两份文档可以叫同一个名字：两个节点各有一份「错题本」，两个目录各有一个 notes.md。
   * 页签上只看名字就分不清点哪个，而名字恰恰是页签唯一说得清的事。
   *
   * **只在真有重名时给**：平时每一条都拖着一串路径，等于把一种少见情况摊到每一次阅读上。
   * 后缀是「它住在哪儿」——节点类取节点到目标的路径（「极限/夹逼定理」），本地文件取所在目录。
   */
  const tabTrails = useMemo(() => {
    const names = tabs.map((t) =>
      tabTitle(t.ref, (id) => nodeById(store, id)?.title, examTabTitle, (vid) => store.videos?.find((v) => v.id === vid)?.title),
    )
    const count = new Map<string, number>()
    for (const n of names) count.set(n, (count.get(n) ?? 0) + 1)
    const out: Record<string, string> = {}
    tabs.forEach((t, i) => {
      if ((count.get(names[i]) ?? 0) < 2) return
      out[t.id] = tabTrail(
        t.ref,
        (id) => {
          const node = nodeById(store, id)
          return node ? nodePathOf(store, node.goalId, id) : ''
        },
        // 记忆页签的后缀是目标本身（多个目标各开一枚「记忆管理」时靠它区分）
        (gid) => store.goals.find((g) => g.id === gid)?.question ?? '',
      )
    })
    return out
  }, [tabs, store.nodes, store.goals, examTabTitle])

  /**
   * 焦点格那一份文档的全部派生值（节点、正文、视图、标题、暂存…）。
   *
   * 抽成 paneInfo 是因为**每一格都要算一遍**（见下面的 renderGroup）：从前只有一格，
   * 顺手写在组件里就够了；能分割之后，同一时刻有好几份文档各自需要这些值，
   * 写两遍必然有一处忘了改（「左边那格切了源码、右边那格没变」这种错最难看出来）。
   */
  const pane = useMemo(
    () => paneInfo(store, docs, docs.focus, examTabTitle),
    [store, docs, examTabTitle],
  )
  const docNode = pane.node
  const docSource = pane.source
  const docTitle = pane.title
  const docView: DocView = pane.view
  /**
   * 超级文档页签指向的那一份（含还没保存的暂存改动）。
   * 那份超级文档已经被删除时为 null——页签由下面的剪枝 effect 关掉，这里只管不渲染空壳。
   */
  const superDoc = pane.superDoc

  // 只读取最近页签快照，不订阅它的通知：touchRecent 不再让整个工作区追加一轮渲染。
  // 下一次工作区本来就会发生的 store/layout 渲染会自然读到最新快照。
  const recentTabs = readRecentTabs()

  const openTabIds = useMemo(() => tabs.map((t) => t.id), [tabs])
  /** 每一格当前显示的那一片：分割之后同时有好几片正文在眼前，它们都得常驻 */
  const shownIds = useMemo(() => activeIdsOf(docs), [docs])

  /**
   * 这一轮常驻哪几片正文（含每一格当前显示的那几片，顺序照布局）。
   *
   * 只常驻 markdown 正文（教学文档与笔记）：源码视图、本地文件、超级文档、试卷副本各有各的
   * 重活与正确性讲究（文件在外部被改过要重挂、iframe 里的脚本状态、一次考试的作答），
   * 这一版不碰它们——切页签时最贵、也最容易来回切的就是教学文档。
   *
   * group 一并算出来：常驻片要渲染在**它所属的那一格**里（见下面 renderGroup），
   * 否则另一格切文档时会画到别人家的框里。
   */
  const residentPanes = useMemo(() => {
    const out: Array<{ group: string; tab: LearnTab; node: KnowledgeNode; source: DocSource }> = []
    for (const id of residentIds(openTabIds, shownIds, recentTabs)) {
      const tab = findTab(docs, id)
      if (!tab) continue
      const pane = paneOf(store, tab)
      const group = groupIdOfTab(docs, id)
      if (pane && group) out.push({ group, tab, node: pane.node, source: pane.source })
    }
    return out
  }, [openTabIds, shownIds, docs, store, recentTabs])

  /** 正文字号系数：预览与源码共用同一个（Ctrl + 滚轮在预览里改，见 NodeNote） */
  const { docScale } = useAppearance()

  // settingsEpoch：模型选择器改了全局提供商/模型后自增，把这次渲染重新跑一遍。
  // loadAiSettings 带模块级缓存，直接调用几乎零成本；之所以要这个 epoch，
  // 是因为它读的不是 React state，改了不会自动触发重渲染。
  const [settingsEpoch, setSettingsEpoch] = useState(0)
  void settingsEpoch

  /*
   * 两列的机制（拖宽、收起、对调）整体在 useSideColumns（workspace/）：
   * 这里解构出编排层用得到的几样；骨架 JSX 从 SplitRow 拿同一份对象。
   */
  const side = useSideColumns()
  /*
   * pureMoving 是「纯净阅读的补间正在走」（进出都算，见 useSideColumns）。页签栏与顶栏
   * 那两条收起动画都要看它——它们的时长与两列是同一档，只有把这 300ms 算进来，
   * 几条边才是**一起**收好、一起放开的，而不是各收各的。
   */
  const { agentLeft, sideCollapsed, toggleSide, expandSide, pure, pureMoving, setPure } = side

  /**
   * 切换纯净阅读：**F11、Esc、文档区悬浮组那颗按钮**走的是同一个动作。
   *
   * 「有没有打开的页签」是进入的门槛（需求里那句「如果当前有打开的 tab」）：
   * 一页都没有时收掉全部外壳，屏幕上只剩一句「没有打开的文档」——那不是阅读模式，是空房间，
   * 所以那一刻只给一句提示，什么也不收。退出不看这个条件：已经在里面了，随时都得能出来。
   *
   * 退出还有一个入口是 Esc（见下面那个 effect）；进的时候顺带把窄屏抽屉合上，
   * 并把「怎么退出去」当场说一遍——收到只剩正文之后，屏幕上唯一说得清这件事的就是那颗按钮。
   */
  const toggleZen = () => {
    if (pure) {
      setPure(false)
      return
    }
    if (!tabs.length) {
      onToast(t('纯净阅读要先打开一份文档'))
      return
    }
    setSidebarOpen(false)
    setPure(true)
    onToast(t('纯净阅读：F11 或 Esc 退出'))
  }

  /**
   * Esc 退出纯净阅读。
   *
   * 只在这一模式里挂监听，而且**让给别人先走**：
   * - 弹窗开着（.modal-scrim）或右键菜单开着（role=menu）时，Esc 是它们的关闭键，别抢；
   * - 已经被别处处理过（defaultPrevented，例如查找条的 Esc）的那一下，也不算「要退出」。
   * 回调走 ref：宿主每次渲染都换一个新闭包，直接写进依赖会每次重挂监听，
   * 而摘挂之间落下的那一次按键就丢了（同 lib/useEscape 的说明）。
   */
  const exitZen = useRef<() => void>(() => {})
  useEffect(() => {
    exitZen.current = () => setPure(false)
  })
  useEffect(() => {
    if (!pure) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.modal-scrim, [role="menu"]')) return
      exitZen.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pure])

  /**
   * 页签全关掉之后自动退出纯净阅读。
   *
   * Ctrl+W 在纯净阅读里照样能用（那颗 × 是看不见了，快捷键还在），关掉最后一页之后
   * 屏幕上就只剩一片空白了——那时候还留在纯净阅读里，用户连「怎么回去」都找不到线索。
   */
  useEffect(() => {
    if (pure && !tabs.length) setPure(false)
  }, [pure, tabs.length, setPure])

  /** 纯净阅读（Zen mode）：同步全局属性与宽度 CSS 变量 */
  useEffect(() => {
    setZenActive(pure)
    if (pure) {
      let initW = 860
      try {
        const saved = localStorage.getItem('moji:zen-width')
        if (saved) {
          const n = parseInt(saved, 10)
          if (Number.isFinite(n) && n >= 480 && n <= 2400) initW = n
        }
      } catch {}
      document.documentElement.style.setProperty('--zen-width', `${initW}px`)
    }
    return () => {
      setZenActive(false)
    }
  }, [pure])

  // 现取一次设置：判断能否用 AI，并把当前提供商名字带进提示文案
  const aiSettings = loadAiSettings()
  const hasKey = hasApiKey(aiSettings)
  const providerName = activeLabel(aiSettings)
  /**
   * 当前模型收不收图。图片输入的唯一开关：模型没声明 image 模态（或协议发不出去），
   * 输入框的附件按钮就是禁用的，拖进来也只会得到一句解释（见 AgentPanel）。
   */
  const vision = supportsImage(aiSettings)

  /**
   * 把目标级资源库的查询能力交给文档渲染层（见 lib/staticView）。
   *
   * 文档里的 `![图注](moji:static/<uuid>)` 与 `[文字](moji:static/<uuid>)` 在 DOM 提交后
   * 需要三件事：清单里这条资源是什么、图片字节、在文件管理器里定位它。这些都是 store 与磁盘的事，
   * 渲染层不认识它们，所以由这里注入。
   *
   * 依赖整个 store 快照（不只是 store.resources）：目标目录由根节点标题推出
   * （见 files.ts 的 nodeLayout），**改一次标题就会换掉资源的相对路径**，
   * 只盯清单会漏掉这一步。注册表一变，所有已渲染的文档都会重画一遍，
   * 代价只是一次签名比较（见 staticView 的 repaint）。
   */
  useEffect(() => {
    if (!activeGoalId) {
      setStaticView(null)
      return
    }
    const goalId = activeGoalId
    setStaticView({
      resource: (uuid) => findResource(getLatest(), goalId, uuid),
      // 同步那条路只走内存缓存：有图就直接贴上去，不让文档先闪一下占位
      cachedUrl: (uuid) => {
        const s = getLatest()
        const res = findResource(s, goalId, uuid)
        return res ? cachedResourceUrl(s, goalId, res) : null
      },
      loadUrl: async (uuid) => {
        const s = getLatest()
        const res = findResource(s, goalId, uuid)
        if (!res) return null
        const loaded = await loadResourceImage(s, goalId, res)
        return loaded?.url ?? null
      },
      reveal: (uuid) => {
        const s = getLatest()
        const res = findResource(s, goalId, uuid)
        if (!res) {
          onToast(t('这个资源已不在清单里，可能已被删除'))
          return
        }
        // revealResource 负责把「相对当前用户」的路径补成数据根下的完整路径
        // （漏了这一步会去 {root}/docs 下找，那里没有用户目录）。
        // 定位是异步的，但文件在登记之前就已经落盘了，不必等防抖保存。
        // 失败只提示、不抛出：磁盘上的事不该把界面打断（与节点文档的定位一致）
        void revealResource(s, goalId, res).then((ok) => {
          if (!ok) onToast(t('未能在资源管理器中定位该文件'))
        })
      },
      subscribe: subscribeResources,
    })
    return () => setStaticView(null)
  }, [activeGoalId, store, getLatest, onToast])

  /**
   * 节点文档的「就地图片」解析器工厂（见 lib/docImages）：文档里相对路径引用的图片
   * （图片就放在数据目录里文档旁边）按**那一份文档自己的目录**解析、读字节贴成 data URL。
   * 常驻的多片正文各是各的文档，所以这里只造「工厂」，每片正文带着自己的 node/kind/note
   * 现取目录（nodeDocPath 走 getLatest，永远是最新的存储树）。callback 身份稳定，
   * 各片的 resolver 只在页签文档变化时换新。
   */
  const nodeImageResolverCache = useRef(new Map<string, LocalImageResolver>())
  const nodeImageResolver = useCallback(
    (nodeId: string, kind: DocKind, note?: string) => {
      const key = `${nodeId}:${kind}:${note ?? ''}`
      let res = nodeImageResolverCache.current.get(key)
      if (!res) {
        res = createNodeDocImageResolver({
          dirRel: () => {
            const p = nodeDocPath(getLatest(), nodeId, { kind, note })
            // 教学文档是「目录/节点.md」、笔记是「目录/节点.notes/名字.md」——文档所在目录就是往前一级
            return p ? p.replace(/\/[^/]*$/, '') : null
          },
        })
        nodeImageResolverCache.current.set(key, res)
      }
      return res
    },
    [getLatest],
  )

  /** api.ui.screenshot：把文档区截成 PNG data URL（转存进资源库由 useAgent 统一做） */
  const captureDocForAgent = useCallback(
    async (): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> => {
      const el = docAreaElement()
      if (!el) return { ok: false, error: '文档区没有可截的内容（先打开一份文档）' }
      const r = el.getBoundingClientRect()
      const cap = await native().window.capture({
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      })
      if (!cap.ok || !cap.dataUrl) return { ok: false, error: cap.error ?? '截图失败' }
      return { ok: true, dataUrl: cap.dataUrl }
    },
    [],
  )

  /**
   * openTab 的晚绑定把手。useAgent 的 ui 参数里有需要调 openTab 的动作（ui.superdoc），
   * 而 openTab 的声明在这之后——React Compiler 对「声明前引用」一律按可变量处理，
   * 会把下游一串 useCallback 的记忆化全部判废（lint 的 preserve-manual-memoization 六连警告
   * 就是它）。所以这里放一个 ref：声明之后随时回填，调用时刻一定已经是最新的一份。
   */
  const openTabRef = useRef<(ref: TabRef) => void>(() => {})
  /**
   * 设置页签的晚绑定把手。设置现在是文档区的一枚页签（set:settings，见 learn/tabs），
   * 而 openTab 声明靠后——React Compiler 对「声明前引用」一律按可变量处理
   * （见 openTabRef 的说明）。这里先给一份稳定身份，下面的回填 effect 每次渲染换成最新的一份。
   */
  const openSettingsRef = useRef<() => void>(() => {})
  const onOpenSettings = useCallback(() => openSettingsRef.current(), [])
  /** 兼容外部调用（makeExamDeps / useConceptActions / useWorkflowStarters）：打开「新建目标」弹窗 */
  const setCreating = useCallback((v: boolean) => {
    setCreateGoalOpen(v)
  }, [])
  /** browser.* 的宿主依赖槽：真正的值在 web 块里（openWebTab / webMeta 声明靠后），effect 里回填 */
  const browserDepsRef = useRef<BrowserDeps | null>(null)

  const agent = useAgent({
    afterNodeEdit: (uuid, kind) => {
      // 出卷后的视觉自检：带图题渲染成位图交给模型看，坏图自动重画（见 examImageCheck）
      if (kind !== 'exam') return
      const s0 = getLatest()
      const exam = s0.exams.find((e) => e.id === uuid)
      if (exam && hasExamFigures(exam.questions)) {
        void selfCheckExamFigures({ getLatest, set, onToast }, exam.id, exam.questions)
      }
    },
    store,
    set,
    getLatest,
    // 面板跟着 agent 栏的激活页签走（不再是文档区的落点）：页签解析出的目标 / 落点节点 / 会话
    goalId: agentView?.goalId ?? null,
    nodeId: agentView?.nodeId ?? null,
    conversationId: agentView?.conversationId ?? null,
    onNeedKey: () => {
      onToast(t('请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
    },
    onNotice: onToast,
    examDeps: (nodeId) =>
      makeExamDeps({ getLatest, set, onToast, openTabRef, setCreating }, nodeId),
    // ui.* 的宿主能力：都是「界面在场才有的动作」，见 AgentUiDeps
    ui: {
      point: (req) => pointToDoc(req),
      scroll: (req) => {
        scrollToDoc(req)
      },
      captureDoc: captureDocForAgent,
      // 显示着的那一片正文：常驻之后文档区里躺着好几份，选择器不该落到别的文档上
      domRoot: () => visibleDocBody(),
      toast: onToast,
      // ui.superdoc：打开/切到某节点的超级文档页签；删掉的那份打不开（不静默开空页签）
      openSuper: ({ nodeId, name }) => {
        if (!readSuperDoc(getLatest(), nodeId, name)) return { opened: false }
        openTabRef.current({ kind: 'super', nodeId, name })
        return { opened: true }
      },
    },
    // browser.*：依赖在 web 块里（openWebTab / webMeta 声明在 useAgent 之后），WebUI 模式下不支持内置浏览器
    browserDeps: () => (isWeb() ? undefined : (browserDepsRef.current ?? undefined)),
  })

  /* ---------- agent 栏页签（见 learn/agentTabs 与 AgentTabStrip） ---------- */

  /** 开（或更新）一枚 agent 页签；子代理页签由用户从会话菜单点开（不自动开——页签多了拥挤） */
  const openAgentTab = useCallback(
    (ref: AgentTabRef, activate = true) => {
      const s = getLatest()
      const next = upsertAgentTab(s.agentTabs ?? [], s.agentActiveTab ?? null, ref, activate)
      set(withAgentTabs(s, next.tabs, next.active))
    },
    [getLatest, set],
  )

  /** 点一枚页签：置前（目标级页签展示哪段对话以页签里记的为准，见 agentView） */
  const activateAgentTab = useCallback(
    (key: string) => {
      const s = getLatest()
      if (s.agentActiveTab === key) return
      // 固定聊天页签不在 store 的页签列表里（界面合成置左），但它是合法的激活项
      if (key !== 'free' && !(s.agentTabs ?? []).some((t) => agentTabKey(t) === key)) return

      let next: LearnStore = s
      if (key !== 'free') {
        const targetTab = (s.agentTabs ?? []).find((t) => agentTabKey(t) === key)
        if (targetTab && targetTab.kind === 'goal') {
          const focusId =
            goalFocusByGoal.get(targetTab.goalId) ??
            s.goals.find((g) => g.id === targetTab.goalId)?.rootNodeId ??
            s.activeNodeId
          const convId =
            targetTab.conversationId ?? resolveDisplayedConversation(s, targetTab.goalId) ?? null
          next = {
            ...s,
            activeGoalId: targetTab.goalId,
            activeNodeId: focusId,
            activeConversationId: convId,
          }
        } else if (targetTab && targetTab.kind === 'sub') {
          const conv = conversationById(s, targetTab.conversationId)
          if (conv) {
            next = {
              ...s,
              activeGoalId: conv.goalId,
              activeConversationId: targetTab.conversationId,
            }
          }
        }
      }
      set(withAgentTabs(next, s.agentTabs ?? [], key))
    },
    [getLatest, set],
  )

  /**
   * 文档区里哪些目标还开着页签：目标级导师页签的关闭守卫读它——
   * 需求原文：「如果文档区还存在某个目标的页签，那么就无法关闭 agent 栏中其对应的 agent」。
   */
  const docGoalIds = useMemo(() => {
    const out = new Set<string>()
    for (const t of tabs) {
      const nid = tabNodeId(t.ref)
      const n = nid ? nodeById(store, nid) : null
      if (n) out.add(n.goalId)
    }
    return out
  }, [tabs, store])

  /** 一枚页签的关闭守卫数据（目标级：文档区还有它的页签 / 会话在跑；子代理不拦） */
  const closeBlockOf = useCallback(
    (s: LearnStore, ref: AgentTabRef): AgentTabCloseBlock => {
      const convId =
        ref.kind === 'goal'
          ? ref.conversationId && conversationById(s, ref.conversationId)?.goalId === ref.goalId
            ? ref.conversationId
            : (resolveDisplayedConversation(s, ref.goalId) ?? null)
          : null
      const hasDocTabs =
        ref.kind === 'goal'
          ? allTabs(s.docArea).some((t) => {
              if (t.ref.kind === 'mind') return t.ref.goalId === ref.goalId
              const nodeId = tabNodeId(t.ref)
              return !!nodeId && nodeById(s, nodeId)?.goalId === ref.goalId
            })
          : false
      return agentTabCloseBlock(ref, {
        // 关闭动作必须按 getLatest() 现算，不能读创建 callback 时的旧 docGoalIds；
        // 文档区刚关完一枚页签后，旧闭包否则会把导师继续错误地拦住。
        hasDocTabs,
        running: ref.kind === 'goal' ? !!(convId && agent.runningByConversation[convId]) : false,
      })
    },
    [agent.runningByConversation],
  )

  /**
   * 关一批页签（右键菜单的位置语义：self/left/right/others/all，与文档区同一套；
   * 单枚关闭 = mode 'self'）。名单里的每一枚都要过关闭守卫：拦下的跳过，
   * 一枚都没关成时把原因说清；关掉的全从 removeAgentTab 走——激活项逐次落到
   * 「被关那枚的邻居」。
   */
  const closeAgentTabMode = useCallback(
    (key: string, mode: TabCloseMode) => {
      const s = getLatest()
      const list = s.agentTabs ?? []
      const doomed = agentTabCloseSet(list, key, mode)
      if (!doomed.length) return
      let cur = s

      // 强制模式：连同文档区关联的tab一起关闭整个目标页签组
      const isForce = mode === 'force' || mode === 'forceOthers'
      if (isForce) {
        const doomedGoalIds = new Set<string>()
        for (const k of doomed) {
          const ref = (cur.agentTabs ?? []).find((t) => agentTabKey(t) === k)
          if (ref && ref.kind === 'goal') doomedGoalIds.add(ref.goalId)
        }
        for (const gid of doomedGoalIds) {
          cur = closeGoalTabGroupStore(cur, gid)
        }
      }

      let closed = 0
      let blocked = 0
      for (const k of doomed) {
        const ref = (cur.agentTabs ?? []).find((t) => agentTabKey(t) === k)
        if (!ref) continue
        const block = closeBlockOf(cur, ref)
        if (block !== 'none' && !isForce) {
          blocked++
          continue
        }
        if (ref.kind === 'goal') {
          // 检查该目标下是否还有未在 doomed 里的其他对话页签
          const remainingTabsOfGoal = (cur.agentTabs ?? []).filter(
            (t) => t.kind === 'goal' && t.goalId === ref.goalId && !doomed.includes(agentTabKey(t)),
          )
          if (remainingTabsOfGoal.length === 0) {
            // 最后一个对话页签关闭：视为关闭整个页签组！
            cur = closeGoalTabGroupStore(cur, ref.goalId)
            closed++
            continue
          }
        }
        const next = removeAgentTab(cur.agentTabs ?? [], cur.agentActiveTab ?? null, k)
        cur = withAgentTabs(cur, next.tabs, next.active)
        if (cur.agentActiveTab) {
          const activeRef = (cur.agentTabs ?? []).find((t) => agentTabKey(t) === cur.agentActiveTab)
          if (activeRef?.kind === 'goal') {
            cur = {
              ...cur,
              activeGoalId: activeRef.goalId,
              activeConversationId: activeRef.conversationId,
            }
          }
        }
        closed++
      }
      if (!closed) {
        onToast(t('导师正在运行，先停止这一轮再关闭'))
        return
      }
      // 全部关完时把激活权交给固定聊天页签——它是这一栏的底座，永远在
      if (!cur.agentActiveTab) cur = { ...cur, agentActiveTab: 'free' }
      set(cur)
      if (blocked) onToast(t('{0} 枚页签被拦下（导师正在跑）', blocked))
    },
    [getLatest, set, closeBlockOf, onToast],
  )

  /** 关一枚页签（单枚 = closeMode 的 self） */
  const closeAgentTab = useCallback(
    (key: string) => closeAgentTabMode(key, 'self'),
    [closeAgentTabMode],
  )

  /** 拖拽排序：只动顺序不动激活态（与文档区 reorderTabList 同一条规矩），顺序随 state.json 落盘。
      固定聊天页签不参与排序：它常驻最左，把它从钥匙串里滤掉（列表里本来也没有它） */
  const reorderAgentTabList = useCallback(
    (keys: string[]) => {
      const s = getLatest()
      const next = reorderAgentTabs(s.agentTabs ?? [], keys.filter((k) => k !== 'free'))
      if (next === (s.agentTabs ?? [])) return
      set(withAgentTabs(s, next, s.agentActiveTab ?? null))
    },
    [getLatest, set],
  )

  /** 页签标题：固定聊天 = 「聊天」；目标级 = 对话标题或目标标题；子代理 = 定义名（任务模式使用图标前置 task chip 标识） */
  const agentTabTitle = useCallback(
    (ref: AgentTabRef): string => {
      if (ref.kind === 'free') return t('聊天')
      if (ref.kind === 'goal') {
        const goal = store.goals.find((g) => g.id === ref.goalId)
        const goalTitle = goal ? (nodeById(store, goal.rootNodeId)?.title ?? goal.question) : ''
        const conv = ref.conversationId ? conversationById(store, ref.conversationId) : undefined
        const convTitle = conv?.title || (conv && conv.messages.length > 0 ? conversationTitle(conv) : '')
        return convTitle || goalTitle || t('新对话')
      }
      const conv = conversationById(store, ref.conversationId)
      const session = conv?.subagents?.sessions.find((x) => x.id === ref.sessionId)
      const def = session ? conv?.subagents?.defs.find((d) => d.key === session.defKey) : undefined
      return def?.name ?? session?.defKey ?? t('子代理')
    },
    [store],
  )

  /** 页签的运行态：固定聊天看那张「谁在跑」的表；目标级看同一张表；子代理看会话状态（后台跑的也算跑着） */
  const agentTabRunning = useCallback(
    (ref: AgentTabRef): boolean => {
      if (ref.kind === 'free') return !!(ref.conversationId && agent.runningByConversation[ref.conversationId])
      if (ref.kind === 'goal') {
        const convId =
          ref.conversationId && conversationById(store, ref.conversationId)?.goalId === ref.goalId
            ? ref.conversationId
            : (resolveDisplayedConversation(store, ref.goalId) ?? null)
        return !!(convId && agent.runningByConversation[convId])
      }
      const conv = conversationById(store, ref.conversationId)
      return conv?.subagents?.sessions.find((x) => x.id === ref.sessionId)?.status === 'running'
    },
    [store, agent.runningByConversation],
  )

  /**
   * 删会话 / 删目标之后收拾 agent 页签：指向被删会话的目标级页签改指该目标最近的一段，
   * 已死会话的子代理页签与已死目标的目标级页签整枚丢掉。读盘归一有同一条规矩
   * （normalizeAgentTabs），这里是活删的即时版。
   */
  const fixAgentTabsAfter = (s: LearnStore): LearnStore => {
    const tabs0 = s.agentTabs ?? []
    if (!tabs0.length) return s
    const mapped = tabs0
      .filter((t) => {
        if (t.kind === 'goal') return s.goals.some((g) => g.id === t.goalId)
        if (t.kind !== 'sub') return true
        const conv = conversationById(s, t.conversationId)
        return !!conv?.subagents?.sessions.some((x) => x.id === t.sessionId)
      })
      .map((t) =>
        t.kind === 'goal' &&
        t.conversationId &&
        conversationById(s, t.conversationId)?.goalId !== t.goalId
          ? { ...t, conversationId: resolveDisplayedConversation(s, t.goalId) ?? null }
          : t,
      )
    const seen = new Set<string>()
    const fixed: AgentTabRef[] = []
    for (const t of mapped) {
      const key = agentTabKey(t)
      if (seen.has(key)) continue
      seen.add(key)
      fixed.push(t)
    }
    const active =
      s.agentActiveTab && fixed.some((t) => agentTabKey(t) === s.agentActiveTab)
        ? s.agentActiveTab
        : (fixed[0] ? agentTabKey(fixed[0]) : null)
    return withAgentTabs(s, fixed, active)
  }

  /**
   * 超级文档的 method 桥：一份**常驻**的沙箱 api + 执行持久化函数的回调。
   *
   * SuperDocView 里的脚本调 api.method.call(...) 时走的就是这里。常驻 api 不持有
   * store 快照（每个闭包都现取 getLatest，见 learnSandboxOps 的说明），换节点、
   * 改文档都不用重建；goalId 变了才重建一次（它是 path 解析与函数库的基准）。
   */
  const bridgeApi = useMemo(
    () =>
      buildStandaloneApi(
        learnSandboxOps({
          getLatest,
          set,
          nodeId: () => store.activeNodeId,
          goalId: () => store.activeGoalId ?? '',
        }),
      ),
    [getLatest, set, store.activeNodeId, store.activeGoalId],
  )
  const runSuperMethod = useCallback(
    async (name: string, args: unknown[]) => {
      // 目标按「超级文档挂的那个节点」取：桥的调用者永远是眼前这份文档
      const goalId = docNode?.goalId ?? store.activeGoalId ?? ''
      const entry = findMethod(getLatest(), goalId, name)
      if (!entry) {
        throw new Error(t('没有叫「{0}」的函数。它由超级导师用 api.method.create 创建；可以先回对话里让它写一个。', name))
      }
      return await runMethodEntry(entry, bridgeApi, args)
    },
    [bridgeApi, docNode, getLatest, store.activeGoalId],
  )

  /**
   * 给「还没选过视图的空笔记」记下源码视图。
   *
   * 空笔记的默认视图是按正文**现算**的（见 emptyNote）：用户敲下第一个字，正文就不再是空的，
   * 那一瞬间默认值会翻回「预览」——人还在打字，编辑器却被换成了预览页。
   * 所以这里替它把选择真的写进页签（与用户自己点过源码是一回事），此后正文怎么变都不再影响视图。
   *
   * 兜的还有两条路：重启后读回来的老页签、以及导师刚把一份笔记清空的时候。
   */
  useEffect(() => {
    const s = getLatest()
    const idle = allTabs(s.docArea).filter((t) => !t.view && emptyNote(s, t))
    if (!idle.length) return
    set({ ...s, docArea: idle.reduce((d, t) => patchTab(d, t.id, { view: 'source' }), s.docArea) })
  }, [store, getLatest, set])

  /**
   * 超级文档被删（多半是 Agent 干的）之后，指向它的页签一并关掉。
   * 留着一个指向空处的页签，点开是一片空白，没人能想到是「文档刚被删了」；
   * 笔记走的也是同一条路（store 归一化与删除入口各自剪），这里补上 Agent 那条路。
   */
  useEffect(() => {
    const doomed = allTabs(store.docArea)
      .filter((t) => {
        // 先提一笔再判：属性收窄穿不进内层回调，直接用 t.ref.name 会丢掉 super 这一支
        const ref = t.ref
        if (ref.kind !== 'super') return false
        const node = nodeById(store, ref.nodeId)
        return !node || !superDocsOf(node).some((d) => d.name.toLowerCase() === ref.name.toLowerCase())
      })
      .map((t) => t.id)
    if (!doomed.length) return
    const s = getLatest()
    set({ ...s, docArea: closeIds(s.docArea, doomed) })
  }, [store, getLatest, set])

  /**
   * 把「当前节点」挪到某个节点上，会话跟着**目标**走。
   *
   * 会话是按目标归属的（见 graph 的 ensureConversation），所以只改 activeNodeId 是不够的：
   * 对话栏读的是 activeConversationId，跨目标换节点时不一起挪，页签与眼前的文档都换了，
   * Agent 说的却还是上一个目标的事——而且那段会话根本不属于当前目标。
   * 目标没变就不动会话：同一个目标里可以并行几段对话，用户挑好了哪一段，
   * 换个节点不该替他换掉。
   *
   * 页签栏点一下（activateTab）、关页签的落点（closeTab）、从侧栏/大纲跳节点（openTab）
   * 三条路都走这里，别再各写一份——这份判断漏一处，用户看到的就是「界面换了、对话没换」。
   *
   * agent 栏的页签也在这里汇合：看向某个目标下的文档，它的导师页签就自动开好并置前
   * （需求原文：「只要打开了某个目标下的文件，那么就自动打开其对应的 agent」）。
   * 页签里展示的会话跟着文档区走——在哪个会话的上下文里读，回来就还在哪个会话说。
   */
  /**
   * 目标页签组：**切到某个目标**时把文档区挪到那个目标的那一套页签上。
   *
   * 需求原文：「资源管理器的目标节点的文字原本是点击打开教学文档，重构为点击创建一个 tab 组，
   * 所有当前目标下的任何层级的文档文件打开都会被 tab 组记录」——落地成这条规则：
   *
   * - 目标自己的页签**一直在文档区里开着**（不是切走就关掉），切目标只是换一套**看得到的**；
   * - 因此切回来时「前一回在这个目标里看的那些文档」原样还在；
   * - 首次切到某个目标时，把它的**大纲页**开成页签并置前：那是一个目标的入口，
   *   教学文档一律从大纲里点进去（需求原文：「以后教学文档打开统一经过大纲 tab 去打开」）。
   *
   * 落点是**焦点格**（与 openTab 同一条口径）：切目标不动分屏布局，
   * 只在当前那一格里换文档——用户分好的左右两半不该被一次切目标打散。
   *
   * `toOutline`（点侧栏里那个目标的标题）时**焦点一定落在大纲上**：此刻看着的即使是
   * 同一个目标的教学文档，点目标名要的也是「回到这一层的入口」，停在原处等于点了没反应。
   * 大纲页开在另一格里时就切到那一格（不重开第二枚，与 openTab 同一条规矩）。
   */
  const goalTabGroup = useCallback(
    (s: LearnStore, goalId: string, toOutline = false): LearnStore => {
      const goal = s.goals.find((x) => x.id === goalId)
      if (!goal) return s
      const anchorNodeId = goal.rootNodeId || goal.id
      const rootRef: TabRef & { kind: 'outline' } = { kind: 'outline', nodeId: anchorNodeId, goalId: goal.id }
      const rootId = tabKey(rootRef)
      const owners = s.docArea.tabOwners ?? {}
      const home = groupIdOfTab(s.docArea, rootId)
      const goalOf = (id: string) => nodeById(s, id)?.goalId ?? (s.goals.some((g) => g.id === id) ? id : null)
      let docArea = home
        ? s.docArea
        : openAnchorOutline(s.docArea, s.docArea.focus, rootRef, goalOf, Date.now())
      if (toOutline) {
        const at = groupIdOfTab(docArea, rootId)
        if (at) docArea = activateIn(docArea, at, rootId)
      } else {
        const focusGroup = focusedGroup(docArea)
        const activeOwner = focusGroup?.active ? ownerOfTabId(s, focusGroup.active, owners) : goalId
        if (focusGroup && focusGroup.active !== rootId && activeOwner !== goalId) {
          docArea = activateIn(docArea, focusGroup.id, rootId)
        }
      }
      return { ...s, docArea: withOwners(docArea, claimTab(docArea.tabOwners, goalId, rootId)) }
    },
    [],
  )

  const retargetGoal = useCallback(
    (s: LearnStore, goalId: string): LearnStore => {
      const goal = s.goals.find((g) => g.id === goalId)
      if (!goal) return s
      const convId =
        s.activeConversationId &&
        s.conversations.some((c) => c.id === s.activeConversationId && c.goalId === goalId)
          ? s.activeConversationId
          : (resolveDisplayedConversation(s, goalId) ?? null)
      const tabbed0 = upsertAgentTab(
        s.agentTabs ?? [],
        s.agentActiveTab ?? null,
        { kind: 'goal', goalId, conversationId: convId },
        true,
      )
      const tabbed = withAgentTabs(s, tabbed0.tabs, tabbed0.active)
      const conv = tabbed.activeConversationId
        ? tabbed.conversations.find((c) => c.id === tabbed.activeConversationId)
        : undefined
      const goalChanged = s.activeGoalId !== goalId
      const withGoalTabs = (next: LearnStore): LearnStore =>
        goalChanged ? goalTabGroup(next, goalId) : next
      if (conv && conv.goalId === goalId) {
        if (tabbed.activeGoalId === goalId && tabbed.activeNodeId === null) return withGoalTabs(tabbed)
        return withGoalTabs({ ...tabbed, activeGoalId: goalId, activeNodeId: null })
      }
      const ensured = ensureConversation(tabbed, goalId)
      const retabbed0 = upsertAgentTab(
        ensured.store.agentTabs ?? [],
        ensured.store.agentActiveTab ?? null,
        { kind: 'goal', goalId, conversationId: ensured.conversationId },
        true,
      )
      const retabbed = withAgentTabs(ensured.store, retabbed0.tabs, retabbed0.active)
      return withGoalTabs({
        ...retabbed,
        activeGoalId: goalId,
        activeNodeId: null,
        activeConversationId: ensured.conversationId,
      })
    },
    [goalTabGroup],
  )

  const retargetNode = useCallback(
    (s: LearnStore, nodeId: string): LearnStore => {
      const node = nodeById(s, nodeId)
      if (!node) return s
      // 「这个目标最近被看到的是哪个节点」：发送目标（agentView.nodeId）与忙态标记都读它。
      // 写在 retargetNode 里而不是每个调用方——closeTab 的落点也走这里，漏了它就会偏一格。
      goalFocusByGoal.set(node.goalId, node.id)
      // 目标级导师页签：开好、置前，并把页签的会话对齐到这一刻的落点
      const convId = s.activeConversationId &&
        s.conversations.some((c) => c.id === s.activeConversationId && c.goalId === node.goalId)
        ? s.activeConversationId
        : (resolveDisplayedConversation(s, node.goalId) ?? null)
      const tabbed0 = upsertAgentTab(s.agentTabs ?? [], s.agentActiveTab ?? null, { kind: 'goal', goalId: node.goalId, conversationId: convId }, true)
      const tabbed = withAgentTabs(s, tabbed0.tabs, tabbed0.active)
      const conv = tabbed.activeConversationId
        ? tabbed.conversations.find((c) => c.id === tabbed.activeConversationId)
        : undefined
      /*
       * 目标页签组：**只有目标真的换了**才动文档区。
       *
       * 同一个目标里换节点（点教学文档、点笔记、点大纲里的另一个节点）时页签栏本来就
       * 停在那一套上，再切一次会把用户刚点开的那份文档顶掉——所以判据是与上一刻的
       * activeGoalId 比，而不是「这次落点在哪个目标」。
       */
      const goalChanged = s.activeGoalId !== node.goalId
      const withGoalTabs = (next: LearnStore): LearnStore =>
        goalChanged ? goalTabGroup(next, node.goalId) : next
      if (conv && conv.goalId === node.goalId) {
        if (node.id === tabbed.activeNodeId && tabbed.activeGoalId === node.goalId) return withGoalTabs(tabbed)
        return withGoalTabs({ ...tabbed, activeGoalId: node.goalId, activeNodeId: node.id })
      }
      /*
       * ensureConversation 只调一次：目标里一段对话都没有时它会**新建**一段，
       * 调两次就会建出两段不同的（各带一个 uuid），而 store 里只留了前一段、
       * activeConversationId 却是后一个——对话栏于是指向一段不存在的对话，一片空白。
       * 页签里记的会话也一并对齐到新建的这段（upsert 时它还没有会话）。
       */
      const ensured = ensureConversation(tabbed, node.goalId)
      const retabbed0 = upsertAgentTab(
        ensured.store.agentTabs ?? [],
        ensured.store.agentActiveTab ?? null,
        { kind: 'goal', goalId: node.goalId, conversationId: ensured.conversationId },
        true,
      )
      const retabbed = withAgentTabs(ensured.store, retabbed0.tabs, retabbed0.active)
      return withGoalTabs({
        ...retabbed,
        activeGoalId: node.goalId,
        activeNodeId: node.id,
        activeConversationId: ensured.conversationId,
      })
    },
    [goalTabGroup],
  )

  /**
   * 打开（或激活）一个页签：文档区「现在看什么」的唯一入口。
   *
   * 三种页签走同一条路：节点的教学文档、节点的某一份笔记、磁盘上的本地文件。
   * 页签本身只记「指向什么」（见 learn/types 的 TabRef），要打开的东西是否还存在
   * 由这里判——指向一个已经删掉的节点时静默返回，而不是开出一个空白页签。
   *
   * 节点类页签顺着把「当前节点」也挪过去（见 retargetNode）；
   * touchNode 也在这里记「最近学习 / 学习次数」——打开一个知识点是这两件事的唯一入口。
   * 本地文件页签不碰节点：它不属于任何目标，对话栏继续说上一个节点的事。
   *
   * 落在**焦点格**里（见 groups 的 openInGroup）：那一格是用户最后点过的地方，
   * 「新开一份文档」理应开在他正在看的那一格；已经在别格开着的则切过去，不再开第二份。
   */
  const openTab = useCallback(
    (targetRef: TabRef) => {
      if (isWeb() && targetRef.kind === 'web') {
        if (targetRef.url) {
          void openExternalLink(targetRef.url)
        }
        return
      }
      const s = getLatest()
      let ref = targetRef
      // 游离笔记的页签：nodeId 放的是笔记自己的 id，对不上节点、却对得上游离池 = 合法页签
      //（与绑定笔记同一套用法，差别只是没有那条关系线——见 workspace/panes 的 noteEntityOf）
      const freeNote = ref.kind === 'note' ? noteEntityOf(s, ref) : null
      const initialNodeId = tabNodeId(ref)
      const initialNode = initialNodeId ? nodeById(s, initialNodeId) : undefined
      const isGoalOutline =
        ref.kind === 'outline' &&
        s.goals.some(
          (g) =>
            g.id === initialNodeId ||
            g.id === (ref as { goalId?: string }).goalId ||
            g.rootNodeId === initialNodeId,
        )
      if (initialNodeId && !initialNode && !freeNote && !isGoalOutline) return
      let targetGoalId: string | null = null
      if (ref.kind === 'outline') {
        const goal =
          (initialNode ? s.goals.find((g) => g.id === initialNode.goalId) : null) ??
          s.goals.find(
            (g) =>
              g.id === initialNodeId ||
              g.id === (ref as { goalId?: string }).goalId ||
              g.rootNodeId === initialNodeId,
          )
        if (goal) {
          targetGoalId = goal.id
          const anchorNodeId = goal.rootNodeId || goal.id
          if (initialNode && ref.nodeId !== anchorNodeId) {
            setOutlineFocus({ nodeId: ref.nodeId, nonce: Date.now() })
          }
          ref = { kind: 'outline', nodeId: anchorNodeId, goalId: goal.id }
        }
      }
      const nodeId = tabNodeId(ref)
      const node = nodeId ? nodeById(s, nodeId) : undefined
      if (nodeId && !node && !freeNote && !isGoalOutline) return
      const wasActive = focusedTab(s.docArea)?.id === tabKey(ref)
      const base = node
        ? touchNode(retargetNode(s, node.id), node.id)
        : isGoalOutline && targetGoalId
          ? retargetGoal(s, targetGoalId)
          : s
      /*
       * 绑定的视频页签：打开它 = 把它所属目标的页签组一并打开（goalTabGroup 会开组锚、
       * 让停靠的整组归队），视频页签落进焦点格并登记在该目标名下，目标随之切过去——
       * 「打开学习视频会一并打开学习目标对应的 tab 组」。组锚关闭（整组进停靠场）时
       * 它随组一起收起。没绑定的、或绑定目标已不在的，走下面的普通开法（公共页签）。
       */
      if (ref.kind === 'video' && ref.videoId) {
        const gid = (base.videoNodes ?? []).find((v) => v.videoId === ref.videoId)?.goalId ?? null
        const boundGoal = gid ? base.goals.find((g) => g.id === gid) : undefined
        if (boundGoal) {
          const vRef: TabRef = { kind: 'video', videoId: ref.videoId, goalId: boundGoal.id }
          /*
           * 「真正打开 tab 组」= 与打开这个目标的一份文档**同一套语义**（retargetNode）：
           * 当前节点/目标落到这个目标（顶栏的目标名读的是 activeNode 的目标——只写
           * activeGoalId 不写 activeNodeId，顶栏会一直停在「请选择页签组」）、目标级
           * 导师页签开好置前。落点节点用「这个目标最近被看到的节点」，没有才是根。
           * 之后再补一次组锚开关：目标本来就活动着时 retargetNode 不切组，
           * 锚关着（整组在停靠场）的话这里把整组拽回来。视频不是知识节点，不碰 touchNode。
           */
          const remembered = goalFocusByGoal.get(boundGoal.id)
          const focusId = remembered && nodeById(base, remembered) ? remembered : boundGoal.rootNodeId
          const retargeted = focusId ? retargetNode(base, focusId) : retargetGoal(base, boundGoal.id)
          const grouped = goalTabGroup(retargeted, boundGoal.id)
          const openedV = openInGroup(
            grouped.docArea,
            grouped.docArea.focus,
            vRef,
            Date.now(),
            undefined,
            (id) => nodeById(base, id)?.goalId ?? null,
          )
          set({
            ...grouped,
            docArea: withOwners(openedV, claimTab(openedV.tabOwners, boundGoal.id, tabKey(vRef))),
          })
          if (wasActive) requestReveal()
          setSidebarOpen(false)
          return
        }
      }
      /*
       * 空笔记当场定下「源码（编辑）视图」：这个默认值是按正文现算的，
       * 而用户敲下第一个字它就翻回预览了（见 emptyNote 与 learn/tabs 的 viewOf）。
       */
      const startView: DocView | undefined =
        ref.kind === 'note' && emptyNote(s, makeTab(ref, 0)) ? 'source' : undefined
      const goalOf = (id: string) => nodeById(base, id)?.goalId ?? (base.goals.some((g) => g.id === id) ? id : null)
      /** 「目标 → 根节点」：组锚判据的第二跳（见 groups/tabs 的 isAnchorOutline） */
      const rootOf = (goalId: string) => base.goals.find((g) => g.id === goalId)?.rootNodeId ?? null
      /*
       * 三种页签三条路（判据与规矩全在 groups/tabs，这里只做分派）：
       * - 组锚（目标根节点的大纲）：带着停靠的整组一起归队（openAnchorOutline）；
       * - 阶段大纲（某个子节点的大纲入口）：只是一枚普通页签，开关都不牵动任何一组；
       * - 组关联的文档（教学文档、工作区内部文件）：先过它的「组」再进门
       *   （openGroupedDoc，需求原文见那边的文档串）。从大纲里点进来的那条路
       *   （OutlineView 的 onOpenNode）是恒等的——大纲就在焦点格，落回原处。
       */
      const opened =
        ref.kind === 'outline'
          ? isAnchorOutline(ref, goalOf, rootOf)
            ? openAnchorOutline(base.docArea, base.docArea.focus, ref, goalOf, Date.now())
            : openOutlineTab(base.docArea, base.docArea.focus, ref, goalOf, Date.now())
          : nodeId && node
            ? openGroupedDoc(base.docArea, ref as TabRef & { nodeId: string }, rootOf(node.goalId), goalOf, Date.now(), startView)
            : openInGroup(base.docArea, base.docArea.focus, ref, Date.now(), startView, goalOf)
      /*
       * 登记归属（见 groups/goals）：这枚页签从此记在它所属的目标名下，
       * 于是切到那个目标时它就出现在栏上、切走时跟着收起来——「所有这个目标下任何层级
       * 的文档打开都会被 tab 组记录」正是这一行。
       */
      const owner = (ref as { goalId?: string }).goalId ?? refOwner(ref, goalOf) ?? freeNote?.goalId ?? null
      set({ ...base, docArea: withOwners(opened, claimTab(opened.tabOwners, owner, tabKey(ref))) })
      if (wasActive) requestReveal()
      setSidebarOpen(false)
    },
    [getLatest, retargetNode, retargetGoal, goalTabGroup, set],
  )
  // 回填放在 effect 里（渲染期不许写 ref）：openTab 的身份随依赖变，每次渲染后换成最新的一份
  useEffect(() => {
    openTabRef.current = openTab
    openSettingsRef.current = () => openTab({ kind: 'settings' })
  })

  /**
   * 目标库为空（初次使用或删光所有目标）且没有打开任何页签时，自动开启「新建目标」页签。
   */


  /**
   * 存活的 tab 组（顶栏目标名的下拉菜单，见 Topbar 的 tabGroups）：某个目标名下还有
   * 实体页签留在文档区里（看得见 + 切走收起来的都算），它就活着一行；空组不出现——
   * 那种目标从侧栏切就行。数字给那一组的页签数，当前组带勾。
   */
  const aliveGoalTabGroups = useMemo(() => {
    const owners = store.docArea.tabOwners
    const all = allStoredTabs(store.docArea)
    const goalOfNode = (nodeId: string) => nodeById(store, nodeId)?.goalId ?? (store.goals.some((g) => g.id === nodeId) ? nodeId : null)
    return store.goals
      .map((g) => ({
        goalId: g.id,
        title: g.title || g.question,
        count: goalTabsOf(owners, all, goalOfNode, g.id).length,
        current: g.id === store.activeGoalId,
      }))
      .filter((x) => x.count > 0)
  }, [store])

  /**
   * 顶栏目标名菜单：切到某个目标的页签组。
   *
   * 与 openGoalGroup（侧栏点目标名）的差别只有一个：**不强制落回大纲**——那个组正开着
   * 哪份文档，切回去就接着看哪份（「快速切换 tab 组」的本意）；组是空的兜底仍由
   * goalTabGroup 管（没开过就在焦点格里开大纲）。
   */
  const switchGoalGroup = useCallback(
    (goalId: string) => {
      const s = getLatest()
      const goal = s.goals.find((g) => g.id === goalId)
      if (!goal) return
      const node = goal.rootNodeId ? nodeById(s, goal.rootNodeId) : null
      const base = node ? touchNode(retargetNode(s, node.id), node.id) : retargetGoal(s, goalId)
      const next = goalTabGroup(base, goalId)
      set(next)
      if (focusedTab(s.docArea)?.id === focusedTab(next.docArea)?.id) requestReveal()
    },
    [getLatest, retargetNode, retargetGoal, goalTabGroup, set],
  )

  /**
   * 用量统计页签的入口（顶栏用户菜单）。只在 Topbar 一处用到（声明在 openTab 之后），
   * 不需要晚绑定把手——直接依赖 openTab 即可。
   */
  const onOpenUsage = useCallback(() => openTab({ kind: 'usage' }), [openTab])

  /** 日程安排页签的入口（顶栏日程 tip 的「手动安排日程」与提醒弹层）。与用量页同样全局一枚 */
  const onOpenSchedule = useCallback(() => openTab({ kind: 'schedule' }), [openTab])

  /**
   * api.ui.point：打开/切到某个节点的文档页签并定位。
   * path 已由工具层解析成节点 + 文档（还给了要在渲染结果里找的文字）；
   * 这一层只负责「开页签 + 找文字」——定位的滚动与选区在 lib/docDom。
   */
  const pointToDoc = useCallback(
    async (req: UiPointRequest): Promise<{ located: boolean }> => {
      const node = nodeById(getLatest(), req.nodeId)
      if (!node) return { located: false }
      let ref: TabRef
      if (req.kind === 'note') {
        // 一份笔记都没有时退回教学文档：point 是「给用户看」的动作，不该顺手建文件
        const name = req.note ?? notesOf(node)[0]?.name
        ref = name ? { kind: 'note', nodeId: node.id, note: name } : { kind: 'teach', nodeId: node.id }
      } else {
        ref = { kind: 'teach', nodeId: node.id }
      }
      openTab(ref)
      if (!req.needle) return { located: false }
      // locateNeedle 自带短暂重试：页签切换到渲染完成有一拍，追上再下结论
      return { located: await locateNeedle(req.needle, req.fallbackRatio) }
    },
    [getLatest, openTab],
  )

  /** 从侧栏 / 面包屑 / 节点链接跳到一个节点：一律落在它的教学文档上 */
  const switchNode = useCallback((nodeId: string) => openTab({ kind: 'teach', nodeId }), [openTab])

  /**
   * 点资源管理器里的**目标节点**：切到它的目标页签组，并把焦点落到它的大纲上。
   *
   * 需求原文：「资源管理器的目标节点的文字原本是点击打开教学文档，重构为点击创建一个 tab 组」；
   * 后来又补了一条：「如果当前显示的标签不是大纲就跳到大纲，即使当前打开的是教学文档也要跳到大纲」。
   * 于是这里的落点**一律是大纲页**——它是这一层的入口，教学文档从大纲里点进去。
   *
   * 具体做两件事：
   * 1. 把「当前目标」挪到它（retargetNode 一条路，对话栏/agent 页签都跟着对齐）；
   * 2. 把文档区切到它那一套页签上，并把该目标的大纲页置前（见 goalTabGroup 的 toOutline）——
   *    目标自己的页签在这个目标下都还在，切回来时原样可见。
   */
  const openGoalGroup = useCallback(
    (targetId: string) => {
      const s = getLatest()
      const goal =
        s.goals.find((g) => g.id === targetId) ??
        (nodeById(s, targetId)?.goalId ? s.goals.find((g) => g.id === nodeById(s, targetId)!.goalId) : null)
      if (!goal) return
      const goalId = goal.id
      const node = nodeById(s, targetId) ?? (goal.rootNodeId ? nodeById(s, goal.rootNodeId) : null)
      const base = node ? touchNode(retargetNode(s, node.id), node.id) : retargetGoal(s, goalId)
      const next = goalTabGroup(base, goalId, true)
      set(next)
      if (focusedTab(s.docArea)?.id === focusedTab(next.docArea)?.id) requestReveal()
      setSidebarOpen(false)
    },
    [getLatest, retargetNode, retargetGoal, goalTabGroup, set],
  )

  /**
   * 激活已经开着的一个页签（点页签栏）。
   *
   * 节点类页签顺着把「当前节点」也挪过去——点的是别个节点的标签页，看的、谈的都该是那个节点。
   * 以前这里只搬了 activeNodeId：跨目标切页签时对话栏还停在上一个目标的会话上，
   * 文档换了、Agent 说的还是别人家的事。
   */
  const activateTab = useCallback(
    (id: string) => {
      const s = getLatest()
      const tab = findTab(s.docArea, id)
      const group = groupIdOfTab(s.docArea, id)
      if (!tab || !group) return
      const fromTab = focusedTab(s.docArea)
      const nodeId = tabNodeId(tab.ref)
      const base = nodeId ? retargetNode(s, nodeId) : s
      const wasActive = fromTab?.id === id && s.docArea.focus === group
      // activateIn 顺手把焦点挪到那一格：点别处的页签，接下来的动作（开文档、Ctrl+W）都该落在那一格
      set({ ...base, docArea: activateIn(base.docArea, group, id) })
      // 同一枚页签没有 activeTab 变化，单独唤醒侧栏完成重复定位。
      if (wasActive) requestReveal()
    },
    [getLatest, retargetNode, set],
  )

  /* ---------- 内置浏览器（网页页签，见 components/learn/web） ---------- */

  /**
   * 网页页签的**活信息**（会话内、不落盘）：标题、图标、加载态。页面事件推着走，
   * 页签栏与地址栏工具条读它；重启后由页面事件现学，learn/state 不挑这个字段。
   */
  const [webMeta, setWebMeta] = useState<Record<string, WebTabMeta>>({})
  const patchWebMeta = useCallback((id: string, p: Partial<WebTabMeta>) => {
    setWebMeta((prev) => {
      const base: WebTabMeta = prev[id] ?? { url: '', loading: false, canBack: false, canFwd: false, error: null }
      return { ...prev, [id]: { ...base, ...p } }
    })
  }, [])

  /**
   * 开一个网页页签：url 归一（learn/webUrl），空串 = 起始页（只有地址栏）。
   * 网页的弹窗 / target=_blank（主进程拦下来推回来的，见 electron/app/webSession）也落到这里。
   */
  const openWebTab = useCallback(
    (url: string): string => {
      const targetUrl = normalizeWebInput(url)
      if (isWeb()) {
        if (targetUrl) {
          void openExternalLink(targetUrl)
        }
        return ''
      }
      const s = getLatest()
      // ref 当场算好（页签身份就是 tabKey），开完直接回页签 id——browser.open 靠它指名
      const ref: TabRef = { kind: 'web', url: targetUrl, key: newWebKey() }
      const opened = openInGroup(s.docArea, s.docArea.focus, ref, Date.now(), undefined, (id) => nodeById(s, id)?.goalId ?? null)
      // 网页页签不属于任何目标（公共）：登记成公共，切目标时它留栏上（见 groups/goals）
      set({ ...s, docArea: withOwners(opened, claimTab(opened.tabOwners, PUBLIC_OWNER, tabKey(ref))) })
      return tabKey(ref)
    },
    [getLatest, set],
  )

  /** 打开空白页签 */
  const openBlankTab = useCallback((): string => {
    const s = getLatest()
    const ref: TabRef = { kind: 'blank', key: newBlankKey() }
    const opened = openInGroup(s.docArea, s.docArea.focus, ref, Date.now())
    // 空白页签同样是公共的（它不属于任何目标）
    set({ ...s, docArea: withOwners(opened, claimTab(opened.tabOwners, PUBLIC_OWNER, tabKey(ref))) })
    return tabKey(ref)
  }, [getLatest, set])

  /** 把当前地址回写进页签（主框架导航时）：重启回到离开时的那一页 */
  const commitWebUrl = useCallback(
    (tabId: string, url: string) => {
      const s = getLatest()
      const tab = findTab(s.docArea, tabId)
      if (!tab || tab.ref.kind !== 'web' || tab.ref.url === url) return
      set({ ...s, docArea: patchTab(s.docArea, tabId, { ref: { ...tab.ref, url } }) })
    },
    [getLatest, set],
  )

  // 主进程推来的两条（见 electron/app/webSession）：要开的新网页页签，与从网页里
  // 转发回来的应用快捷键（焦点在网页里时 DOM 层收不到）。转发来的键当成一次普通
  // 按键交给快捷键注册表——那些键在那里都有注册，不用第二套分派。
  // 功能键（F11 一类）不带修饰键转发（主进程小写送来），其余是 Ctrl 组合。
  useEffect(() => {
    if (!isElectron()) return
    const browser = native().browser
    const offTab = browser.onOpenTab((url) => openWebTab(url))
    const offKey = browser.onShortcut((key) => {
      const fn = /^f(\d{1,2})$/.exec(key)
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: fn ? 'F' + fn[1] : key,
          ctrlKey: !fn,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    return () => {
      offTab()
      offKey()
    }
  }, [openWebTab])

  // 应用内超链接与网页 chip 打开统一走应用内浏览器页签（openWebTab）
  useEffect(() => {
    setWebLinkHandler(openWebTab)
    return () => setWebLinkHandler(null)
  }, [openWebTab])

  /* ---------- 收藏（页签右键菜单 / 地址栏星标 / 侧栏收藏区，见 learn/favorites） ---------- */

  /** 已收藏的身份集合：三个入口的「收藏了没有」都查它 */
  const favoriteKeys = useMemo(
    () => new Set((store.favorites ?? []).map((f) => favoriteKey(f))),
    [store.favorites],
  )

  const isTabFavorite = useCallback(
    (ref: TabRef) => {
      const key = favoriteKeyOfTab(ref)
      return !!key && favoriteKeys.has(key)
    },
    [favoriteKeys],
  )

  /** 地址栏星标的那一问：这一页（网址）收藏了没有 */
  const isUrlFavorite = useCallback(
    (url: string) => !!url && favoriteKeys.has(favoriteKey({ kind: 'web', url })),
    [favoriteKeys],
  )

  /** 收藏 / 取消收藏（页签右键菜单）：起始页没有网址，无从收藏，不动。
   *  网页要顺手把「这一页」的活标题与站点图标记进收藏——收藏夹里显示的是它们，
   *  不是裸网址（标题没有活数据源可查，只能收藏那一刻存下来，见 learn/favorites）；
   *  extra 由地址栏星标直接给，页签右键则从 webMeta 里现查。 */
  const toggleTabFavorite = useCallback(
    (tab: Pick<LearnTab, 'id' | 'ref'>, extra?: { title?: string; icon?: string }) => {
      const fav = favoriteRefOfTab(tab.ref)
      if (!fav) return
      const m = tab.ref.kind === 'web' ? webMeta[tab.id] : undefined
      const title = extra?.title ?? m?.title
      const icon = extra?.icon ?? m?.favicon
      const full: FavoriteRef =
        fav.kind === 'web'
          ? { ...fav, ...(title ? { title: title.slice(0, 200) } : {}), ...(icon ? { icon } : {}) }
          : fav
      const s = getLatest()
      set({ ...s, favorites: toggleInFavorites(s.favorites ?? [], full, Date.now()) })
    },
    [getLatest, set, webMeta],
  )

  /** 地址栏星标：收藏的是当前网址（与页签右键同一条路），这一页的标题与图标一并记下 */
  const toggleUrlFavorite = useCallback(
    (url: string, extra?: { title?: string; icon?: string }) =>
      toggleTabFavorite({ id: '', ref: { kind: 'web', url, key: '' } }, extra),
    [toggleTabFavorite],
  )

  /** 点收藏区的一行：现场换算成页签（网页开新签）走与别处**同一个** openTab */
  const openFavorite = useCallback((ref: FavoriteRef) => openTab(tabRefOfFavorite(ref)), [openTab])

  /** 把一行摘出收藏夹（侧栏收藏区的移除键；收藏的 × 不动文档本身） */
  const dropFavorite = useCallback(
    (ref: FavoriteRef) => {
      const s = getLatest()
      set({ ...s, favorites: removeFromFavorites(s.favorites ?? [], favoriteKey(ref)) })
    },
    [getLatest, set],
  )

  /*
   * 收藏的分组与改名（见 learn/favorites 的分组段）。组名登记在 favGroups、同时长在
   * 成员身上：移入一个没登记过的组名时顺手登记（拖进来的「新建分组」也走这条路），
   * 删组 = 登记表摘掉 + 成员的 group 摘掉（收藏一条不丢）。
   */
  const setFavGroup = useCallback(
    (ref: FavoriteRef, group: string | null) => {
      const s = getLatest()
      const next = setFavoriteGroup(s.favorites ?? [], favoriteKey(ref), group)
      const groups =
        group && !(s.favGroups ?? []).includes(group.trim())
          ? createFavoriteGroup(s.favGroups ?? [], group)
          : s.favGroups ?? []
      set({ ...s, favorites: next, favGroups: groups })
    },
    [getLatest, set],
  )
  const createFavGroup = useCallback(
    (name: string) => {
      const s = getLatest()
      set({ ...s, favGroups: createFavoriteGroup(s.favGroups ?? [], name) })
    },
    [getLatest, set],
  )
  const renameFavGroup = useCallback(
    (from: string, to: string) => {
      const next = to.trim().slice(0, 64)
      if (!next || next === from) return
      const s = getLatest()
      set({
        ...s,
        favGroups: (s.favGroups ?? []).map((g) => (g === from ? next : g)),
        // 组名同时也是成员身上的标记：成员一起换
        favorites: renameFavoriteGroup(s.favorites ?? [], from, next),
      })
    },
    [getLatest, set],
  )
  const removeFavGroup = useCallback(
    (group: string) => {
      const s = getLatest()
      set({
        ...s,
        favGroups: (s.favGroups ?? []).filter((g) => g !== group),
        favorites: removeFavoriteGroup(s.favorites ?? [], group),
      })
    },
    [getLatest, set],
  )
  const renameFavTitle = useCallback(
    (ref: FavoriteRef, title: string) => {
      const s = getLatest()
      set({ ...s, favorites: renameWebFavorite(s.favorites ?? [], favoriteKey(ref), title) })
    },
    [getLatest, set],
  )

  /** 收藏行的标题：节点名与考试名都是活查的（改名之后收藏跟着新名字走） */
  const favoriteTitleOf = useCallback(
    (ref: FavoriteRef) => favoriteTitle(ref, (id) => nodeById(store, id)?.title, examTabTitle),
    [store, examTabTitle],
  )

  /**
   * 文档区全部关闭时的反向联动：目标已经没有活动文档，就移除目标级导师页签。
   * 固定聊天页签不落在 agentTabs 里，子代理页签也保留，让后台任务不因文档区操作被中断。
   */
  const closeAgentTabsForGoals = useCallback((s: LearnStore, goalIds: readonly string[]): LearnStore => {
    const removed = removeAgentTabsOfGoals(s.agentTabs ?? [], s.agentActiveTab ?? null, new Set(goalIds))
    return withAgentTabs(
      s,
      removed.tabs,
      removed.active ?? 'free',
    )
  }, [])

  /**
   * 顶栏目标名菜单：清空某个目标的页签组缓存。
   */
  const dropGoalCache = useCallback(
    (goalId: string) => {
      const s = getLatest()
      const goalOfNode = (nodeId: string) => nodeById(s, nodeId)?.goalId ?? null
      // 1. 从停靠场里清理该目标缓存
      const nextParked = { ...(s.docArea.parkedTabs ?? {}) }
      delete nextParked[goalId]

      // 2. 找到当前活动页签中属于该目标的页签并关闭
      const all = allTabs(s.docArea)
      const victims = goalTabsOf(s.docArea.tabOwners, all, goalOfNode, goalId)
      let docArea = s.docArea
      if (victims.length > 0) {
        docArea = closeIds(docArea, victims.map((v) => v.id), { preserveActiveAsBlank: true })
      }

      // 3. 从归属表中移除该目标
      const nextOwners = { ...(docArea.tabOwners ?? {}) }
      delete nextOwners[goalId]
      docArea = withOwners(withParked(docArea, Object.keys(nextParked).length > 0 ? nextParked : undefined), nextOwners)

      // 4. 清理导师页签中属于该目标的页签
      let nextStore = closeAgentTabsForGoals({ ...s, docArea }, [goalId])

      // 5. 如果当前激活的目标就是它，清空激活目标与节点，文档区置空白
      if (nextStore.activeGoalId === goalId) {
        const fg = focusedGroup(docArea)
        if (fg) {
          const blank = makeBlankTab()
          docArea = withGroup(docArea, fg.id, (g) => ({
            ...g,
            tabs: [blank],
            active: blank.id,
          }))
        }
        nextStore = {
          ...nextStore,
          docArea,
          activeGoalId: null,
          activeNodeId: null,
        }
      }
      set(nextStore)
    },
    [getLatest, set, closeAgentTabsForGoals],
  )

  /*
   * 保存 / 关页签 / 冲突流整体在 useDocSaveFlow（workspace）：
   * 暂存入口、Ctrl+S、关页签、两个确认框、本地文件监听是同一条链上的环节，拆开反而难读。
   */
  const {
    editDocSource,
    stageLocalDraft,
    stageNewFileDraft,
    saveDocNow,
    closeTab,
    localTicks,
    pendingClose,
    setPendingClose,
    pendingConflict,
    setPendingConflict,
    commitCloseSave,
    commitCloseDiscard,
    commitConflictOverwrite,
    commitConflictSaveAs,
  } = useDocSaveFlow({
    getLatest,
    set,
    flush,
    retargetNode,
    examTabTitle,
    tabs,
    drafts: store.drafts,
    setDocSaving,
    setDocSaveError,
    setLocalSaved,
    docTitle,
    onGoalsClosed: closeAgentTabsForGoals,
    onToast,
  })

  // browser.* 的宿主依赖：closeTab（useDocSaveFlow）到这条线才就位，所以回填放在这里——
  // 每次渲染换成最新的一份（webMeta 活信息在里面）
  useEffect(() => {
    webMetaRef.current = webMeta
    browserDepsRef.current = {
      getLatest,
      set,
      openWebTab,
      activateTab,
      closeTab,
      webMeta,
      snapshot: (wcId) =>
        isElectron() ? native().browser.snapshot(wcId) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      point: (wcId, target) =>
        isElectron() ? native().browser.point(wcId, target) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      domOp: (wcId, ref, op, arg) =>
        isElectron() ? native().browser.domOp(wcId, ref, op, arg) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      readHtml: (wcId) =>
        isElectron() ? native().browser.readHtml(wcId) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      logs: (wcId, opts) =>
        isElectron() ? native().browser.logs(wcId, opts) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      logDetail: (wcId, seq, opts) =>
        isElectron() ? native().browser.logDetail(wcId, seq, opts) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      pageFetch: (wcId, req) =>
        isElectron() ? native().browser.pageFetch(wcId, req) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      record: (wcId, action, opts) =>
        isElectron() ? native().browser.record(wcId, action, opts) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      text: (wcId, target) =>
        isElectron() ? native().browser.text(wcId, target) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      scroll: (wcId, req) =>
        isElectron() ? native().browser.scroll(wcId, req) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
      waitFor: (wcId, req) =>
        isElectron() ? native().browser.waitFor(wcId, req) : Promise.resolve({ error: '未检测到 Electron 运行环境' }),
    }
  })

  /**
   * 页签被拖动之后的新顺序（见 TabBar 的拖动排序）——**只对这一格**。
   *
   * 只动顺序，不动激活态：拖动是「把这一项挪个位置」，不是「切到这一项」。
   * 顺序会跟着 state.json 一起落盘，下次打开应用还是这个排法。
   */
  const reorderTabList = useCallback(
    (group: string, ids: string[]) => {
      const s = getLatest()
      set({ ...s, docArea: reorderIn(s.docArea, group, ids) })
    },
    [getLatest, set],
  )

  /*
   * 导出流整体在 useExportFlow（workspace/）：弹窗开关、元信息、三个入口与三条格式路。
   */
  const {
    exportOpen,
    setExportOpen,
    exportPlots,
    exportMeta,
    openExport,
    exportTab,
    runExport,
  } = useExportFlow({
    getLatest,
    set,
    onToast,
    activeTab,
    docNode,
    docSource,
    docTitle,
    superDoc,
    store,
    openTab,
  })

  /* ---------- 文档区：按住右键横向划，页签栏上那颗棱形跟着走 ---------- */

  /** 刚刚那一下右键是不是真的划过：决定要不要吞掉随后的 contextmenu */
  const docMarkMoved = useRef(false)

  /**
   * 按住**右键**在正文里横向划：页签栏上那颗**棱形**跟着指针走，它压到哪个页签就打开哪个。
   *
   * 为什么是右键：左键在这个区域已经有活干（选字、点链接、划注解），再叠一个拖动必然打架；
   * 右键本来是「上下文菜单」，在正文空白处它没什么可给的，正好拿来当手势的起手式。
   * 菜单只在**没有划过**时才弹（划过了就吞掉，否则划到一半跳出一个菜单）。
   *
   * 棱形那边在页签栏上（TabBar），隔着好几层，走 lib/tabMark 那套模块级回调登记/调用；
   * 只有焦点格的栏会登记（分割成好几格时，棱形只该出现在焦点格那条栏上）。
   * 监听挂在 window 上、而且只在这个手势期间挂着，而不是用 setPointerCapture：
   * 捕获会把随后的 mouseup / contextmenu 也一并重定向到这一格上，正文里那些自己的
   * 右键处理（注解、链接）就再也收不到事件了。挂在 window 上同样能接住划出文档区之后的移动。
   */
  const onDocPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 2) return
    const startX = e.clientX
    let moved = false
    /*
     * 收尾要能自己触发：右键在窗口外松开时 window 收不到 pointerup，指针再移回来时
     * `buttons` 已经是 0——那一拍就该结束这个手势。不然三条监听一直挂在 window 上，
     * 每漏一次多一份，只有重载才清得掉。blur 兜住「拖到一半 Alt+Tab 切走」。
     */
    function onUp(): void {
      if (moved) resetTabMark()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
    }
    function onMove(ev: PointerEvent): void {
      // 右键已经松开（或换成了别的键）：这个手势结束了，顺手把监听摘干净
      if ((ev.buttons & 2) === 0) {
        onUp()
        return
      }
      if (!moved) {
        // 手抖不算划：与拖页签同一个阈值口径（见 TabBar 的 DRAG_MIN）
        if (Math.abs(ev.clientX - startX) < 4) return
        moved = true
        docMarkMoved.current = true
      }
      moveTabMark(ev.clientX)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
  }



  /**
   * 切某一份文档的视图（源码 / 预览）：只改**那一个页签**自己的选择。
   *
   * 收 tabId 而不是「当前页签」：视图开关现在住在文档区右上角的悬浮组里，而那一组是
   * **按格**渲染的——点在右边那一格的开关上，改的该是右边那一格显示的文档（见 DocFloat）。
   */
  const setTabView = useCallback(
    (tabId: string | null, view: DocView) => {
      if (!tabId) return
      const s = getLatest()
      set({ ...s, docArea: patchTab(s.docArea, tabId, { view }) })
    },
    [getLatest, set],
  )

  /**
   * 记下「这份文档读到哪儿了」（键 = 页签 id，见 lib/docScroll）。
   *
   * 走 patchQuiet：滚动一秒能触发好几次上报，而它**不参与渲染**——
   * 用 set 的话每报一次就把整棵学习区（正文 + 对话栏）重渲染一遍，跟手感当场没了。
   * 与阅读增量同一条纪律（见下面 onReading 的说明）。
   */
  const rememberScroll = useCallback(
    (tabId: string, top: number) => {
      patchQuiet((s) => ({ ...s, docScroll: { ...s.docScroll, [tabId]: Math.round(top) } }))
    },
    [patchQuiet],
  )

  /* ---------- 随笔（见 learn/essays 与 components/learn/essay） ---------- */

  /**
   * 随笔窗口开着没有。窗口本身在 EssayDock 里，开合只由这里的一个布尔值决定——
   * 这样「双击 Shift」（见下面的 useDoubleShift）与按钮点开走的是同一条路。
   */
  const [essayOpen, setEssayOpen] = useState(false)
  /** 随笔跟着**眼前这份文档的目标**走：目标级的东西，切到别的目标就不该还开着 */
  const essayGoalId = docNode?.goalId ?? null
  const essayList = (essayGoalId ? store.essays?.[essayGoalId] : null) ?? EMPTY_ESSAYS

  /*
   * 三条写入。都用 getLatest() 现取最新快照再算：输入是去抖的，
   * 上一次写入可能刚被别的动作（删一条、切目标）改过。
   */
  const essayCreate = useCallback(
    (goalId: string, title: string, text: string): string | null => {
      const created = createEssay(getLatest(), goalId, text, Date.now(), title)
      if (!created) return null
      set(created.store)
      return created.entry.id
    },
    [getLatest, set],
  )
  const essayUpdate = useCallback(
    (goalId: string, id: string, patch: { text?: string; title?: string }) => {
      set(updateEssay(getLatest(), goalId, id, patch, Date.now()))
    },
    [getLatest, set],
  )
  const essayDelete = useCallback(
    (goalId: string, id: string) => {
      set(deleteEssay(getLatest(), goalId, id))
    },
    [getLatest, set],
  )
  /** 窗口几何与状态：纯界面状态，安静写盘就够（窗口自己已经摆好了，不必为它重渲染整棵学习区） */
  const essayGeometry = useCallback(
    (state: EssayDockRect) => {
      patchQuiet((s) => ({ ...s, essayDock: state }))
    },
    [patchQuiet],
  )

  /**
   * 随笔窗口中的笔记列表（跨目标/节点）：收集当前所有节点的笔记，
   * 标明来自哪个目标的哪个节点（按修改时间倒序）。
   */
  /*
   * 随笔窗口的「笔记」页签只列**当前目标**的笔记（需求定的）：随笔本身是目标级的，
   * 笔记列表却跨目标的话，写着这门课却翻到另一门课的笔记，注意力与归属都会乱。
   * 目标没选（没有 essayGoalId）时给空表——窗口本来也不会露脸。
   */
  const dockNotes = useMemo(() => {
    if (!essayGoalId) return EMPTY_DOCK_NOTES
    const goal = store.goals.find((g) => g.id === essayGoalId)
    const rootNode = goal ? store.nodes.find((n) => n.id === goal.rootNodeId) : undefined
    const goalTitle = rootNode?.title || goal?.question || ''
    const list: DockNoteItem[] = []
    for (const node of store.nodes) {
      if (node.goalId !== essayGoalId) continue
      for (const note of notesOf(node)) {
        list.push({
          goalId: node.goalId,
          goalTitle,
          nodeId: node.id,
          nodeTitle: node.title,
          name: note.name,
          content: note.content,
          updatedAt: note.updatedAt,
          createdAt: note.createdAt,
        })
      }
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    return list
  }, [store.goals, store.nodes, essayGoalId])

  const dockWriteNote = useCallback(
    (nodeId: string, name: string, content: string) => {
      set(writeNote(getLatest(), nodeId, name, content))
    },
    [getLatest, set],
  )

  const dockDeleteNote = useCallback(
    (nodeId: string, name: string) => {
      set(deleteNote(getLatest(), nodeId, name))
    },
    [getLatest, set],
  )


  /* ---------- 随笔提交（见 learn/essayCommits） ---------- */

  /** 这个目标的提交记录（新的在前）；没有就是同一个空数组 */
  const essayCommits = (essayGoalId ? store.essayCommits?.[essayGoalId] : null) ?? EMPTY_COMMITS

  /**
   * 跑一次「随笔整理」。
   *
   * 为什么先拍笔记指纹再触发：整理是 Agent 在沙箱里异步写笔记，**不能等它回来说
   * 「我改了哪几份」**——它记错 / 漏报的时候，提交记录就成了假的。宿主在触发前把所有
   * 笔记的正文拍一份快照，跑完再拍一份，两份一对比，改了什么就是什么。
   */
  const organizeEssayCommit = useCallback(
    (goalId: string, commit: EssayCommit) => {
      const s = getLatest()
      const goal = s.goals.find((g) => g.id === goalId)
      if (!goal) return
      if (!hasKey) {
        set(
          updateEssayCommit(getLatest(), goalId, commit.id, {
            status: 'error',
            error: t('还没配置 AI：快照已经保存，配好 API Key 后可以重试整理'),
          }),
        )
        return
      }
      const before = noteFingerprint(s, goalId)
      let convId = resolveDisplayedConversation(s, goalId)
      if (!convId) {
        const { store: nextStore, conversation } = addConversation(s, goalId)
        set(nextStore)
        convId = conversation.id
      }
      const run = agent.runWorkflow('essay-commit', {
        target: { goalId, nodeId: goal.rootNodeId || null, conversationId: convId },
        // 增量材料：之前的整理记录 + 本次新增全文 + 本次修改的差异（见 commitFeed）
        params: { message: commit.message, feed: commitFeed(commitsOf(s, goalId), commit) },
      })
      if (!run) {
        set(
          updateEssayCommit(getLatest(), goalId, commit.id, {
            status: 'error',
            error: t('没能启动整理：目标或会话已经不在'),
          }),
        )
        return
      }
      void run
        .then(() => {
          // 整理完成：对比前后两份指纹，把真正动过的笔记记到这次提交上
          const after = getLatest()
          const changes = diffNoteChanges(before, noteFingerprint(after, goalId))
          // 提交评论：Agent 按约定格式写在回复末尾（见 essayCommits 的 parseEssayComment），
          // 从这一轮对话最后一条回复里抠出来。解析不到就算了——评论是锦上添花，
          // 不能因为它挡住整理结果本身（changes 由指纹对比得出，不靠模型自报，见上）。
          const conv = conversationById(after, convId)
          const lastReply = conv ? [...conv.messages].reverse().find((m) => m.role === 'assistant') : null
          const replyText = lastReply
            ? lastReply.parts
                .filter((p) => p.type === 'text')
                .map((p) => p.text)
                .join('')
            : ''
          const comment = parseEssayComment(replyText)
          set(
            updateEssayCommit(getLatest(), goalId, commit.id, {
              status: 'done',
              changes,
              ...(comment ? { comment } : {}),
            }),
          )
          onToast(t('随笔整理完成：{0}', changesSummary(changes)))
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          // 中途失败也可能已经写了几份笔记：照样对比一次，别把已经发生的事藏起来
          const partial = diffNoteChanges(before, noteFingerprint(getLatest(), goalId))
          set(
            updateEssayCommit(getLatest(), goalId, commit.id, {
              status: 'error',
              error: message,
              changes: partial,
            }),
          )
          onToast(t('随笔整理失败：{0}', message))
        })
    },
    [agent, getLatest, set, hasKey, onToast],
  )

  /** 提交这一批随笔：封快照 → 立刻返回 id（界面据此打开详情）→ 后台开始整理 */
  const essayCommit = useCallback(
    (message: string): string | null => {
      const goalId = essayGoalId
      if (!goalId) return null
      const created = createEssayCommit(getLatest(), goalId, message, Date.now())
      if (!created) {
        onToast(t('还没有随笔可以提交'))
        return null
      }
      set(created.store)
      organizeEssayCommit(goalId, created.commit)
      return created.commit.id
    },
    [essayGoalId, getLatest, set, organizeEssayCommit, onToast],
  )

  /** 重试一次失败的整理（快照还在，重跑就行，不必重新提交） */
  const essayCommitRetry = useCallback(
    (id: string) => {
      const goalId = essayGoalId
      if (!goalId) return
      const commit = commitsOf(getLatest(), goalId).find((c) => c.id === id)
      if (!commit) return
      set(updateEssayCommit(getLatest(), goalId, id, { status: 'running', changes: [], error: undefined }))
      organizeEssayCommit(goalId, commit)
    },
    [essayGoalId, getLatest, set, organizeEssayCommit],
  )

  /** 从提交详情里点开一份被整理过的笔记：按普通笔记页签打开 */
  const essayOpenNote = useCallback(
    (nodeId: string, noteName: string) => {
      openTab({ kind: 'note', nodeId, note: noteName })
    },
    [openTab],
  )

  // 双击 Shift：唤出 / 收起随笔窗口（没有目标时什么也不做——随笔是目标级的）
  useDoubleShift(() => {
    if (!essayGoalId) return
    setEssayOpen((v) => !v)
  })

  /*
   * 换目标就把窗口收起来：随笔是目标级的东西，切到另一门课还挂着上一个目标的窗口
   * （而且刚重挂成空白的）只会让人以为刚才写的东西没了。
   * 上一份的收尾由 EssayDock 的 key 变化触发卸载时做（见下面的 key）。
   */
  const lastEssayGoal = useRef<string | null>(null)
  useEffect(() => {
    if (lastEssayGoal.current === essayGoalId) return
    lastEssayGoal.current = essayGoalId
    setEssayOpen(false)
  }, [essayGoalId])

  /*
   * 资源管理器的撤回（Ctrl+Z）：删除类动作先捕获再动手，栈与键盘监听都在 useExplorerUndo。
   */
  const { pushUndo } = useExplorerUndo({ getLatest, set, onToast })

  /*
   * 笔记与本地文件的动作整体在 useLibraryActions（workspace/）：
   * 新建 / 改名 / 删除 / 定位，本地文件的收编 / 打开 / 挑选 / 拖拽。
   */
  const {
    createNodeNote,
    renameNodeNote,
    commitRemoveNote,
    commitRemoveSuperDoc,
    revealNoteFile,
    openLocalFile,
    dropLocalFile,
    pickLocal,
  } = useLibraryActions({ getLatest, set, flush, onToast, openTab, pushUndo })

  /** 打开「新建目标」弹窗 */
  const startCreatingGoal = () => {
    setCreateGoalOpen(true)
    setSidebarOpen(false)
  }

  /*
   * moji:node / doc / super 三种链接的跳转注册在 useLinkHandlers（workspace/）。
   */
  useLinkHandlers({ getLatest, openTab, createNodeNote, onToast })

  /* ---------- 选中节点 / 对话 ---------- */

  const selectNode = switchNode

  /* ---------- 空白页签上的两栏（收藏 / 最近打开） ---------- */

  /**
   * 「最近打开」那一栏的数据（原侧栏的「最近打开」区，现挪到空白页签上，见 EmptyDoc）。
   */
  const blankRecents = useMemo(() => recentOpens(store), [store])

  /** 点最近打开的一行：节点接着看（教学文档）、本地文件直接打开——与侧栏那个区同一条路 */
  const openRecent = useCallback(
    (item: RecentOpen) => (item.kind === 'node' ? selectNode(item.id) : openLocalFile(item.id)),
    [selectNode, openLocalFile],
  )

  /**
   * 换一段对话：会话属于目标，所以切对话不换节点。keepalive 的页签面板各自绑自己
   * 的页签——换的是**那一枚页签**里展示的会话；被换的正是激活页签时，
   * activeConversationId（文档区那条旧读口）也同步过去。
   */
  const selectConversationIn = (tab: AgentTabRef, conversationId: string) => {
    if (tab.kind !== 'goal') return
    const s = getLatest()
    const conv = conversationById(s, conversationId)
    if (!conv || conv.goalId !== tab.goalId) return
    const t0 = upsertAgentTab(
      s.agentTabs ?? [],
      s.agentActiveTab ?? null,
      { kind: 'goal', goalId: tab.goalId, conversationId },
      true,
    )
    const next: LearnStore = {
      ...s,
      activeGoalId: tab.goalId,
      activeConversationId: conversationId,
    }
    set(withAgentTabs(next, t0.tabs, t0.active))
    setSidebarOpen(false)
  }

  /** 在某一枚目标级页签的目标里另起一段对话（同一个目标可以有并行几段上下文） */
  const newConversationIn = (tab: AgentTabRef) => {
    if (tab.kind !== 'goal') return
    const s = getLatest()
    const { store: withConv, conversation } = addConversation(s, tab.goalId)
    const t0 = upsertAgentTab(
      withConv.agentTabs ?? [],
      withConv.agentActiveTab ?? null,
      { kind: 'goal', goalId: tab.goalId, conversationId: conversation.id },
      true,
    )
    const next: LearnStore = {
      ...withConv,
      activeGoalId: tab.goalId,
      activeConversationId: conversation.id,
    }
    set(withAgentTabs(next, t0.tabs, t0.active))
  }

  /**
   * 全局推理等级：斜杠 /effort 与 ModelPicker 是同一个设置（AiSettings.global.effort）的两个入口。
   * 写完 bump 一次 settingsEpoch——它读的不是 React state，不 bump 界面不会知道该重新读。
   */
  const effort = globalEffort()
  const setGlobalEffort = (next: ReasoningEffort) => {
    const cur = loadAiSettings()
    saveAiSettings({ ...cur, global: { ...cur.global, effort: next } })
    setSettingsEpoch((n) => n + 1)
    onToast(t('推理等级已设为「{0}」', REASONING_LABEL[next]))
  }

  /**
   * 删对话 / 删消息之后清一次图片。
   *
   * 图片是独立文件（见 learn/images），消息里只有一条引用：引用没了文件不会自己
   * 消失。放在这里而不是每个删除点各写一遍——漏掉一处就是一份永远留在磁盘上的
   * 垃圾，而且用户看不到它、也就不会去清。
   */
  const pruneImagesOf = (s: LearnStore) => {
    if (s.activeGoalId) void pruneImages(s, s.activeGoalId)
  }

  const removeConversation = (conversationId: string) => {
    // 删除会话（或删掉同目标最后一段时清空它的消息）是设计内的历史改写：这一会话的
    // 前缀账重新开始记（见 agent/prefixGate）
    resetPrefixGate(conversationId)
    const next = fixAgentTabsAfter(deleteConversation(getLatest(), conversationId))
    if (next.activeConversationId || !next.activeNodeId) {
      set(next)
      pruneImagesOf(next)
      return
    }
    // 删掉的正是当前对话：回落到同一目标里最近的另一个
    const node = nodeById(next, next.activeNodeId)
    if (!node) {
      set(next)
      pruneImagesOf(next)
      return
    }
    const ensured = ensureConversation(next, node.goalId)
    const patched: LearnStore = { ...ensured.store, activeConversationId: ensured.conversationId }
    set(patched)
    pruneImagesOf(patched)
  }

  /** 在当前激活的目标下新增一段对话并作为新页签打开置前 */
  const handleNewGoalConversation = useCallback(() => {
    const s = getLatest()
    if (!s.activeGoalId) return
    const { store: withConv, conversation } = addConversation(s, s.activeGoalId)
    const t0 = upsertAgentTab(
      withConv.agentTabs ?? [],
      withConv.agentActiveTab ?? null,
      { kind: 'goal', goalId: s.activeGoalId, conversationId: conversation.id },
      true,
    )
    const next: LearnStore = {
      ...withConv,
      activeGoalId: s.activeGoalId,
      activeConversationId: conversation.id,
    }
    set(withAgentTabs(next, t0.tabs, t0.active))
  }, [getLatest, set])

  /* ---------- 新建学习目标 ---------- */

  const createGoal = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) return

      const goalId = crypto.randomUUID()
      const now = Date.now()

      const goal: LearningGoal = {
        id: goalId,
        title: trimmed,
        question: trimmed,
        rootNodeId: '',
        createdAt: now,
        updatedAt: now,
      }

      // 创建一个空的 Agent 会话（无首发消息，不主动调用模型）
      const conversation: Conversation = {
        ...makeConversation(goalId),
        messages: [],
        updatedAt: now,
      }

      const curStore = getLatest()

      // 打开 Agent 导师页签置前
      const tab0 = upsertAgentTab(
        curStore.agentTabs ?? [],
        curStore.agentActiveTab ?? null,
        { kind: 'goal', goalId, conversationId: conversation.id },
        true,
      )

      // 结构页签（节点宇宙），以目标 id 为锚
      const rootRef: TabRef & { kind: 'outline' } = { kind: 'outline', nodeId: goalId, goalId }
      const rootId = tabKey(rootRef)

      const docAreaWithAnchor = openAnchorOutline(
        curStore.docArea,
        curStore.docArea.focus,
        rootRef,
        (id) => (id === goalId ? goalId : (nodeById(curStore, id)?.goalId ?? null)),
        now,
      )

      const docArea = activateIn(docAreaWithAnchor, docAreaWithAnchor.focus, rootId)
      const claimedOwners = claimTab(docArea.tabOwners, goalId, rootId)

      const nextStore: LearnStore = {
        ...curStore,
        ...withAgentTabs(curStore, tab0.tabs, tab0.active),
        goals: [goal, ...curStore.goals],
        conversations: [...curStore.conversations, conversation],
        activeGoalId: goalId,
        activeNodeId: null,
        activeConversationId: conversation.id,
        docArea: withOwners(docArea, claimedOwners),
      }

      set(nextStore)
      setSidebarOpen(false)
      onToast(t('已创建目标「{0}」，可在节点宇宙中自由添加内容', trimmed))
    },
    [getLatest, set, onToast],
  )

  /*
   * 选区上的动作（学习 / 了解 / 注解 / 询问）整体在 useConceptActions（workspace/），
   * AI 大纲「点击学习」链接的注册也随它（与 openConcept 同生共死）。
   */
  const {
    openConcept,
    understandConcept,
    saveAnnotation,
    deleteAnnotation,
    askAboutSelection,
  } = useConceptActions({
    getLatest,
    set,
    onToast,
    onOpenSettings,
    agent,
    hasKey,
    providerName,
    docSource,
    setCreating,
  })

  /**
   * 考试窗口那一侧的接线：开考、作答、单题耗时、切屏、交卷、放弃全部从那边发过来，
   * 在这里落盘（考试窗口一笔都不写，见 learn/useExamBridge 的说明）。
   *
   * live 非空 = 有一场正在考：主窗口盖一层黑遮罩（见下面 ExamShield），
   * 免得一边答题一边翻文档。
   */
  const exam = useExamBridge({
    getLatest,
    set,
    /**
     * 交卷已经落盘了（客观题也判完了），这里只负责把判分 + 讲解那套工作流推起来。
     * 没配 Key 时**不吞掉这次交卷**：卷子照样收下、成绩照旧是系统的客观分，
     * 只是判分与讲解要等用户把 Key 填上——那时再点一次「阅卷」即可（列表里有入口）。
     */
    onSubmitted: (examId: string, attemptId: string) => {
      if (!hasKey) {
        onToast(t('已交卷。判分与错题讲解需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
        onOpenSettings()
        return
      }
      const st = getLatest()
      const ex = st.exams.find((e) => e.id === examId)
      agent.runWorkflow('exam-grade', {
        nodeId: ex?.nodeId,
        params: { target: ex?.nodeId ?? '', examId, attemptId },
      })
    },
  })

  /**
   * 导师开始干活时自动弹开右侧那一栏（仅当它就在右侧）。
   *
   * 收着的那一栏等于不存在，而「它正在写」「它正在判卷」恰恰是这一刻用户要看的东西。
   * 只在 running 的**上升沿**做：跑起来之后用户若手动收起（想安静看文档），
   * 不该每一帧又把它顶开。它在左边（主位）时不用管——本来就看得见。
   */
  const wasRunning = useRef(false)
  useEffect(() => {
    /*
     * 纯净阅读里**不弹**：那时用户要的正是「没有导师栏」的那块地方，
     * 顶开它等于把刚收起来的东西又塞回去（退出之后它自然会按需弹开）。
     */
    if (agent.running && !wasRunning.current && !agentLeft && !pure) expandSide()
    wasRunning.current = agent.running
  }, [agent.running, agentLeft, expandSide, pure])

  /**
   * 文档区在右侧栏（agentLeft）且收起时，若文档区发生变动（文件变动/tab变动）则自动弹出。
   *
   * 对应场景：
   * 1. tab 变动：打开新页签、关闭页签、切换激活页签、分屏或焦点变化。
   * 2. 文件变动：导师改写教学文档（节点 editContent）、笔记修改、超级文档保存、试卷提交或草稿更新。
   *
   * 守卫与约束：
   * - 首次挂载只记录初始快照，不触发弹出（避免应用启动时违背用户上一次保存的收起偏好）。
   * - 纯净阅读（pure）模式下不弹（同导师栏策略，Zen 模式优先保护全屏沉浸）。
   */
  const docAreaSig = useMemo(() => {
    const groupParts = Object.values(docs.groups)
      .map((g) => `${g.id}:${g.active}:[${g.tabs.map((t) => `${t.id}:${tabKey(t.ref)}`).join(',')}]`)
      .join('|')
    const tabSig = `${docs.focus}::${groupParts}`

    const contentParts: string[] = []
    for (const t of tabs) {
      const ref = t.ref
      if (ref.kind === 'teach') {
        const node = nodeById(store, ref.nodeId)
        contentParts.push(`${t.id}:teach:${node?.docs?.teaching?.length ?? 0}:${node?.updatedAt ?? 0}`)
      } else if (ref.kind === 'note') {
        const node = nodeById(store, ref.nodeId)
        const n = node?.notes.find((item) => item.name === ref.note)
        contentParts.push(`${t.id}:note:${n?.content?.length ?? 0}:${n?.updatedAt ?? 0}`)
      } else if (ref.kind === 'super') {
        const s = readSuperDoc(store, ref.nodeId, ref.name)
        contentParts.push(`${t.id}:super:${s?.html?.length ?? 0}:${s?.updatedAt ?? 0}`)
      } else if (ref.kind === 'exam') {
        const exam = store.exams.find((e) => e.id === ref.examId)
        const attempt = exam?.attempts.find((a) => a.id === ref.attemptId)
        contentParts.push(`${t.id}:exam:${attempt?.endedAt ?? attempt?.startedAt ?? 0}`)
      } else if (ref.kind === 'outline') {
        const node = nodeById(store, ref.nodeId)
        contentParts.push(`${t.id}:outline:${node?.updatedAt ?? 0}`)
      }
      const draft = store.drafts[t.id]
      if (draft) {
        contentParts.push(`${t.id}:draft:${draft.length}`)
      }
    }
    const contentSig = contentParts.join(';')

    return { tabSig, contentSig }
  }, [docs, tabs, store])

  const prevDocAreaSig = useRef<{ tabSig: string; contentSig: string } | null>(null)
  useEffect(() => {
    if (prevDocAreaSig.current === null) {
      prevDocAreaSig.current = docAreaSig
      return
    }
    const tabChanged = prevDocAreaSig.current.tabSig !== docAreaSig.tabSig
    const contentChanged = prevDocAreaSig.current.contentSig !== docAreaSig.contentSig
    prevDocAreaSig.current = docAreaSig

    if ((tabChanged || contentChanged) && agentLeft && sideCollapsed && !pure) {
      expandSide()
    }
  }, [docAreaSig, agentLeft, sideCollapsed, pure, expandSide])


  /*
   * 日程：写操作（页面与顶栏共用一套）与到点提醒（顶栏那一条呼吸 + 弹层）。
   *
   * 提醒引擎有自己的 1 秒节拍，但**只在「该响的那条换了」时 setState**——顶栏因此不会
   * 每秒重渲染；这条边界写在 useScheduleFlow 的文件头，改动时别把 tick 挪进渲染。
   */
  const scheduleActions = useScheduleFlow({ getLatest, set })
  const { ringing: scheduleRinging, complete: completeScheduleItem, snooze: snoozeScheduleItem } =
    useScheduleReminder({ getLatest, set })

  /*
   * 纯净阅读里顶栏是收起的（h-0 + invisible）：日程到点时如果还缩着，用户只听得见铃声、
   * 看不见是哪一件事。响铃优先——先退出纯净阅读，让顶栏的呼吸与弹层真的出现在眼前。
   */
  useEffect(() => {
    if (scheduleRinging && pure) setPure(false)
  }, [scheduleRinging, pure, setPure])

  const {
    newExam,
    requestGrading,
    startSuperLab,
    startOutline,
    startPrereqOutline,
    startVideoOverview,
    workflowRows,
    runWorkflowRow,
    removeWorkflowRow,
  } = useWorkflowStarters({
    getLatest,
    set,
    onToast,
    onOpenSettings,
    agent,
    hasKey,
    providerName,
    activeNode,
    activeNodeId,
    activeGoal,
    activeGoalId,
    store,
    setCreating,
  })

  /**
   * 这条消息该不该排进等待队列（而不是直接发出去）：导师正在跑、或队列里已经排着人。
   *
   * 判据只有 learn/agentQueue 的 shouldEnqueue 一处——「先来后到」是队列语义的全部，
   * 写死在这两个调用点上迟早分叉。附件与正文都原样交给队列，它持有到真正发出去那一刻。
   */
  const shouldWaitInLine = (convId: string) =>
    shouldEnqueue(queueOf(agent.queues, convId).length, !!agent.runningByConversation[convId])

  /**
   * 一枚 agent 页签的整份面板 props（keepalive 的每枚页签各取各的，见挂载处的循环）。
   *
   * 数据全部按页签解析：会话与它的流式/表单/账目、子代理桶、目标会话列表；动作也
   * 全部绑到**这一枚页签**的目标上——后台页签里的输入框、菜单、停止键发的都是它自己
   * 那位导师，不借用「眼前激活的页签」。全局设置（人格 / 模型 / 档位）由所有页签共享。
   */
  const agentTabProps = (tab: AgentTabRef) => {
    /*
     * 固定聊天页签：会话住在 learn/freeChat（独立文件），发送走 agent.sendFree——
     * 没有系统提示词/工具/人格，所以 ask、子代理、压缩这些导师域的槽一律置空；
     * 界面上由 AgentPanel 的 free 模式收起对应的功能（菜单三项、无「正在辅导」）。
     */
    if (tab.kind === 'free') {
      const convId = currentFreeConvId
      const conv = freeConversationById(convId)
      const stream = convId ? agent.streams[convId] : undefined
      const nope = () => {}
      return {
        conversation: conv ?? null,
        conversations: freeChats,
        streaming: stream?.parts ?? null,
        streamingMessageId: stream?.messageId ?? null,
        running: !!(convId && agent.runningByConversation[convId]),
        free: true,
        onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
          const id = convId ?? addFreeConversation().id
          if (id !== convId) setFreeConvId(id)
          // 正跑着（或队里排着人）：排进等待队列，等这一轮收口再发（见 learn/agentQueue）
          if (shouldWaitInLine(id)) {
            agent.enqueueMessage({ conversationId: id, free: true, text, images, files })
            return 'queued' as const
          }
          agent.sendFree(id, text, { files, images })
          return 'sent' as const
        },
        queue: queueOf(agent.queues, convId),
        onQueueDrop: (id: string) => {
          if (convId) agent.dropQueuedMessage(convId, id)
        },
        onQueueSendNow: (id: string) => {
          if (convId) agent.sendQueuedNow(convId, id)
        },
        onStop: () => agent.stop(convId ?? undefined),
        onEditMessage: () => {},
        onDeleteMessage: () => {},
        onResumeInterrupted: () => {},
        ask: null,
        onAskSubmit: () => {},
        onAskCancel: () => {},
        tps: (convId ? agent.tpsByConv[convId] : null) ?? null,
        liveUsage: (convId ? agent.liveUsageByConv[convId] : null) ?? null,
        compacting: false,
        onCompact: nope,
        onSuperLab: nope,
        onExam: nope,
        sub: { sessions: [], defs: [], running: false, live: [] },
        viewSubId: null,
        onOpenSub: () => {},
        onNewConversation: () => {
          setFreeConvId(addFreeConversation().id)
        },
        onSelectConversation: (id: string) => setFreeConvId(id),
        onDeleteConversation: (id: string) => {
          if (id && agent.runningByConversation[id]) {
            onToast(t('这一段正在运行，先停止再删除'))
            return
          }
          deleteFreeConversation(id)
          if (id === currentFreeConvId) setFreeConvId(null)
        },
      }
    }
    const isSub = tab.kind === 'sub'
    const goalId = isSub ? (conversationById(store, tab.conversationId)?.goalId ?? null) : tab.goalId
    // 页签里记的会话丢了（被删过）就回落到该目标最近的一段——与 agentView 同一条口径
    const convId = isSub
      ? tab.conversationId
      : tab.conversationId &&
          conversationById(store, tab.conversationId)?.goalId === tab.goalId
        ? tab.conversationId
        : (resolveDisplayedConversation(store, tab.goalId) ?? null)
    const nodeId = goalId
      ? (goalFocusByGoal.get(goalId) ?? (store.goals.find((g) => g.id === goalId)?.rootNodeId || store.nodes.find((n) => n.goalId === goalId)?.id || null))
      : null
    const conv = convId ? (conversationById(store, convId) ?? null) : null
    const target = goalId && convId ? { goalId, nodeId: nodeId || null, conversationId: convId } : null
    const bucket = conv?.subagents
    const sessions = bucket?.sessions ?? []
    const session = isSub ? (sessions.find((x) => x.id === tab.sessionId) ?? null) : null
    const stream = convId ? agent.streams[convId] : undefined
    return {
      // 页签属于哪个目标（子代理经会话反查）：「记忆」入口按它开对应目标的记忆页签
      goalId,
      conversation: conv,
      conversations: goalId ? store.conversations.filter((c) => c.goalId === goalId) : [],
      streaming: stream?.parts ?? null,
      streamingMessageId: stream?.messageId ?? null,
      running: !!(convId && agent.runningByConversation[convId]),
      onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
        if (!target) return 'sent' as const
        /*
         * 导师正在跑（或队里还排着人）：这条排进等待队列，不挤进正在跑的那一轮——
         * 一轮 Agent 是一次完整的模型循环，半路塞一条用户消息会让这一轮实发的上下文
         * 自相矛盾（前缀门禁会当场拦下，见 agent/prefixGate）。
         */
        if (shouldWaitInLine(target.conversationId)) {
          agent.enqueueMessage({
            conversationId: target.conversationId,
            target,
            text,
            images,
            files,
          })
          return 'queued' as const
        }
        agent.send(text, {
          target,
          ...(images.length || files.length
            ? { images: images.length ? images : undefined, files: files.length ? files : undefined }
            : {}),
        })
        return 'sent' as const
      },
      queue: queueOf(agent.queues, convId),
      onQueueDrop: (id: string) => {
        if (convId) agent.dropQueuedMessage(convId, id)
      },
      onQueueSendNow: (id: string) => {
        if (convId) agent.sendQueuedNow(convId, id)
      },
      onStop: () => agent.stop(convId ?? undefined),
      onEditMessage: (messageId: string, text: string) => {
        // 改写消息正文 = 设计内的历史改写：这一会话的前缀账重新开始记（见 agent/prefixGate）
        resetPrefixGate(convId ?? '')
        set(updateMessageText(getLatest(), convId ?? '', messageId, text))
      },
      onDeleteMessage: (messageId: string) => {
        // 同上：删除消息之后的历史与已实发的那份不再前缀一致
        resetPrefixGate(convId ?? '')
        const next = deleteMessage(getLatest(), convId ?? '', messageId)
        set(next)
        pruneImagesOf(next)
      },
      onResumeInterrupted: () => {
        if (target) agent.resumeInterrupted(target)
      },
      ask: (convId ? agent.pendingAskByConv[convId] : null) ?? null,
      onAskSubmit: (answers: AskAnswers) => {
        if (convId) agent.submitAsk(answers, convId)
      },
      onAskCancel: () => {
        if (convId) agent.cancelAsk(convId)
      },
      tps: (convId ? agent.tpsByConv[convId] : null) ?? null,
      liveUsage: (convId ? agent.liveUsageByConv[convId] : null) ?? null,
      compacting: !!convId && agent.compactingConvId === convId,
      onCompact: () => {
        if (convId) void agent.compactNow(convId)
      },
      // 菜单动作绑到这一枚页签的落点节点（节点归属的解析见 runWorkflow）
      // onSuperLab 仍在这里：斜杠命令 /superlab 消费它（更多菜单已摘除工作流分组）
      onSuperLab: () => {
        if (nodeId) startSuperLab(nodeId)
      },
      onExam: () => newExam(nodeId ?? undefined),
      sub: {
        sessions,
        defs: bucket?.defs ?? [],
        running: agent.subRunsAll.some((r) => r.conversationId === convId),
        live: agent.subRunsAll
          .filter((r) => r.conversationId === convId)
          .map(({ sessionId: sid, runId, parts }) => ({ sessionId: sid, runId, parts })),
      },
      viewSubId: session?.id ?? null,
      onOpenSub: (sid: string) => {
        if (convId) openAgentTab({ kind: 'sub', conversationId: convId, sessionId: sid }, true)
      },
      onNewConversation: () => newConversationIn(tab),
      onSelectConversation: (id: string) => selectConversationIn(tab, id),
    }
  }

  /** 等着判分 / 讲解的那一次：按钮上标出来，也决定「新增」还能不能点 */
  const pendingWork = useMemo(
    () => (activeNodeId ? examNeedingWork(store, activeNodeId) : null),
    [store, activeNodeId],
  )
  /**
   * 「哪位导师在跑」按会话查表（agent 栏页签化之后不止一位）：判分 / 讲解的隐藏指令
   * 由 runHidden 按节点归属落进**节点目标**的会话——判卷忙态也按同一条口径查，
   * 不能再看「眼前激活的导师页签在不在跑」。
   */
  const grading = useMemo(() => {
    if (!pendingWork) return false
    const node = nodeById(store, pendingWork.exam.nodeId)
    const convId = node ? (resolveDisplayedConversation(store, node.goalId) ?? null) : null
    return !!(convId && agent.runningByConversation[convId])
  }, [pendingWork, store, agent.runningByConversation])

  /**
   * 当前文档为什么还是空的——文档区据此显示等待动画，而不是留一片白让用户怀疑卡了。
   *
   * 判据只有一条：Agent 正在跑（讲这份文档的会话），而且这一轮是系统代发的隐藏指令
   * （节点刚建好）。少了后半句，用户在空文档的节点里自己提个问，也会被说成「正在撰写教学文档」。
   */
  const docPending = useMemo(() => {
    if (!docSource || docSource.content.trim()) return false
    const convId = docNode ? (resolveDisplayedConversation(store, docNode.goalId) ?? null) : null
    if (!convId || !agent.runningByConversation[convId]) return false
    const msgs = conversationById(store, convId)?.messages ?? []
    return msgs[msgs.length - 1]?.hidden === true
  }, [docSource, docNode, store, agent.runningByConversation])

  /* ---------- 其余操作 ---------- */

  /**
   * 删除试卷：**两档确认**（见 pendingExamDelete 的说明）。
   *
   * 第一档只把连带删掉的东西列清楚，第二档才真的删——考过的卷子是这个知识点的学习记录，
   * 而「删掉之后连带没了什么」不该靠用户自己想象。
   */
  const commitRemoveExam = () => {
    const exam = pendingExamDelete
    if (!exam) return
    if (examDeleteStage === 'warn') {
      setExamDeleteStage('final')
      return
    }
    setPendingExamDelete(null)
    // 先备货再动手：撤回项捕获的是删除前那一刻的旧引用（见 learn/undo）
    const entry = captureExamDelete(getLatest(), exam.id)
    if (entry) pushUndo(entry)
    set(removeExam(getLatest(), exam.id))
    onToast(t('已删除《{0}》，可按 Ctrl+Z 撤回', exam.title))
  }

  /** 打开某一次考试的只读副本页签（试卷 + 作答 + 判分 + 错题讲解） */
  const openExamCopy = (nodeId: string, examId: string, attemptId: string) => {
    openTab({ kind: 'exam', nodeId, examId, attemptId })
  }

  /**
   * 点击一枚 chip 引用：节点类开页签（开不了 = 引用已失效，说一句）；
   * 试卷原件没有页签形态——它弹的是考试窗口（与资源管理器那颗「考试」是同一个入口）。
   */
  const openChip = useCallback(
    (p: ChipPayload) => {
      const s = getLatest()
      if (p.type === 'exam' && !p.attemptId) {
        const row = p.examId ? s.exams.find((e) => e.id === p.examId) : undefined
        if (!row) {
          onToast(t('这场试卷已经不在了'))
          return
        }
        if (exam.live && exam.live.examId !== row.id) {
          onToast(t('有一场考试正在进行，先把它考完或放弃'))
          exam.reveal()
          return
        }
        selectNode(row.nodeId)
        exam.openExam(row.id)
        return
      }
      if (p.type === 'web' && p.url) {
        const targetUrl = normalizeWebInput(p.url)
        const group = focusedGroup(s.docArea)
        const existingTab = group?.tabs.find(
          (t) => t.ref.kind === 'web' && normalizeWebInput(t.ref.url) === targetUrl,
        )
        if (existingTab) {
          activateTab(existingTab.id)
          return
        }
        openWebTab(targetUrl)
        return
      }
      const ref = tabRefFromChip(s, p)
      if (ref) {
        openTab(ref)
        return
      }
      /*
        打开失败先别报「已经不在了」——**路径写法可能不一样**。
        chip 的 path 认的是磁盘文件路径（docs/…/教学.md），而交付登记
        （api.delivery.submit 的 files[].path）与手写 chip 常写「目标/节点」这种
        **节点路径**，末尾还可能跟着「/教学」「/讲义」这类文档类型词。两者对不上，
        文档明明在也会被误报成失效。

        退一步按节点路径解析一次：剥掉末尾的类型词，逐目标试（节点量级几十个，
        点击时跑一次无所谓）。解析到了就打开它的教学文档。
      */
      if (p.type === 'doc' && p.path) {
        const wanted = p.path.replace(/\/(教学|讲义|笔记|大纲|试卷|考试|试卷记录|作答记录)$/, '')
        const normPathStr = (v: string): string => v.replace(/\\/g, '/').trim().replace(/\/+$/, '')
        const targetGoalId = p.goalId || s.activeGoalId
        // 1. 如果有明确的目标作用域（或当前激活目标），优先在该目标内查找，避免多目标同名节点指针混淆
        if (targetGoalId) {
          const exactInGoal = s.nodes.find(
            (n) => n.goalId === targetGoalId && normPathStr(nodePathOf(s, targetGoalId, n.id)) === normPathStr(wanted),
          )
          if (exactInGoal) {
            openTab({ kind: 'teach', nodeId: exactInGoal.id })
            return
          }
          const byTitleInGoal = s.nodes.find(
            (n) => n.goalId === targetGoalId && (normPathStr(n.title) === normPathStr(wanted) || n.key === normalizeKey(wanted) || n.id === wanted),
          )
          if (byTitleInGoal) {
            openTab({ kind: 'teach', nodeId: byTitleInGoal.id })
            return
          }
          const gotInGoal = resolveNode(s, { goalId: targetGoalId, currentNodeId: s.activeNodeId }, wanted)
          if (gotInGoal.ok) {
            openTab({ kind: 'teach', nodeId: gotInGoal.value.id })
            return
          }
        }
        // 2. 兜底跨目标查找（跳过已查过的 targetGoalId）
        const exact = s.nodes.find(
          (n) => (!targetGoalId || n.goalId !== targetGoalId) && !!n.goalId && normPathStr(nodePathOf(s, n.goalId, n.id)) === normPathStr(wanted),
        )
        if (exact) {
          openTab({ kind: 'teach', nodeId: exact.id })
          return
        }
        for (const g of s.goals) {
          if (g.id === targetGoalId) continue
          const got = resolveNode(s, { goalId: g.id, currentNodeId: null }, wanted)
          if (got.ok) {
            openTab({ kind: 'teach', nodeId: got.value.id })
            return
          }
        }
        // 3. 若节点树里依然未找到，但路径带物理文件后缀（如 .md），尝试作为本地文件打开
        if (/\.[a-z0-9]{1,8}$/i.test(p.path)) {
          const fileNorm = p.path.replace(/\\/g, '/')
          const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(fileNorm)
          const abs = isAbs ? fileNorm : (userAbsPath(fileNorm) ?? fileNorm)
          openTab({ kind: 'local', path: abs, title: p.path.split('/').pop() })
          return
        }
      }
      if (p.type === 'attempt') {
        onToast(t('这次考试记录已经不在了'))
        return
      }
      if (p.type === 'exam') {
        onToast(t('这场试卷已经不在了'))
        return
      }
      onToast(t('这条引用对应的文档已经不在了'))
      return
    },
    [getLatest, openTab, openWebTab, activateTab, selectNode, exam, onToast],
  )

  // chip 的「点击打开」全走这一份登记（消息列表、输入框都不认识 store，见 lib/docChip）
  useEffect(() => {
    setChipOpener(openChip)
    return () => setChipOpener(null)
  }, [openChip])

  // 设置 → 插件里的「插件开发文档」：同一条打开器纪律（见 lib/pluginDoc）
  useEffect(() => {
    setPluginDocOpener(() => openTab({ kind: 'pluginDoc' }))
    return () => setPluginDocOpener(null)
  }, [openTab])

  // 视频代码块（```videos）的选集数据拉取与点播跳转：注册宿主接口
  useEffect(() => {
    setVideoBlockHost({
      getVideoData: async (videoNodeUuid: string): Promise<VideoBlockData | null> => {
        const s = getLatest()
        const raw = cleanVideoNodeUuid(videoNodeUuid)
        // 1. 优先按 videoNode.id 查找
        let vNode = (s.videoNodes ?? []).find((vn) => vn.id === raw)
        // 2. 次优先按 videoId 查找
        if (!vNode) vNode = (s.videoNodes ?? []).find((vn) => vn.videoId === raw)
        // 3. 兜底：从当前激活文档节点的上游连接查找视频节点
        if (!vNode && s.activeNodeId) {
          const upEdges = s.edges.filter((e) => e.to === s.activeNodeId)
          for (const e of upEdges) {
            const upV = (s.videoNodes ?? []).find((vn) => vn.id === e.from)
            if (upV) {
              vNode = upV
              break
            }
          }
        }
        // 4. 兜底：若该目标下只有一个视频节点，直接匹配它
        if (!vNode && s.activeGoalId) {
          const goalVNodes = (s.videoNodes ?? []).filter((vn) => vn.goalId === s.activeGoalId)
          if (goalVNodes.length === 1) vNode = goalVNodes[0]
        }
        // 5. 兜底：全局若只有一个视频节点
        if (!vNode && (s.videoNodes ?? []).length === 1) {
          vNode = s.videoNodes![0]
        }

        const videoId = vNode?.videoId ?? raw
        let video = (s.videos ?? []).find((v) => v.id === videoId)
        if (!video && !vNode && (s.videos ?? []).length === 1) {
          video = (s.videos ?? [])[0]
        }
        if (!video) return null

        try {
          const src = await resolveVideoSource(video.selection?.source ?? video.input, video.fields)
          let episodes: VideoEpisodeItem[] = []
          if (src.pages && src.pages.length > 0) {
            episodes = src.pages.map((p, idx) => ({
              page: typeof p.page === 'number' && p.page > 0 ? p.page : idx + 1,
              title: p.title,
              source: p.source,
              durationMs: p.durationMs,
            }))
          } else if (src.collection?.items && src.collection.items.length > 0) {
            episodes = src.collection.items.map((it, idx) => ({
              page: idx + 1,
              title: it.title,
              source: it.source,
              durationMs: it.durationMs,
            }))
          }
          return {
            videoTitle: src.title || video.title,
            pluginName: video.pluginName ?? video.pluginId,
            episodes,
          }
        } catch (err) {
          console.warn('[videosBlock] 解析视频选集失败', err)
          return null
        }
      },
      onOpenEpisode: (videoNodeUuid: string, episode: VideoEpisodeItem) => {
        const s = getLatest()
        const raw = cleanVideoNodeUuid(videoNodeUuid)
        let vNode = (s.videoNodes ?? []).find((vn) => vn.id === raw)
        if (!vNode) vNode = (s.videoNodes ?? []).find((vn) => vn.videoId === raw)
        if (!vNode && s.activeNodeId) {
          const upEdges = s.edges.filter((e) => e.to === s.activeNodeId)
          for (const e of upEdges) {
            const upV = (s.videoNodes ?? []).find((vn) => vn.id === e.from)
            if (upV) {
              vNode = upV
              break
            }
          }
        }
        if (!vNode && s.activeGoalId) {
          const goalVNodes = (s.videoNodes ?? []).filter((vn) => vn.goalId === s.activeGoalId)
          if (goalVNodes.length === 1) vNode = goalVNodes[0]
        }
        if (!vNode && (s.videoNodes ?? []).length === 1) {
          vNode = s.videoNodes![0]
        }

        const videoId = vNode?.videoId ?? raw
        const video =
          (s.videos ?? []).find((v) => v.id === videoId) ?? ((s.videos ?? []).length === 1 ? s.videos![0] : undefined)
        if (!video) return

        const nextSource = episode.source
        if (nextSource && nextSource !== (video.selection?.source ?? video.input)) {
          const updatedVideos = (s.videos ?? []).map((v) =>
            v.id === video.id
              ? {
                  ...v,
                  selection: { source: nextSource, title: episode.title },
                  progress: { source: nextSource, positionMs: 0, updatedAt: Date.now() },
                }
              : v,
          )
          set({ ...s, videos: updatedVideos })
        }
        openTab({ kind: 'video', videoId: video.id })
      },
    })
    return () => setVideoBlockHost(null)
  }, [getLatest, set, openTab])

  // 原文引用代码块（```quote）的文件内容读取与跳转：注册宿主接口
  useEffect(() => {
    setQuoteBlockHost({
      readFile: async (rawPath: string): Promise<string | null> => {
        const s = getLatest()
        let cleanPath = (rawPath ?? '').trim().replace(/\\/g, '/')
        if (!cleanPath) return null

        let decodedPath = cleanPath
        try {
          if (cleanPath.includes('%')) {
            decodedPath = decodeURIComponent(cleanPath).replace(/\\/g, '/')
          }
        } catch {}

        const uPrefix = userAbsPrefix()?.replace(/\\/g, '/')

        const tryReadOne = async (p: string): Promise<string | null> => {
          if (!p) return null
          // 1. 若落在当前用户数据目录下，优先走 readUserText
          if (uPrefix && p.startsWith(uPrefix)) {
            const rel = p.slice(uPrefix.length).replace(/^[\/]+/, '')
            try {
              const res = await readUserText(rel)
              if (res !== null) return res
            } catch {}
          }
          // 2. 若是相对路径，尝试直接当用户相对路径读
          if (!/^[a-zA-Z]:[\/]/.test(p) && !p.startsWith('/') && !p.startsWith('\\\\')) {
            try {
              const res = await readUserText(p.replace(/^[\/]+/, ''))
              if (res !== null) return res
            } catch {}
          }
          // 3. 外部本地文件读取（readLocalFile）
          try {
            const res = await readLocalFile(p)
            if (res.ok && typeof res.content === 'string') return res.content
          } catch {}
          // 4. 尝试通过 projectFs 读（处理已声明项目根内的文件）
          try {
            if (isElectron()) {
              const allRoots = (s.projects ?? [])
                .map((pr) => resolveProjectRoot(s, pr))
                .filter((r): r is string => Boolean(r))
              if (allRoots.length > 0) {
                const r = await native().projectFs({ op: 'read', path: p, roots: allRoots, encoding: 'utf8' })
                if (r.ok && r.op === 'read' && typeof r.content === 'string') return r.content
              }
            }
          } catch {}
          return null
        }

        const tryRead = async (p: string): Promise<string | null> => {
          let c = await tryReadOne(p)
          if (c !== null) return c
          try {
            if (p.includes('%')) {
              c = await tryReadOne(decodeURIComponent(p).replace(/\\/g, '/'))
              if (c !== null) return c
            }
          } catch {}
          return null
        }

        const isAbs = (p: string) => /^[a-zA-Z]:[\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

        // 绝对路径：直接测试
        if (isAbs(cleanPath) || isAbs(decodedPath)) {
          const direct = await tryRead(cleanPath)
          if (direct !== null) return direct
          if (decodedPath !== cleanPath) {
            const decRes = await tryRead(decodedPath)
            if (decRes !== null) return decRes
          }
        }

        // 收集相对路径候选
        const candidates: string[] = []
        const fRef = focusedTab(s.docArea)?.ref
        const currentViewingId = (fRef ? tabNodeId(fRef) : null) ?? s.activeNodeId
        const activeGoal = s.goals.find((g) => g.id === s.activeGoalId)
        const relevantNodeIds = new Set<string>()
        if (currentViewingId) relevantNodeIds.add(currentViewingId)
        if (s.activeNodeId) relevantNodeIds.add(s.activeNodeId)
        if (activeGoal?.rootNodeId) relevantNodeIds.add(activeGoal.rootNodeId)
        for (const n of s.nodes ?? []) {
          if (n.goalId === s.activeGoalId) relevantNodeIds.add(n.id)
        }

        const pathVariants = [cleanPath]
        if (decodedPath !== cleanPath) pathVariants.push(decodedPath)

        for (const variant of pathVariants) {
          const relPath = variant.replace(/^\.\//, '')
          const relWithoutWs = relPath.startsWith('workspace/') ? relPath.slice('workspace/'.length) : relPath

          // 1. 相关节点的工作区目录（workspace/）
          for (const nid of relevantNodeIds) {
            const wsRel = wsRelOf(s, nid)
            if (!wsRel) continue
            candidates.push(`${wsRel}/${relWithoutWs}`)
            if (uPrefix) {
              candidates.push(`${uPrefix}/${wsRel}/${relWithoutWs}`)
            }
            candidates.push(`${wsRel.replace(/\/workspace$/, '')}/${relPath}`)
            if (uPrefix) {
              candidates.push(`${uPrefix}/${wsRel.replace(/\/workspace$/, '')}/${relPath}`)
            }
          }

          // 2. 已声明的项目节点（Project Nodes）
          const candidateProjects: ProjectNodeEntity[] = []
          if (s.activeNodeId) {
            const downEdges = s.edges.filter((e) => e.from === s.activeNodeId)
            for (const e of downEdges) {
              const p = (s.projects ?? []).find((pr) => pr.id === e.to)
              if (p) candidateProjects.push(p)
            }
          }
          if (s.activeGoalId) {
            for (const pr of s.projects ?? []) {
              if (pr.goalId === s.activeGoalId && !candidateProjects.some((cp) => cp.id === pr.id)) {
                candidateProjects.push(pr)
              }
            }
          }
          for (const pr of s.projects ?? []) {
            if (!candidateProjects.some((cp) => cp.id === pr.id)) {
              candidateProjects.push(pr)
            }
          }

          for (const proj of candidateProjects) {
            const root = resolveProjectRoot(s, proj)
            if (!root) continue
            const full = root.replace(/[\\/]+$/, '') + '/' + relPath.replace(/^[\\/]+/, '')
            candidates.push(full)
          }

          // 3. 用户数据目录直接寻找
          candidates.push(relPath)
          candidates.push(`docs/${relPath}`)
          if (uPrefix) {
            candidates.push(`${uPrefix}/${relPath}`)
            candidates.push(`${uPrefix}/docs/${relPath}`)
          }
        }

        for (const cand of candidates) {
          const content = await tryRead(cand)
          if (content !== null) return content
        }

        // 4. 检查笔记挂件内容（支持引用笔记，如 @笔记/错题本 或 @错题本）
        for (const variant of pathVariants) {
          const noteTarget = variant.replace(/^(?:note|notes|笔记)[\/:]/i, '').replace(/\.md$/i, '').trim()
          for (const nid of relevantNodeIds) {
            const n = s.nodes.find((item) => item.id === nid)
            if (!n) continue
            const notes = notesOf(n)
            const foundNote = notes.find((nt) => nt.name === noteTarget || nt.name === variant)
            if (foundNote && typeof foundNote.content === 'string') return foundNote.content
          }
        }

        return null
      },
      onOpenFile: (rawPath: string, _line?: number) => {
        const s = getLatest()
        let cleanPath = (rawPath ?? '').trim().replace(/\\/g, '/')
        if (!cleanPath) return

        let decodedPath = cleanPath
        try {
          if (cleanPath.includes('%')) {
            decodedPath = decodeURIComponent(cleanPath).replace(/\\/g, '/')
          }
        } catch {}

        const isAbs = (p: string) => /^[a-zA-Z]:[\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

        let targetAbsPath: string | null = null
        if (isAbs(cleanPath)) targetAbsPath = cleanPath
        else if (isAbs(decodedPath)) targetAbsPath = decodedPath

        const uPrefix = userAbsPrefix()?.replace(/\\/g, '/')

        if (!targetAbsPath) {
          const fRef = focusedTab(s.docArea)?.ref
        const currentViewingId = (fRef ? tabNodeId(fRef) : null) ?? s.activeNodeId
          const activeGoal = s.goals.find((g) => g.id === s.activeGoalId)
          const relevantNodeIds = new Set<string>()
          if (currentViewingId) relevantNodeIds.add(currentViewingId)
          if (s.activeNodeId) relevantNodeIds.add(s.activeNodeId)
          if (activeGoal?.rootNodeId) relevantNodeIds.add(activeGoal.rootNodeId)
          for (const n of s.nodes ?? []) {
            if (n.goalId === s.activeGoalId) relevantNodeIds.add(n.id)
          }

          const relWithoutWs = cleanPath.startsWith('workspace/') ? cleanPath.slice('workspace/'.length) : cleanPath

          // 1. 优先查工作区
          for (const nid of relevantNodeIds) {
            const wsRel = wsRelOf(s, nid)
            if (!wsRel) continue
            const fullRel = `${wsRel}/${relWithoutWs}`
            const wsRef = wsRefOfRel(s, fullRel)
            if (wsRef) {
              openTab(wsRef)
              return
            }
            if (uPrefix) {
              targetAbsPath = `${uPrefix}/${fullRel}`
              break
            }
          }

          // 2. 项目节点
          if (!targetAbsPath) {
            for (const pr of s.projects ?? []) {
              const root = resolveProjectRoot(s, pr)
              if (root) {
                targetAbsPath = root.replace(/[\\/]+$/, '') + '/' + cleanPath.replace(/^[\\/]+/, '')
                break
              }
            }
          }
        }

        if (targetAbsPath) {
          if (uPrefix && targetAbsPath.startsWith(uPrefix)) {
            const rel = targetAbsPath.slice(uPrefix.length).replace(/^[\/]+/, '')
            const wsRef = wsRefOfRel(s, rel)
            if (wsRef) {
              openTab(wsRef)
              return
            }
          }
          openTab({ kind: 'local', path: targetAbsPath, title: localFileNameOf(targetAbsPath) })
        }
      },
    })
    return () => setQuoteBlockHost(null)
  }, [getLatest, openTab])

  /*
    plot 错误卡片上的「让导师修复」：以**工作流**（learn/workflows 的 plot-fix）注入——
    隐藏指令、分界条一条，不是一条普通用户消息。报错原因、字符区间与围栏原文都算好
    塞进 {{占位符}}；区间与 doc.replace 的参数同语义，agent 一轮就能改完。
    目标是当前文档的节点——不是界面上此刻激活的那个导师页签（用户可能正看着 A 课的
    文档，agent 栏开着 B 课）。登记模式与上面的 setChipOpener 相同。
  */
  useEffect(() => {
    setPlotFixHandler(({ reason, source }) => {
      const node = docNode
      const convId = node ? resolveDisplayedConversation(getLatest(), node.goalId) : null
      if (!node || !convId) {
        onToast(t('这一页没有对应的导师会话，无法自动发送'))
        return
      }
      /*
        在当前文档源码里找这段围栏的 [start, end)：start 指向 ```plot 行首，
        end 越过收尾的 ```。找不到（文档刚被改过、或这一页不是纯文本源）就如实给
        [0, 0)，指令里会让 agent 先用 doc.find 定位——别给一个看似对的错区间。
      */
      const content = docSource?.content ?? ''
      const range = findPlotFenceRange(content, source)
      agent.runWorkflow('plot-fix', {
        target: { goalId: node.goalId, nodeId: node.id, conversationId: convId },
        params: {
          nodeTitle: node.title,
          reason,
          path: nodePathOf(getLatest(), node.goalId, node.id),
          range: range ? `[${range.start}, ${range.end})` : '[0, 0)（未能自动定位，文档可能刚被改过）',
          start: range ? range.start : 0,
          end: range ? range.end : 0,
          source,
        },
      })
      onToast(t('已把报错发给导师，请看对话栏'))
    })
    return () => setPlotFixHandler(null)
  }, [docNode, getLatest, agent, onToast])

  /** 在资源管理器中定位某个目标的大纲文件（{节点}.outline.json，大纲行右键菜单用） */
  const revealOutlineFile = async (nodeId: string) => {
    const rel = nodeDocRel(getLatest(), nodeId, { kind: 'outline' })
    if (!rel) {
      onToast(t('这个目标还没有大纲文件（生成大纲之后才会有）'))
      return
    }
    await flush()
    if (!(await revealPath(rel))) onToast(t('未能在资源管理器中定位该文件'))
  }

  /** 删除前先弹确认框，避免误删：看一眼「删的是哪个、连带删掉多少」再点头 */
  const requestRemoveNode = (nodeId: string) => {
    const s = getLatest()
    const goal = s.goals.find((g) => g.id === nodeId || g.rootNodeId === nodeId)
    if (goal) {
      const goalTitle =
        goal.title ||
        goal.question ||
        (goal.rootNodeId ? nodeById(s, goal.rootNodeId)?.title : '') ||
        t('未命名目标')
      setPendingDelete({ nodeId: goal.id, title: goalTitle, isRoot: true, count: goalSubtreeSize(goal.id) })
      return
    }
    const node = nodeById(s, nodeId)
    if (!node) return
    setPendingDelete({ nodeId, title: node.title, isRoot: false, count: 1 })
  }

  /**
   * 右键菜单的「在资源管理器中打开」：定位到这个节点的正文 .md。
   *
   * 先 flush 再定位：改动是 500ms 防抖落盘的，刚写完就打开的话，
   * 文件管理器里看到的是上一版内容，甚至文件还不存在。
   */
  const revealNodeFile = async (nodeId: string) => {
    const s = getLatest()
    // 定位「这个节点此刻打开的那一份」：节点上的教学文档、或当前页签里的那份笔记
    const target =
      docSource && docNode?.id === nodeId
        ? { kind: docSource.kind, note: docSource.note }
        : { kind: 'teaching' as DocKind }
    const rel = nodeDocRel(s, nodeId, target)
    if (!rel) {
      onToast(t('这个节点还没有对应的文档文件'))
      return
    }
    await flush()
    if (!(await revealPath(rel))) onToast(t('未能在资源管理器中定位该文件'))
  }

  /**
   * 定位工作区目录里的真实文件 / 子目录（节点下「工作区」目录树的点击与右键菜单）。
   *
   * 与 revealNodeFile 同一个道理：先 flush 再定位，文件管理器里看到的才是刚写完的那一份。
   */
  const revealWsFile = async (rel: string) => {
    await flush()
    if (!(await revealUserPath(rel))) onToast(t('未能在资源管理器中定位该文件'))
  }

  /**
   * 工作区文件在页签里打开：rel（相对当前用户）反查成**内部文件页签**（`{kind:'ws'}`，
   * 见 learn/workspace 的 wsRefOfRel）。它是内部文件而不是外部文件——openTab 会先把它
   * 所属目标的那一组立起来再进门（见 groups/tabs 的 openGroupedDoc），
   * 于是「打开项目里的任何一个文件就打开关联的 tab 组」。
   * 解析不解析看后缀（md/html 有预览，其余看源码，见 learn/tabs 的 viewOf）。
   */
  const openWsFile = useCallback(
    (rel: string) => {
      const ref = wsRefOfRel(getLatest(), rel)
      if (!ref) {
        onToast(t('现在打不开这个工作区文件（它不属于任何节点的工作区）'))
        return
      }
      openTab(ref)
    },
    [getLatest, openTab, onToast],
  )

  /** 工作区里正在就地改名的那条路径（null = 没有在改名） */
  const [renamingWs, setRenamingWs] = useState<string | null>(null)

  /**
   * 工作区的新建与改名：**真实地**落在磁盘上（mkdir / 写文件 / move，见 learn/workspace）。
   *
   * 动完 notifyWsChanged()，侧栏里展开过的目录各自重列一遍。新建沿用资源管理器的习惯：
   * 先按「新建目录 / 新建文件.md」避开撞名落一个真名，再当场进输入框让用户起名；
   * 改名走 move（绝不覆盖已有目标），失败用 toast 把原因说清。
   */
  const wsActions = {
    renaming: renamingWs,
    endRename: () => setRenamingWs(null),
    startRename: (rel: string) => setRenamingWs(rel),
    create: (dirRel: string, kind: 'dir' | 'file') => {
      void (async () => {
        const taken = new Set((await listUserDir(dirRel)).map((e) => e.name))
        const name = wsAllocateName(kind === 'dir' ? t('新建目录') : t('新建文件.md'), taken)
        const rel = dirRel + '/' + name
        const done = kind === 'dir' ? await mkdirUserPath(rel) : await writeUserText(rel, '')
        if (!done) {
          onToast(t('未能创建（那里已经有同名文件或目录）'))
          return
        }
        notifyWsChanged()
        setRenamingWs(rel)
      })()
    },
    rename: (fromRel: string, toRel: string) => {
      void (async () => {
        if (!wsNameOk(localFileNameOf(toRel))) {
          onToast(t('名字不合法：不能是空的、「.」「..」或带斜杠'))
          return
        }
        if (!(await moveUserPath(fromRel, toRel))) {
          onToast(t('未能改名（那里已经有同名文件或目录）'))
          return
        }
        notifyWsChanged()
      })()
    },
    /** 拖拽移动 / 复制（Ctrl）：落到某个目录行上，把文件或整个目录搬（拷）过去。
        撞名自动避开（「新建文件 2.md」那套习惯）；目录移进它自己当场拒绝。 */
    transfer: (fromRel: string, toDirRel: string, copy: boolean) => {
      if (fromRel === toDirRel || toDirRel.startsWith(fromRel + '/')) {
        onToast(t('不能把目录移进它自己里面'))
        return
      }
      void (async () => {
        const name = localFileNameOf(fromRel)
        const taken = new Set((await listUserDir(toDirRel)).map((e) => e.name))
        const toRel = toDirRel + '/' + wsAllocateName(name, taken)
        const done = copy ? await copyUserPath(fromRel, toRel) : await moveUserPath(fromRel, toRel)
        if (!done) {
          onToast(t(copy ? '复制失败' : '移动失败'))
          return
        }
        notifyWsChanged()
        onToast(copy ? t('已复制到 {0}', toDirRel.split('/').pop() ?? '') : t('已移动到 {0}', toDirRel.split('/').pop() ?? ''))
      })()
    },
  }

  /**
   * 新建项目：在目标的工作区目录下开一个**项目目录**（真实落盘），并当场进就地改名。
   *
   * 「项目」就是工作区里的一层目录（需求原文：「新建项目是在 workspace 目录中增加一个
   * 项目目录……项目是挂载目标节点下的」）——资源管理器里目标节点展开后看到的那几行目录
   * 就是它；项目里的文件是**内部文件**（页签是 ws 型，打开就带着目标的 tab 组）。
   *
   * 与 wsActions.create('dir') 同一套习惯：先按「新建项目」避开撞名落一个真名，
   * 再让用户改名（名字就是磁盘上的目录名，改的当场是真实目录）。
   */
  const newProject = useCallback(
    (nodeId: string) => {
      const base = wsRelOf(getLatest(), nodeId)
      if (!base) {
        onToast(t('这个节点还没有工作区目录'))
        return
      }
      void (async () => {
        const taken = new Set((await listUserDir(base)).map((e) => e.name))
        const name = wsAllocateName(t('新建项目'), taken)
        const rel = base + '/' + name
        if (!(await mkdirUserPath(rel))) {
          onToast(t('未能创建项目（那里已经有同名目录）'))
          return
        }
        notifyWsChanged()
        setRenamingWs(rel)
      })()
    },
    [getLatest, onToast],
  )
  const goalSubtreeSize = (rootOrGoalId: string): number => {
    const s = getLatest()
    const goal = s.goals.find((g) => g.id === rootOrGoalId || g.rootNodeId === rootOrGoalId)
    return goal ? goalSubtreeIds(s, goal.id).size : 1
  }

  /** 删除目标/节点：含全部下级知识点、对话与试卷，先确认再删；Ctrl+Z 可撤回 */
  const commitRemoveNode = () => {
    const pending = pendingDelete
    if (!pending) return
    setPendingDelete(null)
    // 先备货再动手：撤回项捕获的是删除前那一刻的旧引用（节点本身、相连的边、试卷、会话与两本账）
    const entry = captureNodeDelete(getLatest(), pending.nodeId)
    if (entry) pushUndo(entry)
    // 目标级删除走 deleteGoal，普通节点走 deleteNode
    const nextStore = pending.isRoot
      ? deleteGoal(getLatest(), pending.nodeId)
      : deleteNode(getLatest(), pending.nodeId)
    set(fixAgentTabsAfter(nextStore))
    onToast(pending.isRoot ? t('已删除该学习目标，可按 Ctrl+Z 撤回') : t('已删除该节点，可按 Ctrl+Z 撤回'))
  }

  const generateTeachingDoc = useCallback(
    (targetNode: KnowledgeNode, hint?: string) => {
      if (!hasKey) {
        onToast(t('生成教学文档需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
        onOpenSettings()
        return
      }
      const s = getLatest()
      let convId = resolveDisplayedConversation(s, targetNode.goalId)
      if (!convId) {
        const { store: nextStore, conversation } = addConversation(s, targetNode.goalId)
        set(nextStore)
        convId = conversation.id
      }
      // hint 是发起方的意图上下文（如结构画布的「落地哪条目标项」），跟着这一轮进模型
      agent.autoTeach({ goalId: targetNode.goalId, nodeId: targetNode.id, conversationId: convId }, false, hint)
      onToast(t('已开始为「{0}」生成教学文档', targetNode.title))
    },
    [hasKey, providerName, onToast, onOpenSettings, getLatest, set, agent],
  )

  /**
   * 递给正文区的「生成教学文档」回调——**身份必须稳定**。
   *
   * DocPane / NodeNote / DocBody 都是 memo，且 DocBody 的比较器显式比了这个 prop。
   * 在渲染里现造闭包（`() => generateTeachingDoc(node)`）会让比较恒为不等，
   * 于是每次工作区渲染——包括 Agent 每一跳流式——都把当前正文整棵重渲一遍。
   * 真正的那份实现依赖 agent 等易变对象，注定每轮都是新的；这里用 ref 转发，
   * 只把「稳定的一层壳」交给 props，点下去时读到的仍是最新实现。
   */
  const generateDocRef = useRef(generateTeachingDoc)
  generateDocRef.current = generateTeachingDoc
  const requestGenerateDoc = useCallback(
    (n: KnowledgeNode) => generateDocRef.current(n),
    [],
  )

  const handleOutlineFocusHandled = useCallback(() => {
    setOutlineFocus(null)
  }, [])

  /**
   * 结构图变了：整张换上去（v2 只剩坐标表）。空表不留在 store 里——
   * `structure.json` 的空壳没有意义，读盘那一侧按「空 = 还没拖过」处理。
   */
  const updateStructure = useCallback(
    (goalId: string, next: StructureMap) => {
      const s = getLatest()
      const structure = { ...(s.structure ?? {}) }
      if (Object.keys(next.positions).length) structure[goalId] = next
      else delete structure[goalId]
      set({ ...s, structure: Object.keys(structure).length ? structure : undefined })
    },
    [getLatest, set],
  )

  /**
   * 结构画布拖出一张笔记节点时用：建一份**真实的空笔记**，把名字交回去。
   *
   * 与侧栏的「新建笔记」不同，这里**不打开页签**——用户要的是先在图上有这张卡，
   * 想写的时候点标题再打开。笔记不需要上下文，所以这一步是纯本地的、同步的。
   */
  /*
   * 节点服务（统一通道）：画布的建 / 删 / 连 / 改名与 agent 的 api.node 走的是
   * **同一个 NodeService**——画布上不再有任何「只存在于图里」的状态。目标的坐标
   * 由派生自动铺排，删除时顺手把坐标表里那条清掉（别留死键）。
   */
  const makeNodeService = useCallback(
    () => new NodeService({ getLatest, set, goalId: () => getLatest().activeGoalId ?? '' }),
    [getLatest, set],
  )

  const dropPositionOf = useCallback(
    (uuid: string) => {
      const s = getLatest()
      if (!s.structure) return
      const structure = { ...s.structure }
      let touched = false
      for (const [gid, map] of Object.entries(structure)) {
        if (!(uuid in map.positions)) continue
        const { [uuid]: _drop, ...rest } = map.positions
        structure[gid] = { ...map, positions: rest }
        touched = true
      }
      if (touched) set({ ...s, structure })
    },
    [getLatest, set],
  )

  const canvasCreateNode = useCallback(
    (kind: GNodeKind, under: string | null) => makeNodeService().create({ kind, ...(under ? { under } : {}) }),
    [makeNodeService],
  )

  /**
   * 画布垃圾桶是**用户的**删除通道，与服务那条 agent 通道共用同一套「删谁只删谁」：
   * 大纲卡删除 = 清空计划（文档与下级文档都在）；试卷卡走**用户自己的两档确认**
   * （与试卷列表同一条路：列出连带删掉什么 → 二次确认 → 可撤回），正在考的先挡下；
   * 其余走统一服务（文档只删自己，下游断线成游离）。
   */
  const canvasDeleteNode = useCallback(
    (uuid: string) => {
      const target = getLatest().exams.find((e) => e.id === uuid)
      if (target) {
        if (exam.live && exam.live.examId === uuid) {
          onToast(t('有一场考试正在进行，先把它考完或放弃'))
          return { ok: true as const }
        }
        setPendingExamDelete(target)
        setExamDeleteStage(examAttempted(target) ? 'warn' : 'final')
        return { ok: true as const }
      }
      // 删根文档 = 删整个目标（根就是目标的骨架）：从画布的删除键触发也必须走两档确认
      const goal = getLatest().goals.find((g) => g.id === uuid || g.rootNodeId === uuid)
      if (goal) {
        const node = goal.rootNodeId ? nodeById(getLatest(), goal.rootNodeId) : null
        const title = goal.title || goal.question || node?.title || uuid
        setPendingDelete({ nodeId: goal.id, title, isRoot: true, count: goalSubtreeSize(goal.id) })
        return { ok: true as const }
      }
      const r = makeNodeService().delete(uuid)
      if ('ok' in r) dropPositionOf(uuid)
      return r
    },
    [getLatest, makeNodeService, dropPositionOf, onToast, exam.live],
  )

  const canvasConnect = useCallback(
    (fromUuid: string, toUuid: string, portKey?: string) => {
      const svc = makeNodeService()
      const from = svc.get(fromUuid)
      const to = svc.get(toUuid)
      if (!from || !to) return { error: '有一个节点刚刚不在了（可能被删除）' }
      return from.connect(to, 'down', portKey)
    },
    [makeNodeService],
  )

  const canvasDisconnect = useCallback(
    (fromUuid: string, toUuid: string) => {
      const svc = makeNodeService()
      const from = svc.get(fromUuid)
      const to = svc.get(toUuid)
      if (!from || !to) return { error: '有一个节点刚刚不在了（可能被删除）' }
      return from.disconnect(to)
    },
    [makeNodeService],
  )

  const canvasRenameNote = useCallback(
    (noteUuid: string, to: string) => {
      const svc = makeNodeService()
      const node = svc.get(noteUuid)
      if (!node || node.kind !== 'note') return { error: '这份笔记已经不在了' }
      const c = node.content as { text?: string }
      return node.editContent({ title: to, text: typeof c.text === 'string' ? c.text : '' })
    },
    [makeNodeService],
  )

  const canvasAddOutlineEntry = useCallback(
    (outlineUuid: string, title: string) => {
      const svc = makeNodeService()
      const outline = svc.get(outlineUuid)
      if (!outline || outline.kind !== 'outline') return
      const current = (outline.content as { intro?: string; children?: Array<{ title: string; summary: string }> } | null) ?? null
      const r = outline.editContent({
        intro: current?.intro ?? '',
        children: [...(current?.children ?? []), { title, summary: '' }],
      })
      if ('error' in r) onToast(r.error)
      else onToast(t('已添加目标项「{0}」', title))
    },
    [makeNodeService, onToast],
  )

  /**
   * 在目标项上挂一份带标题的空文档（统一通道）：create 的同目标去重让同一标题
   * 永远指向同一份实体；只建实体不写正文——正文由「生成文档」交给 AI。
   */
  const createChildDoc = useCallback(
    (ownerNodeId: string, title: string, portKey?: string): string | null => {
      const r = makeNodeService().create({ kind: 'doc', title, under: ownerNodeId, ...(portKey ? { portKey } : {}) })
      return 'uuid' in r ? r.uuid : null
    },
    [makeNodeService],
  )

  /** 空文档卡上的「生成文档」：复用正文区那颗按钮同一条路径；hint 为画布侧的意图 */
  const generateDocForNode = useCallback(
    (nodeId: string, hint?: string) => {
      const n = nodeById(getLatest(), nodeId)
      if (n) generateDocRef.current(n, hint)
    },
    [getLatest],
  )

  /**
   * 右键「设为入口」：把一份**没有上级**的文档立为那张图的入口（目标的根）。
   * 一张图有且只有一个——换入口就是旧的退位（它还挂在图上，多半从此变成游离卡）。
   */
  const canvasSetEntry = useCallback(
    (docUuid: string) => {
      const s = getLatest()
      const node = nodeById(s, docUuid)
      if (!node) return { error: t('这份文档已经不在了') }
      const goal = s.goals.find((g) => g.id === node.goalId)
      if (!goal) return { error: t('这个文档不属于任何学习目标') }
      if (goal.rootNodeId === docUuid) return { error: t('它已经是入口了') }
      if (s.edges.some((e) => e.to === docUuid)) {
        return { error: t('「{0}」已经有上级了——只有没有上级的文档能立为入口', node.title) }
      }
      set({ ...s, goals: s.goals.map((g) => (g.id === goal.id ? { ...g, rootNodeId: docUuid, updatedAt: Date.now() } : g)) })
      return { ok: true, note: t('已把「{0}」立为入口：这门课从这里开始（原入口文档还在图上）', node.title) }
    },
    [getLatest, set],
  )

  /** 画布统一通道（一个稳定对象：OutlinePane 按 referential equality 冻结比较） */
  const canvasChannel = useMemo(
    () => ({
      onCreateNode: canvasCreateNode,
      onDeleteNode: canvasDeleteNode,
      onConnect: canvasConnect,
      onDisconnect: canvasDisconnect,
      onSetEntry: canvasSetEntry,
      onCreateChildDoc: createChildDoc,
      onRenameNote: canvasRenameNote,
      onAddOutlineEntry: canvasAddOutlineEntry,
      onGenerateDoc: generateDocForNode,
      onGenerateOutline: (docUuid: string) => startPrereqOutline(docUuid),
      // 视频卡的绑定 / 打开：绑定走节点的 editContent（与 agent 动手是同一条路），打开走 openTab 的组联动
      onBindVideo: (nodeUuid: string, videoId: string | null) => {
        const node = makeNodeService().get(nodeUuid)
        if (!node || node.kind !== 'video') return { error: '这个视频节点已经不在了' }
        return node.editContent({ videoId })
      },
      // 项目卡的路径声明：同样走节点对象的 editContent（与 agent 同一条路），拼法由路径
      // 自己说（盘符 / / 开头 = 绝对）。保存成功后把**还不存在的目录**建出来——相对路径
      // 第一次用最常见的场景就是新建一个项目目录；解析不出根（如数据根未就绪）时跳过，
      // 第一次读写时主进程会把原因讲清楚。
      onSetProjectPath: async (nodeUuid: string, path: string) => {
        const node = makeNodeService().get(nodeUuid)
        if (!node || node.kind !== 'project') return { error: '这个项目节点已经不在了' }
        const r = node.editContent({ path })
        if ('error' in r) return r
        const entity = getLatest().projects?.find((p) => p.id === nodeUuid)
        const root = entity ? resolveProjectRoot(getLatest(), entity) : null
        if (root) {
          try {
            await native().projectFs({ op: 'mkdir', roots: [root], path: root })
          } catch {
            // 建不出来不阻断保存：卡上与第一次读写时都会有清楚的说法
          }
        }
        return r
      },
      // 点项目卡目录树里的一个文件：本地文件页签打开（TabRef.local 认磁盘绝对路径）
      onOpenProjectFile: (absPath: string) => {
        const name = absPath.split(/[\\/]/).pop() || absPath
        openTab({ kind: 'local', path: absPath, title: name })
      },
      onOpenVideo: (videoId: string) => openTab({ kind: 'video', videoId }),
      onGenerateVideoDoc: (videoNodeUuid: string) => startVideoOverview(videoNodeUuid),
    }),
    [canvasCreateNode, canvasDeleteNode, canvasConnect, canvasDisconnect, canvasSetEntry, createChildDoc, canvasRenameNote, canvasAddOutlineEntry, generateDocForNode, startPrereqOutline, startVideoOverview, makeNodeService, openTab, getLatest, set],
  )

  const noteActionsCache = useRef(new Map<string, ComponentProps<typeof DocPane>['note']>())
  const getNoteActions = useCallback(
    (tabId: string, node: KnowledgeNode, source: DocSource): ComponentProps<typeof DocPane>['note'] => {
      /*
       * 缓存键带上页签 id：暂存区是**按页签**记的（同一份文档在两格各开一份，
       * 改的是各格自己那一份），所以「改正文」这条回调必须认页签，不能只认文档。
       */
      const key = `${tabId}:${node.id}:${source.kind}:${source.note ?? ''}`
      let actions = noteActionsCache.current.get(key)
      if (!actions) {
        actions = {
          onLearnConcept: (term) => void openConcept(node.id, term),
          resolveLocalImage: nodeImageResolver(node.id, source.kind, source.note),
          onUnderstand: (term, occurrence, snippet) => understandConcept(node.id, term, occurrence, snippet),
          onSaveAnnotation: (term, body, style, occurrence) =>
            saveAnnotation(node.id, term, body, style, occurrence),
          onDeleteAnnotation: (term) => deleteAnnotation(node.id, term),
          onWarn: onToast,
          onAsk: (payload) => askAboutSelection(node.id, payload),
          // 正文右键菜单的「粘贴」：改动进暂存区，与在源码视图里改是同一套（见 learn/drafts）
          onEditContent: (next) => editDocSource(tabId, next),
          /*
           * 正文右键菜单的「定位源码」：先放下「选中哪一段」，再把这个页签切到源码视图。
           * 顺序不能反——切完视图预览就卸载了，选区也随之消失（见 lib/docReveal）。
           */
          onRevealSource: (loc) => {
            requestSourceReveal(nodeRevealKey(node.id, source.kind, source.note), loc.start, loc.end)
            setTabView(tabId, 'source')
          },
        }
        noteActionsCache.current.set(key, actions)
      }
      return actions
    },
    [openConcept, nodeImageResolver, understandConcept, saveAnnotation, deleteAnnotation, onToast, askAboutSelection, getLatest, patchQuiet, editDocSource, setTabView],
  )

  // 保存：Ctrl+S 交给快捷键模块（见 lib/shortcuts）——改键与冲突检测都归它管，
  // 写死在这里的话，用户在设置里改的那一条就成了一句空话。
  // 保存的是**当前这份文档**：暂存区里的改动写进文档并落盘（见 saveDocNow）
  useShortcut('learn.save', {
    down: () => {
      void saveDocNow()
    },
  })

  /*
   * 文档区查找（Ctrl+F）与替换（Ctrl+H）。
   *
   * 走快捷键注册表而不是各自 addEventListener：这样它们出现在设置里、可改键、
   * 也参与冲突检测（见 lib/shortcuts）。焦点在输入框里时也照样触发——
   * Ctrl 组合键不会和打字冲突（见 shouldFire）。
   */
  useShortcut('doc.find', {
    down: () => {
      setFindMode('find')
      setFindTick((n) => n + 1)
    },
  })
  useShortcut('doc.replace', {
    down: () => {
      setFindMode('replace')
      setFindTick((n) => n + 1)
    },
  })

  // 导出文档（Ctrl+E）：与查找/替换同一条路——登记在快捷键注册表里，可改键、参与冲突检测。
  // 快捷键导的是**焦点格**那一篇（悬浮组里那颗按钮导的是它所在的那一格，见 openExport）
  useShortcut('doc.export', { down: () => openExport(getLatest().docArea.focus) })

  /*
   * Ctrl+W：关掉**焦点格**里正看着的那个页签。
   *
   * 走的是页签上那颗 × 的同一条路（closeTab）：有没保存的改动时照旧先问一声，
   * 关完之后停在哪一个也算得一样——快捷键只是那颗按钮的另一种按法，不该有第二套规矩。
   */
  useShortcut('learn.closeTab', {
    down: () => {
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      if (!group?.active) return
      closeTab(group.id, group.active, 'self')
    },
  })

  /*
   * Ctrl+Q：它的名字是「聚焦导师」，动作是**切换**右侧栏。
   *
   * 导师栏在**右侧栏**时：收着就展开，并把光标放进输入框——弹出来的东西就是要跟你
   * 说话的那个，再让你去点一下输入框是白费一步。展开是 300ms 补间，而收着的那一栏
   * 是 invisible（见 SplitRow）：光标此刻落进去也看不见，所以等补间走完、面板真的
   * 现形了再把焦点放进去。已经展开的再一次就是收起。
   * 导师栏占着**主位**时：收起 / 展开右侧那一栏（与骑线按钮同一件事）。
   * 纯净阅读里**不响应**：那一格此刻已经从布局里让出去了，没有「右侧栏」可收可展——
   * 照旧执行会有两个坏结果：退出纯净阅读后栏位状态被悄悄改了（用户没看见这一下），
   * 而导师栏正占着右边那一格时，它会当场顶回屏幕、盖在正文上。
   */
  useShortcut('agent.focus', {
    down: () => {
      if (pure) return
      if (!agentLeft) {
        if (sideCollapsed) {
          expandSide()
          window.setTimeout(focusAgentInput, SIDE_ANIM_MS)
        } else {
          toggleSide()
        }
        return
      }
      toggleSide()
    },
  })

  /*
   * F11：纯净阅读（见上面 toggleZen 的说明）。
   *
   * 登记在快捷键表里而不是自己 addEventListener：它因此出现在设置里、可改键、
   * 也参与冲突检测（见 lib/shortcuts）。**单独一个 F 键在输入框里也照样触发**
   * ——光标在源码编辑器或对话栏里时按 F11 也得有反应，那条放行写在 shouldFire 里。
   * 顺带一提，主进程那份菜单里的「全屏」已经不挂 F11 了（见 electron/app/icon.ts）：
   * 菜单加速键会先把按键吃掉，不摘掉它，这里永远收不到。
   */
  useShortcut('doc.zen', { down: () => toggleZen() })

  /*
   * Ctrl+L：新建网页页签（浏览器的肌肉记忆）。
   * 焦点格已经看着一个网页时不开第二枚，把光标挪进它的地址栏——输入、回车、直达。
   */
  useShortcut('web.newTab', {
    down: () => {
      if (isWeb()) return
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      const active = group?.tabs.find((x) => x.id === group.active)
      if (active?.ref.kind === 'web') focusWebAddress()
      else openWebTab('')
    },
  })

  /**
   * 鼠标侧键前进 / 后退（Back / Forward 按钮）切换当前显示的页签：
   *
   * 绝大多数五键鼠标带有侧边双键（常见为大拇指侧的前进与后退键）：
   * - 侧键后退（MouseEvent e.button === 3 或系统键盘事件 BrowserBack / AppBack）：向左切换上一个页签；
   * - 侧键前进（MouseEvent e.button === 4 或系统键盘事件 BrowserForward / AppForward）：向右切换下一个页签。
   *
   * 全局捕获并 preventDefault() 阻止 Chromium 默认的网页路由历史跳转，
   * 并在当前分屏组或工作区全部页签内前后循环切换，自然伴随过场滑入动效。
   */
  const stepActiveTab = useCallback(
    (direction: 'back' | 'forward') => {
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      if (!group) return

      // 1. 若当前焦点格有多个页签，在当前格内循环切换
      if (group.tabs.length > 1) {
        const curIdx = group.tabs.findIndex((t) => t.id === group.active)
        const idx = curIdx >= 0 ? curIdx : 0
        const nextIdx =
          direction === 'back'
            ? (idx - 1 + group.tabs.length) % group.tabs.length
            : (idx + 1) % group.tabs.length
        activateTab(group.tabs[nextIdx].id)
        return
      }

      // 2. 兜底：若当前格仅有 1 个页签，但工作区内有多个页签（跨格分屏时）
      const all = allTabs(s.docArea)
      if (all.length > 1) {
        const curIdx = all.findIndex((t) => t.id === activeTabId)
        const idx = curIdx >= 0 ? curIdx : 0
        const nextIdx =
          direction === 'back'
            ? (idx - 1 + all.length) % all.length
            : (idx + 1) % all.length
        activateTab(all[nextIdx].id)
      }
    },
    [getLatest, activateTab, activeTabId],
  )

  useEffect(() => {
    let lastNavTime = 0
    const trigger = (dir: 'back' | 'forward') => {
      const now = Date.now()
      if (now - lastNavTime < 160) return
      lastNavTime = now
      stepActiveTab(dir)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        e.stopPropagation()
        trigger('back')
      } else if (e.button === 4) {
        e.preventDefault()
        e.stopPropagation()
        trigger('forward')
      }
    }

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'BrowserBack' || e.key === 'AppBack' || e.code === 'BrowserBack') {
        e.preventDefault()
        e.stopPropagation()
        trigger('back')
      } else if (e.key === 'BrowserForward' || e.key === 'AppForward' || e.code === 'BrowserForward') {
        e.preventDefault()
        e.stopPropagation()
        trigger('forward')
      }
    }

    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('auxclick', onAuxClick, true)
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('auxclick', onAuxClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [stepActiveTab])

  /*
   * 文档区分屏（页签拖拽与格间分割线）整体在 useTabDnd（workspace/）。
   * zoneAt 只被它自己的两个回调消费，这里不解构。
   */
  const {
    tabDrag,
    splitDrag,
    groupHosts,
    stripHosts,
    onTabDragMove,
    onTabDrop,
    beginSplitDrag,
  } = useTabDnd({ getLatest, set })

  /**
   * 一格的完整内容：页签栏 → 节点提示 → 正文 → 右上角悬浮组。
   *
   * 「每个视图都有自己的 tab 栏」那条需求就落在这里：分割出来的每一格都是**自足的一份**——
   * 自己的页签栏、自己显示的文档、自己的视图开关与导出。
   *
   * 写成普通函数而不是组件：它要用到组件里几十个闭包（保存、注解、导出、工作流…），
   * 拆成组件就得把这几十样逐个透传一遍，而它本来就只在这一次渲染里用（每格一次）。
   */
  /**
   * 把一枚引用开进指定分组。页签栏（TabBar 的 onDropChip）与正文区任意位置的 chip
   * 落点共用这一条路——拖到文档区直接打开，不必再瞄准那条窄页签栏。
   */
  const openChipInGroup = (groupId: string) => (p: ChipPayload) => {
    const s = getLatest()
    const rawRef = tabRefFromChip(s, p)
    if (!rawRef) return
    let ref = rawRef
    const initialNodeId = tabNodeId(ref)
    const initialNode = initialNodeId ? nodeById(s, initialNodeId) : undefined
    if (ref.kind === 'outline' && initialNode) {
      const goal = s.goals.find((g) => g.id === initialNode.goalId)
      if (goal && ref.nodeId !== goal.rootNodeId) {
        setOutlineFocus({ nodeId: ref.nodeId, nonce: Date.now() })
        ref = { kind: 'outline', nodeId: goal.rootNodeId }
      }
    }
    const nodeId = tabNodeId(ref)
    const base = nodeId ? retargetNode(s, nodeId) : s
    const goalOf = (id: string) => nodeById(base, id)?.goalId ?? null
    /** 「目标 → 根节点」：组锚判据的第二跳（见 groups/tabs 的 isAnchorOutline） */
    const rootOf = (goalId: string) => base.goals.find((g) => g.id === goalId)?.rootNodeId ?? null
    /*
     * 与 openTab 同一条分派：组关联的文档（教学文档 / 工作区内部文件）先过它的「组」——
     * 拖放明确落在哪一格，文档就进哪一格（into 传 groupId；组可以横跨几格，见 groups/goals
     * 的说明）；组锚大纲带着停靠组归队；阶段大纲与其余页签都是普通开法。
     */
    const docArea =
      nodeId && ref.kind !== 'outline'
        ? openGroupedDoc(base.docArea, ref as TabRef & { nodeId: string }, rootOf(goalOf(nodeId) ?? ''), goalOf, Date.now(), undefined, groupId)
        : ref.kind === 'outline'
          ? isAnchorOutline(ref, goalOf, rootOf)
            ? openAnchorOutline(base.docArea, groupId, ref, goalOf, Date.now())
            : openOutlineTab(base.docArea, groupId, ref, goalOf, Date.now())
          : openInGroup(base.docArea, groupId, ref, Date.now(), undefined, goalOf)
    /*
     * 登记归属（与 openTab 同一行；漏登记的话这枚页签在归属表里查无此人，
     * 切目标时到处飘、关锚时也收不利索）。
     */
    set({ ...base, docArea: withOwners(docArea, claimTab(docArea.tabOwners, refOwner(ref, goalOf), tabKey(ref))) })
  }

  /**
   * 在当前空白页签中就地替换打开一个目标页签；
   * 如果该目标已经存在，则直接跳转到它并关闭当前空白页签。
   */
  const openInPlace = useCallback(
    (groupId: string, currentTabId: string, targetRef: TabRef) => {
      const s = getLatest()
      const targetId = tabKey(targetRef)
      const existingGroup = groupIdOfTab(s.docArea, targetId)
      if (existingGroup) {
        // 如果已经存在：跳转到它，并关闭自身空白页签
        let docArea = closeIn(s.docArea, groupId, currentTabId, 'self')
        const targetGroup = groupIdOfTab(docArea, targetId)
        if (targetGroup) {
          docArea = activateIn(docArea, targetGroup, targetId)
        }
        const nodeId = tabNodeId(targetRef)
        const base = nodeId ? retargetNode(s, nodeId) : s
        set({ ...base, docArea })
        return
      }
      // 不存在：在本页签快速打开（替换当前页签）
      const docArea = settle(
        withGroup(s.docArea, groupId, (g) => ({
          ...g,
          tabs: g.tabs.map((t) => (t.id === currentTabId ? makeTab(targetRef, t.createdAt) : t)),
          active: targetId,
        })),
      )
      const nodeId = tabNodeId(targetRef)
      const base = nodeId ? retargetNode(s, nodeId) : s
      set({ ...base, docArea })
    },
    [getLatest, retargetNode, set],
  )

  const openWebInPlace = useCallback(
    (groupId: string, currentTabId: string) => {
      if (isWeb()) return
      openInPlace(groupId, currentTabId, { kind: 'web', url: '', key: newWebKey() })
    },
    [openInPlace],
  )

  const openNewGoalInPlace = useCallback(
    (_groupId: string, _currentTabId: string) => {
      setCreateGoalOpen(true)
    },
    [],
  )

  /**
   * 新建文件：把当前这枚空白页签**就地**换成新建文件页签（见 learn/types 的 draft）。
   *
   * 为什么是就地换而不是新开一枚：用户点的就是「新页签」那一页上的按钮，他想要的是
   * 「这一页变成能写字的地方」，而不是「再多一枚页签、还留着一枚空白的」。
   * 这也顺带保住了「一个栏只有一枚新页签」那条规矩——不换的话，那枚占位还留着。
   */
  const openNewFileInPlace = useCallback(
    (groupId: string, currentTabId: string) => {
      openInPlace(groupId, currentTabId, { kind: 'draft', key: newDraftKey() })
    },
    [openInPlace],
  )

  const pickLocalInPlace = useCallback(
    async (groupId: string, currentTabId: string) => {
      const paths = await pickLocalFiles()
      if (!paths.length) return
      const s = getLatest()
      let next = { ...s, localFiles: addLocalFile(s.localFiles, paths[0], Date.now()) }
      for (let i = 1; i < paths.length; i++) {
        next = { ...next, localFiles: addLocalFile(next.localFiles, paths[i], Date.now() + i) }
      }
      const firstRef: TabRef = { kind: 'local', path: paths[0] }
      const firstId = tabKey(firstRef)
      const existingGroup = groupIdOfTab(next.docArea, firstId)
      let docArea = next.docArea
      if (existingGroup) {
        docArea = closeIn(docArea, groupId, currentTabId, 'self')
        const targetGroup = groupIdOfTab(docArea, firstId)
        if (targetGroup) {
          docArea = activateIn(docArea, targetGroup, firstId)
        }
      } else {
        docArea = settle(
          withGroup(docArea, groupId, (g) => ({
            ...g,
            tabs: g.tabs.map((t) => (t.id === currentTabId ? makeTab(firstRef, t.createdAt) : t)),
            active: firstId,
          })),
        )
      }
      let at = Date.now() + 10
      for (let i = 1; i < paths.length; i++) {
        docArea = openInGroup(docArea, groupId, { kind: 'local', path: paths[i] }, at++, undefined, (id) => nodeById(next, id)?.goalId ?? null)
      }
      set({ ...next, docArea })
    },
    [getLatest, set],
  )

  const renderGroup = (groupId: string) => {
    const g = paneInfo(store, docs, groupId, examTabTitle)
    const dg = g
    const gTab = g.tab
    /** 这一格显示的页签 id；回调里用（TS 的收窄穿不进闭包，见下面几处 onChange） */
    const gTabId = gTab?.id ?? ''
    /** 网页页签携带的 URL：闭包里用（TS 的收窄穿不进闭包） */
    const gWebUrl = gTab?.ref.kind === 'web' ? gTab.ref.url : ''
    const isFocused = groupId === docs.focus
    const gExam = examCopyOf(store, gTab)
    const panes = residentPanes.filter((p) => p.group === groupId)
    /**
     * 这一格**看得见**的页签：公共 + 当前目标，且本目标的排在前面（见 groups/goals）。
     *
     * 页签实体仍全部住在 groups 里（切目标不关页签，切回来原样还在），
     * 这里只是决定「这一格现在把哪几张画在栏上」——所以它同时是页签栏的顺序来源。
     */
    const gVisibleTabs = focusTabsInGroup(
      (g.group?.tabs ?? []).filter((t) => shownTabIds.has(t.id)),
      tabOwners,
      activeGoalId,
    )
    /** 这一格挂着的网页页签：WebTabLayer 常驻层只挂一份，切页签只藏不卸（见下） */
    const gWebTabs = gVisibleTabs.filter((x): x is WebTab => x.ref.kind === 'web')
    /** 这一格挂着的视频页签（含创建态）：VideoTabLayer 常驻，切页签只藏不卸（用户定的 keepalive） */
    const gVideoTabs = (g.group?.tabs ?? []).filter((x): x is VideoTab => x.ref.kind === 'video')
    /** 这一格挂着的大纲页签：keepalive 常驻，切页签只藏不卸，切回时保留导图相机视角与选中状态 */
    const gOutlineTabs = (g.group?.tabs ?? []).filter(
      (x): x is LearnTab & { ref: { kind: 'outline'; nodeId: string; goalId?: string } } => x.ref.kind === 'outline',
    )
    /** 这一格的正文层：切页签的过场、查找条与数据属性都挂在它身上 */
    const boxProps = {
      'data-doc-area': groupId,
      // 焦点格的额外标记：ui.scroll / ui.dom / 导出抓图都只认它（见 lib/docDom）
      'data-doc-area-focus': isFocused ? '' : undefined,
    }
    return (
      <div
        key={groupId}
        ref={(el) => {
          if (el) groupHosts.current.set(groupId, el)
          else groupHosts.current.delete(groupId)
        }}
        /*
         * 指针落在哪一格，焦点就挪到哪一格：ui.dom、Ctrl+S、导出、下一页签都跟着焦点走。
         * 挂在**捕获之外的这一层**（冒泡到这里时正文自己那套处理已经跑完），只改状态、不拦事件。
         */
        onPointerDown={() => {
          const s = getLatest()
          if (s.docArea.focus !== groupId) set({ ...s, docArea: setFocus(s.docArea, groupId) })
        }}
        /*
         * 整格铺 bg-paper：文档、设置、用量、守卫报告……各类页签的正文底色共用这同一层。
         * 有的页签内容自己不带背景（用量页、空格子），不铺的话它们会露出更底层的深色，
         * 切页签时整个文档区一明一暗地跳。
         */
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-paper"
      >
        {/*
          页签栏：纯净阅读时整条收起。

          手法是「格子高度闭合 + 整条向上滑出去」两件事同时做：
          - 高度交给 grid-template-rows 的 1fr → 0fr 补间（Chrome 107 起可补间），
            这样不必去量页签栏此刻多高——它是随页签内容变的；
          - 内容自己 translateY(-100%) 从顶边滑出去，于是看着是「收上去」而不是「被压扁」。

          裁溢出（用的是 overflow-clip，理由见下）**只在收起与补间期间**加：平时必须放开，
          页签顶上那颗棱形（见 TabBar 的 measureMark）是探出栏外的，裁了就没了。
          棱形在补间里确实会被裁掉——它本来就在最上沿，是第一个滑出去的，看不见也不突兀。
        */}
        <div
          className={
            'grid shrink-0 grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-300 ease-out ' +
            (pure ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]')
          }
        >
          {/*
            列轨必须锁成 minmax(0,1fr)：不写列模板时隐式轨道按内容的 max-content 取宽，
            而页签是 shrink-0 的——页签一多轨道就把整条 grid 撑得比文档列更宽，
            页签条的 overflow-x-auto 永远等不到触发的机会，页签直接画进隔壁导师栏。
            锁住之后轨道宽 = 文档列宽，页签超了才真正「溢出」，滚动接管。

            裁溢出用 overflow-clip 而不是 hidden：hidden 会生成一个滚动容器，
            里面那些页签按钮一旦被 Tab 聚焦，这一格就会被滚走（同 NoteDialog 的取舍）。
          */}
          <div className={'min-h-0 ' + (pure || pureMoving ? 'overflow-clip' : '')}>
            {/*
              invisible 与位移一起走：滑出去之后整条栏还在 DOM 里（页签、关闭键都在），
              不加它，Tab 键还会一个个跳进那些看不见的按钮里。
              visibility 参与补间是「到末尾才真的切过去」，所以它是等滑完了才失效的
              （与右侧栏收起时的做法一致，见 SplitRow）。
            */}
            <div
              className={
                'transition-[transform,visibility] duration-300 ease-out ' +
                (pure ? '-translate-y-full invisible' : '')
              }
            >
              <TabBar
                tabs={gVisibleTabs}
                paneTotal={g.group?.tabs.length}
                activeId={g.group?.active ?? null}
                titleOf={(ref) =>
                  tabTitle(ref, (id) => nodeById(store, id)?.title, examTabTitle, (vid) => store.videos?.find((v) => v.id === vid)?.title)
                }
                trailOf={(ref) => tabTrails[tabKey(ref)] ?? ''}
                onActivate={activateTab}
                onClose={(id, mode, opts) => closeTab(groupId, id, mode, opts)}
                onReorder={(ids) => reorderTabList(groupId, ids)}
                unsaved={unsavedIds}
                onDragMove={onTabDragMove}
                onStripHost={(el) => {
                  if (el) stripHosts.current.set(groupId, el)
                  else stripHosts.current.delete(groupId)
                }}
                // 上层只认坐标（它知道别的格在哪），TabBar 交出落点那一刻的指针位置
                onDrop={(tabId, _ids, x, y, commit) => onTabDrop(tabId, x, y, commit)}
                // 页签拖进对话输入框时交给它的那份信息（路径信息在这里算，TabBar 不认得 store）
                docPayloadOf={tabDocPayload}
                // web 页签的活标题/站点图标（加载完才有，见 WebTabMeta）
                webMetaOf={(tab) => (tab.ref.kind === 'web' ? webMeta[tab.id] : undefined)}
                // 右键菜单的收藏/取消收藏（见 learn/favorites）
                favoriteOf={isTabFavorite}
                onToggleFavorite={toggleTabFavorite}
                // 资源管理器/外部拖进来的引用落在这一格的页签栏上：还原成页签开在这一格里
                onDropChip={openChipInGroup(groupId)}
                // 棱形只在焦点格的栏上跟着右键走（见 lib/tabMark）
                focused={isFocused}
                // 栏上空白处的右键菜单要开新网页页签（见 TabBar 的 BarMenu）；WebUI 模式下不提供
                onOpenWebTab={isWeb() ? undefined : () => openWebTab('')}
                // 「新页签」就长在最后一枚页签后面（原先在顶栏，见 TabBar 的 onNewTab）
                onNewTab={() => openBlankTab()}
                store={store}
              />
            </div>
          </div>
        </div>

        {/*
          文档内容 + 右上角悬浮组。悬浮组是绝对定位的，所以这一层必须 relative，
          并且它是**唯一**能被悬浮组盖住的地方——它不会跑到页签栏或对话栏上去。
        */}
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          onPointerDown={onDocPointerDown}
          onContextMenu={(e) => {
            // 刚用右键划过：这一下 contextmenu 是那趟划动的尾巴，不是「要上下文」
            if (!docMarkMoved.current) return
            docMarkMoved.current = false
            e.preventDefault()
            e.stopPropagation()
          }}
        >
            <div
              ref={isFocused ? docBox : undefined}
              {...boxProps}
              className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
              onDragOver={(e) => {
              // 整个正文区都是 chip 的落点：资源管理器 / 收藏里拖来的引用，拖到这里
              // 直接开成本格的页签（不必再瞄准上面那条窄页签栏）。系统文件拖入
              // （dataTransfer.files）走 window 级的监听，这里只认 chip。
              if (!e.dataTransfer.types.includes(CHIP_MIME)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(CHIP_MIME)
              if (!raw) return
              e.preventDefault()
              const p = parseChipJson(raw)
              if (p) openChipInGroup(groupId)(p)
            }}
            onDoubleClick={(e) => {
              /*
                快速双击 = 切换纯净阅读（与右上角那颗按钮、F11 同一件事）。
                双击在文字上本来就是「选一个词」：**命中的是词本身**（指针落在选区矩形里）
                就不当开关，不然读正文时随手双击一个词就进出了。要靠选区矩形而不是
                「选区空不空」来判：点在段落空白 / 行边距上时，Chromium 会顺手选中最邻近
                的词——选区非空，但那个词不在指针底下，这次双击该归开关。
                点在按钮 / 输入框 / 链接这类可交互的东西上也不算。
                超级文档是 iframe，guest 里的事件到不了这里，天然不受影响。
              */
              const sel = window.getSelection()
              if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
                const r = sel.getRangeAt(0).getBoundingClientRect()
                if (
                  e.clientX >= r.left - 2 &&
                  e.clientX <= r.right + 2 &&
                  e.clientY >= r.top - 2 &&
                  e.clientY <= r.bottom + 2
                ) {
                  return
                }
                // 顺手选中的那个词不是用户要的：清掉，别让切换后还挂着一截蓝
                sel.removeAllRanges()
              }
              const el = e.target as HTMLElement
              if (el.closest('button, input, textarea, a, iframe, [contenteditable="true"], [role="button"]')) return
              toggleZen()
            }}
          >
            {gTab?.ref.kind === 'web' ? (
              /*
                网页页签：正文不归 React 画（guest 进程自己渲染），由下面挂着的
                WebTabLayer 常驻层显示——这里只让出位置，别画任何东西。
                WebUI 模式下不支持内置浏览器，展示在当前浏览器中打开的引导卡片。
              */
              isWeb() ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center select-none">
                  <Globe size={32} className="text-seal/70" />
                  <div className="text-[14px] font-semibold text-ink-strong">{t('WebUI 模式不支持内置浏览器')}</div>
                  <p className="max-w-md text-[12px] text-ink-faint">
                    {gWebUrl ? t('该网页可在当前浏览器新标签页中打开访问。') : t('WebUI 模式下请直接在当前浏览器中浏览网页。')}
                  </p>
                  {gWebUrl && (
                    <button
                      type="button"
                      onClick={() => void openExternalLink(gWebUrl)}
                      className="flex items-center gap-1.5 rounded-lg bg-seal px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-seal-deep cursor-pointer"
                    >
                      <ExternalLink size={13} />
                      {t('在当前浏览器打开')}
                    </button>
                  )}
                </div>
              ) : null
            ) : gTab?.ref.kind === 'blank' ? (
              /*
                空白页签（底页）：显示无页签引导卡片（打开本地文件 / 浏览网络 / 新建目标），
                并在当前页签中快速就地打开。
              */
              <EmptyDoc
                onNewFile={() => openNewFileInPlace(groupId, gTab.id)}
                onPickLocal={() => void pickLocalInPlace(groupId, gTab.id)}
                onOpenWeb={isWeb() ? undefined : () => openWebInPlace(groupId, gTab.id)}
                onNewGoal={() => openNewGoalInPlace(groupId, gTab.id)}
                hasGoals={(store.goals ?? []).length > 0}
                // 收藏 / 最近打开两栏（原侧栏的「最近打开」区挪到这里，见 EmptyDoc）
                favorites={store.favorites ?? []}
                favoriteTitleOf={favoriteTitleOf}
                onOpenFavorite={openFavorite}
                recents={blankRecents}
                onOpenRecent={openRecent}
              />

            ) : gTab?.ref.kind === 'schedule' ? (
              /*
                日程安排页：用户级的一张提醒清单（见 learn/schedule）。全局一枚页签，
                入口在顶栏日程 tip 与到点提醒弹层；页面自己只管展示与编辑态，写操作
                全部经 scheduleActions 交回这一层。
              */
              <SchedulePage
                store={store}
                actions={scheduleActions}
                onToast={onToast}
                ringingId={scheduleRinging?.id ?? null}
              />
            ) : gTab?.ref.kind === 'usage' ? (
              /*
                用量统计：独立的一枚页签（入口在顶栏用户菜单）。它读的是「台账」
                （ai/usageLog）而不是配置，所以不挤在设置里；页面自己订阅台账重渲染。
              */
              <UsagePanel />
            ) : gTab?.ref.kind === 'video' ? (
              /*
                视频页签：由下面的 VideoTabLayer 常驻层画（切页签只藏不卸，
                播放与已解析的流都留着）。这里只让出位置，别画任何东西。
              */
              null
            ) : gTab?.ref.kind === 'pluginDoc' ? (
              /*
                插件开发文档（设置 → 插件里的入口打开）：契约说明 + 导出 .md。
                静态内容，没有会话态（见 components/plugins/PluginDoc）。
              */
              <PluginDoc />
            ) : gTab?.ref.kind === 'settings' ? (
              /*
                设置面板：文档区的一枚页签（不再是弹窗）。全局只有这一份（tabKey 恒定），
                从任何入口打开都是切到它；分页与内容都在面板内部（见 settings/SettingsPanel）。
              */
              <SettingsPanel
                onRootChanged={onRootChanged}
                onToast={onToast}
                scheduleSound={store.schedule?.sound}
                onScheduleSoundChange={scheduleActions.setSound}
              />
            ) : gTab?.ref.kind === 'mind' ? (
              /*
                记忆管理：导师写下的记忆（learn/memory）的查看与编辑。**一枚目标一枚页签**
                （tabKey = 'm:' + goalId），打开时默认筛到该目标的工作记忆；长期记忆跨目标，
                这一页也看得到。目标删掉时页签一起关（见 deleteGoal）。
                界面与设置页里的「记忆管理」是同一份实现（components/agent/MemoryManager）。
              */
              <MindPanel
                goalId={gTab.ref.goalId}
                goals={store.goals}
                memory={store.memory ?? { long: [], work: {} }}
                onCreate={memoryCreate}
                onUpdate={memoryUpdate}
                onDelete={memoryDelete}
                onClearWork={memoryClearWork}
                onToast={onToast}
              />
            ) : gTab?.ref.kind === 'agentSettings' ? (
              /*
                超级导师设置：原先是弹窗，现在是文档区的一枚页签。数据是 agent/settings
                那一份（与全局设置分开），改动当场生效。
              */
              <AgentSettingsPanel
                settings={agentSettings}
                hasKey={hasKey}
                model={globalSummary()}
                onChange={(next) => {
                  saveAgentSettings(next)
                  onToast(t('超级导师设置已保存'))
                }}
                onOpenContextDebugger={() => debugWin.setOpen(true)}
                onOpenContextTrace={openContextTrace}
                flowRows={workflowRows}
                onRunWorkflow={runWorkflowRow}
                onRemoveWorkflow={removeWorkflowRow}
                goals={store.goals}
                memory={store.memory ?? { long: [], work: {} }}
                activeGoalId={activeGoalId}
                onMemoryCreate={memoryCreate}
                onMemoryUpdate={memoryUpdate}
                onMemoryDelete={memoryDelete}
                onMemoryClearWork={memoryClearWork}
                onToast={onToast}
              />
            ) : gTab?.ref.kind === 'draft' ? (
              /*
                新建文件：还没有落点、也没有类型的那一份正文（见 DraftDoc）。
                正文住在暂存区里（基准是空文档），保存那一步才问路径与文件名，
                后缀一确定，这枚页签当场换成指向那个文件的本地文件页签。
                没有 key：它不指向任何外部东西，也就没有「重挂重读」这回事。
              */
              <DraftDoc
                draft={dg.draft}
                scale={docScale}
                onDraft={(text) => stageNewFileDraft(gTabId, text)}
                saving={docSaving}
                saveError={docSaveError}
                onSave={() => void saveDocNow()}
              />
            ) : gTab?.ref.kind === 'local' ? (
              /*
                本地文件：内容不在数据目录里，读取与落盘都由它自己管（见 LocalDoc）。
                key 绑「路径 + 外部版本号」：换一个文件、或文件在外部被改过（应用里
                没有暂存改动，见 useDocSaveFlow 的 handleLocalChange）就重挂重读，上一份的
                「未保存」状态不会串到这一份上。文件丢失的兜底关页签不弹确认（confirm:false）——
                文件都不在了，没有「保存」可言。
              */
              <LocalDoc
                key={gTab.ref.path + '#' + (localTicks[gTab.ref.path] ?? 0)}
                path={gTab.ref.path}
                view={dg.view}
                scale={docScale}
                draft={dg.draft}
                savedText={localSaved?.path === gTab.ref.path ? localSaved.text : undefined}
                onDraft={(text) => stageLocalDraft(gTabId, text)}
                saving={docSaving}
                saveError={docSaveError}
                onMissing={() => closeTab(groupId, gTab.id, 'self', { confirm: false })}
                outlineSlot={getOutlineSlot(gTab.id)}
                // 空 md 默认进编辑（空预览是一片白）：读完内容发现是空的，从预览切过来
                onNeedEdit={() => setTabView(gTab.id, 'source')}
                // 右键菜单的「定位源码」：先放下选中哪一段，再切到源码视图（见 lib/docReveal）
                onRevealSource={(loc) => {
                  if (gTab?.ref.kind !== 'local') return
                  requestSourceReveal(localRevealKey(gTab.ref.path), loc.start, loc.end)
                  setTabView(gTab.id, 'source')
                }}
                onToast={onToast}
              />
            ) : gTab?.ref.kind === 'ws' ? (
              /*
                工作区（项目）内部文件：渲染与本地文件共用 LocalDoc（读 / 改 / 保存体验同一套），
                差别只在路径的来源——rel 从节点工作区现推（节点改名跟着走），再换算绝对路径。
                推不出来（节点刚被删）给一句话，而不是留一片白。
              */
              (() => {
                const rel = wsRelOfTab(store, gTab.ref)
                const abs = rel ? userAbsPath(rel) : null
                if (!abs) {
                  return (
                    <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
                      {t('这份工作区文件已经不在了（节点或项目被删掉了）')}
                    </div>
                  )
                }
                return (
                  <LocalDoc
                    key={abs + '#' + (localTicks[abs] ?? 0)}
                    path={abs}
                    view={dg.view}
                    scale={docScale}
                    draft={dg.draft}
                    savedText={localSaved?.path === abs ? localSaved.text : undefined}
                    onDraft={(text) => stageLocalDraft(gTabId, text)}
                    saving={docSaving}
                    saveError={docSaveError}
                    onMissing={() => closeTab(groupId, gTab.id, 'self', { confirm: false })}
                    outlineSlot={getOutlineSlot(gTab.id)}
                    onNeedEdit={() => setTabView(gTab.id, 'source')}
                    // 右键菜单的「定位源码」：先放下选中哪一段，再把这个页签切到源码视图
                    // （切完预览就卸载了，选区也随之消失，顺序不能反，见 lib/docReveal）
                    onRevealSource={(loc) => {
                      requestSourceReveal(localRevealKey(abs), loc.start, loc.end)
                      setTabView(gTab.id, 'source')
                    }}
                    onToast={onToast}
                  />
                )
              })()
            ) : gTab?.ref.kind === 'exam' ? (
              /*
                试卷副本：只读的一次考试（卷子原件 + 那次作答 + 判分 + 错题讲解）。
                它与其它页签最大的不同：**内容不由节点决定**，而是由 examId + attemptId 决定，
                所以它排在前面的分支里，也不受「此刻在看哪个节点」影响。
              */
              gExam.exam && gExam.attempt ? (
                <ExamCopyView exam={gExam.exam} attempt={gExam.attempt} />
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
                  {t('这份试卷已经被删了，这一次考试的内容也一并没了。')}
                </div>
              )
            ) : gTab?.ref.kind === 'outline' ? (
              /*
                大纲页：思维导图采用 keepalive 常驻（见下方的 gOutlineTabs），
                切去其它页签时仅隐藏保活，切回时零延迟复原相机与状态。这里让出位置。
              */
              null
            ) : gTab?.ref.kind === 'super' && dg.node && dg.superDoc ? (
              /*
                超级文档：一份完整的可交互 HTML。预览跑在沙箱化的 iframe 里
                （见 SuperDocView），源码视图直接改 HTML——暂存与 Ctrl+S 与
                其它文档同一套（保存写回 node.superdocs，见 saveDocNow）。
                key 绑「节点 + 名字」：换一份就重挂，脚本从头执行、状态归零。
              */
              dg.view === 'source' ? (
                <SourceEditor
                  key={dg.node.id + ':super:' + gTab.ref.name}
                  value={dg.draft ?? dg.superDoc.html}
                  onChange={(text) => editDocSource(gTabId, text)}
                  state={docSaving ? 'saving' : dg.draft === undefined ? 'saved' : 'dirty'}
                  label={dg.title}
                  scale={docScale}
                  scrollTop={store.docScroll[gTabId + SRC_SCROLL_SUFFIX]}
                  onScrollTop={(top) => rememberScroll(gTabId + SRC_SCROLL_SUFFIX, top)}
                  ext=".html"
                />
              ) : (
                <SuperDocView
                  key={dg.node.id + ':super:' + gTab.ref.name}
                  html={dg.superDoc.html}
                  onMethodCall={runSuperMethod}
                  // 文档里的 moji:super 链接：BRIDGE 拦截后转回来，走上面注册的同一个处理器
                  onSuperLink={(href) => {
                    const target = parseSuperHref(href)
                    if (target) handleSuperLink(target)
                  }}
                />
              )
            ) : dg.node && dg.source ? (
              dg.view === 'source' ? (
                /*
                  源码视图：直接改 Markdown。改动先进**暂存区**（见 learn/drafts），
                  按 Ctrl+S 才写进文档——底栏上的「已保存 / 未保存」读的就是暂存区里
                  有没有这一份，而不是「store 落盘了没有」。
                */
                <SourceEditor
                  key={dg.title + ':' + dg.source.kind + ':' + (dg.source.note ?? '')}
                  value={dg.source.content}
                  onChange={(text) => editDocSource(gTabId, text)}
                  state={docSaving ? 'saving' : dg.draft === undefined ? 'saved' : 'dirty'}
                  label={dg.title}
                  scale={docScale}
                  ext=".md"
                  // 编辑位置与阅读位置各记各的：同一份文档在源码里改到一半、
                  // 切到预览又读到别处，共用一格会互相拽（见 learn/types 的 DocScroll）
                  scrollTop={store.docScroll[gTabId + SRC_SCROLL_SUFFIX]}
                  onScrollTop={(top) => rememberScroll(gTabId + SRC_SCROLL_SUFFIX, top)}
                  // 「定位源码」放下的一次性请求：挂载时按这个身份取走并选中（见 lib/docReveal）
                  revealKey={nodeRevealKey(dg.node.id, dg.source.kind, dg.source.note)}
                />
              ) : null /* 预览那一份由下面的常驻列表渲染（见 DocPane） */
            ) : (
              <EmptyDoc
                onNewFile={() => openNewFileInPlace(groupId, gTabId)}
                onPickLocal={() => void pickLocalInPlace(groupId, gTabId)}
                onOpenWeb={isWeb() ? undefined : () => openWebInPlace(groupId, gTabId)}
                onNewGoal={() => openNewGoalInPlace(groupId, gTabId)}
                hasGoals={(store.goals ?? []).length > 0}
                favorites={store.favorites ?? []}
                favoriteTitleOf={favoriteTitleOf}
                onOpenFavorite={openFavorite}
                recents={blankRecents}
                onOpenRecent={openRecent}
              />
            )}

            {/*
              常驻的正文（见 DocPane）：每一格显示着的那一片显示，其余带着 hidden 留在 DOM 里。
              常驻片按**它所属的那一格**分派（见 residentPanes 的 group）：同一片正文在
              两处渲染会各自建一份 DOM，那就白常驻了。
            */}
            {panes.map(({ tab, node, source }) => {
              const paneActive = tab.id === gTab?.id && dg.view === 'preview'
              const goalConvId = resolveDisplayedConversation(store, node.goalId) ?? null
              const isAgentRunning = !!(goalConvId && agent.runningByConversation[goalConvId])
              return (
                <DocPane
                  key={tab.id}
                  tabId={tab.id}
                  active={paneActive}
                  node={node}
                  source={source}
                  // 待写提示说的是「agent 正在给这个节点写文档」，只有眼前这一片才有意义
                  pending={paneActive && docPending}
                  agentRunning={isAgentRunning}
                  onGenerateDoc={requestGenerateDoc}
                  knownConceptKeys={conceptKeysOf(store, node)}
                  // 大纲句柄槽：每片正文对应自己页签的那一份（见 lib/outline 的 OutlineHandle）
                  outlineSlot={getOutlineSlot(tab.id)}
                  // 读到哪儿了：记在页签 id 上，重启回来接着读（见 lib/docScroll）
                  scrollTop={store.docScroll[tab.id]}
                  onScrollTop={(top) => rememberScroll(tab.id, top)}
                  note={getNoteActions(tab.id, node, source)}
                />
              )
            })}

            {/*
              大纲页常驻层（keepalive）：只要大纲页签在这一格开着，思维导图就常挂在 DOM 中，
              切去其它页签时仅藏不卸，切回时零延迟复原导图相机与选中状态。
            */}
            {gOutlineTabs.map((tab) => {
              const goal = store.goals.find((g) => g.id === tab.ref.nodeId || g.rootNodeId === tab.ref.nodeId)
              const oNode = tab.ref.kind === 'outline' ? nodeById(store, tab.ref.nodeId) : null
              if (!oNode && !goal) return null
              const isActive = gTab?.id === tab.id
              return (
                <OutlinePane
                  key={tab.id}
                  tabId={tab.id}
                  active={isActive}
                  store={store}
                  node={oNode ?? undefined}
                  goalId={goal?.id ?? oNode?.goalId ?? ''}
                  onChangeStructure={updateStructure}
                  docs={explorerDocs}
                  exams={explorerExams}
                  channel={canvasChannel}
                  onToast={onToast}
                  focusTarget={outlineFocus}
                  onFocusHandled={handleOutlineFocusHandled}
                />
              )
            })}
          </div>

          {/*
            网页层（见 components/learn/web/WebTabLayer）：常挂在格子里、切去文档时
            整层藏起来（guest 进程照跑）。z-10 盖过正文，又在拖放高亮（z-30）之下。
          */}
          {/* 视频页签常驻层（keepalive）：开着就挂着，切走只藏不卸（见 VideoTabLayer） */}
          {gVideoTabs.length > 0 && (
            <VideoTabLayer
              tabs={gVideoTabs}
              activeId={gTab?.ref.kind === 'video' ? gTab.id : null}
              videos={store.videos}
              onCreate={(tabId, draft: VideoCreateDraft) => {
                const id = crypto.randomUUID()
                const now = Date.now()
                const record = {
                  id,
                  pluginId: draft.pluginId,
                  pluginName: draft.pluginName,
                  input: draft.input,
                  ...(Object.keys(draft.fields).length ? { fields: draft.fields } : {}),
                  title: draft.input.slice(0, 60),
                  createdAt: now,
                }
                set({ ...store, videos: [...(store.videos ?? []), record] })
                // 开绑定页签、关掉创建页签（顺序反过来会让这一格短暂没页签）
                openTab({ kind: 'video', videoId: id })
                closeTab(groupId, tabId, 'self')
              }}
              onResolved={(videoId, title) => {
                // 取最新一份再合并：进度写入是高频的，闭包里的 store 可能落后一拍
                const latest = getLatest()
                const list = latest.videos ?? []
                const cur = list.find((v) => v.id === videoId)
                if (!cur || cur.title === title) return
                set({
                  ...latest,
                  videos: list.map((v) => (v.id === videoId ? { ...v, title, updatedAt: Date.now() } : v)),
                })
              }}
              onProgress={(videoId, positionMs, source) => {
                const latest = getLatest()
                const list = latest.videos ?? []
                const cur = list.find((v) => v.id === videoId)
                if (!cur) return
                set({
                  ...latest,
                  videos: list.map((v) =>
                    v.id === videoId
                      ? {
                          ...v,
                          progress: { ...(source ? { source } : {}), positionMs: Math.round(positionMs), updatedAt: Date.now() },
                        }
                      : v,
                  ),
                })
              }}
              onSelection={(videoId, source, title) => {
                const latest = getLatest()
                const list = latest.videos ?? []
                const cur = list.find((v) => v.id === videoId)
                if (!cur) return
                set({
                  ...latest,
                  videos: list.map((v) =>
                    v.id === videoId
                      ? {
                          ...v,
                          selection: { source, ...(title ? { title } : {}) },
                          // 换集就把进度归零到新那一项：旧进度不能续到别的集上
                          progress: { source, positionMs: 0, updatedAt: Date.now() },
                        }
                      : v,
                  ),
                })
              }}
              onSaveRecap={(videoId, source, recap) => {
                // 视频总结（总结+分段**一次生成**）按来源落库；生成过就不再生成（空态才给入口）
                if (!recap.summary && !recap.chapters?.length) return
                const latest = getLatest()
                const list = latest.videos ?? []
                const cur = list.find((v) => v.id === videoId)
                if (!cur) return
                set({
                  ...latest,
                  videos: list.map((v) =>
                    v.id === videoId
                      ? { ...v, recaps: { ...(v.recaps ?? {}), [source]: recap }, updatedAt: Date.now() }
                      : v,
                  ),
                })
                if (recap.chapters?.length) {
                  onToast(t('已生成总结与分段：{0} 段，分段点在进度条上', String(recap.chapters.length)))
                } else {
                  onToast(t('已生成总结'))
                }
              }}
            />
          )}

          {!isWeb() && gWebTabs.length > 0 && (
            <WebTabLayer
              tabs={gWebTabs}
              activeId={gTab?.ref.kind === 'web' ? gTab.id : null}
              meta={webMeta}
              hidden={gTab?.ref.kind !== 'web'}
              onMeta={patchWebMeta}
              onCommitUrl={commitWebUrl}
              // 地址栏的收藏星标（收藏认网址，见 learn/favorites）
              favoriteOf={isUrlFavorite}
              onToggleFavoriteUrl={toggleUrlFavorite}
            />
          )}

          {/*
            查找 / 替换条：浮在正文右上角（见 components/learn/FindBar）。
            它是**全局一个**（Ctrl+F 打开的那一条），所以只画在焦点格上：同时冒出两条，
            用户按 Ctrl+F 时根本不知道往哪一条里打字。
          */}
          {isFocused && findMode && (
            <FindBar
              boxRef={docBox}
              source={docView === 'source'}
              mode={findMode}
              onModeChange={setFindMode}
              focusTick={findTick}
              // 替换只在「源码视图 + 有一份归学习数据管的正文」时可用：
              // 本地文件的正文不归 store 管，预览是只读的
              onReplace={
                docView === 'source' && docSource && activeTab
                  ? (text) => editDocSource(activeTab.id, text)
                  : undefined
              }
              onClose={() => setFindMode(null)}
            />
          )}

          {/*
            悬浮组（这一格右上角，横向一条，见 components/learn/DocFloat）：左半边是这个
            节点的工具（笔记 / 超级文档 / 学习状态 / 试卷），右半边是这份文档的动作
            （源码 / 预览 / 导出）。一个页签都没有的空格子不画。

            **新建文件页不画**（用户报的：那一条会压住页头右侧的「保存…」按钮）：
            这一页右上角是它自己的页头，保存按钮就长在那儿；而悬浮组里的东西对它也
            基本没意义——还没有类型，切不了预览，大纲也不存在。纯净阅读仍可用 F11。
          */}
          {gTab &&
            gTab.ref.kind !== 'web' &&
            gTab.ref.kind !== 'settings' &&
            gTab.ref.kind !== 'usage' &&
            gTab.ref.kind !== 'schedule' &&
            gTab.ref.kind !== 'mind' &&
            gTab.ref.kind !== 'agentSettings' &&
            gTab.ref.kind !== 'outline' &&
            gTab.ref.kind !== 'draft' &&
            // 视频学习页（实验）也不画：大纲/视图切换对播放器没有意义，纯净阅读
            // 仍可用 F11（用户定的：这一页右上角不要按钮组）
            gTab.ref.kind !== 'video' &&
            // 插件文档页同样不画：它是参考手册，不是可编辑文档
            gTab.ref.kind !== 'pluginDoc' && (
            <DocFloat
              /*
               * key 绑「格 + 节点」：换节点时重挂，各块 tip 的展开状态自然回到收起；
               * 拖页签分割之后新格里的悬浮组也是新的一份，不会继承旧格展开着的那块。
               */
              key={groupId + ':' + (dg.node?.id ?? gTab.id)}
              view={dg.view}
              previewable={dg.previewable}
              previewHint={
                dg.emptyNote ? t('这份笔记还是空的：先在源码视图里写点东西，才有得预览') : undefined
              }
              onSwitchView={(v) => setTabView(gTabId, v)}
              showBackToDoc={gTab.ref.kind === 'note' || gTab.ref.kind === 'super'}
              onBackToDoc={() => dg.node && openTab({ kind: 'teach', nodeId: dg.node.id })}
              // 纯净阅读那颗：它与 F11 / Esc 是同一个动作（见 toggleZen）。
              // 每一格的悬浮组都画一颗，而状态是**全局一个**——点哪一格都是同一件事
              pure={pure}
              onTogglePure={toggleZen}
              // 标题大纲：按当前页签的槽取（渲染组件装进去，见 lib/outline 的 OutlineHandle）
              outlineSlot={getOutlineSlot(gTabId)}
            />
          )}

          {/*
            画布页签（大纲页）右上角的纯净阅读入口：悬浮组不画 outline（它不是文档），
            这颗补位。画布内的双击归画布自己（适应画布 / 聚焦节点），进纯净阅读
            只走这颗按钮与 F11——两套双击手势不再打架。
          */}
          {gTab?.ref.kind === 'outline' && (
            <button
              type="button"
              title={pure ? t('退出纯净阅读（F11 / Esc）') : t('纯净阅读：收起两侧栏、页签栏与顶栏，只留正文（F11）')}
              aria-pressed={pure}
              onClick={toggleZen}
              className={
                pure
                  ? 'absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong bg-line/50 text-ink transition'
                  : 'absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-card/90 text-ink-soft shadow-sm backdrop-blur transition hover:bg-line/50 hover:text-ink'
              }
            >
              {pure ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}

          {/*
            拖页签的落点高亮：指针停在某一格的边上时，把那半边画出来——
            松手就长成新的一格。中间那一块是「放进这一格」，画满整格。
          */}
          {tabDrag?.over?.group === groupId && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-30">
              <div
                className={
                  'absolute rounded-md border-2 border-seal/60 bg-seal/10 transition-all duration-100 ' +
                  ZONE_BOX[tabDrag.over.zone]
                }
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  /**
   * 布局树 → DOM。
   *
   * 叶子是一格正文，内部节点是一条可拖的分割线 + 按占比铺开的孩子。
   * 占比走 flexGrow（basis 0）：谁占多少完全由 sizes 说了算，与内容宽度无关——
   * 这正是「拖那条线时两边的比例严格跟着指针走」的前提。
   */
  const renderLayout = (node: DocLayout): ReactNode => {
    if (node.kind === 'group') return renderGroup(node.group)
    const sizes = splitDrag?.id === node.id ? splitDrag.sizes : node.sizes
    return (
      <div
        key={node.id}
        className={
          'flex min-h-0 min-w-0 flex-1 ' + (node.dir === 'row' ? 'flex-row' : 'flex-col')
        }
      >
        {node.children.map((child, i) => (
          <Fragment key={child.kind === 'group' ? child.group : child.id}>
            {i > 0 && (
              /*
                分割线：视觉上 1px，命中区 8px（负边距把那 8px 折回去，布局上不占地方）。
                与两列之间那根把手是同一套做法：线由把手自己画，拖动时只把它自己点亮。
              */
              <div
                role="separator"
                aria-orientation={node.dir === 'row' ? 'vertical' : 'horizontal'}
                aria-label={t('拖动调整两格的大小')}
                title={t('拖动调整两格的大小')}
                onPointerDown={(e) => beginSplitDrag(e, node, i)}
                className={
                  'no-print relative z-10 shrink-0 touch-none transition-colors hover:bg-seal/20 ' +
                  (node.dir === 'row' ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize')
                }
              >
                <span
                  className={
                    'absolute bg-line ' +
                    (node.dir === 'row'
                      ? 'inset-y-0 left-1/2 w-px -translate-x-1/2'
                      : 'inset-x-0 top-1/2 h-px -translate-y-1/2')
                  }
                />
              </div>
            )}
            <div
              className="flex min-h-0 min-w-0 flex-col"
              // 占比：flexGrow 按 sizes，basis 固定 0——内容再宽也不会把比例顶走
              style={{ flexGrow: sizes[i] ?? 1, flexShrink: 1, flexBasis: 0 }}
            >
              {renderLayout(child)}
            </div>
          </Fragment>
        ))}
      </div>
    )
  }

  const explorerDocs = useMemo<NodeDocActions>(
    () => ({
      onOpenTeach: (nodeId) => selectNode(nodeId),
      onOpenOutline: (nodeId) => {
        const g = store.goals.find((x) => x.id === nodeId || x.rootNodeId === nodeId)
        openTab({ kind: 'outline', nodeId, ...(g ? { goalId: g.id } : {}) })
      },
      onNewNote: (nodeId) => createNodeNote(nodeId),
      onNewProject: (nodeId) => newProject(nodeId),
      onNewExam: (nodeId) => newExam(nodeId),
      // 壳名必须带到：画布空壳卡上的「生成」说的是「就写这一份」，丢了它导师会另建一份（两份超级文档的元凶）
      onNewSuperDoc: (nodeId, shellName) => startSuperLab(nodeId, shellName),
      onOpenNote: (nodeId, name) => openTab({ kind: 'note', nodeId, note: name }),
      onRenameNote: (nodeId, from, to) => renameNodeNote(nodeId, from, to),
      onDeleteNote: (nodeId, name) => setPendingNoteDelete({ nodeId, name }),
      onOpenSuperDoc: (nodeId, name) => openTab({ kind: 'super', nodeId, name }),
      onDeleteSuperDoc: (nodeId, name) => setPendingSuperDelete({ nodeId, name }),
      onOpenAttempt: (nodeId, examId, attemptId) => openExamCopy(nodeId, examId, attemptId),
      onReveal: (nodeId, what) => {
        if (what.kind === 'note') void revealNoteFile(nodeId, what.note ?? '')
        else if (what.kind === 'outline') void revealOutlineFile(nodeId)
        else void revealNodeFile(nodeId)
      },
      onReplanOutline: (nodeId) => startOutline(nodeId),
      onExport: (ref) => exportTab(ref),
    }),
    [selectNode, openTab, createNodeNote, newExam, startSuperLab, renameNodeNote, openExamCopy, startOutline, exportTab, newProject],
  )

  const explorerExams = useMemo<ExamActions>(
    () => ({
      onStart: (nodeId, examId) => {
        if (exam.live && exam.live.examId !== examId) {
          onToast(t('有一场考试正在进行，先把它考完或放弃'))
          exam.reveal()
          return
        }
        selectNode(nodeId)
        exam.openExam(examId)
      },
      onGrade: (nodeId) => requestGrading(nodeId),
      onOpenRecord: (nodeId, examId, attemptId) => openExamCopy(nodeId, examId, attemptId),
      onDelete: (target) => {
        setPendingExamDelete(target)
        setExamDeleteStage(examAttempted(target) ? 'warn' : 'final')
      },
      liveExamId: exam.live?.examId ?? null,
      grading,
    }),
    [exam.openExam, exam.reveal, exam.live, selectNode, onToast, requestGrading, grading, openExamCopy],
  )

  return (
    <div className="print-flat flex h-full overflow-hidden">
      <ExplorerSidebar
        store={store}
        videos={store.videos ?? []}
        onOpenVideo={(id) => openTab({ kind: 'video', videoId: id })}
        onDeleteVideo={(id) => {
          // 删除守卫：被视频节点绑着的视频不许删（引用的节点会变成死绑）——
          // 视频节点跟着目标走，列出目标名让用户知道是哪门课在用
          const refs = (store.videoNodes ?? []).filter((v) => v.videoId === id)
          if (refs.length) {
            const names = refs
              .map((r) => store.goals.find((g) => g.id === r.goalId)?.question ?? r.goalId)
              .slice(0, 3)
              .join('、')
            onToast(
              t(
                refs.length > 3
                  ? '这个视频正被 {0} 等 {1} 个目标绑着：先解绑（画布上的视频卡）再删'
                  : '这个视频正被「{0}」绑着：先解绑（画布上的视频卡）再删',
                names,
                String(refs.length),
              ),
            )
            return
          }
          set({ ...store, videos: (store.videos ?? []).filter((v) => v.id !== id) })
        }}
        // 视频的新建入口（顶栏按钮已移除）：开创建态页签
        onNewVideo={() => openTab({ kind: 'video' })}
        // 高亮跟着**激活的页签**走：关掉某个节点的教学文档页签，它就不再是选中样式
        activeNodeId={selectedNodeId}
        // 文档行也一样：焦点格开着哪份笔记 / 试卷副本 / 超级文档 / 学习文档，那一行就亮
        activeTab={activeTab?.ref ?? null}
        // 忙的是「正在跑的那位导师冲着的节点」——页签化之后它与眼前选中的节点是两回事
        busyNodeId={
          agentView && agentView.conversationId && agent.runningByConversation[agentView.conversationId]
            ? agentView.nodeId
            : null
        }
        open={sidebarOpen}
        // 纯净阅读：资源管理器整栏向左让位（靠负外边距真让位，见 ExplorerSidebar）
        pure={pure}
        onClose={() => setSidebarOpen(false)}
        onSelectNode={selectNode}
        // 点目标节点的文字 = 切到它的目标页签组（不再直接开教学文档）
        onSelectGoal={openGoalGroup}
        // 目标行的高亮：当前正在看的那个目标
        activeGoalId={tabGoalId}
        onNewGoal={startCreatingGoal}
        onDeleteNode={requestRemoveNode}
        onRevealNode={(nodeId) => void revealNodeFile(nodeId)}
        onRevealWs={(rel) => void revealWsFile(rel)}
        onOpenWs={openWsFile}
        ws={wsActions}
        onOpenLocal={openLocalFile}
        onRemoveLocal={dropLocalFile}
        onRevealLocal={(path) => void revealLocalFile(path)}
        onPickLocal={() => void pickLocal()}
        // 收藏区（学习目标与本地文件之间）：打开 / 移除 / 现查标题
        onOpenFavorite={openFavorite}
        onRemoveFavorite={dropFavorite}
        onSetFavoriteGroup={setFavGroup}
        onRenameFavoriteGroup={renameFavGroup}
        onRemoveFavoriteGroup={removeFavGroup}
        onRenameFavoriteTitle={renameFavTitle}
        onCreateFavoriteGroup={createFavGroup}
        favoriteTitleOf={favoriteTitleOf}
        docs={explorerDocs}
        exams={explorerExams}
      />

      <div className="print-flat flex min-w-0 flex-1 flex-col">
        {/*
          顶栏：纯净阅读时收起来（高度补间到 0，顶栏自己从下往上被裁掉）。

          高度写在**外面这一层**、而不是给 Topbar 加一个开关：顶栏自己是 h-14 的
          flex 行，它不必知道自己此刻露着多少。裁溢出只在收起与补间期间加——
          平时必须放开，顶栏里的账号菜单、模型菜单都是向下探出去的（见 Topbar 顶上那段
          z-index 的说明），裁了它们就只剩半个。

          z-30 跟着顶栏一起搬上来：顶栏是层叠上下文，里面的下拉菜单与弹窗靠它压在正文与侧栏分割按钮之上。
        */}
        <div
          className={
            'no-print relative z-30 shrink-0 transition-[height,opacity,visibility] duration-300 ease-out ' +
            // 裁溢出只在收起与补间那一段：平时必须放开——顶栏里的账号菜单、模型菜单
            // 都是向下探出去的（见 Topbar 顶上那段 z-index 的说明），裁了它们就只剩半个。
            // 用 overflow-clip 而不是 hidden：hidden 会生成一个滚动容器，焦点落到里面
            // 那些按钮上时它会被滚走（同 NoteDialog 里的取舍）。
            (pure || pureMoving ? 'overflow-clip ' : '') +
            // invisible 与高度一起走：高度 0 只是看不见，里面那几十颗按钮还在 Tab 序列里；
            // visibility 参与补间时是「到末尾才真的切过去」，所以它是等收完了才失效的
            (pure ? 'h-0 opacity-0 invisible' : 'h-14 opacity-100')
          }
        >
          <Topbar
            /*
             * 顶栏里那个「我在哪」说的是**眼前这一屏**，所以它跟的是页签，不是 activeNodeId：
             * activeNodeId 是「导师此刻认哪个节点」（关掉页签之后它仍然是上一处落点，
             * 否则关掉全部页签就会把对话也一起废掉）。两者分开正是为了这件事——
             * 把页签全关掉之后，顶栏该显示「没有打开的文档」，而不是一个已经关掉的节点。
             */
            activeNode={docNode}
            onSelectNode={selectNode}
            goalQuestion={topbarGoalQuestion}
            // 目标名点开的下拉菜单：存活的 tab 组（点一行切过去，见 switchGoalGroup）
            tabGroups={aliveGoalTabGroups}
            onSwitchGoalGroup={switchGoalGroup}
            onDropGoalCache={dropGoalCache}
            store={store}
            user={user}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenUser={onOpenUser}
            onSignOut={onSignOut}
            onOpenSettings={onOpenSettings}
            onOpenUsage={onOpenUsage}
            onOpenUpdate={onOpenUpdate}
            onOpenNotice={onOpenNotice}
            onOpenLan={onOpenLan}
            onToast={onToast}
            /* 工具箱：截图与录屏入口 */
            tools={<ToolsButton onScreenshot={handleStartScreenshot} onToast={onToast} />}
            /* 日程是「今天还剩什么」；到点时的呼吸层挂在顶栏本体上 */
            schedule={
              <ScheduleDock
                store={store}
                ringing={scheduleRinging}
                onOpen={onOpenSchedule}
                onComplete={completeScheduleItem}
                onSnooze={snoozeScheduleItem}
              />
            }
            scheduleRinging={!!scheduleRinging}
          />
        </div>

        {/*
          两列：文档区与超级导师对话栏。骨架（两格、分割线、收起按钮、拖动读数）在
          SplitRow，宽度与拖动机制在 useSideColumns；左格自适应、右格固定宽（--side-w，可拖），
          宽度属于「格子」而不属于内容，对调时只换内容、不换宽度（见 lib/appearance 的 agentLeft）。
          目标创建页现已移入文档区作为普通页签（kind: 'newGoal'）渲染。
        */}
        <SplitRow
          side={side}
            /*
              随笔的入口与窗口挂在这一层：它是**文档区**的浮层（右下角那颗按钮），
              不属于某一份文档——切页签、切节点都不该把它连根拔掉（目标变了才换一本账）。
              外面这层 relative 是它的定位基准，且**没有** overflow-hidden：
              按钮贴着文档区的角，窗口则 portal 到 body（见 EssayDock）。
            */
            docsSlot={
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                {renderLayout(docs.layout)}
                {essayGoalId && (
                  <EssayDock
                    /*
                     * key 绑目标：换目标是**换一本账**。重挂会让上一份的收尾（把没落库的
                     * 那一下写掉）用**旧目标**的闭包跑完，而新的一份从空白开始——
                     * 不这么做的话，切目标时那一笔会写进新目标的账里。
                     */
                    key={essayGoalId}
                    goalId={essayGoalId}
                    // 入口只在教学文档上露脸（需求：教学文档右下角）；窗口开着时另说
                    showEntry={activeTab?.ref.kind === 'teach'}
                    open={essayOpen}
                    onOpenChange={setEssayOpen}
                    essays={essayList}
                    // 提交记录与提交动作（见 learn/essayCommits）：历史、快照与整理结果都在窗口里看
                    commits={essayCommits}
                    onCommit={essayCommit}
                    onRetryCommit={essayCommitRetry}
                    onOpenNote={essayOpenNote}
                    geometry={store.essayDock ?? null}
                    onGeometry={essayGeometry}
                    onCreate={essayCreate}
                    onUpdate={essayUpdate}
                    onDelete={essayDelete}
                    allNotes={dockNotes}
                    onWriteNote={dockWriteNote}
                    onDeleteNote={dockDeleteNote}
                  />
                )}
              </div>
            }
            agentSlot={
              activeAgentTab ? (
                <div className="flex h-full min-h-0 flex-col">
                  {/*
                    agent 栏的页签条：一页签一份独立的上下文与运行时。目标级导师的关闭守卫
                    （文档区还有它的页签 / 还在跑）与子代理页签的随时可关，见 AgentTabStrip。
                  */}
                  <AgentTabStrip
                    tabs={stripTabs}
                    activeId={activeAgentTabId}
                    titleOf={agentTabTitle}
                    runningOf={agentTabRunning}
                    docTabsOf={(ref) => (ref.kind === 'goal' ? docGoalIds.has(ref.goalId) : false)}
                    onActivate={activateAgentTab}
                    onClose={closeAgentTab}
                    onCloseMode={closeAgentTabMode}
                    onReorder={reorderAgentTabList}
                    onNewConversation={store.activeGoalId ? handleNewGoalConversation : undefined}
                  />
                  {/*
                    **keepalive**：所有页签的面板常挂（absolute 铺满、非激活的 display:none）——
                    滚动位置、跟随状态、编辑态、输入框里打到一半的话，切走再回来都还在。
                    每枚面板的 props 由 agentTabProps 按页签解析（数据与动作各归各的导师），
                    激活的拿到 active 标记，切回可见时重新量定位条（隐藏期间量到的全是零矩形）。
                  */}
                  <div className="relative min-h-0 flex-1">
                    {/* 常挂的是全部页签（见 agentPanes 的说明），栏上画哪几枚由 stripTabs 决定 */}
                    {agentPanes.map((tab) => {
                      const key = agentTabKey(tab)
                      const on = key === activeAgentTabId
                      const props = agentTabProps(tab)
                      return (
                        <AgentTabPane
                          key={key}
                          tabKey={key}
                          active={on}
                          hasKey={hasKey}
                          providerLabel={providerName}
                          onModelChanged={() => setSettingsEpoch((n) => n + 1)}
                          vision={vision}
                          onNotice={onToast}
                          onOpenAgentSettings={() => openTab({ kind: 'agentSettings' })}
                          onOpenSettings={() => openTab({ kind: 'agentSettings' })}
                          effort={effort}
                          onSetEffort={setGlobalEffort}
                          compactThreshold={agentSettings.compact.threshold}
                          persona={agentSettings.persona}
                          onPickPersona={(id) => {
                            saveAgentSettings({ ...agentSettings, persona: id })
                            onToast(t('导师人格已切到「{0}」，从下一轮开始生效', personaOf(id).label))
                          }}
                          docFormat={agentSettings.docFormat}
                          onPickDocFormat={(id) => {
                            saveAgentSettings({ ...agentSettings, docFormat: id })
                            onToast(t('文档格式已切到「{0}」，从下一轮开始生效', docFormatOf(id).label))
                          }}
                          onDeleteConversation={removeConversation}
                          onOpenFile={(pathOrRel, title) => {
                            const norm = pathOrRel.replace(/\\/g, '/')
                            const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(norm)
                            const abs = isAbs ? norm : (userAbsPath(norm) ?? norm)
                            openTab({ kind: 'local', path: abs, ...(title ? { title } : {}) })
                          }}
                          {...props}
                        />
                      )
                    })}
                  </div>
                </div>
              ) : (
                /*
                  一枚页签都没有：还没有任何目标被打开过（或用户把导师都关了）。
                  说清「导师从哪里来」——打开一份目标下的文档，它的导师会自己出现。
                */
                <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                  <span className="text-[13px] font-medium text-ink-soft">{t('超级导师')}</span>
                  <p className="max-w-[240px] text-[11.5px] leading-relaxed text-ink-faint">
                    {t('打开一份目标下的文档，它的导师会在这里出现。')}
                  </p>
                </div>
              )
            }
          />
      </div>

      {/*
        考试期间的黑遮罩：有一场正在考就盖住整个主窗口。

        考试窗口是全屏的，但 Alt+Tab 回来仍然看得见文档——那正是「一边答题一边翻文档」的口子。
        只要那一场还开着，主窗口就什么也不给看（遮罩之上只有一颗「回到考试窗口」，
        免得用户切回来之后找不着北）。遮罩下面的东西一律不可点：它盖住了整窗。
      */}
      {exam.live && (
        <div className="no-print fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black">
          <p className="text-[15px] text-white/85">{t('考试进行中')}</p>
          <p className="max-w-[440px] text-center text-[12px] leading-relaxed text-white/45">
            {t('为了不让「翻文档」变成作弊，考试期间主窗口一直遮着。考试窗口是全屏的； 切出去会被记一次切屏，次数与时长都会留给导师看。')}
          </p>
          <button
            type="button"
            onClick={exam.reveal}
            className="mt-1 rounded-lg border border-white/25 px-3.5 py-1.5 text-[12.5px] text-white/85 transition hover:bg-white/10"
          >
            {t('回到考试窗口')}
          </button>
        </div>
      )}

      {/*
        导出文档：一个弹窗（Ctrl+E / 文档区右上角悬浮组里那颗按钮）。
        key 绑页签：换一份文档就重挂，上一次选的格式与「已导出到…」不会串到这一份上。
      */}
      {exportOpen && activeTab && (
        <ExportDialog
          key={activeTab.id}
          title={docTitle || t('未命名文档')}
          meta={exportMeta}
          hasAnnotations={!!docNode?.annotations.length}
          hasPlots={exportPlots.some(Boolean)}
          onExport={runExport}
          onReveal={(path) => {
            void revealLocalFile(path).then((ok) => {
              if (!ok) onToast(t('没能在文件管理器里定位这个文件（可能已被移动或删除）'))
            })
          }}
          onClose={() => setExportOpen(false)}
        />
      )}

      {/*
        上下文对比调试器：可拖动的悬浮窗（见 components/FloatWindow）。
        平时不录制；命中骤降时 contextDebug 定格报告，开发者开关开着就自动弹出来。
      */}
      {debugWin.mounted && (
        <FloatWindow width={760} height={680} closing={debugWin.closing}>
          <ContextDebugger onClose={() => debugWin.setOpen(false)} />
        </FloatWindow>
      )}

      {pendingExamDelete && (
        <ConfirmDialog
          title={examDeleteStage === 'warn' ? t('这份试卷考过，删除会一并带走这些') : t('最后确认：删除这份试卷？')}
          message={
            examDeleteStage === 'warn'
              ? examDeleteWarn(pendingExamDelete)
              : examAttempted(pendingExamDelete)
                ? t('《{0}》与它的 {1} 次考试记录会被永久移除；删错了按 Ctrl+Z 可撤回。', pendingExamDelete.title, pendingExamDelete.attempts.length)
                : t('《{0}》还没考过，删掉只是把这份题目丢掉，可以随时让导师重出一份。', pendingExamDelete.title)
          }
          confirmLabel={examDeleteStage === 'warn' ? t('我了解，继续') : t('删除试卷')}
          onConfirm={commitRemoveExam}
          onCancel={() => setPendingExamDelete(null)}
        />
      )}

      {pendingNoteDelete && (
        <ConfirmDialog
          title={t('删除这份笔记？')}
          message={t(
            '「{0}」是一个独立文件（{节点}.notes/{1}.md），删除后文件本体也会一并移除；删错了按 Ctrl+Z 可撤回。',
            pendingNoteDelete.name,
            pendingNoteDelete.name,
          )}
          confirmLabel={t('删除笔记')}
          onConfirm={() => {
            const p = pendingNoteDelete
            setPendingNoteDelete(null)
            commitRemoveNote(p.nodeId, p.name)
          }}
          onCancel={() => setPendingNoteDelete(null)}
        />
      )}

      {pendingSuperDelete && (
        <ConfirmDialog
          title={t('删除这份超级文档？')}
          message={t(
            '「{0}」是一份可交互的 HTML 文档，删除后无法恢复（Ctrl+Z 可撤回）。配着它使用的持久化函数（method）仍会保留，需要时可在对话里让超级导师重新生成。',
            pendingSuperDelete.name,
          )}
          confirmLabel={t('删除超级文档')}
          onConfirm={() => {
            const p = pendingSuperDelete
            setPendingSuperDelete(null)
            commitRemoveSuperDoc(p.nodeId, p.name)
          }}
          onCancel={() => setPendingSuperDelete(null)}
        />
      )}

      {/*
        关页签确认：要关的那批页签里有没保存的改动。三个出路——保存并关（冲突的本地
        文件会先被下一张冲突框拦下）、放弃改动并关（显式丢弃）、取消（什么都不发生）。
      */}
      {pendingClose && (
        <ConfirmDialog
          title={t('有未保存的改动')}
          message={
            pendingClose.names.length > 1
              ? t('{0} 还没保存。可以先保存再关闭，也可以放弃这些改动直接关。', pendingClose.names.filter(Boolean).join('、'))
              : t('「{0}」 还没保存。可以先保存再关闭，也可以放弃这些改动直接关。', pendingClose.names[0] ?? '')
          }
          confirmLabel={t('保存并关闭')}
          extraLabel={t('放弃改动并关闭')}
          onConfirm={commitCloseSave}
          onExtra={commitCloseDiscard}
          onCancel={() => setPendingClose(null)}
        />
      )}

      {/*
        保存冲突确认：本地文件在外部被改过、而应用里还有没保存的改动。
        覆盖 = 以手上这版写回原文件；另存为 = 存成新文件、两边都保留；取消 = 先不存。
      */}
      {pendingConflict && (
        <ConfirmDialog
          title={t('文件在外部被修改过')}
          message={t(
            '「{0}」在你编辑期间被外部程序改动过。直接保存会以手上这一版覆盖外部的内容；也可以另存成一个新文件，两边都保留。',
            localFileNameOf(pendingConflict.path),
          )}
          confirmLabel={t('覆盖保存')}
          extraLabel={t('另存为…')}
          onConfirm={commitConflictOverwrite}
          onExtra={commitConflictSaveAs}
          onCancel={() => setPendingConflict(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.isRoot ? t('删除整个学习目标？') : t('删除这个阶段目标？')}
          message={
            pendingDelete.isRoot
              ? t('「{0}」是学习目标（总目标），删除后它及其下 {1} 个阶段目标、所有对话与试卷都会一并移除，且无法恢复。', pendingDelete.title, Math.max(0, pendingDelete.count - (getLatest().goals.find((g) => g.id === pendingDelete.nodeId)?.rootNodeId ? 1 : 0)))
              : t('只删除「{0}」本身：与它相连的线一并解开，它的下级阶段目标会留在画布上（成为没有上游的游离卡），挂在该文档上的笔记与试卷随它一起移除。删错可按 Ctrl+Z 撤回。', pendingDelete.title)
          }
          confirmLabel={pendingDelete.isRoot ? t('删除目标') : t('删除')}
          onConfirm={commitRemoveNode}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* 新建目标弹窗 */}
      <CreateGoalDialog
        open={createGoalOpen}
        onClose={() => setCreateGoalOpen(false)}
        onCreate={createGoal}
      />

      {/* 节点宇宙浮层：Tab 弹出/收回（见上面的 toggleStructOverlay）；画布与大纲页签同一套通道 */}
      {structOverlayGoal && (
        <StructOverlay
          goalId={structOverlayGoal}
          store={store}
          onChangeStructure={updateStructure}
          docs={explorerDocs}
          exams={explorerExams}
          channel={canvasChannel}
          onToast={onToast}
          onClose={() => setStructOverlayGoal(null)}
        />
      )}

      {/* 截图工具全屏操作浮层（WebUI模式） */}
      {screenshotImage && (
        <ScreenshotModal
          imageSrc={screenshotImage}
          onClose={() => setScreenshotImage(null)}
          onPin={(pinItem) => {
            try {
              sessionStorage.setItem(`pin_${pinItem.id}`, JSON.stringify(pinItem))
              window.open(
                `?pinWindow=${encodeURIComponent(pinItem.id)}`,
                '_blank',
                `width=${Math.round(pinItem.width)},height=${Math.round(pinItem.height)},menubar=no,toolbar=no`,
              )
              onToast(t('已生成独立置顶贴图窗口'))
            } catch {
              onToast(t('已生成置顶贴图'))
            }
          }}
          onToast={onToast}
        />
      )}
    </div>
  )
}

/** 在文档源码里找包含 raw 的 ```plot 围栏：回 [start, end)，含首尾两行围栏标记 */
function findPlotFenceRange(content: string, raw: string): { start: number; end: number } | null {
  const body = raw.trim()
  if (!body) return null
  const marker = '```plot'
  let from = 0
  for (;;) {
    const start = content.indexOf(marker, from)
    if (start < 0) return null
    const lineEnd = content.indexOf('\n', start + marker.length)
    if (lineEnd < 0) return null
    const close = content.indexOf('```', lineEnd)
    if (close < 0) return null
    if (content.slice(lineEnd + 1, close).trim() === body) return { start, end: close + 3 }
    from = close + 3
  }
}
