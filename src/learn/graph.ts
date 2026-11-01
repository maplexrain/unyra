/**
 * 图的纯函数操作：输入旧 store、返回新 store。不碰文件系统、不碰 DOM。
 * 记录采用「节点 + 依赖边」分离，因此同一知识点可被多个父节点引用。
 *
 * 本文件只做 re-export（barrel）：实现按职责拆到 ./graph/ 下的各个模块，
 * 调用方仍旧从 './graph' 导入，路径与符号名一个不变。
 */

/* ---------- 节点（含 nodeById / goalById 两个查表函数） ---------- */
export {
  addNode,
  ancestors,
  createChildNode,
  createNodeUnder,
  deleteNode,
  findNodeByTitle,
  goalById,
  knowledgeDepth,
  moveNode,
  nodeById,
  normalizeKey,
  replaceNode,
  siblingIds,
  titleTaken,
  touchNode,
  updateDoc,
  updateNode,
} from './graph/nodes'

/* ---------- 依赖边 ---------- */
export {
  addEdge,
  backtrackTargets,
  docIdOfMember,
  isUnlocked,
  parentIds,
  pathToRoot,
  prereqIds,
  removeEdge,
  unmetPrereqs,
  wouldCreateCycle,
} from './graph/edges'

/* ---------- 笔记 ---------- */
export { appendNote, createNote, deleteNote, notesOfNode, renameNoteFile, writeNote } from './graph/notes'

/* ---------- 节点状态 ---------- */
export { setNodeStatus } from './graph/state'

/* ---------- 注解 ---------- */
export { addAnnotation, removeAnnotation, updateAnnotation } from './graph/annotations'

/* ---------- 阅读账与目标级操作 ---------- */
export { deleteGoal, goalProgress, goalSubtreeIds } from './graph/goals'

/* ---------- 会话 ---------- */
export {
  addConversation,
  conversationById,
  conversationTitle,
  conversationsOfGoal,
  deleteConversation,
  deleteMessage,
  ensureConversation,
  latestConversation,
  resolveDisplayedConversation,
  updateMessageText,
} from './graph/conversations'

/* ---------- 考试 ---------- */
export {
  abandonAttempt,
  applyExplanation,
  applyGradeResult,
  attachCroppedAnswerImage,
  attachHandwrittenImages,
  updateHandwrittenImage,
  examsOfNode,
  findAttempt,
  latestExam,
  ongoingAttempt,
  removeExam,
  replaceQuestionImages,
  shellExamOf,
  startAttempt,
  submitAttempt,
  upsertAttempt,
  upsertExam,
} from './graph/exams'
export type { GradePayload } from './graph/exams'
