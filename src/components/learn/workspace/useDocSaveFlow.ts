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
import { notesOf, type LearnStore, type LearnTab } from '../../../learn/types'
import { draftOf, dropDraft, dropDrafts, putDraft, stageDraft } from '../../../learn/drafts'
import {
  closeTabs,
  tabTitle,
  tabNodeId,
  fileNameOf as localFileNameOf,
  type TabCloseMode,
} from '../../../learn/tabs'
import { allTabs, closeIn, findTab, focusedGroup, focusedTab, groupOf } from '../../../learn/groups'
import { nodeById, updateDoc, writeNote } from '../../../learn/graph'
import { findNote } from '../../../learn/notes'
import { readSuperDoc, writeSuperDoc } from '../../../learn/superdocs'
import { writeLocalFile } from '../../../lib/localFiles'
import { native } from '../../../lib/native'
import { savedTextOf } from './labels'
import { t } from '../../../i18n'

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
  onToast: (msg: string) => void
}

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
    for (const p of Object.keys(rawConflicts)) {
      const tab = tabs.find((t) => t.ref.kind === 'local' && t.ref.path === p)
      if (tab && drafts[tab.id] !== undefined) out[p] = true
    }
    return out
  }, [rawConflicts, tabs, drafts])

  /**
   * 关闭动作的本体：closeIn 算落点（那一格收了或换了激活项）、节点与会话跟着新落点走。
   *
   * 「落点」要在**关完之后**再读一次：那一格关空了就被收掉了（见 groups 的 dropEmpties），
   * 那时该看的是接管焦点的那一格显示什么，而不是一个已经不存在的组。
   */
  const applyClose = useCallback(
    (group: string, id: string, mode: TabCloseMode) => {
      const s = getLatest()
      const docArea = closeIn(s.docArea, group, id, mode)
      const landing = focusedGroup(docArea)
      const nextRef = landing.tabs.find((t) => t.id === landing.active)?.ref ?? null
      const nextNodeId = nextRef ? tabNodeId(nextRef) : null
      // 落点也一样：新落到的页签属于别的节点时，节点与会话都得跟着它走（见 retargetNode）
      const base = nextNodeId ? retargetNode(s, nextNodeId) : s
      set({ ...base, docArea })
    },
    [getLatest, retargetNode, set],
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
    (group: string, id: string, mode: TabCloseMode, opts?: { confirm?: boolean }) => {
      const s = getLatest()
      const g = groupOf(s.docArea, group)
      if (!g) return
      const r = closeTabs(g.tabs, id, mode, g.active)
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
      applyClose(group, id, mode)
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
      // 本地文件、试卷副本与大纲页都没有「暂存」这回事：一个自己管落盘，一个只读，一个不是文档
      if (!tab || tab.ref.kind === 'local' || tab.ref.kind === 'exam' || tab.ref.kind === 'outline') return
      set({ ...s, drafts: stageDraft(s.drafts, tab.id, content, savedTextOf(s, tab.ref)) })
    },
    [getLatest, set],
  )

  /**
   * 本地文件的暂存（见 LocalDoc）：它自己知道磁盘上那一份是什么，改回去时传 null。
   */
  const stageLocalDraft = useCallback(
    (tabId: string, text: string | null) => {
      const s = getLatest()
      const tab = findTab(s.docArea, tabId)
      if (!tab || tab.ref.kind !== 'local') return
      set({ ...s, drafts: text === null ? dropDraft(s.drafts, tab.id) : putDraft(s.drafts, tab.id, text) })
    },
    [getLatest, set],
  )

  /**
   * 保存一个页签的暂存改动（Ctrl+S 与「关闭未保存页签」两条路共用这一份）。
   *
   * 返回 null = 存成了（或本来就没东西可存）；返回一句**用户能直接读**的失败说明——
   * 调用方原样弹吐司，据此决定要不要继续（关闭流程失败就停，不把没存上的东西丢掉）。
   * 冲突弹窗不在这里出：Ctrl+S 路径在调用前判断，关闭路径自己在遍历时判断。
   */
  const saveTab = useCallback(
    async (tab: LearnTab): Promise<string | null> => {
      const s = getLatest()
      const text = draftOf(s.drafts, tab.id)
      if (text === undefined) return null
      // 网页页签没有编辑器，永远不该有暂存正文；真有这份草稿也没处可存
      if (tab.ref.kind === 'web') return null
      // 守卫上下文、专注报告与系统页（设置/用量）同样没有编辑器，没有暂存这回事
      if (
        tab.ref.kind === 'guard' ||
        tab.ref.kind === 'report' ||
        tab.ref.kind === 'settings' ||
        tab.ref.kind === 'usage'
      )
        return null
      const title = tabTitle(tab.ref, (nid) => nodeById(s, nid)?.title, examTabTitle)
      setDocSaving(true)
      if (tab.ref.kind === 'local') {
        // 属性收窄穿不进下面的回调：先把路径提取出来（见 saveTab 其余分支的同款处理）
        const localPath = tab.ref.path
        const err = await writeLocalFile(localPath, text)
        if (err) {
          setDocSaving(false)
          setDocSaveError(err)
          return t('保存「{0}」失败：{1}', title, err)
        }
        setDocSaveError(undefined)
        setLocalSaved({ path: localPath, text })
        // 存成了，外部改动已被这一版盖过：冲突标记撤掉
        setRawConflicts((m) => {
          if (!m[localPath]) return m
          const next = { ...m }
          delete next[localPath]
          return next
        })
        set({ ...s, drafts: dropDraft(s.drafts, tab.id) })
      } else {
        /*
         * 指向的东西中途没了的兜底：节点被删、笔记被删或改名——这条页签本该同时被关掉，
         * 但保存是异步入口（快捷键随时可能按下），落后一拍时不能装作存进去了：
         * 那会让用户以为写住了，然后把暂存区里唯一的一份正文也清掉。
         */
        const node = nodeById(s, tab.ref.nodeId)
        const gone =
          !node ||
          (tab.ref.kind === 'note' && !findNote(notesOf(node), tab.ref.note)) ||
          // 超级文档被 Agent 删掉后不靠保存「复活」它：那份 HTML 已经没有了
          (tab.ref.kind === 'super' && !readSuperDoc(s, tab.ref.nodeId, tab.ref.name))
        if (gone) {
          setDocSaving(false)
          return t('「{0}」已经不在了，没能保存', title)
        }
        const next =
          tab.ref.kind === 'note'
            ? writeNote(s, tab.ref.nodeId, tab.ref.note, text)
            : tab.ref.kind === 'super'
              ? writeSuperDoc(s, tab.ref.nodeId, tab.ref.name, text)
              : updateDoc(s, tab.ref.nodeId, text)
        // 超级文档那条路在节点消失时会返回 null（上面 gone 查过一拍，异步入口仍要兜底）
        if (!next) {
          setDocSaving(false)
          return t('「{0}」已经不在了，没能保存', title)
        }
        set({ ...next, drafts: dropDraft(next.drafts, tab.id) })
      }
      // 暂存清掉之后立刻落盘：手动保存的意思就是「现在就写下去」，不是「等下一次防抖」
      await flush()
      setDocSaving(false)
      return null
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
    if (tab.ref.kind === 'local' && localConflicts[tab.ref.path]) {
      setPendingConflict({ path: tab.ref.path, tabId: tab.id, phase: 'save' })
      return
    }
    const err = await saveTab(tab)
    if (err) {
      onToast(err)
      return
    }
    onToast(t('已保存「{0}」', docTitle))
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
        if (tab.ref.kind === 'local' && conflictsRef.current[tab.ref.path]) {
          setPendingConflict({
            path: tab.ref.path,
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
        const err = await saveTab(tab)
        if (err) {
          onToast(t('{0}，先不关闭了', err))
          return
        }
      }
      applyClose(group, id, mode)
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
    // 被放弃的本地文件：冲突标记一并作废——重开之后编辑器的基准就是磁盘上那一版
    const droppedPaths = p.dirtyIds.flatMap((tid) => {
      const tab = findTab(s.docArea, tid)
      return tab && tab.ref.kind === 'local' ? [tab.ref.path] : []
    })
    if (droppedPaths.length) {
      setRawConflicts((m) => {
        if (!droppedPaths.some((x) => m[x])) return m
        const next = { ...m }
        for (const x of droppedPaths) delete next[x]
        return next
      })
    }
    applyClose(p.group, p.id, p.mode)
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
      const err = await saveTab(tab)
      if (err) {
        onToast(p.phase === 'close' ? t('{0}，先不关闭了', err) : err)
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
   * - 没暂存：外部就是新的「已保存版」，版本号 +1 让页签重挂重读，当场同步；
   * - 有暂存：用户手上的版本不能被动覆盖，只记一个冲突标记，等他保存时再问覆盖还是另存。
   */
  const handleLocalChange = useCallback(
    (p: string) => {
      const s = getLatest()
      const tab = allTabs(s.docArea).find((t) => t.ref.kind === 'local' && t.ref.path === p)
      if (!tab) return
      if (s.drafts[tab.id] !== undefined) {
        if (!conflictsRef.current[p]) {
          // ref 先行（事件处理里写 ref 不违反渲染纪律）：同一次外部保存连发的两拍只提醒一次
          conflictsRef.current = { ...conflictsRef.current, [p]: true }
          onToast(t('「{0}」在外部被改动过；保存时会请你选覆盖还是另存', localFileNameOf(p)))
        }
        setRawConflicts((m) => (m[p] ? m : { ...m, [p]: true }))
        return
      }
      // 保存后残留的「刚保存的正文」要撤掉：它比磁盘上这份旧，留着会在重挂后盖住新内容。
      // 冲突标记也一并作废：重挂之后编辑器的基准就是磁盘上这一版，旧的「外部改过」不再成立。
      setLocalSaved((cur) => (cur?.path === p ? null : cur))
      setRawConflicts((m) => {
        if (!m[p]) return m
        const next = { ...m }
        delete next[p]
        return next
      })
      if (conflictsRef.current[p]) {
        const nextRef = { ...conflictsRef.current }
        delete nextRef[p]
        conflictsRef.current = nextRef
      }
      setLocalTicks((m) => ({ ...m, [p]: (m[p] ?? 0) + 1 }))
      // setLocalSaved 是宿主 useState 的 dispatch（身份稳定）：列进来只为过 exhaustive-deps，不改行为
    },
    [getLatest, onToast, setLocalSaved],
  )
  const localChangeRef = useRef(handleLocalChange)
  useEffect(() => {
    localChangeRef.current = handleLocalChange
  })

  /** 开着的本地文件页签：这就是主进程要盯的文件清单（关掉页签就不再盯） */
  const openLocalPaths = useMemo(
    () => tabs.flatMap((t) => (t.ref.kind === 'local' ? [t.ref.path] : [])),
    [tabs],
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
