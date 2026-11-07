import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DocView, DockNoteItem, EssayCommit, EssayDockRect, EssayEntry, KnowledgeNode, LearnStore, TabRef } from '../../../learn/types'
import { notesOf } from '../../../learn/types'
import { createEssay, deleteEssay, updateEssay } from '../../../learn/essays'
import {
  changesSummary,
  commitFeed,
  commitsOf,
  createEssayCommit,
  diffNoteChanges,
  noteFingerprint,
  parseEssayComment,
  updateEssayCommit,
} from '../../../learn/essayCommits'
import { addConversation, conversationById, resolveDisplayedConversation, writeNote, deleteNote } from '../../../learn/graph'
import type { useAgent } from '../../../learn/useAgent'
import { useDoubleShift } from '../../../lib/useDoubleShift'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>

/** 随笔域需要的宿主能力与数据 */
export interface EssayFlowDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  /** 窗口几何走安静写盘（不重渲染整棵学习区） */
  patchQuiet: (patch: (s: LearnStore) => LearnStore) => void
  /** 眼前这份文档的节点：随笔跟着它所属的目标走 */
  docNode: KnowledgeNode | null
  agent: AgentApi
  hasKey: boolean
  onToast: (msg: string) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  /** 窗口开合状态留在宿主（DocFloat / 侧栏也要读），这里只拿开关 */
  setEssayOpen: Dispatch<SetStateAction<boolean>>
}

/**
 * 没有随笔时的空数组：**同一个常量**。
 * 每次渲染现造一个 `[]` 会让 EssayDock 的 props 每次都变（它没有 memo，但列表要重排一遍）。
 */
const EMPTY_ESSAYS: EssayEntry[] = []
/** 没有提交记录时的空数组：理由同上（同一个常量，避免每次渲染都换引用） */
const EMPTY_COMMITS: EssayCommit[] = []
/** 没有当前目标时的笔记表：同一个空数组，避免每次渲染都造新引用 */
const EMPTY_DOCK_NOTES: DockNoteItem[] = []

/* ---------- 随笔（见 learn/essays 与 components/learn/essay） ---------- */
export function useEssayFlow({
  store,
  getLatest,
  set,
  patchQuiet,
  docNode,
  agent,
  hasKey,
  onToast,
  openTab,
  setEssayOpen,
}: EssayFlowDeps) {
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
   * 上一份的收尾由 EssayDock 的 key 变化触发卸载时做（见宿主里的 key）。
   */
  const lastEssayGoal = useRef<string | null>(null)
  useEffect(() => {
    if (lastEssayGoal.current === essayGoalId) return
    lastEssayGoal.current = essayGoalId
    setEssayOpen(false)
  }, [essayGoalId, setEssayOpen])

  return {
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
    organizeEssayCommit,
    essayCommit,
    essayCommitRetry,
    essayOpenNote,
  }
}
