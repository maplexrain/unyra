/**
 * Agent 的工具集：现在只剩一个 execute——模型写一段 JS，通过沙箱里的 api 编排一切。
 *
 * 为什么改成这样：模型逐个调工具时，「读一段、改一段、再读回来核对」这种多步动作
 * 每一步都要一次往返，中间结果全塞进上下文；而循环、条件、批量修改这类事本来就该
 * 由代码来表达。现在笔记读写、描述、试卷、临时变量全部变成沙箱 api。
 *
 * 代价也写在明处：不再有 JSON Schema 级的参数校验（改由 api 在运行时校验），
 * 写代码能力弱的模型会更容易出错——报错信息因此写得尽量具体。
 */

/*
 * 这个文件现在只是一个 barrel：实现按职责搬进了 ./sandbox/，下面把它们原样再导出一次，
 * 从 './tools'（或 '../agent/tools'）取用这些符号的调用方一行都不用改。
 */

/* ---------- 类型：全部契约（sandbox/types、sandbox/refs） ---------- */
export type {
  AskAnswer,
  AskAnswers,
  AskFormPayload,
  AskOption,
  AskQuestion,
  AttentionOps,
  CheckinOps,
  CodeOps,
  CompactOps,
  CreateExamPayload,
  ExamAction,
  ExamToolDeps,
  ExecuteTool,
  LearningOps,
  MethodOps,
  MindOps,
  PomodoroOps,
  ReadingOps,
  ResourceOps,
  ReviewOps,
  SandboxCall,
  SandboxDocKind,
  SandboxOptions,
  SandboxReply,
  SandboxRequest,
  SuperDocOps,
  UiCaptureResult,
  UiOps,
  UiPointRequest,
  UiScrollRequest,
  UserInfoOps,
  WebOps,
  WorkflowOps,
  WorkspaceOps,
} from './sandbox/types'
export { EXAM_ACTIONS } from './sandbox/types'

export type { DocRef, NodeRef, ResolvedDocRef, ResolvedNodeRef } from './sandbox/refs'

/* ---------- 参数小工具与文档跳转规则（sandbox/refs） ---------- */
export { asExamPayload, asIndex, asOptionalPath, asRecord, asText } from './sandbox/refs'
/* plainLineOf / needleForDoc 与文档跳转类型仍旧从这里取得到（中转自 lib/docDom） */
export { needleForDoc, plainLineOf } from './sandbox/refs'
export type { DocJumpTarget } from './sandbox/refs'

/* ---------- body 的形状归一化与编译检查（sandbox/body） ---------- */
export { compileBody, normalizeBody } from './sandbox/body'
export type { CompileBodyResult } from './sandbox/body'

/* ---------- ask 表单（sandbox/askForm） ---------- */
export { normalizeAskForm, safeJson } from './sandbox/askForm'

/* ---------- 沙箱 api（sandbox/api、sandbox/standalone） ---------- */
export { buildApi, clip, imagesOf } from './sandbox/api'
export { buildStandaloneApi } from './sandbox/standalone'

/* ---------- 执行器（sandbox/worker、sandbox/execute） ---------- */
export { makeDomFacade, RENAMED_API_HINT, runInWorker } from './sandbox/worker'
export { createExecuteTool } from './sandbox/execute'