/*
 * 这个文件负责：一份文档从「用户改了字」到「磁盘有了它 / 页签关掉了」之间的全部机制——
 * 暂存（源码 / 本地文件）、保存（Ctrl+S 与关闭流程共用那一份）、关页签的确认流、
 * 本地文件与外部改动的冲突流、以及主进程的文件监听。
 *
 * 之所以是**一个**文件而不是「保存」「关闭」「冲突」三个：它们共享同一批状态
 * （暂存区、冲突标记、两个确认框），并且互相把对方当下一步——关闭流程里的保存
 * 撞上冲突要弹冲突框，冲突框里选完覆盖又要接着把剩下的页签关完。拆开写，
 * 这条链就要靠一层层回调穿针，漏一针就是「存了却没关上」这类事故。
 *
 * 保存的落点（写 store 还是写磁盘）由 saveTab 分流；这个文件不渲染任何东西，
 * 渲染层（renderGroup / 各确认框）从返回值里拿自己要的那几样。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { notesOf, type LearnStore, type LearnTab, type TabRef } from '../../../learn/types'
import { draftOf, dropDraft, dropDrafts, putDraft, stageDraft } from '../../../learn/drafts'
import {
  closeTabs,
  draftFileName,
  isBlankTab,
  makeBlankTab,
  tabTitle,
  tabNodeId,
  fileNameOf as localFileNameOf,
  type TabCloseMode,
} from '../../../learn/tabs'
import {
  PUBLIC_OWNER,
  activateIn,
  allTabs,
  closeIn,
  dropTabs,
  findTab,
  focusedGroup,
  focusedTab,
  groupOf,
  isAnchorOutline,
  ownerOfTab,
  renameTabRef,
  servesGoal,
  unloadAnchoredGroups,
  withDocs,
  withOwners,
} from '../../../learn/groups'
import { findNoteEntity } from '../../../learn/detached'
import { nodeById, updateDoc, writeNote } from '../../../learn/graph'
import { findNote } from '../../../learn/notes'
import { readSuperDoc, writeSuperDoc } from '../../../learn/superdocs'
import { addLocalFile } from '../../../learn/localfiles'
import { writeLocalFile } from '../../../lib/localFiles'
import { diskPathKey, userAbsPath, writeUserText } from '../../../lib/storage'
import { wsRelOfTab } from '../../../learn/workspace'
import { native } from '../../../lib/native'
import { savedTextOf } from './labels'
import { t } from '../../../i18n'

/**
 * 一枚页签指向的**磁盘绝对路径**：本地外部文件 = 它自己的 path；工作区内部文件 = 从节点
 * 工作区现推再换算（节点改名跟着走）。冲突记录、外部监听与保存写回都按这个键对齐；
 * 两类之外的页签（节点文档等）没有磁盘路径，返回 null。
 */
function diskPathOf(store: LearnStore, ref: TabRef): string | null {
  if (ref.kind === 'local') return ref.path
  if (ref.kind === 'ws') {
    const rel = wsRelOfTab(store, ref)
    return rel ? userAbsPath(rel) : null
  }
  return null
}

/** 宿主交给这一套流程的能力与现成的派生值（见 useDocSaveFlow 的参数说明） */
export interface DocSaveFlowDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  /** 立刻把 store 落盘（绕过 500ms 防抖），见 useLearnStore */
  flush: () => void | Promise<void>
  /** 落点变了之后把「当前节点 / 会话」跟过去（见 LearnWorkspace 的 retargetNode） */
  retargetNode: (s: LearnStore, nodeId: string) => LearnStore
  /** 试卷副本页签的标题（页签名的重名消歧要读它，见 LearnWorkspace 的 examTabTitle） */
  examTabTitle: (examId: string, attemptId: string) => string | undefined
  /** 全部页签（按布局顺序）：开着的本地文件清单与冲突的有效性都按它算 */
  tabs: LearnTab[]
  /** 暂存区（store.drafts）：「这个页签有没有没保存的改动」的唯一判据 */
  drafts: LearnStore['drafts']
  setDocSaving: (v: boolean) => void
  setDocSaveError: (v: string | undefined) => void
  setLocalSaved: Dispatch<SetStateAction<{ path: string; text: string } | null>>
  /** 焦点格那份文档的标题（保存成功的吐司要说「已保存『…』」） */
  docTitle: string
  /** 文档区「全部关闭」后，删除已经没有活动文档的目标导师页签；子代理由调用方自行保留 */
  onGoalsClosed?: (store: LearnStore, goalIds: readonly string[]) => LearnStore
  onToast: (msg: string) => void
}

/**
 * saveTab 的结果。
 *
 * 为什么是三态而不是原来的「错误字符串 or null」：新建文件那条路要走**另存对话框**，
 * 而用户在对话框上按「取消」既不是失败、也绝不能当成「存成了」——关闭流程拿到「存成了」
 * 就会把没写住的东西关掉。第三种状态就是为这一下准备的。
 */
export type SaveTabResult =
  | { ok: true }
  | { ok: false; canceled: true }
  | { ok: false; error: string }

/**
 * 文档的保存 / 关闭 / 冲突流。
 *
 * 返回值只包含**渲染层要直接用**的那几样：源码与本地文件的暂存入口、Ctrl+S、
 * 关页签（页签栏与快捷键共用）、两个确认框的状态与提交、以及本地文件的外部版本号
 * （LocalDoc 的 key 要读它）。saveTab / applyClose 这类纯内部的环节不外露——
 * 露得越多，外面越容易绕过确认流直接动暂存区。
 */
