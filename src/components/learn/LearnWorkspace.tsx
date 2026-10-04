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
 * - usePomodoroFlow            —— 番茄钟动作；
 * - useWorkflowStarters        —— 一切「交给导师工作流跑」的启动器。
 *
 * renderGroup / renderLayout 刻意留在这里（见它们头上的说明）。
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type {
  DocKind,
  DocView,
  FavoriteRef,
  KnowledgeNode,
  LearnStore,
  LearnTab,
  OutlineEntry,
  TabRef,
  WebTabMeta,
} from '../../learn/types'
import { emptyDocs, emptyOutline, notesOf } from '../../learn/types'
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
import { getOutlineSlot } from '../../lib/outline'
import {
  activateIn,
  activeIdsOf,
  allTabs,
  closeIds,
  findTab,
  focusedGroup,
  focusedTab,
  groupIdOfTab,
  openInGroup,
  patchTab,
  reorderIn,
  setFocus,
  type DocLayout,
} from '../../learn/groups'
import { makeTab, newWebKey, tabIndex, tabKey, tabNodeId, tabTitle, tabTrail, fileNameOf as localFileNameOf } from '../../learn/tabs'
import { normalizeWebInput } from '../../learn/webUrl'
import type { BrowserDeps } from '../../learn/web/browserOps'
import {
  addConversation,
  deleteConversation,
  deleteMessage,
  deleteNode,
  ensureConversation,
  goalSubtreeIds,
  nodeById,
  nodeStructure,
  normalizeKey,
  removeExam,
  touchNode,
  updateMessageText,
} from '../../learn/graph'
import { attemptBrief, examAttempted, examTotalPoints } from '../../learn/exam'
import type { Exam } from '../../learn/exam'
import { useExamBridge } from '../../learn/useExamBridge'
import { captureExamDelete, captureNodeDelete } from '../../learn/undo'
import {
  applyReadingDelta,
  emptyReading,
  readToday,
  readingDay,
  readingDocKey,
  readingOfGoal,
  withGoalReading,
} from '../../learn/reading'
import { makeConversation, makeGoal, nodeDocRel } from '../../learn/store'
import { loadAgentSettings, saveAgentSettings, subscribeAgentSettings } from '../../agent/settings'
import { personaOf } from '../../agent/persona'
import AgentSettingsModal from '../AgentSettingsModal'
import ExportDialog from './ExportDialog'
import FloatWindow from '../FloatWindow'
import { usePresence } from '../../lib/presence'
import { animate } from 'animejs'
import ExamCopyView from './ExamCopyView'
import OutlineView from './OutlineView'
import { pruneImages } from '../../learn/images'
import {
  cachedResourceUrl,
  findResource,
  loadResourceImage,
  revealResource,
  subscribeResources,
} from '../../learn/static'
import { nodePathOf } from '../../learn/paths'
import { nodeDocPath } from '../../learn/files'
import { createNodeDocImageResolver } from '../../lib/docImages'
import { revealLocalFile, revealPath, revealUserPath, userAbsPath, refreshStorageRoot, listUserDir, mkdirUserPath, moveUserPath, copyUserPath, writeUserText } from '../../lib/storage'
import { wsAllocateName, wsNameOk } from '../../learn/workspace'
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
import ExplorerSidebar from './ExplorerSidebar'
import { focusAgentInput } from '../../lib/agentFocus'
import { moveTabMark, resetTabMark } from '../../lib/tabMark'
import { setChipOpener, type ChipPayload } from '../../lib/docChip'
import { tabRefFromChip } from '../../learn/chipRef'
import { CHIP_MIME, parseChipJson } from '../../lib/chipSyntax'
import TabBar from './TabBar'
import WebTabLayer, { type WebTab } from './web/WebTabLayer'
import { focusWebAddress } from './web/addressFocus'
import FindBar from './FindBar'
import SuperDocView from './SuperDocView'
import { readSuperDoc } from '../../learn/superdocs'
import { superDocsOf } from '../../learn/types'
import { findMethod, runMethodEntry } from '../../learn/methods'
import { learnSandboxOps } from '../../learn/useAgent'
import { buildStandaloneApi } from '../../agent/tools'
import { isElectron, native } from '../../lib/native'
import DocFloat from './DocFloat'
import LocalDoc from './LocalDoc'
import SourceEditor from './SourceEditor'
import type { DocSource } from './NodeNote'
import ConfirmDialog from '../ConfirmDialog'
import AgentPanel from '../agent/AgentPanel'
import ContextDebugger from '../agent/ContextDebugger'
import { resetPrefixGate } from '../../agent/prefixGate'
import { docAreaElement, locateNeedle, scrollToDoc, visibleDocBody } from '../../lib/docDom'
import { publishReadingDay } from '../../lib/readingPulse'
import { residentIds, useRecentTabs } from '../../learn/resident'
import type { UiPointRequest } from '../../agent/tools'
import type { Props } from './workspace/constants'
import { SRC_SCROLL_SUFFIX, SIDE_ANIM_MS } from './workspace/constants'
import { ZONE_BOX } from './workspace/drag'
import { examDeleteWarn } from './workspace/labels'
import { conceptKeysOf, emptyNote, examCopyOf, paneInfo, paneOf } from './workspace/panes'
import { DocPane } from './workspace/DocPane'
import { CheckinDock, PomodoroDock, ReadingDock, ReviewDock } from './workspace/docks'
import { EmptyDoc, GoalInput, NodeHints, Topbar } from './workspace/chrome'
import { useSideColumns } from './workspace/useSideColumns'
import SplitRow from './workspace/SplitRow'
import { useDocSaveFlow } from './workspace/useDocSaveFlow'
import { useExportFlow } from './workspace/useExportFlow'
import { useTabDnd } from './workspace/useTabDnd'
import { useLinkHandlers } from './workspace/useLinkHandlers'
import { useLibraryActions } from './workspace/useLibraryActions'
import { useExplorerUndo } from './workspace/useExplorerUndo'
import { useConceptActions } from './workspace/useConceptActions'
import { usePomodoroFlow } from './workspace/usePomodoroFlow'
import { useWorkflowStarters } from './workspace/useWorkflowStarters'
import { examNeedingWork, makeExamDeps } from './workspace/examTools'
import { t } from '../../i18n'

