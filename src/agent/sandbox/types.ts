/**
 * 这个文件负责什么：沙箱对外的全部**类型契约**——宿主能力（SandboxOptions）、
 * 各分组 ops 接口、请求/回复与 execute 工具的形状。这里没有实现（只有一张阶段表 EXAM_ACTIONS），
 * 实现见同目录的 api / body / askForm / worker / execute。
 *
 * 契约本体已按 API 能力组拆到 ./types/ 子目录（core / exam / options / permission /
 * subagent / ask / workspace / web / see / memory / schedule / compact / chip / delivery /
 * method / workflow / code / userInfo / ui / browser / mcp / resources / video / project），
 * 本文件只做**原样转发**：类型用 `export type { ... } from`、值（EXAM_ACTIONS）用
 * `export { ... } from`——调用方从 './sandbox/types' 引用名字的写法一行都不用改。
 */
export type { SandboxDocKind } from './refs'
export type { NodeOps } from './nodeObject'

/* ---------- 传输核心（SandboxCall / SandboxRequest / SandboxReply / ExecuteTool） ---------- */
export type { SandboxCall, SandboxRequest, SandboxReply, ExecuteTool } from './types/core'

/* ---------- 考试（exam） ---------- */
export { EXAM_ACTIONS } from './types/exam'
export type { CreateExamPayload, ExamToolDeps, ExamAction } from './types/exam'

/* ---------- 总装配 ---------- */
export type { SandboxOptions } from './types/options'

/* ---------- permission：路径放行 ---------- */
export type { PermissionRequestPayload, PermissionOps } from './types/permission'

/* ---------- subagent：子代理 ---------- */
export type {
  SubWaitDelivery,
  SubWaitRunning,
  SubWaitResult,
  SubAgentApiResult,
  SubAgentSandboxApi,
} from './types/subagent'

/* ---------- ask：结构化表单 ---------- */
export type {
  AskOption,
  AskQuestionType,
  AskFileAttachment,
  AskQuestion,
  AskFormPayload,
  AskAnswer,
  AskAnswers,
} from './types/ask'

/* ---------- workspace / web / see ---------- */
export type { WorkspaceOps } from './types/workspace'
export type { WebOps } from './types/web'
export type { SeeRequest } from './types/see'

/* ---------- memory / schedule / compact ---------- */
export type { MemoryOps } from './types/memory'
export type { ScheduleOps } from './types/schedule'
export type { CompactOps } from './types/compact'

/* ---------- chip / delivery / method / wf / code / userInfo ---------- */
export type { ChipOps } from './types/chip'
export type { DeliveryOps } from './types/delivery'
export type { MethodOps } from './types/method'
export type { WorkflowOps } from './types/workflow'
export type { CodeOps } from './types/code'
export type { UserInfoOps } from './types/userInfo'

/* ---------- ui：界面操作 ---------- */
export type { UiPointRequest, UiScrollRequest, UiCaptureResult, UiOps } from './types/ui'

/* ---------- browser：内置浏览器 ---------- */
export type {
  BrowserTabInfo,
  BrowserTarget,
  BrowserIndexOpts,
  BrowserIndexResult,
  BrowserTextOpts,
  BrowserTextResult,
  BrowserInspectOpts,
  BrowserInspectResult,
  BrowserClickOpts,
  BrowserClickResult,
  BrowserFillOpts,
  BrowserFillResult,
  BrowserTypeOpts,
  BrowserTypeResult,
  BrowserPressResult,
  BrowserScrollOpts,
  BrowserScrollResult,
  BrowserQueryItem,
  BrowserQueryOpts,
  BrowserQueryResult,
  BrowserWaitForOpts,
  BrowserWaitForResult,
  BrowserToImageOpts,
  BrowserToImageResult,
  BrowserScreenshotOpts,
  BrowserScreenshotResult,
  BrowserToMarkdownOpts,
  BrowserToMarkdownResult,
  BrowserEvalOpts,
  BrowserEvalResult,
  BrowserOps,
} from './types/browser'

/* ---------- mcp / res / video / project ---------- */
export type { McpOps } from './types/mcp'
export type { ResourceOps } from './types/resources'
export type { VideoEpisodeInfo, VideoInfoResult, VideoOps } from './types/video'
export type { ProjectTreeEntry, ProjectOps } from './types/project'
