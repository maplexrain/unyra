import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { LearnStore, TabRef, WebTabMeta } from '../../../learn/types'
import {
  activateIn,
  closeIn,
  focusedGroup,
  groupIdOfTab,
  isAnchorOutline,
  openAnchorOutline,
  openGroupedDoc,
  openInGroup,
  openOutlineTab,
  claimTab,
  refOwner,
  settle,
  withGroup,
  withOwners,
} from '../../../learn/groups'
import { tabKey, tabNodeId, tabTitle, newWebKey, newDraftKey, makeTab } from '../../../learn/tabs'
import { nodeById, normalizeKey } from '../../../learn/graph'
import { nodePathOf, resolveNode } from '../../../learn/paths'
import { normalizeWebInput } from '../../../learn/webUrl'
import { tabRefFromChip, wsChipUserRel } from '../../../learn/chipRef'
import type { ChipPayload } from '../../../lib/docChip'
import { userAbsPath } from '../../../lib/storage'
import { isWeb } from '../../../lib/native'
import { pickLocalFiles } from '../../../lib/localFiles'
import { addLocalFile } from '../../../learn/localfiles'
import { nodeDocPath } from '../../../learn/files'
import { wsRefOfRel, wsRelOfTab } from '../../../learn/workspace'
import type { ExamBridgeApi } from '../../../learn/useExamBridge'
import { t } from '../../../i18n'

/** chip 引用与就地打开需要的宿主能力与邻接动作 */
export interface ChipOpeningDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  openTab: (ref: TabRef, preferredView?: import('../../../learn/types').DocView) => void
  activateTab: (tabId: string) => void
  openWebTab: (url: string, selector?: string) => string
  /** 跳到节点 = 开它的教学文档（useTabOpening 的 switchNode） */
  selectNode: (nodeId: string) => void
  exam: ExamBridgeApi
  retargetNode: (s: LearnStore, nodeId: string) => LearnStore
  setOutlineFocus: Dispatch<SetStateAction<{ nodeId: string; nonce: number } | null>>
  setCreateGoalOpen: Dispatch<SetStateAction<boolean>>
  /** 网页页签的活标题（拖拽 payload 里带上，见宿主 webMetaRef 的回填） */
  webMetaRef: RefObject<Record<string, WebTabMeta>>
  examTabTitle: (examId: string, attemptId: string) => string | undefined
}

/* ---------- chip 引用与就地打开（消息里的引用点击、拖放进文档区、空白页上的就地按钮） ---------- */
export function useChipOpening({
  getLatest,
  set,
  onToast,
  openTab,
  activateTab,
  openWebTab,
  selectNode,
  exam,
  retargetNode,
  setOutlineFocus,
  setCreateGoalOpen,
  webMetaRef,
  examTabTitle,
}: ChipOpeningDeps) {
  /**
   * 页签拖进对话输入框时交给它的那份引用（见 lib/chipSyntax 的 ChipPayload）：
   * 带上宿主知道的全部字段——nodeId 让打开时免于反查，path 给导师的 doc.* 接口与
   * #[{…}] 文本形态用，title 是显示名。网页页签也拖得出引用：一枚 web chip。
   */
  const tabDocPayload = useCallback((ref: TabRef): ChipPayload | null => {
    const s = getLatest()
    const title = tabTitle(ref, (id) => nodeById(s, id)?.title, examTabTitle, (vid) => s.videoNodes?.find((vn) => vn.id === vid)?.title ?? s.videos?.find((v) => v.id === vid)?.title)
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
      ref.kind === 'sponsors' ||
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
        // 3. 若节点树里依然未找到，但路径带物理文件后缀（如 .md），优先尝试反查工作区，再兜底本地文件
        if (/\.[a-z0-9]{1,8}$/i.test(p.path)) {
          const wsRel = wsChipUserRel(s, p.path, targetGoalId ?? undefined)
          const wsRef = wsRel ? wsRefOfRel(s, wsRel) : null
          if (wsRef) {
            openTab(wsRef)
            return
          }
          const fileNorm = p.path.replace(/\\/g, '/')
          const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(fileNorm)
          const abs = isAbs ? fileNorm : (userAbsPath(fileNorm) ?? fileNorm)
          openTab({ kind: 'local', path: abs, title: p.path.split('/').pop() })
          return
        }
      }
      if (p.type === 'ws' && p.path) {
        // ws 类型的兜底：若是绝对路径，尝试作为本地文件打开
        const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(p.path)
        if (isAbs) {
          openTab({ kind: 'local', path: p.path, title: p.title || p.path.split('/').pop() })
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
    [setCreateGoalOpen],
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

  return {
    tabDocPayload,
    openChip,
    openChipInGroup,
    openInPlace,
    openWebInPlace,
    openNewGoalInPlace,
    openNewFileInPlace,
    pickLocalInPlace,
  }
}
