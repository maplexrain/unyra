/**
 * 渲染层与主进程共用的 IPC 契约类型——同一个契约只留这一份。
 *
 * 这些形状原先在 `electron/preload.ts`（主进程暴露出去的形状）与 `src/lib/native.ts`
 * （渲染层看到的 preload 形状）里各写一份、逐字重复，另外在 electron/runner.ts、
 * electron/plugins.ts、electron/voice.ts、electron/storage/**、src/lib/codeArtifacts.ts
 * 里还有同名同体的副本。漏改一侧不会编译报错，只会在运行时炸——所以只在这里留一份，
 * 其余各文件从这里 `import type` 之后按原样再转出去（调用方的 import 路径不变）。
 *
 * 三条约定：
 * - 这里**只有类型与接口**，一个运行时值都不许放：本文件会被渲染层与主进程同时引入，
 *   放值就会把一侧的实现拖进另一侧的包里。
 * - 通道名字符串（`'storage:read'` 之类）留在各自的实现里——它们是实现细节，不是契约形状。
 * - 每个类型上面那句「谁在用」写的是它跨进程的两端，改字段之前先看那两端。
 *
 * 契约本体已按通道组拆到 ./ipc/ 子目录（browser / browserLogs / storage / plugins /
 * codeArtifact / voice / ocr / nativeExport / fetch / update / exam / fs / process /
 * mcp / notice / video / screen），本文件只做**原样转发**（类型 `export type { ... } from`，
 * 局域网一段保持 `export * from './lan'` 原样）——调用方从 shared/ipc 引用名字的写法
 * 一行都不用改。
 */

/* ---------- 内置浏览器（webview 网页页签） ---------- */
export type {
  WebSnapshotElement,
  WebSnapshotResult,
  WebPointResult,
  WebDomOpResult,
  WebReadHtmlResult,
  TranslationEngine,
  WebTranslatePayload,
  WebFastTranslateResult,
} from './ipc/browser'

/* ---------- 页签日志与直发请求（browser.logs / logDetail / fetch / record，见 shared/webLogs） ---------- */
export type {
  WebLogsOpts,
  WebLogsResult,
  WebLogDetailResult,
  WebPageFetchReq,
  WebPageFetchResult,
  WebTextTarget,
  WebTextResult,
  WebScrollReq,
  WebScrollResult,
  WebWaitReq,
  WebWaitResult,
  WebRecordResult,
} from './ipc/browserLogs'

/* ---------- 窗口外壳 / 数据落盘（含落盘通用结果） ---------- */
export type {
  CloseBehavior,
  CloseAction,
  StorageInfo,
  RootRisk,
  StorageEntry,
  FlushItem,
  PluginSettingsResult,
  StorageFail,
  StorageOk,
  StorageRootResult,
} from './ipc/storage'

/* ---------- 插件目录（{root}/plugins/） ---------- */
export type {
  PluginEntry,
  PluginListResult,
  PluginSourceResult,
  PluginTogglesResult,
} from './ipc/plugins'

/* ---------- 代码块的伪编译产物 ---------- */
export type { CodeArtifact, SilentMark } from './ipc/codeArtifact'

/* ---------- 语音模型与识别 ---------- */
export type {
  VoiceModelFile,
  VoiceModelStatus,
  VoiceModelProgress,
  VoiceDownloadResult,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from './ipc/voice'

/* ---------- OCR 文字识别 ---------- */
export type {
  OcrBBox,
  OcrWordItem,
  OcrLineItem,
  OcrPageResult,
  OcrModelOption,
  OcrModelStatus,
  OcrModelProgress,
  OcrDownloadRequest,
  OcrDownloadResult,
  OcrRecognizeRequest,
  OcrRecognizeResult,
} from './ipc/ocr'

/* ---------- 原生导入导出 ---------- */
export type {
  SaveFilter,
  SaveBinaryPayload,
  SaveBinaryResult,
  ExportPdfPayload,
  ExportPdfResult,
} from './ipc/nativeExport'

/* ---------- 附件 / 抓网页 ---------- */
export type { AttachReadResult, WebFetchResult, WebBinaryFetchResult } from './ipc/fetch'

/* ---------- 基础文件系统与 project:fs ---------- */
export type {
  BaseFileEntry,
  BaseFileStat,
  BaseFileReadResult,
  BaseFileWriteResult,
  BaseFileEditOpts,
  BaseFileEditResult,
  BaseFileListResult,
  BaseFileStatResult,
  BaseFileOpResult,
  ProjectFsOp,
  ProjectFsRequest,
  ProjectFsResult,
} from './ipc/fs'

/* ---------- base.process（进程管理） ---------- */
export type {
  BaseProcessCreateOpts,
  BaseProcessInfo,
  BaseProcessCreateResult,
  BaseProcessStartResult,
  BaseProcessStatusResult,
  BaseProcessOutputResult,
  BaseProcessStopResult,
  BaseProcessDeleteResult,
  BaseProcessListResult,
  BaseProcessGetResult,
} from './ipc/process'

/* ---------- 外部 MCP 服务的本地进程会话（stdio 传输，见 electron/mcp） ---------- */
export type {
  McpStdioServerPayload,
  McpStdioTool,
  McpStdioToolsResult,
  McpStdioContentItem,
  McpStdioCallResult,
} from './ipc/mcp'

/* ---------- 公告（远程公告的本地状态） ---------- */
export type { NoticeSettings } from './ipc/notice'

/* ---------- 视频学习（实验） ---------- */
export type { VideoApiFetchResult, VideoStreamOpenResult } from './ipc/video'

/* ---------- 考试窗口 ---------- */
export type {
  ExamOpenResult,
  ExamCloseReason,
  CropBoxInput,
  CropImageResult,
  PreviewCropResult,
  RotateImageResult,
} from './ipc/exam'

/* ---------- 自动更新 ---------- */
export type {
  UpdateChannel,
  UpdatePhase,
  UpdateFail,
  UpdateState,
} from './ipc/update'

/* ---------- 局域网互联与文件传输服务 ---------- */
export * from './lan'

/* ---------- 屏幕截图与录屏工具 ---------- */
export type {
  ScreenCaptureResult,
  ScreenRecordResult,
  ImageSavePayload,
  ImageSaveResult,
  ImageCopyResult,
} from './ipc/screen'

/* ---------- TTS 语音合成与本地模型 ---------- */
export type {
  TtsModelDefinition,
  TtsModelFile,
  TtsModelStatus,
  TtsModelProgress,
  TtsDownloadResult,
  TtsSynthesizeRequest,
  TtsSynthesizeResult,
} from './ipc/tts'
