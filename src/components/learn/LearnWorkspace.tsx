/*
 * 学习工作区（宿主）：目标 → 节点树 → 选中节点进入「文档 + 超级导师」两列。
 * 节点由用户在文档里选中陌生词汇创建；创建后原文替换为可点击的节点链接，
 * 剩下的事（标题、描述、正文）都交给 Agent，界面当场就有反馈。
 *
 * 这个文件是**编排层**：它持有「现在看什么」（页签）、把 store 派生成界面要的形状、
 * 把 Agent 与界面接起来，最后把 JSX 拼出来。成块的机制都住在 workspace/ 下：
 *
 * - useSideColumns / SplitRow / useHostWiring —— 两列骨架、宿主注册接线；
 * - useDocSaveFlow / useDeleteFlows / DeleteConfirms —— 保存与删除两类确认流；
 * - useExportFlow / useUnrTransfer —— 导出三条路与 .unr 分享包；
 * - useTabDnd / useLinkHandlers / useWsActions —— 拖拽分屏、链接跳转、工作区文件；
 * - useFavorites / useEssayFlow / useWsActions / useMemoryActions —— 收藏/随笔/文件/记忆；
 * - useScreenshotTool / useTraceWindow / goalFocus —— 截图、轨迹窗、落点缓存槽；
 * - useAgentTabActions / AgentSlot —— agent 栏的页签动作与整块 JSX；
 * - useCanvasChannel / quoteTarget / videoTabBridge —— 画布通道、引用块解析、视频桥；
 * - useConceptActions / useLibraryActions / useScheduleFlow / useWorkflowStarters /
 *   useExplorerUndo / examTools —— 选区动作、库动作、日程、工作流启动器、撤回、试卷工具。
 *
 * renderGroup / renderLayout 刻意留在这里（见它们头上的说明）——
 * 它们与页签编排的派生值咬合最深，是下一轮拆分的对象。
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
import { Upload } from 'lucide-react'
import type {
  DocKind,
  DocView,
  KnowledgeNode,
  LearnStore,
  LearnTab,
  TabRef,
  WebTabMeta,
  LearningGoal,
} from '../../learn/types'
import { notesOf } from '../../learn/types'
import { recentOpens, type RecentOpen } from '../../learn/recents'
import {
  activateIn,
  activeIdsOf,
  allTabs,
  claimTab,
  closeIds,
  findTab,
  focusedGroup,
  focusedTab,
  goalTabsOf,
  groupIdOfTab,
  groupOf,
  openAnchorOutline,
  patchTab,
  reconcileOwners,
  reorderIn,
  settle,
  syncGoalOutlineTabs,
  visibleTabs,
  withGroup,
  withOwners,
  type DocLayout,
} from '../../learn/groups'
import { isTabPinned, reorderTabs, tabKey, tabNodeId, tabTitle, tabTrail, fileNameOf as localFileNameOf } from '../../learn/tabs'
import { setZenActive } from '../../learn/zen'
import type { BrowserDeps } from '../../learn/web/browserOps'
import { webviewOf } from '../../learn/web/webviewRegistry'
import {
  addConversation,
  conversationById,
  deleteConversation,
  ensureConversation,
  latestConversation,
  resolveDisplayedConversation,
  nodeById,
} from '../../learn/graph'
import {
  agentTabKey,
  upsertAgentTab,
  visibleAgentTabs,
  withAgentTabs,
} from '../../learn/agentTabs'
import type { AgentTabRef } from '../../learn/types'
import { attemptBrief, examAttempted, examTotalPoints } from '../../learn/exam'
import { useExamBridge } from '../../learn/useExamBridge'
import { makeConversation, nodeDocRel } from '../../learn/store'
import { loadAgentSettings, subscribeAgentSettings } from '../../agent/settings'
import { subscribeDrops } from '../../agent/contextDebug'
import { freeConversationById, getFreeConversations, subscribeFreeChat } from '../../learn/freeChat'
import ExportDialog from './ExportDialog'
import FloatWindow from '../FloatWindow'
import { usePresence } from '../../lib/presence'
import StructOverlay from './workspace/StructOverlay'
import { pruneImages } from '../../learn/images'
import { queueOf, shouldEnqueue } from '../../learn/agentQueue'
import { nodePathOf } from '../../learn/paths'
import { nodeDocPath } from '../../learn/files'
import { createNodeDocImageResolver, type LocalImageResolver } from '../../lib/docImages'
import { revealLocalFile, revealPath } from '../../lib/storage'
import { useAppearance } from '../../lib/appearance'
import { useLearnStore } from '../../learn/useLearnStore'
import { useShortcut } from '../../lib/useShortcut'

import { syncProxyHosts } from '../../ai/http'
import {
  activeLabel,
  allProviderBaseUrls,
  globalEffort,
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
import { focusAgentInput } from '../../lib/agentFocus'
import { moveTabMark, resetTabMark } from '../../lib/tabMark'
import { focusWebAddress } from './web/addressFocus'
import { readSuperDoc } from '../../learn/superdocs'
import { superDocsOf } from '../../learn/types'
import { findMethod, runMethodEntry } from '../../learn/methods'
import { learnSandboxOps } from '../../learn/useAgent'
import { buildStandaloneApi } from '../../agent/tools'
import { isWeb, native } from '../../lib/native'
import EssayDock from './essay/EssayDock'
import { useDoubleCtrl } from '../../lib/useDoubleCtrl'
import type { DocSource } from './NodeNote'
import ConfirmDialog from '../ConfirmDialog'
import ContextDebugger from '../agent/ContextDebugger'
import { resetPrefixGate } from '../../agent/prefixGate'
import { docAreaElement, locateNeedle, scrollToDoc, visibleDocBody } from '../../lib/docDom'
import { nodeRevealKey, requestSourceReveal } from '../../lib/docReveal'
import { readRecentTabs, residentIds } from '../../learn/resident'
import type { UiPointRequest } from '../../agent/tools'
import type { Conversation } from '../../agent/types'
import type { Props } from './workspace/constants'
import { SIDE_ANIM_MS } from './workspace/constants'
import { emptyNote, paneInfo, paneOf } from './workspace/panes'
import { DocPane } from './workspace/DocPane'
import { ScheduleDock } from './workspace/docks'
import ToolsButton from '../tools/ToolsButton'
import ScreenshotModal from '../tools/ScreenshotModal'
import { Topbar } from './workspace/chrome'
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
import { goalFocusByGoal } from './workspace/goalFocus'
import { useTraceWindow } from './workspace/useTraceWindow'
import { useScreenshotTool } from './workspace/useScreenshotTool'
import { useMemoryActions } from './workspace/useMemoryActions'
import { useFavorites } from './workspace/useFavorites'
import { useUnrTransfer } from './workspace/useUnrTransfer'
import { useEssayFlow } from './workspace/useEssayFlow'
import { useWsActions } from './workspace/useWsActions'
import { useCanvasChannel } from './workspace/useCanvasChannel'
import { useAgentTabActions } from './workspace/useAgentTabActions'
import { useDeleteFlows } from './workspace/useDeleteFlows'
import { DeleteConfirms } from './workspace/DeleteConfirms'
import { AgentSlot } from './workspace/AgentSlot'
import { useHostWiring } from './workspace/useHostWiring'
import { renderGroupBody } from './workspace/GroupBody'
import { useTabOpening } from './workspace/useTabOpening'
import { useChipOpening } from './workspace/useChipOpening'
import { t } from '../../i18n'

/**
 * 没有随笔时的空数组常量已随随笔域迁入 workspace/useEssayFlow。
 */


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

  // 结构页签保底去重与对齐：目标换根、历史并发开签等情况可能导致重复的结构页签，此处保证全局至多一枚
  useEffect(() => {
    const synced = syncGoalOutlineTabs(store.docArea, store.goals)
    if (synced !== store.docArea) {
      set({ ...store, docArea: synced })
    }
  }, [store.goals, store.docArea, set])
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
  /*
   * 上下文轨迹：独立 Electron 窗口（见 workspace/useTraceWindow）。
   * 主窗口是数据拥有者：打开时把当前激活会话整份递过去，开着期间随数据变化持续 push。
   */
  const { openContextTrace } = useTraceWindow({ store })
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
  /* 删除确认流的五个 pending 状态与提交动作：见 workspace/useDeleteFlows（useWsActions 之后挂载） */
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
  // 双击 Ctrl 或快捷键（默认 F2）：唤出 / 收起节点宇宙浮层
  useDoubleCtrl(toggleStructOverlay)
  useShortcut('learn.structPopout', { down: toggleStructOverlay })

  /* ---------- 实用工具箱：屏幕截图（见 workspace/useScreenshotTool） ---------- */
  const { screenshotImage, setScreenshotImage, handleStartScreenshot } = useScreenshotTool({ onToast })

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
   * 记忆的写入口（见 workspace/useMemoryActions）：目标由调用方给——工作记忆落进哪个
   * 目标，由页签携带的 goalId 或设置页里的选择决定，不随活动目标漂移。
   */
  const { memoryCreate, memoryUpdate, memoryDelete, memoryClearWork } = useMemoryActions({ getLatest, set })

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
      tabTitle(t.ref, (id) => nodeById(store, id)?.title, examTabTitle, (vid) => store.videoNodes?.find((vn) => vn.id === vid)?.title ?? store.videos?.find((v) => v.id === vid)?.title),
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
  const { docScale, editorScale } = useAppearance()

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
  const openTabRef = useRef<(ref: TabRef, preferredView?: DocView) => void>(() => {})
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

  /* ---------- agent 栏页签（见 learn/agentTabs 与 AgentTabStrip）：见 workspace/useAgentTabActions ---------- */
  const {
    openAgentTab,
    activateAgentTab,
    docGoalIds,
    closeAgentTabMode,
    closeAgentTab,
    reorderAgentTabList,
    agentTabTitle,
    agentTabRunning,
    fixAgentTabsAfter,
  } = useAgentTabActions({ store, getLatest, set, onToast, tabs, agent })

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
  /* ---------- 打开与跳转（openTab/retarget/目标页签组/内置浏览器网页签）：见 workspace/useTabOpening ---------- */
  const {
    retargetNode,
    openTab,
    aliveGoalTabGroups,
    switchGoalGroup,
    openGoalGroup,
    activateTab,
    webMeta,
    patchWebMeta,
    pendingJumpsRef,
    openWebTab,
    openBlankTab,
    commitWebUrl,
    closeAgentTabsForGoals,
    dropGoalCache,
  } = useTabOpening({ store, getLatest, set, setSidebarOpen, setOutlineFocus, openTabRef, openSettingsRef })
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

  /* ---------- 收藏（页签右键菜单 / 地址栏星标 / 侧栏收藏区）：见 workspace/useFavorites ---------- */
  const {
    isTabFavorite,
    isUrlFavorite,
    toggleTabFavorite,
    toggleUrlFavorite,
    openFavorite,
    dropFavorite,
    setFavGroup,
    createFavGroup,
    renameFavGroup,
    removeFavGroup,
    renameFavTitle,
    favoriteTitleOf,
  } = useFavorites({ store, getLatest, set, webMeta, examTabTitle, openTab })


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
      execJs: async (tabId, script) => {
        const wv = webviewOf(tabId)
        if (!wv || typeof wv.executeJavaScript !== 'function') {
          throw new Error('网页页签尚未挂载或已销毁：' + tabId)
        }
        return await wv.executeJavaScript(script)
      },
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

  /** 固定/取消固定某一格里的页签，重排确保固定页签在最前面 */
  const toggleTabPin = useCallback(
    (group: string, tab: LearnTab) => {
      if (tab.ref.kind === 'outline') return
      const s = getLatest()
      const docs = s.docArea
      const g = groupOf(docs, group)
      if (!g) return
      const nextPinned = !isTabPinned(tab)
      const nextTabs = g.tabs.map((t) => (t.id === tab.id ? { ...t, pinned: nextPinned } : t))
      const reordered = reorderTabs(nextTabs, nextTabs.map((t) => t.id))
      set({ ...s, docArea: settle(withGroup(docs, group, (cur) => ({ ...cur, tabs: reordered }))) })
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

  /* ---------- 随笔（见 learn/essays 与 components/learn/essay）：见 workspace/useEssayFlow ---------- */
  const [essayOpen, setEssayOpen] = useState(false)
  const essayBtnRef = useRef<HTMLButtonElement | null>(null)
  const {
    essayGoalId,
    essayList,
    essayCreate,
    essayUpdate,
    essayDelete,
    essayGeometry,
    dockNotes,
    dockWriteNote,
    dockDeleteNote,
    essayCommits,
    essayCommit,
    essayCommitRetry,
    essayOpenNote,
  } = useEssayFlow({ store, getLatest, set, patchQuiet, docNode, agent, hasKey, onToast, openTab, setEssayOpen })

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

  /* ---------- .unr 目标分享包（导出 / 导入 / 全屏拖拽遮罩）：见 workspace/useUnrTransfer ---------- */
  const { handleExportGoal, handleImportGoal, isDraggingFile } = useUnrTransfer({ getLatest, set, flush, openTab, onToast })

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

  /** 打开某一次考试的只读副本页签（试卷 + 作答 + 判分 + 错题讲解） */
  const openExamCopy = (nodeId: string, examId: string, attemptId: string) => {
    openTab({ kind: 'exam', nodeId, examId, attemptId })
  }
  /* ---------- chip 引用与就地打开（拖放落点/引用点击/空白页就地按钮）：见 workspace/useChipOpening ---------- */
  const {
    tabDocPayload,
    openChip,
    openChipInGroup,
    openWebInPlace,
    openNewGoalInPlace,
    openNewFileInPlace,
    pickLocalInPlace,
  } = useChipOpening({ getLatest, set, onToast, openTab, activateTab, openWebTab, selectNode: switchNode, exam, retargetNode, setOutlineFocus, setCreateGoalOpen, webMetaRef, examTabTitle })
  /* ---------- 宿主接线（chip/插件/赞助/视频块/引用块/plot/静态资源/网页链接/effort 提醒）：见 workspace/useHostWiring ---------- */
  useHostWiring({
    onToast,
    activeGoalId,
    store,
    getLatest,
    set,
    openWebTab,
    openChip,
    openTab,
    docNode,
    docSource,
    agent,
  })

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

  /* ---------- 工作区文件（定位 / 打开 / 新建改名 / 项目）：见 workspace/useWsActions ---------- */
  const { revealWsFile, openWsFile, wsActions, newProject, goalSubtreeSize } = useWsActions({ getLatest, flush, openTab, onToast })

  /* ---------- 删除确认流（删目标/节点、删试卷两档、删笔记、删超级文档）：见 workspace/useDeleteFlows ---------- */
  const {
    pendingDelete,
    setPendingDelete,
    pendingExamDelete,
    setPendingExamDelete,
    examDeleteStage,
    setExamDeleteStage,
    pendingNoteDelete,
    setPendingNoteDelete,
    pendingSuperDelete,
    setPendingSuperDelete,
    commitRemoveExam,
    requestRemoveNode,
    commitRemoveNode,
  } = useDeleteFlows({ getLatest, set, onToast, pushUndo, goalSubtreeSize, fixAgentTabsAfter })

  /* ---------- 结构画布通道（建 / 删 / 连 / 改名，与 agent 的 api.node 同一条 NodeService 路）：见 workspace/useCanvasChannel ---------- */
  const { requestGenerateDoc, updateStructure, canvasChannel } = useCanvasChannel({
    store,
    getLatest,
    set,
    onToast,
    openTab,
    exam,
    hasKey,
    providerName,
    onOpenSettings,
    agent,
    startPrereqOutline,
    startVideoOverview,
    goalSubtreeSize,
    setPendingDelete,
    setPendingExamDelete,
    setExamDeleteStage,
  })

  const handleOutlineFocusHandled = useCallback(() => {
    setOutlineFocus(null)
  }, [])

  /** 删除目标/节点：含全部下级知识点、对话与试卷，先确认再删；Ctrl+Z 可撤回 */

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
          onUpdateNotepads: (notepads) => {
            const s = getLatest()
            const nextNodes = s.nodes.map((n) => (n.id === node.id ? { ...n, notepads } : n))
            set({ ...s, nodes: nextNodes })
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

  /*
   * 一格正文的完整渲染：见 workspace/GroupBody（页签栏、页签类型分派、
   * 常驻层、查找条、悬浮组、落点高亮）。格内派生在 GroupBody 里现算，
   * 宿主能力从这里一次性喂入。
   */
  const renderGroup = (groupId: string) =>
    renderGroupBody({
      groupId,
      store,
      docs,
      getLatest,
      set,
      onToast,
      openTab,
      onRootChanged,
      tabOwners,
      shownTabIds,
      residentPanes,
      activeGoalId,
      activeTab,
      docView,
      docSource,
      docPending,
      unsavedIds,
      tabTrails,
      webMeta,
      patchWebMeta,
      outlineFocus,
      handleOutlineFocusHandled,
      pure,
      pureMoving,
      toggleZen,
      essayGoalId,
      setEssayOpen,
      essayBtnRef,
      findMode,
      findTick,
      setFindMode,
      docSaving,
      docSaveError,
      localSaved,
      localTicks,
      editDocSource,
      stageLocalDraft,
      stageNewFileDraft,
      saveDocNow,
      closeTab,
      setTabView,
      rememberScroll,
      docScale,
      editorScale,
      activateTab,
      reorderTabList,
      toggleTabPin,
      onTabDragMove,
      onTabDrop,
      tabDrag,
      tabDocPayload,
      openChipInGroup,
      openNewFileInPlace,
      pickLocalInPlace,
      openWebInPlace,
      openNewGoalInPlace,
      openWebTab,
      openBlankTab,
      commitWebUrl,
      pendingJumpsRef,
      isTabFavorite,
      toggleTabFavorite,
      isUrlFavorite,
      toggleUrlFavorite,
      favoriteTitleOf,
      openFavorite,
      blankRecents,
      openRecent,
      scheduleActions,
      scheduleRinging,
      memoryCreate,
      memoryUpdate,
      memoryDelete,
      memoryClearWork,
      agentSettings,
      hasKey,
      debugWin,
      openContextTrace,
      workflowRows,
      runWorkflowRow,
      removeWorkflowRow,
      requestGenerateDoc,
      getNoteActions,
      agent,
      updateStructure,
      explorerDocs,
      explorerExams,
      canvasChannel,
      runSuperMethod,
      onDocPointerDown,
      docMarkMoved,
      docBox,
      groupHosts,
      stripHosts,
      examTabTitle,
    })

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
      onExportGoal: (goalId) => void handleExportGoal(goalId),
    }),
    [selectNode, handleExportGoal, openTab, createNodeNote, newExam, startSuperLab, renameNodeNote, openExamCopy, startOutline, exportTab, newProject],
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
        onImportGoal={() => void handleImportGoal()}
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
        onOpenEssay={() => setEssayOpen(true)}
        onOpenSchedule={() => openTab({ kind: 'schedule' })}
        onOpenSettings={() => openTab({ kind: 'settings' })}
        onOpenFind={() => setFindMode('find')}
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
                    triggerRef={essayBtnRef}
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
              <AgentSlot
                deps={{
                  store,
                  getLatest,
                  set,
                  agent,
                  freeChats,
                  currentFreeConvId,
                  setFreeConvId,
                  onToast,
                  openTab,
                  effort,
                  setGlobalEffort,
                  hasKey,
                  providerName,
                  vision,
                  agentSettings,
                  setSettingsEpoch,
                  stripTabs,
                  agentPanes,
                  activeAgentTab,
                  activeAgentTabId,
                  docGoalIds,
                  agentTabTitle,
                  agentTabRunning,
                  activateAgentTab,
                  closeAgentTab,
                  closeAgentTabMode,
                  reorderAgentTabList,
                  openAgentTab,
                  handleNewGoalConversation,
                  removeConversation,
                  newConversationIn,
                  selectConversationIn,
                  pruneImagesOf,
                  startSuperLab,
                  newExam,
                  shouldWaitInLine,
                }}
              />
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

      {/* 删除类确认框（删目标/节点、删试卷两档、删笔记、删超级文档）：见 workspace/DeleteConfirms */}
      <DeleteConfirms
        pendingDelete={pendingDelete}
        commitRemoveNode={commitRemoveNode}
        onCancelRemoveNode={() => setPendingDelete(null)}
        pendingExamDelete={pendingExamDelete}
        examDeleteStage={examDeleteStage}
        commitRemoveExam={commitRemoveExam}
        onCancelExam={() => setPendingExamDelete(null)}
        pendingNoteDelete={pendingNoteDelete}
        commitRemoveNote={commitRemoveNote}
        onCancelNote={() => setPendingNoteDelete(null)}
        pendingSuperDelete={pendingSuperDelete}
        commitRemoveSuperDoc={commitRemoveSuperDoc}
        onCancelSuper={() => setPendingSuperDelete(null)}
        getLatest={getLatest}
      />

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
      {isDraggingFile && (
        <div className="pointer-events-none fixed inset-0 z-[100] flex flex-col items-center justify-center bg-paper/85 backdrop-blur-sm border-2 border-dashed border-seal/60 m-4 rounded-2xl shadow-2xl transition-all">
          <div className="flex flex-col items-center gap-3 p-8 rounded-xl bg-card border border-line-strong shadow-xl">
            <Upload size={38} className="text-seal animate-bounce" />
            <div className="text-base font-semibold text-ink-strong">{t('释放鼠标导入目标 (.unr)')}</div>
            <div className="text-xs text-ink-faint">{t('支持拖入 .unr 目标包')}</div>
          </div>
        </div>
      )}
    </div>
  )
}