export function useDocSaveFlow(deps: DocSaveFlowDeps) {
  const {
    getLatest,
    set,
    flush,
    retargetNode,
    examTabTitle,
    tabs,
    drafts,
    setDocSaving,
    setDocSaveError,
    setLocalSaved,
    docTitle,
    onGoalsClosed,
    onToast,
  } = deps

  /**
   * 关页签确认：这一批页签里有没保存的改动时先问一声（保存并关 / 放弃改动 / 取消）。
   * 记下原始的关闭请求（id + mode 与受影响的两列 id），确认后照单执行——
   * 弹窗期间 store 不会有别的改动（模态挡着），但执行时仍现取 getLatest()，不吃旧快照。
   */
  const [pendingClose, setPendingClose] = useState<{
    /** 要关的那一格（分割之后同一个页签 id 只可能在一格里，但落点得按格算） */
    group: string
    id: string
    mode: TabCloseMode
    closingIds: string[]
    dirtyIds: string[]
    names: string[]
  } | null>(null)
  /**
   * 本地文件在外部被改过的标记（键 = 绝对路径）。只在「应用里还有没保存的改动」时记：
   * 没有暂存的文件外部一改就直接同步进页签（见 localTicks），撞不上；有暂存的撞上了，
   * 保存时就要先问一句——覆盖外部那一版，还是把手上这份另存成新文件。
   * 只记不删：真正「有效」的冲突见下面的 localConflicts 派生。
   */
  const [rawConflicts, setRawConflicts] = useState<Record<string, true>>({})
  const conflictsRef = useRef<Record<string, true>>({})
  /**
   * 外部改动让 LocalDoc 重读的版本号（键 = 绝对路径）：+1 = 换 key 重挂。
   * 重挂后的首次读取就是「同步」：没有暂存的页签当场显示磁盘上的新内容，
   * 文件被外部删掉时也会走一遍「读不到 → 说明页」的既有流程。
   */
  const [localTicks, setLocalTicks] = useState<Record<string, number>>({})
  /**
   * 保存撞上外部改动的确认框。phase 'save' = 只是这次 Ctrl+S；'close' = 关页签流程里的
   * 保存——解决完冲突还要接着关（rest 是剩下还没保存的页签）。
   */
  const [pendingConflict, setPendingConflict] = useState<{
    path: string
    tabId: string
    phase: 'save' | 'close'
    rest?: string[]
    closingIds?: string[]
    id?: string
    mode?: TabCloseMode
    /** 关闭流程发起时的那一格（见 pendingClose 的同名字段） */
    group?: string
  } | null>(null)
  /**
   * 真正有效的冲突 = 标记在、手上的暂存还在、页签还开着。它是**派生**的（渲染时现算）：
   * 草稿没了（保存成功、改回原样、页签关掉）标记自动失效，不需要一个 effect 回头清——
   * 滞留在 rawConflicts 里的旧标记没有副作用（只被这里消费），下次同路径再撞时还能当「提醒过」的依据。
   */
  const localConflicts = useMemo(() => {
    const out: Record<string, true> = {}
    const s = getLatest()
    for (const p of Object.keys(rawConflicts)) {
      const tab = tabs.find((t) => diskPathOf(s, t.ref) === p)
      if (tab && drafts[tab.id] !== undefined) out[p] = true
    }
    return out
  }, [getLatest, rawConflicts, tabs, drafts])

  /**
   * 关闭动作的本体：closeIn 算落点（那一格收了或换了激活项）、节点与会话跟着新落点走。
   *
   * 「落点」要在**关完之后**再读一次：那一格关空了就被收掉了（见 groups 的 dropEmpties），
   * 那时该看的是接管焦点的那一格显示什么，而不是一个已经不存在的组。
   */
  const applyClose = useCallback(
    (group: string, id: string, mode: TabCloseMode, closingIds?: string[]) => {
      const s = getLatest()
      const beforeGroup = groupOf(s.docArea, group)
      const beforeTabs = allTabs(s.docArea)
      const goalOfNode = (nodeId: string) => nodeById(s, nodeId)?.goalId ?? (s.goals.some((g) => g.id === nodeId) ? nodeId : null)
      /** 「目标 → 根节点」：组锚判据的第二跳（见 groups/tabs 的 isAnchorOutline） */
      const rootOf = (goalId: string) => s.goals.find((g) => g.id === goalId)?.rootNodeId ?? null
      const goalOfTab = (tab: LearnTab): string | null => {
        if (tab.ref.kind === 'mind') return tab.ref.goalId
        if (tab.ref.kind === 'outline' && (tab.ref as { goalId?: string }).goalId) return (tab.ref as { goalId?: string }).goalId!
        if (tab.ref.kind === 'video' && tab.ref.goalId) return tab.ref.goalId
        const nodeId = tabNodeId(tab.ref)
        return nodeId ? goalOfNode(nodeId) : null
      }
      /*
       * 反向同步有两种触发：
       * - 关闭目标根大纲（组锚）：即使 mode 是 self，整组也会进入 parkedTabs，导师页签应关闭；
       * - 文档区「全部关闭」：只关闭那些在其它活动组也没有文档的目标。
       * 阶段大纲不算组锚，关闭它不能误删整个目标导师。
       */
      const beforeClose = beforeGroup
        ? closeTabs(beforeGroup.tabs, id, mode, beforeGroup.active, closingIds)
        : null
      const closingTabIds = new Set(
        (beforeGroup?.tabs ?? [])
          .filter((tab) => !beforeClose?.tabs.some((kept) => kept.id === tab.id))
          .map((tab) => tab.id),
      )
      const closedAnchorGoalIds = new Set<string>()
      for (const tab of beforeGroup?.tabs ?? []) {
        if (!closingTabIds.has(tab.id) || !isAnchorOutline(tab.ref, goalOfNode, rootOf)) continue
        const goalId = goalOfTab(tab)
        if (goalId) closedAnchorGoalIds.add(goalId)
      }
      const allClosedGoalIds =
        mode === 'all'
          ? new Set(
              (beforeGroup?.tabs ?? [])
                .map(goalOfTab)
                .filter((goalId): goalId is string => !!goalId),
            )
          : new Set<string>()
      /*
       * 落点只在「栏上看得见」的页签里挑，判据与页签栏同一套（见 groups/goals 的 visibleTabs）：
       * 页签实体全住在格子里、栏上只画「公共 + 当前目标」，物理顺序里因此躺着别的目标
       * 藏起来的页签——照物理顺序落，会落到一枚栏上没有的页签上。
       */
      const owners = s.docArea.tabOwners
      const gid = s.activeGoalId ?? PUBLIC_OWNER
      const preferVisible = (tab: LearnTab): boolean => {
        const known = ownerOfTab(owners, tab.id)
        return known === null || known === gid || known === PUBLIC_OWNER
      }
      const docArea0 = closeIn(s.docArea, group, id, mode, closingIds, preferVisible)
      /*
       * 组锚卸载（见 groups/tabs 的 unloadAnchoredGroups）：这一批里被关掉的若是
       * **目标根节点的大纲**（组锚），该目标名下还开着的页签一并收进停靠场，等锚再开时
       * 归队。被关掉的若是**阶段大纲**（某个子节点的大纲入口），这里什么都不做——
       * 它只是一枚普通页签。「从别处打开文档 → 关掉另一枚大纲 → 那份文档被弹走」
       * 正是旧判据（凡是 outline 都算锚）的事故现场。目标已经不在了（连树一起删的）
       * 也不停靠：那组页签本来就该陪葬。
       */
      let docArea1 = unloadAnchoredGroups(docArea0, beforeTabs, goalOfNode, rootOf)
      /*
       * 归属表跟着页签一起收：页签关掉了，它在这一格（以及任何一格）的条目都不该留着。
       * 不主动收也不会出错（reconcileOwners 会在下次读盘时扫掉），但那样 state.json 里
       * 会攒下一串指向空处的 id，切到那个目标时才发现——不如关的这一下就顺手清掉。
       * （停靠进停靠场的那几枚由 unloadAnchoredGroups 里面收，不在这里。）
       */
      const live = new Set(allTabs(docArea0).map((t) => t.id))
      const goneIds = beforeTabs.filter((t) => !live.has(t.id)).map((t) => t.id)
      const docArea = goneIds.length > 0 ? withOwners(docArea1, dropTabs(docArea1.tabOwners, goneIds)) : docArea1
      const landing = focusedGroup(docArea)
      const nextRef = landing.tabs.find((t) => t.id === landing.active)?.ref ?? null
      const remainingGoals = new Set(
        allTabs(docArea)
          .map(goalOfTab)
          .filter((goalId): goalId is string => !!goalId),
      )
      const goalsClosed = [...closedAnchorGoalIds]
      for (const goalId of allClosedGoalIds) {
        if (!remainingGoals.has(goalId) && !goalsClosed.includes(goalId)) goalsClosed.push(goalId)
      }

      /*
       * 落点跟随：
       * 1. 若当前目标本身被关闭了（组锚被卸载或名下所有页签均已退出活动区）：
       *    - 若落点落在其它存活目标上，节点与会话切换到该存活目标；
       *    - 若落点不属于任何目标但仍有其它存活目标，回退到其它存活目标的根节点；
       *    - 若已无任何存活目标，主动清空 activeGoalId 与 activeNodeId，避免 Topbar / 资源管理器残留已关闭的目标高亮。
       * 2. 当前目标未被关闭：保持原先门禁，只跟当前目标自己的页签走，不误跳别处。
       */
      const isCurrentGoalClosed = Boolean(
        s.activeGoalId && (!remainingGoals.has(s.activeGoalId) || goalsClosed.includes(s.activeGoalId)),
      )
      let base: LearnStore = s
      let nextDocArea = docArea
      if (isCurrentGoalClosed) {
        // tab组从tab栏卸载时，不要让tab组列表中其他的列表顶上，而是留下一个空白（只剩新页签）的tab栏
        // 且清除 activeGoalId 与 activeNodeId，确保资源管理器与 Topbar 不残留选中状态
        const g = groupOf(docArea, docArea.focus) ?? docArea.groups[0]
        if (g) {
          const existingBlank = g.tabs.find(isBlankTab)
          if (existingBlank) {
            nextDocArea = activateIn(docArea, g.id, existingBlank.id)
          } else {
            const blank = makeBlankTab()
            nextDocArea = activateIn(
              withDocs(docArea, {
                groups: docArea.groups.map((grp) => (grp.id === g.id ? { ...grp, tabs: [...grp.tabs, blank] } : grp)),
              }),
              g.id,
              blank.id,
            )
          }
        }
        base = { ...s, activeGoalId: null, activeNodeId: null }
      } else {
        const nextNodeId = nextRef && servesGoal(nextRef, goalOfNode, s.activeGoalId) ? tabNodeId(nextRef) : null
        base = nextNodeId ? retargetNode(s, nextNodeId) : s
      }

      const next = onGoalsClosed && goalsClosed.length > 0
        ? onGoalsClosed({ ...base, docArea: nextDocArea }, goalsClosed)
        : { ...base, docArea: nextDocArea }
      set(next)
    },
    [getLatest, onGoalsClosed, retargetNode, set],
  )

  /**
   * 关闭页签（页签栏的 × 与右键菜单共用）。
   *
   * 关完之后停在哪一个由 learn/tabs 的 closeTabs 算（往右找最近的一个）。
   * 落点是节点类页签时，当前节点跟着它走——「关掉正在看的这份文档」之后，
   * 对话栏与顶栏说的仍该是眼前这一屏；落点是本地文件时**不动**当前节点：
   * 那说明用户从「某个知识点」切到了「磁盘上的一个文件」，
   * 回来时该还在原来那个知识点上。
   *
   * 有未保存改动（暂存区里有这一批页签的正文）时先问一声：保存并关 / 放弃改动 / 取消。
   * 放弃是显式的（dropDrafts）——「关闭」从此真的意味着「不要这版改动」，而不是
   * 让草稿留在暂存区里等日后再撞见。程序化的关闭（文件已丢失的兜底）传 confirm:false
   * 照旧直接关，不打断流程。
   */
  const closeTab = useCallback(
    (
      group: string,
      id: string,
      mode: TabCloseMode,
      opts?: { confirm?: boolean; closingIds?: string[] },
    ) => {
      const s = getLatest()
      const g = groupOf(s.docArea, group)
      if (!g) return
      const r = closeTabs(g.tabs, id, mode, g.active, opts?.closingIds)
      const closingIds = g.tabs.filter((t) => !r.tabs.some((k) => k.id === t.id)).map((t) => t.id)
      const dirtyIds = closingIds.filter((tid) => s.drafts[tid] !== undefined)
      if (dirtyIds.length && opts?.confirm !== false) {
        const names = dirtyIds.map((tid) => {
          const tab = g.tabs.find((t) => t.id === tid)
          return tab ? tabTitle(tab.ref, (nid) => nodeById(s, nid)?.title, examTabTitle) : ''
        })
        setPendingClose({ group, id, mode, closingIds, dirtyIds, names })
        return
      }
      applyClose(group, id, mode, opts?.closingIds)
    },
    [examTabTitle, getLatest, applyClose],
  )

  /**
   * 源码视图里改了正文：写进**暂存区**，一个字都不动文档本身。
   *
   * 文档要等 Ctrl+S 才改（见 saveDocNow）。于是「改了一半」与「改完了」在数据上
   * 是两件事：Agent 读到的仍是保存过的那一份。放弃这版改动的路是显式的——
   * 把正文改回原样（那条暂存自己消失），或关页签时在确认框里选「放弃改动」；
   * 直接关页签现在会先被确认框拦住（见 closeTab），不会悄悄丢东西。
   *
   * 暂存区跟着 state.json 一起落盘（500ms 防抖，见 useLearnStore），所以这里的
   * 「不写文档」不等于「会丢」：现在丢的只有「没按过 Ctrl+S」这一个动作而已。
   *
   * 收 tabId 而不是认「当前页签」：分割之后源码视图可能开在**没焦点的那一格**里，
   * 在那儿敲字要落到那一格显示的文档上（见 renderGroup）。
   */
  const editDocSource = useCallback(
    (tabId: string, content: string) => {
      const s = getLatest()
      const tab = findTab(s.docArea, tabId)
      // 本地文件、工作区内部文件（各自在 LocalDoc 里走 stageLocalDraft）、试卷副本与
      // 大纲页都没有「节点文档」那套暂存：一个自己管落盘，一个只读，一个不是文档
      if (!tab || tab.ref.kind === 'local' || tab.ref.kind === 'ws' || tab.ref.kind === 'exam' || tab.ref.kind === 'outline') return
      set({ ...s, drafts: stageDraft(s.drafts, tab.id, content, savedTextOf(s, tab.ref)) })
    },
    [getLatest, set],
  )

  /**
   * 本地文件 / 工作区内部文件的暂存（见 LocalDoc）：它自己知道磁盘上那一份是什么，
   * 改回去时传 null。
   */
  const stageLocalDraft = useCallback(
    (tabId: string, text: string | null) => {
      const s = getLatest()
      const tab = findTab(s.docArea, tabId)
      if (!tab || (tab.ref.kind !== 'local' && tab.ref.kind !== 'ws')) return
      set({ ...s, drafts: text === null ? dropDraft(s.drafts, tab.id) : putDraft(s.drafts, tab.id, text) })
    },
    [getLatest, set],
  )

  /**
   * 新建文件页签的暂存（见 DraftDoc）：它的基准是**空文档**——还没有落点，
   * 磁盘上什么都没有。因此「改回空串」就等于「又回到没写过」，那一条暂存自己消失，
   * 页签上那颗圆点也跟着消失（关它不该弹「有未保存的改动」）。
   */
  const stageNewFileDraft = useCallback(
    (tabId: string, text: string) => {
      const s = getLatest()
      const tab = findTab(s.docArea, tabId)
      if (!tab || tab.ref.kind !== 'draft') return
      set({ ...s, drafts: stageDraft(s.drafts, tab.id, text, '') })
    },
    [getLatest, set],
  )

  /**
   * 保存一个页签的暂存改动（Ctrl+S 与「关闭未保存页签」两条路共用这一份）。
   *
   * 返回 `{ ok: true }` = 存成了（或本来就没东西可存）；`{ ok: false, canceled: true }` =
   * 用户在另存对话框上取消了（什么都没发生，调用方**不能**当成存成了继续往下走）；
   * 其余给一句**用户能直接读**的失败说明——调用方原样弹吐司，据此决定要不要继续
   * （关闭流程失败就停，不把没存上的东西丢掉）。
   * 冲突弹窗不在这里出：Ctrl+S 路径在调用前判断，关闭路径自己在遍历时判断。
   */
  const saveTab = useCallback(
    async (tab: LearnTab): Promise<SaveTabResult> => {
      const s = getLatest()
      const text = draftOf(s.drafts, tab.id)
      if (text === undefined) return { ok: true }
      // 网页页签没有编辑器，永远不该有暂存正文；真有这份草稿也没处可存
      if (tab.ref.kind === 'web') return { ok: true }
      // 系统页（设置/用量/记忆/导师设置/新建目标）同样没有编辑器，没有暂存这回事
      if (
        tab.ref.kind === 'settings' ||
        tab.ref.kind === 'usage' ||
        tab.ref.kind === 'schedule' ||
        tab.ref.kind === 'mind' ||
        tab.ref.kind === 'agentSettings' ||
        tab.ref.kind === 'blank'
      )
        return { ok: true }
      const title = tabTitle(tab.ref, (nid) => nodeById(s, nid)?.title, examTabTitle)
      setDocSaving(true)
      /*
       * 新建文件：**保存这一步才定下它是什么**。
       *
       * 它原先没有落点、也没有类型——用户在空白页上点「新建文件」说的只是「我要写点东西」。
       * 所以这里要问的不是「存不存」，而是「存到哪儿、叫什么、什么后缀」（默认 .txt）。
       * 原生对话框把内容一并写下（file:saveText 自己 fsp.writeFile），拿到路径之后
       * 页签当场换成指向那个文件的 local 页签：后缀是什么，它就是什么类型
       * （md 进预览、txt 进编辑、图片进媒体预览，见 learn/tabs 的 viewOf）。
       */
      if (tab.ref.kind === 'draft') {
        let saved: { ok: boolean; canceled?: boolean; path?: string; error?: string }
        try {
          saved = await native().saveText({
            suggestedName: draftFileName(),
            content: text,
            title: t('保存新建文件'),
            filters: [
              { name: t('文本文件'), extensions: ['txt'] },
              { name: t('Markdown'), extensions: ['md', 'markdown'] },
              { name: t('网页'), extensions: ['html', 'htm'] },
              { name: t('全部文件'), extensions: ['*'] },
            ],
          })
        } catch {
          setDocSaving(false)
          return { ok: false, error: t('保存失败：应用没有跑在 Electron 里') }
        }
        if (!saved.ok) {
          setDocSaving(false)
          // 取消不是失败：什么都不做，页签与草稿原样留着
          return saved.canceled ? { ok: false, canceled: true } : { ok: false, error: saved.error ?? t('保存失败') }
        }
        const path = saved.path
        if (!path) {
          setDocSaving(false)
          return { ok: false, error: t('没有拿到保存路径') }
        }
        /*
         * 文件已经落盘（主进程写的）。回读一次确认这个后缀归一打得开：
         * local 通道只放行文本类后缀（见 electron/storage/local 的白名单），
         * 用户手打一个别的后缀时，留一枚读不出内容的页签比说清楚更糟。
         * 打不开就**不转换**：草稿原样留在编辑区，用户改个后缀再来一次。
         */
        try {
          const probe = await native().local.read(path)
          if (!probe.ok) {
            setDocSaving(false)
            return {
              ok: false,
              error: t('已存到 {0}，但这个后缀归一打不开（只认文本类）。改个后缀再存一次吧', path),
            }
          }
        } catch {
          /* 桥不可用：上面 saveText 已经成功了，说明桥在，这里不拦 */
        }
        const ref: TabRef = { kind: 'local', path }
        set({
          ...s,
          docArea: renameTabRef(s.docArea, tab.ref, ref),
          drafts: dropDraft(s.drafts, tab.id),
          // 新建的文件就是一份外部文件：进「本地文件」清单，之后还能从那儿再打开它
          localFiles: addLocalFile(s.localFiles, path, Date.now()),
        })
        setLocalSaved({ path, text })
        setDocSaveError(undefined)
        // 手动保存的意思就是「现在就写下去」：立刻落盘，不等 500ms 防抖
        await flush()
        setDocSaving(false)
        return { ok: true }
      }
      if (tab.ref.kind === 'local' || tab.ref.kind === 'ws') {
        /*
         * 本地外部文件与工作区内部文件同一条保存路，差别只在**写回哪条通道**：
         * - 外部文件走 local 通道（它就是用户挑的那份任意文件）；
         * - 内部文件在数据目录里，走 storage 的受守通道（写「相对当前用户」的路径），
         *   这也正是「不能当外部文件看」在落盘这一层的体现。
         * 属性收窄穿不进下面的回调：先把两样都提取出来（与其它分支同款处理）。
         */
        const ref = tab.ref
        const rel = ref.kind === 'ws' ? wsRelOfTab(s, ref) : null
        const diskPath = ref.kind === 'local' ? ref.path : rel ? userAbsPath(rel) : null
        if (!diskPath) {
          setDocSaving(false)
          return { ok: false, error: t('「{0}」已经不在了，没能保存', title) }
        }
        const err =
          ref.kind === 'local'
            ? await writeLocalFile(diskPath, text)
            : (await writeUserText(rel as string, text))
              ? null
              : t('写入失败')
        if (err) {
          setDocSaving(false)
          setDocSaveError(err)
          return { ok: false, error: t('保存「{0}」失败：{1}', title, err) }
        }
        setDocSaveError(undefined)
        setLocalSaved({ path: diskPath, text })
        // 存成了，外部改动已被这一版盖过：冲突标记撤掉
        setRawConflicts((m) => {
          if (!m[diskPath]) return m
          const next = { ...m }
          delete next[diskPath]
          return next
        })
        set({ ...s, drafts: dropDraft(s.drafts, tab.id) })
      } else {
        /*
         * 指向的东西中途没了的兜底：节点被删、笔记被删或改名——这条页签本该同时被关掉，
         * 但保存是异步入口（快捷键随时可能按下），落后一拍时不能装作存进去了：
         * 那会让用户以为写住了，然后把暂存区里唯一的一份正文也清掉。
         */
        if (tab.ref.kind === 'video' || tab.ref.kind === 'pluginDoc') {
          // 这两个页签不指向节点，也不参与文档保存：落到这里说明入口走错了，直接不存
          setDocSaving(false)
          return { ok: false, error: t('这个页签没有可保存的内容') }
        }
        // 笔记页签的实体两处住（绑定 = 宿主记录；游离 = 池子，nodeId 就是笔记自己的 id）——
        // 游离那份直接改池子，其余照旧走宿主
        const freeNoteEntity =
          tab.ref.kind === 'note' && !nodeById(s, tab.ref.nodeId)
            ? findNoteEntity(s, tab.ref.nodeId)
            : null
        const node = nodeById(s, tab.ref.nodeId)
        const gone =
          !node && !freeNoteEntity ||
          (tab.ref.kind === 'note' && !freeNoteEntity && (!node || !findNote(notesOf(node), tab.ref.note))) ||
          // 超级文档被 Agent 删掉后不靠保存「复活」它：那份 HTML 已经没有了
          (tab.ref.kind === 'super' && !readSuperDoc(s, tab.ref.nodeId, tab.ref.name))
        if (gone) {
          setDocSaving(false)
          return { ok: false, error: t('「{0}」已经不在了，没能保存', title) }
        }
        const next =
          tab.ref.kind === 'note'
            ? freeNoteEntity
              ? (() => {
                  const pool = s.detached?.[freeNoteEntity.goalId]
                  if (!pool) return null
                  return {
                    ...s,
                    detached: {
                      ...s.detached,
                      [freeNoteEntity.goalId]: {
                        ...pool,
                        notes: pool.notes.map((n) =>
                          n.id === freeNoteEntity.note.id ? { ...n, content: text, updatedAt: Date.now() } : n,
                        ),
                      },
                    },
                  }
                })()
              : writeNote(s, tab.ref.nodeId, tab.ref.note, text)
            : tab.ref.kind === 'super'
              ? writeSuperDoc(s, tab.ref.nodeId, tab.ref.name, text)
              : updateDoc(s, tab.ref.nodeId, text)
        // 超级文档那条路在节点消失时会返回 null（上面 gone 查过一拍，异步入口仍要兜底）
        if (!next) {
          setDocSaving(false)
          return { ok: false, error: t('「{0}」已经不在了，没能保存', title) }
        }
        set({ ...next, drafts: dropDraft(next.drafts, tab.id) })
      }
      // 暂存清掉之后立刻落盘：手动保存的意思就是「现在就写下去」，不是「等下一次防抖」
      await flush()
      setDocSaving(false)
      return { ok: true }
    },
    [examTabTitle, flush, getLatest, set, setDocSaveError, setDocSaving, setLocalSaved],
  )

  /**
   * 保存当前这份文档（Ctrl+S，见 lib/shortcuts 的 learn.save）。
   *
   * 「保存」= 把暂存区里的那一份写进文档（节点文档 / 笔记进 store，本地文件写回原文件），
   * 然后清掉暂存、立刻落盘。没有暂存的改动时只催一次落盘——Ctrl+S 在任何时候都该有反应，
   * 而不是「这次没东西可存」，那样用户会以为键坏了。
   *
   * 本地文件在外部被改过（localConflicts 里有它）时**不闷头写盘**：先问一句——
   * 覆盖外部那一版，还是把手上的另存成新文件（见 pendingConflict）。
   */
  const saveDocNow = useCallback(async () => {
    const s = getLatest()
    const tab = focusedTab(s.docArea)
    if (!tab) return
    if (draftOf(s.drafts, tab.id) === undefined) {
      await flush()
      onToast(t('已是最新，没有未保存的改动'))
      return
    }
    const conflictPath = diskPathOf(s, tab.ref)
    if (conflictPath && localConflicts[conflictPath]) {
      setPendingConflict({ path: conflictPath, tabId: tab.id, phase: 'save' })
      return
    }
    const r = await saveTab(tab)
    if (!r.ok) {
      // 在另存对话框上取消：什么都不说，也别弹「已保存」——用户知道自己在做什么
      if ('error' in r) onToast(r.error)
      return
    }
    // 新建文件那条路存完就换了身份（draft → local）：此刻拿它的旧标题说「已保存『未命名』」是错的
    onToast(tab.ref.kind === 'draft' ? t('已保存') : t('已保存「{0}」', docTitle))
  }, [docTitle, flush, getLatest, localConflicts, onToast, saveTab])

  /* ---------- 关页签 / 保存冲突的两条确认流 ---------- */

  /**
   * 关闭流程里的顺序保存：队列里撞上「冲突的本地文件」就停下来弹冲突框（phase: 'close'，
   * 带上剩下的队列），其余的逐个存，全存完（或全没东西可存）才真正关。
   * 任何一次保存失败都整个停下——关掉的页签找不回，没存上的东西更不能丢。
   */
  const closeSaveRemaining = useCallback(
    async (queue: string[], closingIds: string[], group: string, id: string, mode: TabCloseMode) => {
      let rest = queue
      for (;;) {
        const s = getLatest()
        const idx = rest.findIndex((tid) => {
          const tab = findTab(s.docArea, tid)
          return !!tab && s.drafts[tid] !== undefined
        })
        if (idx < 0) break
        const tab = findTab(s.docArea, rest[idx])
        rest = rest.slice(idx + 1)
        if (!tab) continue
        const conflictPath = diskPathOf(s, tab.ref)
        if (conflictPath && conflictsRef.current[conflictPath]) {
          setPendingConflict({
            path: conflictPath,
            tabId: tab.id,
            phase: 'close',
            rest,
            closingIds,
            group,
            id,
            mode,
          })
          return
        }
        const r = await saveTab(tab)
        if (!r.ok) {
          onToast('error' in r ? t('{0}，先不关闭了', r.error) : t('已取消保存，先不关闭了'))
          return
        }
      }
      applyClose(group, id, mode, closingIds)
    },
    [applyClose, getLatest, onToast, saveTab],
  )

  /** 关页签确认：保存并关（队列里有冲突的本地文件时，会先被冲突框拦下） */
  const commitCloseSave = useCallback(() => {
    const p = pendingClose
    if (!p) return
    setPendingClose(null)
    void closeSaveRemaining(p.dirtyIds, p.closingIds, p.group, p.id, p.mode)
  }, [closeSaveRemaining, pendingClose])

  /** 关页签确认：放弃改动并关——「关闭」从此真的意味着「不要这版改动」 */
  const commitCloseDiscard = useCallback(() => {
    const p = pendingClose
    if (!p) return
    setPendingClose(null)
    const s = getLatest()
    set({ ...s, drafts: dropDrafts(s.drafts, p.dirtyIds) })
    // 被放弃的本地 / 工作区内部文件：冲突标记一并作废——重开之后编辑器的基准就是磁盘上那一版
    const droppedPaths = p.dirtyIds.flatMap((tid) => {
      const tab = findTab(s.docArea, tid)
      const disk = tab ? diskPathOf(s, tab.ref) : null
      return disk ? [disk] : []
    })
    if (droppedPaths.length) {
      setRawConflicts((m) => {
        if (!droppedPaths.some((x) => m[x])) return m
        const next = { ...m }
        for (const x of droppedPaths) delete next[x]
        return next
      })
    }
    applyClose(p.group, p.id, p.mode, p.closingIds)
  }, [applyClose, getLatest, pendingClose, set])

  /** 冲突框：覆盖外部那一版照常保存；处于关闭流程时接着把剩下的关完 */
  const commitConflictOverwrite = useCallback(() => {
    const p = pendingConflict
    if (!p) return
    setPendingConflict(null)
    void (async () => {
      const s = getLatest()
      const tab = findTab(s.docArea, p.tabId)
      if (!tab) return
      const r = await saveTab(tab)
      if (!r.ok) {
        if ('error' in r) onToast(p.phase === 'close' ? t('{0}，先不关闭了', r.error) : r.error)
        else onToast(p.phase === 'close' ? t('已取消保存，先不关闭了') : t('已取消保存'))
        return
      }
      if (p.phase === 'close' && p.rest && p.closingIds && p.group && p.id && p.mode) {
        await closeSaveRemaining(p.rest, p.closingIds, p.group, p.id, p.mode)
      }
    })()
  }, [closeSaveRemaining, getLatest, onToast, pendingConflict, saveTab])

  /** 冲突框：把手上的这版另存成新文件；关闭流程里存完就放弃那份暂存、接着关 */
  const commitConflictSaveAs = useCallback(() => {
    const p = pendingConflict
    if (!p) return
    setPendingConflict(null)
    void (async () => {
      const s = getLatest()
      const tab = findTab(s.docArea, p.tabId)
      const text = tab ? draftOf(s.drafts, tab.id) : undefined
      if (!tab || text === undefined) return
      try {
        const r = await native().saveText({
          suggestedName: localFileNameOf(p.path),
          content: text,
          title: t('另存为'),
          filters: [{ name: t('文本文件'), extensions: ['md', 'markdown', 'txt', 'html', 'htm'] }],
        })
        // 用户取消了另存对话框：什么都不发生，页签与冲突标记都保持原样
        if (!r.ok) return
        if (p.phase === 'close') {
          set({ ...getLatest(), drafts: dropDraft(getLatest().drafts, tab.id) })
          if (p.rest && p.closingIds && p.group && p.id && p.mode) {
            await closeSaveRemaining(p.rest, p.closingIds, p.group, p.id, p.mode)
          }
        } else {
          onToast(t('已另存到 {0}', r.path ?? ''))
        }
      } catch {
        onToast(t('另存失败：应用没有跑在 Electron 里'))
      }
    })()
  }, [closeSaveRemaining, getLatest, onToast, pendingConflict, set])

  /* ---------- 本地文件的外部变化监听 ---------- */

  /**
   * 外部文件变了：应用里有没有暂存决定两件事——
   * - 没暂存：外部就是新的「已保存版」，版本号 +1 让页签重挂重读，当场同步（文件被外部
   *   删掉时读到「读不到」，走既有的「提示 + 关页签」兜底，删除因此同样及时收场）；
   * - 有暂存：用户手上的版本不能被动覆盖，只记一个冲突标记，等他保存时再问覆盖还是另存。
   *
   * 路径要**归一着比**（diskPathKey）：主进程 watcher 报回来的是 path.join 的原生形
   * （Windows 上全反斜杠），而工作区内部文件的路径是 userAbsPath 的混血形（反斜杠的根 +
   * 斜杠的后半段）——直接相等永远对不上，「外部删掉文件、页签没反应」正是这么来的。
   * 比中之后，下面所有的键（冲突标记 / 版本号 / 刚保存的正文）都用**这枚页签自己的路径
   * 形式**（diskPathOf），与渲染那边（LocalDoc 的 key、savedText、localTicks 的查表）
   * 才是同一套。
   */
  const handleLocalChange = useCallback(
    (p: string) => {
      const s = getLatest()
      const wanted = diskPathKey(p)
      const tab = allTabs(s.docArea).find((t) => {
        const dp = diskPathOf(s, t.ref)
        return dp !== null && diskPathKey(dp) === wanted
      })
      if (!tab) return
      const key = diskPathOf(s, tab.ref)
      if (!key) return
      if (s.drafts[tab.id] !== undefined) {
        if (!conflictsRef.current[key]) {
          // ref 先行（事件处理里写 ref 不违反渲染纪律）：同一次外部保存连发的两拍只提醒一次
          conflictsRef.current = { ...conflictsRef.current, [key]: true }
          onToast(t('「{0}」在外部被改动过；保存时会请你选覆盖还是另存', localFileNameOf(key)))
        }
        setRawConflicts((m) => (m[key] ? m : { ...m, [key]: true }))
        return
      }
      // 保存后残留的「刚保存的正文」要撤掉：它比磁盘上这份旧，留着会在重挂后盖住新内容。
      // 冲突标记也一并作废：重挂之后编辑器的基准就是磁盘上这一版，旧的「外部改过」不再成立。
      setLocalSaved((cur) => (cur?.path === key ? null : cur))
      setRawConflicts((m) => {
        if (!m[key]) return m
        const next = { ...m }
        delete next[key]
        return next
      })
      if (conflictsRef.current[key]) {
        const nextRef = { ...conflictsRef.current }
        delete nextRef[key]
        conflictsRef.current = nextRef
      }
      setLocalTicks((m) => ({ ...m, [key]: (m[key] ?? 0) + 1 }))
      // setLocalSaved 是宿主 useState 的 dispatch（身份稳定）：列进来只为过 exhaustive-deps，不改行为
    },
    [getLatest, onToast, setLocalSaved],
  )
  const localChangeRef = useRef(handleLocalChange)
  useEffect(() => {
    localChangeRef.current = handleLocalChange
  })

  /** 开着的本地 / 工作区内部文件页签：这就是主进程要盯的文件清单（关掉页签就不再盯） */
  const openLocalPaths = useMemo(
    () => {
      const s = getLatest()
      return tabs.flatMap((t) => {
        const p = diskPathOf(s, t.ref)
        return p ? [p] : []
      })
    },
    [getLatest, tabs],
  )
  useEffect(() => {
    let off: (() => void) | undefined
    try {
      void native().local.watch(openLocalPaths)
      off = native().local.onChanged((p) => localChangeRef.current(p))
    } catch {
      // 不在 Electron 里跑（纯浏览器开发态）就没有 watcher：这个功能整体缺席，不影响其它
    }
    return () => {
      off?.()
    }
  }, [openLocalPaths])

  // 冲突标记的 ref 镜像（raw 那份）：watcher 事件回调读它做「只提醒一次」的判断
  useEffect(() => {
    conflictsRef.current = rawConflicts
  }, [rawConflicts])

  return {
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
  }
}
