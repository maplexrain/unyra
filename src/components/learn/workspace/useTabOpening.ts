import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { DocView, LearnStore, TabRef, WebTabMeta } from '../../../learn/types'
import {
  PUBLIC_OWNER,
  activateIn,
  allStoredTabs,
  allTabs,
  claimTab,
  closeIds,
  findTab,
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
  refOwner,
  setFocus,
  syncGoalOutlineTabs,
  withGroup,
  withOwners,
  withParked,
  type TabOwners,
} from '../../../learn/groups'
import { tabKey, tabNodeId, newWebKey, newBlankKey, makeTab, makeBlankTab } from '../../../learn/tabs'
import { nodeById, touchNode, ensureConversation, resolveDisplayedConversation } from '../../../learn/graph'
import { upsertAgentTab, withAgentTabs, removeAgentTabsOfGoals } from '../../../learn/agentTabs'
import { normalizeWebInput } from '../../../learn/webUrl'
import { webviewOf } from '../../../learn/web/webviewRegistry'
import { buildJumpToElementScript } from '../../../learn/web/guestJump'
import { isElectron, isWeb, native } from '../../../lib/native'
import { openExternalLink } from '../../../lib/externalLink'
import { requestReveal } from '../explorer/reveal'
import { emptyNote, noteEntityOf } from './panes'
import { goalFocusByGoal } from './goalFocus'
import { setVimPageOpener } from '../../../lib/vimPage'

/** 打开与跳转需要的宿主能力（晚绑定把手由宿主先声明、这里回填，见各自说明） */
export interface TabOpeningDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setOutlineFocus: Dispatch<SetStateAction<{ nodeId: string; nonce: number } | null>>
  /** useAgent / examTools 在本 hook 之前就要拿到的打开器把手（见宿主的声明位） */
  openTabRef: RefObject<(ref: TabRef, preferredView?: DocView) => void>
  openSettingsRef: RefObject<() => void>
}

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

/**
 * 打开与跳转：文档区「现在看什么」的全部写入口。
 *
 * - openTab 是唯一入口（三种页签同一条路），retargetNode/retargetGoal/goalTabGroup
 *   是七条导航路的单点汇合（文档区、agent 页签、侧栏、链接、chip 全走这里）；
 * - 内置浏览器的网页页签（webMeta 活信息、开签、地址回写）也在这条域里；
 * - 目标页签组的整组切换（顶栏菜单 / 侧栏）与它的缓存清理。
 */
