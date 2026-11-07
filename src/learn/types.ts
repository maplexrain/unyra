/**
 * 学习域类型门面（facade）。
 *
 * 原先的单文件实现按域拆进本目录的 types/（node / tabs / media / essay /
 * memory / workflow / store / utils），这里是唯一的对外出口：全仓库对
 * `learn/types` 的既有导入（`from '../../learn/types'` 等）一行不改，
 * 靠下面的**原名转发**接住。tsconfig 开了 verbatimModuleSyntax——
 * 类型用 `export type` 转发、值用 `export` 转发，两者不可混写。
 */

/* ---------- 节点 / 文档 / 大纲 / 注解（types/node） ---------- */
export type {
  MasteryStatus,
  DocKind,
  NodeDocs,
  NoteFile,
  SuperDocFile,
  DetachedPool,
  OutlineEntry,
  OutlineDoc,
  OutlineEntity,
  MethodEntry,
  MethodStore,
  AnnotationKind,
  AnnotationStyle,
  Annotation,
  DocNotepadItem,
  KnowledgeNode,
  DependencyEdge,
  LearningGoal,
} from './types/node'
export {
  DOC_KINDS,
  DOC_LABEL,
  MASTERY_LABEL,
  emptyDocs,
  isDocKind,
  emptyOutline,
} from './types/node'

/* ---------- 页签 / 收藏（types/tabs） ---------- */
export type {
  TabRef,
  AgentTabRef,
  DocView,
  WebTabMeta,
  LearnTab,
  LocalFile,
  FavoriteRef,
  FavoriteItem,
} from './types/tabs'

/* ---------- 视频 / 项目 / 文件节点（types/media） ---------- */
export type {
  VideoResource,
  VideoChapter,
  VideoRecap,
  VideoNodeEntity,
  ProjectNodeEntity,
  ProjectPathKind,
  FileNodeKind,
  FileNodeEntity,
} from './types/media'

/* ---------- 随笔（types/essay） ---------- */
export type {
  EssayEntry,
  EssayStore,
  EssayCommitChange,
  EssayCommit,
  EssayCommitStore,
  EssayDockState,
  EssayDockRect,
  DockNoteItem,
} from './types/essay'

/* ---------- 记忆（types/memory） ---------- */
export type { MemoryType, MemoryItem, MemoryStore } from './types/memory'

/* ---------- 工作流（types/workflow） ---------- */
export type { WorkflowEntry, WorkflowBook } from './types/workflow'

/* ---------- 顶层 store / 滚动 / 临时变量（types/store） ---------- */
export type { LearnStore, DocScroll, TmpEntry, TmpStore } from './types/store'

/* ---------- 取值 / 兜底小工具（types/utils） ---------- */
export { notesOf, docOf, superDocsOf, outlineOf } from './types/utils'

export type { Conversation } from '../agent/types'
