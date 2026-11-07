import { useState, type Dispatch, type SetStateAction } from 'react'
import type { LearnStore } from '../../../learn/types'
import { captureExamDelete, captureNodeDelete } from '../../../learn/undo'
import { deleteGoal, deleteNode, nodeById, removeExam } from '../../../learn/graph'
import type { Exam } from '../../../learn/exam'
import type { PendingNodeDelete } from './useCanvasChannel'
import { t } from '../../../i18n'

/** 删除确认流需要的宿主能力与邻接动作 */
export interface DeleteFlowsDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  /** 撤回栈（useExplorerUndo）：删除类动作先捕获再动手 */
  pushUndo: (entry: Exclude<ReturnType<typeof captureNodeDelete>, null>) => void
  /** 一枚目标名下的节点总数（确认框上的量词） */
  goalSubtreeSize: (rootOrGoalId: string) => number
  /** 删完收拾 agent 页签（useAgentTabActions） */
  fixAgentTabsAfter: (s: LearnStore) => LearnStore
}

/* ---------- 删除确认流（删目标/节点、删试卷两档、删笔记、删超级文档） ---------- */
export function useDeleteFlows({
  getLatest,
  set,
  onToast,
  pushUndo,
  goalSubtreeSize,
  fixAgentTabsAfter,
}: DeleteFlowsDeps) {
  // 删除确认：pendingDelete 非空时弹出确认框（删谁只删谁，问一句再删；根文档=整个目标）
  const [pendingDelete, setPendingDelete] = useState<PendingNodeDelete | null>(null)
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

  return {
    pendingDelete,
    setPendingDelete: setPendingDelete as Dispatch<SetStateAction<PendingNodeDelete | null>>,
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
  }
}