export default function LearnWorkspace({
  user,
  onOpenSettings,
  onOpenUser,
  onSignOut,
  onToast,
  onOpenUpdate,
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
  const tabs = useMemo(() => allTabs(docs), [docs])
  const activeTab = useMemo(() => focusedTab(docs), [docs])
  const activeTabId = activeTab?.id ?? null

  /**
   * agent 自己的设置（压缩阈值等）。
   *
   * 走 useSyncExternalStore 而不是 useState+effect：它是模块级缓存（见 agent/settings），
   * 在独立窗口里改了之后宿主这边的快照要能跟着变——订阅是唯一能拿到那次通知的口子。
   */
  const agentSettings = useSyncExternalStore(subscribeAgentSettings, loadAgentSettings)
  const [creating, setCreating] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  /*
   * 学习状态与试卷**都没有应用内的窗口**：两块都是文档区右上角悬浮组里的一块 tip
   * （鼠标经过即展开，见 components/learn/DocFloat），试卷的作答在独立的考试窗口里
   * （见 learn/useExamBridge 与 ExamWindow）。所以这里没有它们的开关。
   */
  // 超级导师设置：一个弹窗（与全局设置分开的另一份配置，见 agent/settings）
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false)
  /** 上下文比对调试器：悬浮窗口（可拖动），只在开发者模式里打开（见 AgentSettingsModal） */
  const debugWin = usePresence()
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
  // 删除确认：pendingDelete 非空时弹出确认框（整棵子树会一起没，问一句再删）
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
  /** 上一个激活的页签：过场的方向（往左切还是往右切）由它和当前项比出来 */
  const prevTab = useRef<{ id: string | null; index: number }>({ id: null, index: -1 })

  // 挂载时按当前用户的配置同步一次代理白名单：
  // 每个用户的提供商地址各不相同（自定义中转尤其），换用户后必须重新同步，
  // 否则主进程还留着上一个用户的名单，新地址会被 403 拦掉。
  useEffect(() => {
    void syncProxyHosts(allProviderBaseUrls())
  }, [])

  const activeNodeId = store.activeNodeId
  const activeNode = activeNodeId ? (nodeById(store, activeNodeId) ?? null) : null
  const activeGoal = activeNode ? (store.goals.find((g) => g.id === activeNode.goalId) ?? null) : null
  const activeGoalId = activeGoal?.id ?? null
  const activeConversationId = store.activeConversationId

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
    const title = tabTitle(ref, (id) => nodeById(s, id)?.title, examTabTitle)
    if (ref.kind === 'local') return { type: 'local', path: ref.path, title }
    if (ref.kind === 'web') {
      // 起始页没有可引用的东西；网页引用带网址与活标题（没拿到标题时 chipLabel 显示域名兜底）
      if (!ref.url) return null
      const m = webMetaRef.current[tabKey(ref)]
      return { type: 'web', url: ref.url, ...(m?.title ? { title: m.title } : {}) }
    }
    if (ref.kind === 'exam') {
      return { type: 'attempt', nodeId: ref.nodeId, examId: ref.examId, attemptId: ref.attemptId, title }
    }
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
    const names = tabs.map((t) => tabTitle(t.ref, (id) => nodeById(store, id)?.title, examTabTitle))
    const count = new Map<string, number>()
    for (const n of names) count.set(n, (count.get(n) ?? 0) + 1)
    const out: Record<string, string> = {}
    tabs.forEach((t, i) => {
      if ((count.get(names[i]) ?? 0) < 2) return
      out[t.id] = tabTrail(t.ref, (id) => {
        const node = nodeById(store, id)
        return node ? nodePathOf(store, node.goalId, id) : ''
      })
    })
    return out
  }, [tabs, store, examTabTitle])

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

  // 最近激活过的页签（常驻名额按它排，见 learn/resident 的 touchRecent）
  const recentTabs = useRecentTabs()

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
  /** 会话属于目标，因此对话列表也按目标取 */
  const goalConversations = useMemo(
    () => (activeGoalId ? store.conversations.filter((c) => c.goalId === activeGoalId) : []),
    [store.conversations, activeGoalId],
  )

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
  const { agentLeft, sideCollapsed, toggleSide, expandSide, swapTo, pure, pureMoving, setPure } = side

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
  const nodeImageResolver = useCallback(
    (nodeId: string, kind: DocKind, note?: string) =>
      createNodeDocImageResolver({
        dirRel: () => {
          const p = nodeDocPath(getLatest(), nodeId, { kind, note })
          // 教学文档是「目录/节点.md」、笔记是「目录/节点.notes/名字.md」——文档所在目录就是往前一级
          return p ? p.replace(/\/[^/]*$/, '') : null
        },
      }),
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
  /** browser.* 的宿主依赖槽：真正的值在 web 块里（openWebTab / webMeta 声明靠后），effect 里回填 */
  const browserDepsRef = useRef<BrowserDeps | null>(null)

  const agent = useAgent({
    store,
    set,
    getLatest,
    goalId: activeGoalId,
    nodeId: activeNodeId,
    conversationId: activeConversationId,
    onNeedKey: () => {
      onToast(t('请先在设置中填写「{0}」的 API Key', providerName))
      onOpenSettings()
    },
    onNotice: onToast,
    examDeps: (nodeId) =>
      makeExamDeps({ getLatest, set, onToast, openTabRef, setCreating }, nodeId),
    // ui.* 的宿主能力：都是「界面在场才有的动作」，见 AgentUiDeps
    ui: {
      switchMain: (main) => swapTo(main === 'agent'),
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
    // browser.*：依赖在 web 块里（openWebTab / webMeta 声明在 useAgent 之后），这里只给取法
    browserDeps: () => browserDepsRef.current ?? undefined,
  })

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
   */
  const retargetNode = useCallback(
    (s: LearnStore, nodeId: string): LearnStore => {
      const node = nodeById(s, nodeId)
      if (!node) return s
      const conv = s.activeConversationId
        ? s.conversations.find((c) => c.id === s.activeConversationId)
        : undefined
      if (conv && conv.goalId === node.goalId) {
        if (node.id === s.activeNodeId && s.activeGoalId === node.goalId) return s
        return { ...s, activeGoalId: node.goalId, activeNodeId: node.id }
      }
      /*
       * ensureConversation 只调一次：目标里一段对话都没有时它会**新建**一段，
       * 调两次就会建出两段不同的（各带一个 uuid），而 store 里只留了前一段、
       * activeConversationId 却是后一个——对话栏于是指向一段不存在的对话，一片空白。
       */
      const ensured = ensureConversation(s, node.goalId)
      return {
        ...ensured.store,
        activeGoalId: node.goalId,
        activeNodeId: node.id,
        activeConversationId: ensured.conversationId,
      }
    },
    [],
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
    (ref: TabRef) => {
      const s = getLatest()
      const nodeId = tabNodeId(ref)
      const node = nodeId ? nodeById(s, nodeId) : undefined
      if (nodeId && !node) return
      const base = node ? touchNode(retargetNode(s, node.id), node.id) : s
      /*
       * 空笔记当场定下「源码（编辑）视图」：这个默认值是按正文现算的，
       * 而用户敲下第一个字它就翻回预览了（见 emptyNote 与 learn/tabs 的 viewOf）。
       */
      const startView: DocView | undefined =
        ref.kind === 'note' && emptyNote(s, makeTab(ref, 0)) ? 'source' : undefined
      set({
        ...base,
        docArea: openInGroup(base.docArea, base.docArea.focus, ref, Date.now(), startView),
      })
      setSidebarOpen(false)
      setCreating(false)
    },
    [getLatest, retargetNode, set],
  )
  // 回填放在 effect 里（渲染期不许写 ref）：openTab 的身份随依赖变，每次渲染后换成最新的一份
  useEffect(() => {
    openTabRef.current = openTab
  })

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
      const nodeId = tabNodeId(tab.ref)
      const base = nodeId ? retargetNode(s, nodeId) : s
      // activateIn 顺手把焦点挪到那一格：点别处的页签，接下来的动作（开文档、Ctrl+W）都该落在那一格
      set({ ...base, docArea: activateIn(base.docArea, group, id) })
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
      const s = getLatest()
      // ref 当场算好（页签身份就是 tabKey），开完直接回页签 id——browser.open 靠它指名
      const ref: TabRef = { kind: 'web', url: normalizeWebInput(url), key: newWebKey() }
      set({ ...s, docArea: openInGroup(s.docArea, s.docArea.focus, ref, Date.now()) })
      return tabKey(ref)
    },
    [getLatest, set],
  )

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

  /*
   * 保存 / 关页签 / 冲突流整体在 useDocSaveFlow（workspace/）：
   * 暂存入口、Ctrl+S、关页签、两个确认框、本地文件监听是同一条链上的环节，拆开反而难读。
   */
  const {
    editDocSource,
    stageLocalDraft,
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
    const onMove = (ev: PointerEvent) => {
      // 右键已经松开（或换成了别的键）：这个手势结束了，不要再跟着指针挪棱形
      if ((ev.buttons & 2) === 0) return
      if (!moved) {
        // 手抖不算划：与拖页签同一个阈值口径（见 TabBar 的 DRAG_MIN）
        if (Math.abs(ev.clientX - startX) < 4) return
        moved = true
        docMarkMoved.current = true
      }
      moveTabMark(ev.clientX)
    }
    const onUp = () => {
      if (moved) resetTabMark()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  /**
   * 切页签的过场：新内容从切换方向那一侧轻轻滑进来。
   *
   * 用 Web Animations 而不是给容器换一个带动画的 class：同一个 class 连续设两次
   * 不会重播（第二次「往右切」就没有动画了），要重播就得先把元素卸载再挂回来——
   * 而重挂会把正文的滚动位置、正在编辑的光标一起丢掉。el.animate() 每次都是新动画，
   * 也不碰 DOM。
   *
   * 关掉动效偏好时整个跳过：这一段只是「换了」的润色，不是信息本身。
   */
  useLayoutEffect(() => {
    const id = activeTabId
    const prev = prevTab.current
    const nextIndex = tabIndex(tabs, id)
    prevTab.current = { id, index: nextIndex }
    if (!id || prev.id === null || prev.id === id) return
    const el = docBox.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const forward = prev.index < 0 || nextIndex >= prev.index
    const dx = forward ? 14 : -14
    /*
     * 起步值**先手动写进内联样式**，再交给 anime 收尾。
     *
     * 这是「不闪」的关键：anime 的动画在下一个 rAF 才真正开始写样式，
     * 而那之前浏览器已经要画一帧了——那一帧画的是**最终状态**（内容整个跳到位、
     * 亮度也已经满了），下一帧才回到起点重来，看上去就是一闪。
     * 先自己把起点写上，第一帧画出来就是起点；anime 从解析到的当前值出发走到 0。
     *
     * 放在 useLayoutEffect（而不是 useEffect）里同理：它在浏览器绘制之前跑完。
     */
    el.style.opacity = '0.5'
    el.style.transform = 'translateX(' + dx + 'px)'
    animate(el, {
      opacity: 1,
      x: 0,
      duration: 220,
      ease: 'out(3)',
      onComplete: () => {
        el.style.opacity = ''
        el.style.transform = ''
      },
    })
  }, [activeTabId, tabs])

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

  /** 打开「新建目标」页 */
  const startCreatingGoal = () => {
    setCreating(true)
    setSidebarOpen(false)
  }

  /*
   * moji:node / doc / super 三种链接的跳转注册在 useLinkHandlers（workspace/）。
   */
  useLinkHandlers({ getLatest, openTab, createNodeNote, onToast })

  /* ---------- 选中节点 / 对话 ---------- */

  const selectNode = switchNode

  /** 换一段对话：会话属于目标，所以切对话不换节点 */
  const selectConversation = (conversationId: string) => {
    set({ ...getLatest(), activeConversationId: conversationId })
    setSidebarOpen(false)
  }

  /** 在当前目标里另起一段对话（同一个目标可以有并行几段上下文） */
  const newConversation = () => {
    if (!activeGoalId) return
    const { store: withConv, conversation } = addConversation(getLatest(), activeGoalId)
    set({ ...withConv, activeConversationId: conversation.id })
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
    const next = deleteConversation(getLatest(), conversationId)
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

  /* ---------- 新建学习目标 ---------- */

  const startGoal = async (raw: string) => {
    const q = raw.trim()
    if (!q) return
    // 未配置 API Key 就不创建目标：没有超级导师，目标只剩一个空节点，
    // 既无大纲也开不了讲。这里现读一次设置（而非用渲染时的 hasKey），
    // 保证用户刚在设置里填完 Key 回来点「开始学习」能立刻通过。
    if (!hasApiKey()) {
      onToast(t('创建失败：请先配置「{0}」的 API Key', activeLabel()))
      onOpenSettings()
      return
    }
    const goalId = crypto.randomUUID()
    const now = Date.now()
    /**
     * 根节点先拿用户原话当临时标题占位，立刻建出来；正式标题与描述都交给 Agent
     * （见内置工作流「学习大纲」的「三件事」，learn/workflows）。
     *
     * 这样点「开始学习」当场就有节点、有侧栏条目、有对话开始跑，用户马上看到东西在动；
     * 旧流程要先等一次「生成描述」的模型往返，那几秒里界面是空的。标题随后会被
     * api.node.rename 改掉，数据目录名跟着变（改标题＝目录改名，早已支持）。
     */
    const rootNode: KnowledgeNode = {
      id: crypto.randomUUID(),
      title: q,
      key: normalizeKey(q),
      description: '',
      docs: emptyDocs(),
      notes: [],
      annotations: [],
      status: 'learning',
      origin: 'user',
      goalId,
      // 大纲与教学文档创建时同时成形（与 addNode 的脚手架同一口径；根节点是手工建的，这里补上）
      outline: { ...emptyOutline(), updatedAt: now },
      createdAt: now,
      updatedAt: now,
    }
    const goal = makeGoal(rootNode.id, q, goalId)
    const conversation = makeConversation(goalId)
    // 新目标当场把**大纲页**开成页签：导师这一轮的交付物就是它（「学习大纲」工作流往里写），
    // 用户点完「开始学习」就该看见路线逐条长出来，教学文档从大纲页里点进去
    const rootRef: TabRef = { kind: 'outline', nodeId: rootNode.id }
    const next: LearnStore = {
      ...store,
      nodes: [...store.nodes, rootNode],
      goals: [goal, ...store.goals],
      conversations: [...store.conversations, conversation],
      activeGoalId: goalId,
      activeNodeId: rootNode.id,
      activeConversationId: conversation.id,
      docArea: openInGroup(store.docArea, store.docArea.focus, rootRef, now),
    }
    set(next)
    setCreating(false)
    setSidebarOpen(false)

    // Key 已在上面校验过，此处可直接进入 AI 流程
    agent.autoTeach({ goalId, nodeId: rootNode.id, conversationId: conversation.id }, true)
  }

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
    onSubmitted: () => {
      if (!hasKey) {
        onToast(t('已交卷。判分与错题讲解需要 AI，请先在设置中填写「{0}」的 API Key', providerName))
        onOpenSettings()
        return
      }
      agent.runWorkflow('exam-grade')
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

  /*
   * 番茄钟动作在 usePomodoroFlow、导师工作流启动器在 useWorkflowStarters（都在 workspace/）。
   */
  const { startFocus, stopFocus, tickFocus } = usePomodoroFlow({ getLatest, set, onToast })
  const {
    startCheckin,
    startReview,
    backfillReviewPlan,
    newExam,
    requestGrading,
    setSelfReport,
    clearMistake,
    startRecall,
    startProbe,
    startSuperLab,
    startBrowserUse,
    startOutline,
    workflowRows,
    runWorkflowRow,
    removeWorkflowRow,
    setWorkflowEffortRow,
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

  /** 等着判分 / 讲解的那一次：按钮上标出来，也决定「新增」还能不能点 */
  const pendingWork = useMemo(
    () => (activeNodeId ? examNeedingWork(store, activeNodeId) : null),
    [store, activeNodeId],
  )
  // 判分 / 讲解是否进行中：由「Agent 是否在跑」与「有没有等着收尾的考试」组合推导，
  // 不用额外的 state + effect（否则每次状态变化都会多一轮渲染）
  const grading = agent.running && !!pendingWork

  /**
   * 当前文档为什么还是空的——文档区据此显示等待动画，而不是留一片白让用户怀疑卡了。
   *
   * 判据只有一条：Agent 正在跑，而且这一轮是系统代发的隐藏指令（节点刚建好）。
   * 少了后半句，用户在空文档的节点里自己提个问，也会被说成「正在撰写教学文档」。
   */
  const docPending = useMemo(() => {
    if (!docSource || docSource.content.trim()) return false
    const msgs = agent.conversation?.messages ?? []
    return agent.running && msgs[msgs.length - 1]?.hidden === true
  }, [docSource, agent.running, agent.conversation])

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
      const ref = tabRefFromChip(s, p)
      if (!ref) {
        onToast(t('这条引用对应的文档已经不在了'))
        return
      }
      openTab(ref)
    },
    [getLatest, openTab, selectNode, exam, onToast],
  )

  // chip 的「点击打开」全走这一份登记（消息列表、输入框都不认识 store，见 lib/docChip）
  useEffect(() => {
    setChipOpener(openChip)
    return () => setChipOpener(null)
  }, [openChip])

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
    const node = nodeById(getLatest(), nodeId)
    if (!node) return
    const isRoot = getLatest().goals.some((g) => g.rootNodeId === nodeId)
    setPendingDelete({ nodeId, title: node.title, isRoot, count: isRoot ? goalSubtreeSize(nodeId) : 1 })
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
   * 工作区文件在页签里打开：rel（相对当前用户）换算成磁盘绝对路径，开一份 local 页签——
   * 解析不解析看后缀（md/html 有预览，其余看源码，见 learn/tabs 的 viewOf）。
   * 数据根缓存还没就绪时现场刷一次再换算（启动头几拍点进来的兜底）。
   */
  const openWsFile = useCallback(
    async (rel: string) => {
      let abs = userAbsPath(rel)
      if (!abs) {
        await refreshStorageRoot()
        abs = userAbsPath(rel)
      }
      if (!abs) {
        onToast(t('现在打不开这个工作区文件（没有登录用户，或存储位置还没就绪）'))
        return
      }
      openTab({ kind: 'local', path: abs })
    },
    [openTab, onToast],
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
  const goalSubtreeSize = (rootId: string): number => {
    const goal = getLatest().goals.find((g) => g.rootNodeId === rootId)
    return goal ? goalSubtreeIds(getLatest(), goal.id).size : 1
  }

  /** 删除目标/节点：含全部下级知识点、对话与试卷，先确认再删；Ctrl+Z 可撤回 */
  const commitRemoveNode = () => {
    const pending = pendingDelete
    if (!pending) return
    setPendingDelete(null)
    // 先备货再动手：撤回项捕获的是删除前那一刻的旧引用（整棵子树、边、试卷、会话与两本账）
    const entry = captureNodeDelete(getLatest(), pending.nodeId)
    if (entry) pushUndo(entry)
    set(deleteNode(getLatest(), pending.nodeId))
    onToast(pending.isRoot ? t('已删除该学习目标，可按 Ctrl+Z 撤回') : t('已删除该节点，可按 Ctrl+Z 撤回'))
  }

  /**
   * 大纲页里「创建并开讲」：把大纲条目真的建成子目标。
   *
   * 复用 openConcept 的整条路径（建点、补描述、开教学文档页签、交给导师开讲），
   * 只是不改写父文档的链接——大纲条目不是正文里的词，没有可替换的链接。
   * 建出来的节点 key 与条目一致（都来自标题），大纲页靠它对上号。
   */
  const createOutlineChild = (parentNode: KnowledgeNode, entry: OutlineEntry) => {
    openConcept(parentNode.id, entry.title, { hint: entry.summary, rewriteLink: false })
  }

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
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      const active = group?.tabs.find((x) => x.id === group.active)
      if (active?.ref.kind === 'web') focusWebAddress()
      else openWebTab('')
    },
  })

  const hasContent = store.goals.length > 0 && activeNode

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
    const ref = tabRefFromChip(s, p)
    if (!ref) return
    const nodeId = tabNodeId(ref)
    const base = nodeId ? retargetNode(s, nodeId) : s
    set({ ...base, docArea: openInGroup(base.docArea, groupId, ref, Date.now()) })
  }

  const renderGroup = (groupId: string) => {
    const g = paneInfo(store, docs, groupId, examTabTitle)
    const gTab = g.tab
    /** 这一格显示的页签 id；回调里用（TS 的收窄穿不进闭包，见下面几处 onChange） */
    const gTabId = gTab?.id ?? ''
    const isFocused = groupId === docs.focus
    const gExam = examCopyOf(store, gTab)
    const panes = residentPanes.filter((p) => p.group === groupId)
    /** 这一格挂着的网页页签：WebTabLayer 常驻层只挂一份，切页签只藏不卸（见下） */
    const gWebTabs = (g.group?.tabs ?? []).filter((x): x is WebTab => x.ref.kind === 'web')
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
        className="flex min-h-0 min-w-0 flex-1 flex-col"
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
                tabs={g.group?.tabs ?? []}
                activeId={g.group?.active ?? null}
                titleOf={(ref) => tabTitle(ref, (id) => nodeById(store, id)?.title, examTabTitle)}
                trailOf={(ref) => tabTrails[tabKey(ref)] ?? ''}
                onActivate={activateTab}
                onClose={(id, mode) => closeTab(groupId, id, mode)}
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
                // 栏上空白处的右键菜单要开新网页页签（见 TabBar 的 BarMenu）
                onOpenWebTab={() => openWebTab('')}
              />
            </div>
          </div>
        </div>

        {/*
          前置缺口：它说的是**这一格显示的节点**（与正开着哪份文档无关），
          因此留在各自那一格顶上，不跟着页签走。
        */}
        {g.node && <NodeHints node={g.node} store={store} />}

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
          {/* 正文这一层：切页签的过场只加在它上面，右侧悬浮组不跟着晃。
              data-doc-area：大纲栏据此判断「焦点在不在文档区里」（固定时 Tab 切换展开收起） */}
          <div
            ref={isFocused ? docBox : undefined}
            {...boxProps}
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
            className="flex min-h-0 flex-1 flex-col"
          >
            {gTab?.ref.kind === 'web' ? (
              /*
                网页页签：正文不归 React 画（guest 进程自己渲染），由下面挂着的
                WebTabLayer 常驻层显示——这里只让出位置，别画任何东西。
              */
              null
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
                view={g.view}
                scale={docScale}
                draft={g.draft}
                savedText={localSaved?.path === gTab.ref.path ? localSaved.text : undefined}
                onDraft={(text) => stageLocalDraft(gTabId, text)}
                saving={docSaving}
                saveError={docSaveError}
                onMissing={() => closeTab(groupId, gTab.id, 'self', { confirm: false })}
                outlineSlot={getOutlineSlot(gTab.id)}
                // 空 md 默认进编辑（空预览是一片白）：读完内容发现是空的，从预览切过来
                onNeedEdit={() => setTabView(gTab.id, 'source')}
              />
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
            ) : gTab?.ref.kind === 'outline' && g.node ? (
              /*
                大纲页：结构化计划的交互视图（见 OutlineView）。它不走源码/预览、
                不进常驻列表、也没有暂存——层级计划要改，就在页上点「重排大纲」交给导师。
                key 绑节点：换一个目标就重挂，展开状态从头开始（那是「这一页」的状态）。
              */
              <OutlineView
                key={g.node.id}
                store={store}
                node={g.node}
                onOpenNode={(id) => openTab({ kind: 'teach', nodeId: id })}
                onCreateChild={createOutlineChild}
                onGenerate={(n) => startOutline(n.id)}
              />
            ) : gTab?.ref.kind === 'super' && g.node && g.superDoc ? (
              /*
                超级文档：一份完整的可交互 HTML。预览跑在沙箱化的 iframe 里
                （见 SuperDocView），源码视图直接改 HTML——暂存与 Ctrl+S 与
                其它文档同一套（保存写回 node.superdocs，见 saveDocNow）。
                key 绑「节点 + 名字」：换一份就重挂，脚本从头执行、状态归零。
              */
              g.view === 'source' ? (
                <SourceEditor
                  key={g.node.id + ':super:' + gTab.ref.name}
                  value={g.draft ?? g.superDoc.html}
                  onChange={(text) => editDocSource(gTabId, text)}
                  state={docSaving ? 'saving' : g.draft === undefined ? 'saved' : 'dirty'}
                  label={g.title}
                  scale={docScale}
                  scrollTop={store.docScroll[gTabId + SRC_SCROLL_SUFFIX]}
                  onScrollTop={(top) => rememberScroll(gTabId + SRC_SCROLL_SUFFIX, top)}
                  ext=".html"
                />
              ) : (
                <SuperDocView
                  key={g.node.id + ':super:' + gTab.ref.name}
                  html={g.superDoc.html}
                  onMethodCall={runSuperMethod}
                  // 文档里的 moji:super 链接：BRIDGE 拦截后转回来，走上面注册的同一个处理器
                  onSuperLink={(href) => {
                    const target = parseSuperHref(href)
                    if (target) handleSuperLink(target)
                  }}
                />
              )
            ) : g.node && g.source ? (
              g.view === 'source' ? (
                /*
                  源码视图：直接改 Markdown。改动先进**暂存区**（见 learn/drafts），
                  按 Ctrl+S 才写进文档——底栏上的「已保存 / 未保存」读的就是暂存区里
                  有没有这一份，而不是「store 落盘了没有」。
                */
                <SourceEditor
                  key={g.title + ':' + g.source.kind + ':' + (g.source.note ?? '')}
                  value={g.source.content}
                  onChange={(text) => editDocSource(gTabId, text)}
                  state={docSaving ? 'saving' : g.draft === undefined ? 'saved' : 'dirty'}
                  label={g.title}
                  scale={docScale}
                  ext=".md"
                  // 编辑位置与阅读位置各记各的：同一份文档在源码里改到一半、
                  // 切到预览又读到别处，共用一格会互相拽（见 learn/types 的 DocScroll）
                  scrollTop={store.docScroll[gTabId + SRC_SCROLL_SUFFIX]}
                  onScrollTop={(top) => rememberScroll(gTabId + SRC_SCROLL_SUFFIX, top)}
                />
              ) : null /* 预览那一份由下面的常驻列表渲染（见 DocPane） */
            ) : (
              <EmptyDoc onPickLocal={() => void pickLocal()} onOpenWeb={() => openWebTab('')} />
            )}

            {/*
              常驻的正文（见 DocPane）：每一格显示着的那一片显示，其余带着 hidden 留在 DOM 里。
              常驻片按**它所属的那一格**分派（见 residentPanes 的 group）：同一片正文在
              两处渲染会各自建一份 DOM，那就白常驻了。
            */}
            {panes.map(({ tab, node, source }) => {
              const paneActive = tab.id === gTab?.id && g.view === 'preview'
              return (
                <DocPane
                  key={tab.id}
                  tabId={tab.id}
                  active={paneActive}
                  node={node}
                  source={source}
                  // 待写提示说的是「agent 正在给这个节点写文档」，只有眼前这一片才有意义
                  pending={paneActive && docPending}
                  knownConceptKeys={conceptKeysOf(store, node)}
                  readingPaused={!!exam.live}
                  // 大纲句柄槽：每片正文对应自己页签的那一份（见 lib/outline 的 OutlineHandle）
                  outlineSlot={getOutlineSlot(tab.id)}
                  /*
                   * 导师栏占着中间主位时不算阅读（窄栏里跟读的时间丢，见 useReadingTracker）。
                   * 纯净阅读里正文独占整行——那当然算阅读，所以这一条要放行：
                   * 对调过两栏时（agentLeft），不收这一句的话，最该记账的那段时间反而记不上。
                   */
                  mainPane={!agentLeft || pure}
                  // 读到哪儿了：记在页签 id 上，重启回来接着读（见 lib/docScroll）
                  scrollTop={store.docScroll[tab.id]}
                  onScrollTop={(top) => rememberScroll(tab.id, top)}
                  note={{
                    onLearnConcept: (term) => void openConcept(node.id, term),
                    // 文档目录旁的图片（相对路径引用）：按「这一份文档自己的目录」解析成 data URL
                    // （见 lib/docImages——生产 CSP 不放行 file:，这是文档资源能显示的唯一通道）
                    resolveLocalImage: nodeImageResolver(node.id, source.kind, source.note),
                    onUnderstand: (term, occurrence, snippet) => understandConcept(node.id, term, occurrence, snippet),
                    onSaveAnnotation: (term, body, style, occurrence) =>
                      saveAnnotation(node.id, term, body, style, occurrence),
                    onDeleteAnnotation: (term) => deleteAnnotation(node.id, term),
                    onWarn: onToast,
                    onAsk: (payload) => askAboutSelection(node.id, payload),
                    /*
                     * 节点已经删了：这一笔不再记。
                     *
                     * 删节点时会连它的阅读记录一起清掉（见 learn/reading 的 pruneReading），
                     * 而这里是「删完那一刻采集器最后一次结算」——照记就当场长回一条空索引。
                     */
                    onReading: (delta) => {
                      const alive = nodeById(getLatest(), delta.nodeId)
                      if (!alive) return
                      // 这一笔记到**这个节点所属目标**的那本账上（阅读账按目标分开，见 learn/reading）
                      const goalId = alive.goalId
                      // 阅读增量走 patchQuiet：它不参与渲染，别为它每秒重渲染整棵学习区
                      patchQuiet((s) => {
                        const mine = readingOfGoal(s.reading, goalId)
                        const next = applyReadingDelta(mine ?? emptyReading(), delta)
                        const reading = withGoalReading(s.reading, goalId, next)
                        const reading2 = { ...s, reading }
                        // 顺手把「这个目标今天已落盘多少」发布出去：顶栏那两个数字读不到 ref
                        // （patchQuiet 不重渲染），不发布的话它们只能等到别的动作触发一次 set 才跳
                        // （见 lib/readingPulse）
                        publishReadingDay(goalId, delta.day, readingDay(next, delta.day)?.activeMs ?? 0)
                        return reading2
                      })
                    },
                    // 今天已经读过这份文档就直接算；没读过要先过「动过 + 20 秒」的门槛
                    readingKnownToday: () =>
                      readToday(
                        readingOfGoal(getLatest().reading, node.goalId),
                        node.id,
                        readingDocKey(source.kind, source.note),
                      ),
                  }}
                />
              )
            })}
          </div>

          {/*
            网页层（见 components/learn/web/WebTabLayer）：常挂在格子里、切去文档时
            整层藏起来（guest 进程照跑）。z-10 盖过正文，又在拖放高亮（z-30）之下。
          */}
          {gWebTabs.length > 0 && (
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
          */}
          {gTab && gTab.ref.kind !== 'web' && (
            <DocFloat
              /*
               * key 绑「格 + 节点」：换节点时重挂，各块 tip 的展开状态自然回到收起；
               * 拖页签分割之后新格里的悬浮组也是新的一份，不会继承旧格展开着的那块。
               */
              key={groupId + ':' + (g.node?.id ?? gTab.id)}
              view={g.view}
              // 大纲页没有源码/预览之分（它本来就不是文档）：把视图开关按住，只留「回教学文档」
              previewable={g.previewable && gTab.ref.kind !== 'outline'}
              previewHint={
                g.emptyNote ? t('这份笔记还是空的：先在源码视图里写点东西，才有得预览') : undefined
              }
              onSwitchView={(v) => setTabView(gTabId, v)}
              showBackToDoc={gTab.ref.kind === 'note' || gTab.ref.kind === 'super' || gTab.ref.kind === 'outline'}
              onBackToDoc={() => g.node && openTab({ kind: 'teach', nodeId: g.node.id })}
              // 纯净阅读那颗：它与 F11 / Esc 是同一个动作（见 toggleZen）。
              // 每一格的悬浮组都画一颗，而状态是**全局一个**——点哪一格都是同一件事
              pure={pure}
              onTogglePure={toggleZen}
              // 标题大纲：按当前页签的槽取（渲染组件装进去，见 lib/outline 的 OutlineHandle）
              outlineSlot={getOutlineSlot(gTabId)}
            />
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

  return (
    <div className="print-flat flex h-full overflow-hidden">
      <ExplorerSidebar
        store={store}
        // 高亮跟着**激活的页签**走：关掉某个节点的教学文档页签，它就不再是选中样式
        activeNodeId={selectedNodeId}
        // 文档行也一样：焦点格开着哪份笔记 / 试卷副本 / 超级文档 / 学习文档，那一行就亮
        activeTab={activeTab?.ref ?? null}
        busyNodeId={agent.running ? activeNodeId : null}
        open={sidebarOpen}
        // 纯净阅读：资源管理器整栏向左让位（靠负外边距真让位，见 ExplorerSidebar）
        pure={pure}
        onClose={() => setSidebarOpen(false)}
        onSelectNode={selectNode}
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
        /*
         * 侧栏里那些文档行的动作。每一个都走与别处**同一个入口**：
         * 新建交给同一套流程（笔记由 learn/notes 起名、试卷与超级文档交给导师的工作流），
         * 打开走 openTab / openExamCopy，删除走同一批确认框——两条路各写一套，
         * 迟早会出现「从侧栏开出来的页签」与从别处开出来的不是同一个东西。
         */
        docs={{
          // 学习文档行（与节点绑定、置顶）的打开：与「切到这个节点」同一件事
          onOpenTeach: (nodeId) => selectNode(nodeId),
          // 大纲页（交互页，见 OutlineView）：右键菜单的「打开大纲」与大纲页里的入口都走它
          onOpenOutline: (nodeId) => openTab({ kind: 'outline', nodeId }),
          onNewNote: (nodeId) => createNodeNote(nodeId),
          onNewExam: (nodeId) => newExam(nodeId),
          onNewSuperDoc: (nodeId) => startSuperLab(nodeId),
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
          // 让导师规划 / 重排这个目标的大纲（内置工作流「生成大纲」，大纲行右键菜单）
          onReplanOutline: (nodeId) => startOutline(nodeId),
          onExport: (ref) => exportTab(ref),
        }}
        /*
         * 考试那一侧的动作。它们原先住在文档区右上角那块「试卷」tip 里（那颗按钮已经删掉）：
         * **开考只有用户能做**（导师没有开考试窗口的 api），所以这些入口必须有个新家。
         */
        exams={{
          onStart: (nodeId, examId) => {
            if (exam.live && exam.live.examId !== examId) {
              onToast(t('有一场考试正在进行，先把它考完或放弃'))
              exam.reveal()
              return
            }
            // 开考要认准是哪个节点的卷子：主窗口这边只负责落盘与遮罩，见 useExamBridge
            selectNode(nodeId)
            exam.openExam(examId)
          },
          onGrade: (nodeId) => requestGrading(nodeId),
          onDelete: (target) => {
            setPendingExamDelete(target)
            setExamDeleteStage(examAttempted(target) ? 'warn' : 'final')
          },
          liveExamId: exam.live?.examId ?? null,
          grading,
        }}
        /* 学习状态那块 tip：节点右键菜单里悬停展开，内容与原先那颗按钮上的完全一样 */
        state={{
          structure: (nodeId) => nodeStructure(store, nodeId),
          onSetSelf: (nodeId, self) => setSelfReport(nodeId, self),
          onClearMistake: (nodeId, pattern) => clearMistake(nodeId, pattern),
          onRecall: (nodeId) => startRecall(nodeId),
          onProbe: (nodeId) => startProbe(nodeId),
          busy: agent.running,
        }}
      />

      <div className="print-flat flex min-w-0 flex-1 flex-col">
        {/*
          顶栏：纯净阅读时收起来（高度补间到 0，顶栏自己从下往上被裁掉）。

          高度写在**外面这一层**、而不是给 Topbar 加一个开关：顶栏自己是 h-14 的
          flex 行，它不必知道自己此刻露着多少。裁溢出只在收起与补间期间加——
          平时必须放开，顶栏里的账号菜单、模型菜单都是向下探出去的（见 Topbar 顶上那段
          z-index 的说明），裁了它们就只剩半个。

          z-20 跟着顶栏一起搬上来：顶栏是层叠上下文，里面的下拉菜单靠它压在正文之上。
        */}
        <div
          className={
            'no-print relative z-20 shrink-0 transition-[height,opacity,visibility] duration-300 ease-out ' +
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
            goalQuestion={activeGoal?.question ?? ''}
            store={store}
            user={user}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenUser={onOpenUser}
            onSignOut={onSignOut}
            onOpenSettings={onOpenSettings}
            onOpenUpdate={onOpenUpdate}
            onToast={onToast}
            /* 番茄钟与打卡都是「自给自足的小块」：时钟/倒计时只在这一块里每秒重渲染，
               不会把整个学习区（正文 + 对话栏）一起带上 */
            pomodoro={<PomodoroDock store={store} onStart={startFocus} onStop={stopFocus} onTick={tickFocus} />}
            checkin={<CheckinDock store={store} onCheckin={startCheckin} />}
            review={<ReviewDock store={store} onReview={startReview} onBackfill={backfillReviewPlan} />}
            reading={<ReadingDock store={store} onOpenNode={selectNode} />}
          />
        </div>

        {/*
          两列：文档区与超级导师对话栏。骨架（两格、分割线、收起按钮、拖动读数）在
          SplitRow，宽度与拖动机制在 useSideColumns；左格自适应、右格固定宽（--side-w，可拖），
          宽度属于「格子」而不属于内容，对调时只换内容、不换宽度（见 lib/appearance 的 agentLeft）。
          这里只决定「有没有这两列」（创建目标页时只有 GoalInput），并把两格的内容装进去。
        */}
        {creating || !hasContent ? (
          <GoalInput
            busy={false}
            hasGoals={store.goals.length > 0}
            onModelChanged={() => setSettingsEpoch((n) => n + 1)}
            onSubmit={startGoal}
          />
        ) : (
          <SplitRow
            side={side}
            docsSlot={renderLayout(docs.layout)}
            agentSlot={
              <AgentPanel
                // key 绑定「目标 + 对话」：切节点**不重挂**（上下文是目标级的，收起的对话下拉
                // 不该因为换个节点又跳出来），换一段对话才重挂 —— 那时滚动位置、跟随状态、
                // 编辑态都该从头开始，而这正是 key 该管的事（见 AgentPanel 的 pinned）
                key={(activeGoalId ?? 'none') + ':' + (activeConversationId ?? 'none')}
                nodeTitle={activeNode.title}
                conversation={agent.conversation}
                conversations={goalConversations}
                streaming={agent.streaming}
                streamingMessageId={agent.streamingMessageId}
                running={agent.running}
                hasKey={hasKey}
                providerLabel={providerName}
                onModelChanged={() => setSettingsEpoch((n) => n + 1)}
                vision={vision}
                // 待发送的附件原样交给 useAgent：转存发生在真正开跑那一轮（见它的说明）
                onSend={(text, images, files) =>
                  agent.send(
                    text,
                    images.length || files.length
                      ? { images: images.length ? images : undefined, files: files.length ? files : undefined }
                      : undefined,
                  )
                }
                onNotice={onToast}
                // 更多 → 工作流 → 回忆：与文档区那颗按钮同一件事，只是这里不再二次确认（见 AgentPanel 的说明）
                onRecall={() => startRecall()}
                // 更多 → 工作流 → 超级实验室：问清想做什么实验，生成一份可交互的超级文档（内置工作流）
                onSuperLab={startSuperLab}
                onCheckin={startCheckin}
                onBrowserUse={startBrowserUse}
                onCompact={() => void agent.compactNow()}
                compacting={agent.compacting}
                onOpenAgentSettings={() => setAgentSettingsOpen(true)}
                // 斜杠 /exam：与资源管理器右键「新增试卷」是同一个 newExam（不指名节点 = 当前节点）
                onExam={() => newExam()}
                // 斜杠 /effort：全局推理等级，与 ModelPicker 里那条滑条写的是同一个设置
                effort={effort}
                onSetEffort={setGlobalEffort}
                compactThreshold={agentSettings.compact.threshold}
                // 导师人格（见 agent/persona）：标题后面括号里那两个字，切换即时写进设置
                persona={agentSettings.persona}
                onPickPersona={(id) => {
                  saveAgentSettings({ ...agentSettings, persona: id })
                  onToast(t('导师人格已切到「{0}」，从下一轮开始生效', personaOf(id).label))
                }}
                onStop={agent.stop}
                onNewConversation={newConversation}
                onSelectConversation={selectConversation}
                onDeleteConversation={removeConversation}
                onEditMessage={(messageId, text) => {
                  // 改写消息正文 = 设计内的历史改写：这一会话的前缀账重新开始记（见 agent/prefixGate）
                  resetPrefixGate(activeConversationId ?? '')
                  set(updateMessageText(getLatest(), activeConversationId ?? '', messageId, text))
                }}
                onDeleteMessage={(messageId) => {
                  // 同上：删除消息之后的历史与已实发的那份不再前缀一致
                  resetPrefixGate(activeConversationId ?? '')
                  const next = deleteMessage(getLatest(), activeConversationId ?? '', messageId)
                  set(next)
                  pruneImagesOf(next)
                }}
                // 中断说明旁的「继续」：接着被应用退出打断的那一轮往下做（见 useAgent.resumeInterrupted）
                onResumeInterrupted={() => agent.resumeInterrupted()}
                // api.ask 的表单卡（渲染在输入框上方）
                ask={agent.pendingAsk}
                onAskSubmit={agent.submitAsk}
                onAskCancel={agent.cancelAsk}
                // 状态条要的实时吐字速度（空闲时面板自己回退到消息里的存量）
                tps={agent.tps}
                // 上下文占用圆环的实时账（每跳 usage 重算；轮末随落库一起清）
                liveUsage={agent.liveUsage}
                // 子代理（见 docs/subagent-architecture.md）：会话列表、实时槽与子会话视图的数据源
                sub={agent.sub}
              />
            }
          />
        )}
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
        超级导师设置：一个弹窗（不是独立窗口，也不是全局设置里的一个分页）。
        它改的是 agent/settings 那一份数据，与顶栏「设置」里的模型配置互不相干。
      */}
      {agentSettingsOpen && (
        <AgentSettingsModal
          settings={agentSettings}
          hasKey={hasKey}
          model={globalSummary()}
          onChange={(next) => {
            saveAgentSettings(next)
            onToast(t('超级导师设置已保存'))
          }}
          onOpenContextDebugger={() => debugWin.setOpen(true)}
          // 工作流分页：三级列表 + 从列表直接跑 / 删除登记的工作流 / 改思考档位
          flowRows={workflowRows}
          onRunWorkflow={runWorkflowRow}
          onRemoveWorkflow={removeWorkflowRow}
          onWorkflowEffort={setWorkflowEffortRow}
          onClose={() => setAgentSettingsOpen(false)}
        />
      )}

      {/*
        上下文比对调试器：可拖动的悬浮窗（见 components/FloatWindow）。
        开着才有记录——快照由 agent 设置里的开发者开关控制（见 useAgent 的 onContext）。
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
              ? t('「{0}」是学习目标（总目标），删除后它及其下 {1} 个阶段目标、所有对话与试卷都会一并移除，且无法恢复。', pendingDelete.title, pendingDelete.count - 1)
              : t('将删除「{0}」及其全部下级阶段目标、试卷与对话。删错了这个动作可以撤回——删除后按 Ctrl+Z 即可恢复（关掉的页签要重新打开）。', pendingDelete.title)
          }
          confirmLabel={pendingDelete.isRoot ? t('删除目标') : t('删除')}
          onConfirm={commitRemoveNode}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