export function useTabOpening({
  store,
  getLatest,
  set,
  setSidebarOpen,
  setOutlineFocus,
  openTabRef,
  openSettingsRef,
}: TabOpeningDeps) {
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
      let docArea = syncGoalOutlineTabs(s.docArea, s.goals)
      const home = groupIdOfTab(docArea, rootId)
      const goalOf = (id: string) => nodeById(s, id)?.goalId ?? (s.goals.some((g) => g.id === id) ? id : null)
      docArea = home
        ? docArea
        : openAnchorOutline(docArea, docArea.focus, rootRef, goalOf, Date.now())
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
    (targetRef: TabRef, preferredView?: DocView) => {
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
      if (ref.kind === 'web' && ref.fileNodeId && ref.goalId) {
        const boundGoal = base.goals.find((g) => g.id === ref.goalId)
        if (boundGoal) {
          const remembered = goalFocusByGoal.get(boundGoal.id)
          const focusId = remembered && nodeById(base, remembered) ? remembered : boundGoal.rootNodeId
          const retargeted = focusId ? retargetNode(base, focusId) : retargetGoal(base, boundGoal.id)
          const grouped = goalTabGroup(retargeted, boundGoal.id)
          const openedW = openInGroup(
            grouped.docArea,
            grouped.docArea.focus,
            ref,
            Date.now(),
            undefined,
            (id) => nodeById(base, id)?.goalId ?? null,
          )
          set({
            ...grouped,
            docArea: withOwners(openedW, claimTab(openedW.tabOwners, boundGoal.id, tabKey(ref))),
          })
          if (wasActive) requestReveal()
          setSidebarOpen(false)
          return
        }
      }
      if (ref.kind === 'video') {
        const matchingVNode = ref.videoNodeId
          ? (base.videoNodes ?? []).find((v) => v.id === ref.videoNodeId)
          : (base.videoNodes ?? []).find((v) => ref.videoId && v.videoId === ref.videoId)
        const vNodeId = ref.videoNodeId || matchingVNode?.id
        const vId = ref.videoId || matchingVNode?.videoId || undefined
        const gid = ref.goalId ?? matchingVNode?.goalId ?? null
        const boundGoal = gid ? base.goals.find((g) => g.id === gid) : undefined
        if (boundGoal) {
          const vRef: TabRef = {
            kind: 'video',
            ...(vNodeId ? { videoNodeId: vNodeId } : {}),
            ...(vId ? { videoId: vId } : {}),
            goalId: boundGoal.id,
          }
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
        preferredView ?? (ref.kind === 'note' && emptyNote(s, makeTab(ref, 0)) ? 'source' : undefined)
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
    setVimPageOpener(() => openTab({ kind: 'vim' }))
    return () => setVimPageOpener(null)
  }, [openTab])

  // 监听全局打开页签请求（例如 OCR 插件引导等）
  useEffect(() => {
    const onOpenGlobalTab = (e: CustomEvent<TabRef>) => {
      if (e.detail) openTab(e.detail)
    }
    window.addEventListener('moji:open-tab', onOpenGlobalTab as EventListener)
    return () => window.removeEventListener('moji:open-tab', onOpenGlobalTab as EventListener)
  }, [openTab])

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

  /** 待跳转选择器（url#selector 语法支持） */
  const pendingJumpsRef = useRef<Map<string, string>>(new Map())

  /**
   * 开一个网页页签：url 归一（learn/webUrl），空串 = 起始页（只有地址栏）。
   * 网页的弹窗 / target=_blank（主进程拦下来推回来的，见 electron/app/webSession）也落到这里。
   */
  const openWebTab = useCallback(
    (url: string, selector?: string): string => {
      const targetUrl = normalizeWebInput(url)
      if (isWeb()) {
        if (targetUrl) {
          void openExternalLink(targetUrl)
        }
        return ''
      }
      const s = getLatest()

      // 检查是否已经存在该网页页签（单例激活）
      if (targetUrl) {
        let existingTabId: string | null = null
        let existingGroupId: string | null = null
        for (const g of s.docArea.groups) {
          for (const t of g.tabs) {
            if (t.ref.kind === 'web' && normalizeWebInput(t.ref.url) === targetUrl) {
              existingTabId = t.id
              existingGroupId = g.id
              break
            }
          }
          if (existingTabId) break
        }

        if (existingTabId && existingGroupId) {
          set({
            ...s,
            docArea: activateIn(setFocus(s.docArea, existingGroupId), existingGroupId, existingTabId),
          })
          if (selector) {
            const wv = webviewOf(existingTabId)
            if (wv) {
              try {
                void wv.executeJavaScript(buildJumpToElementScript(selector))
              } catch {
                pendingJumpsRef.current.set(existingTabId, selector)
              }
            } else {
              pendingJumpsRef.current.set(existingTabId, selector)
            }
          }
          return existingTabId
        }
      }

      // ref 当场算好（页签身份就是 tabKey），开完直接回页签 id——browser.open 靠它指名
      const ref: TabRef = { kind: 'web', url: targetUrl, key: newWebKey() }
      const tabId = tabKey(ref)
      if (selector) {
        pendingJumpsRef.current.set(tabId, selector)
      }
      const opened = openInGroup(s.docArea, s.docArea.focus, ref, Date.now(), undefined, (id) => nodeById(s, id)?.goalId ?? null)
      // 网页页签不属于任何目标（公共）：登记成公共，切目标时它留栏上（见 groups/goals）
      set({ ...s, docArea: withOwners(opened, claimTab(opened.tabOwners, PUBLIC_OWNER, tabId)) })
      return tabId
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

  return {
    goalTabGroup,
    retargetGoal,
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
  }
}
