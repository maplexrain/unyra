/**
 * 这个文件负责什么：沙箱对外的全部**类型契约**——宿主能力（SandboxOptions）、
 * 各分组 ops 接口、请求/回复与 execute 工具的形状。这里没有实现（只有一张阶段表 EXAM_ACTIONS），
 * 实现见同目录的 api / body / askForm / worker / execute。
 */
import type { AgentTool, AgentToolResult, MessageImage } from '../types'
import type { TmpEntry } from '../../learn/types'
import type { ProfileField } from '../../user/fields'
/* SandboxDocKind 定义在 ./refs（DocRef 要用它），这里既要它进本文件的作用域、又要对外转出：
   import type 管前者，export type ... from 管后者——少写前者，下面那些引用会全变成「找不到名字」。 */
import type { ResolvedDocRef, ResolvedNodeRef, SandboxDocKind } from './refs'
import type { NodeOps } from './nodeObject'
export type { SandboxDocKind } from './refs'
export type { NodeOps } from './nodeObject'

export interface SandboxCall {
  name: string
  ok: boolean
  /**
   * 失败时那句话（「哪一步没做、该怎么改」）。
   *
   * 为什么要把这句话也记下来：只告诉模型「有 N 次调用失败」，它得自己回到 result 里
   * 去找是哪一项、错在哪——一次真实运行里它因此写了个 try/catch 去判断成败
   * （写操作的失败根本不抛异常），又追加一次读接口去确认有没有建成，白烧了两轮。
   * 把名字与那句话一起顶到结果最前面，它一眼就能改。
   */
  message?: string
}

/** 出题请求：字段一律 unknown，校验交给 learn/exam 的 normalize* */
export interface CreateExamPayload {
  title?: unknown
  kind?: unknown
  level?: unknown
  /**
   * 时限（分钟）。随堂小测不用给（不限时）；其余必给，且不得低于题目数 × 2——
   * 下限由 learn/exam 的 resolveExamMinutes 强制，不是提示词里的君子协定。
   */
  minutes?: unknown
  questions: unknown
}

/** 考试工具依赖：由学习工作区注入，沙箱本身不直接碰 store 结构 */
export interface ExamToolDeps {
  stage: () => 'idle' | 'grading'
  createExam: (payload: CreateExamPayload) => { ok: boolean; message: string }
  /** 读卷；给 attemptId 就读那一次考试（判分与讲解时要看某一次的历史记录） */
  readExam: (attemptId?: string) => string
  gradeExam: (payload: unknown) => { ok: boolean; message: string }
  /** 顺时针旋转整张手写答卷 */
  rotateSheet?: (payload: unknown) => Promise<unknown>
  /** 裁切手写答案定位红框预检 */
  previewCrop?: (payload: unknown) => Promise<unknown>
  /** 裁切手写答案图片并贴在对应题目上 */
  cropAnswer?: (payload: unknown) => Promise<{ ok: boolean; message: string; croppedPath?: string }>
  /** 写错题讲解：判分之后的第二步，落在同一次考试上（显示在试卷副本页签里） */
  explainExam: (payload: unknown) => { ok: boolean; message: string }
  /** 删一份试卷；只认「一次都没考过」的，考过的要用户在界面上删，见 learn/exam 的 examDeleteBlock */
  deleteExam: (examId?: string) => { ok: boolean; message: string }
}

export type ExamAction = 'create' | 'grade' | 'cropAnswer' | 'previewCrop' | 'rotateSheet' | 'explain' | 'delete'

/**
 * 阶段只约束**写**（出题 / 判分 / 作废）：有卷待阅时不能再出卷，反之亦然，
 * 模型因此不会在作答途中又出一份新卷，也不会重复阅卷。
 *
 * **读（exam.read）不在这张表里**，任何时候都开放。它原先只在「待阅卷」时可用，
 * 于是刚出完题想核对一下题目、或看看有没有卷子，得到的都是一句「当前没有待阅卷的试卷」
 * ——而这句「没有」还被算成一次调用失败。一次真实运行里模型因此连烧两轮才确认卷子建没建成
 * （见 failureHeader 与 learn/useAgent 里 read 那一段的注释）。
 */
export const EXAM_ACTIONS: Record<'idle' | 'grading', ExamAction[]> = {
  idle: ['create', 'delete'],
  // 判分与讲解是一套工作流的两步，必须同一阶段都放行；第二步在第一次调用之后仍是 grading
  // 判分、手写答卷旋转、红框预检、裁切贴题与讲解是一套工作流的环节，同一阶段都放行
  grading: ['grade', 'rotateSheet', 'previewCrop', 'cropAnswer', 'explain'],
}



/**
 * 沙箱要用的全部宿主能力。
 *
 * 关键变化：**一切按 path 寻址**。会话上下文改成目标级之后，一次编排里 Agent 会同时
 * 碰好几个节点（给上一个节点写文档、给这一个改描述、再建一个新节点），全部隐式作用于
 * 「当前节点」的旧接口根本表达不了「改那一个」。path 的语法与解析见 learn/paths。
 */
export interface SandboxOptions {
  /** 会话此刻在看哪个节点；path 省略（或写「当前」）时的落点 */
  nodeId: () => string | null
  /** path → 节点；解析失败时 message 直接作为结果回给模型 */
  resolveNode: (path: string) => ResolvedNodeRef
  /** path → 节点 + 文档（ui.point / files 镜像同步还在用 path 这套寻址） */
  resolveDoc: (path: string) => ResolvedDocRef
  /** 文档读写的最小面（ui.point 的定位文本与 files.* 的磁盘镜像同步用） */
  docOps: {
    read: (nodeId: string, kind: SandboxDocKind, note?: string) => string
    write: (nodeId: string, kind: SandboxDocKind, note: string | undefined, content: string) => AgentToolResult
  }
  /**
   * 节点宇宙（api.node）：create / get / list / delete 四条传输 + 对象成员代调用。
   * 行为在 learn/nodeKinds 的类型子类里（多态），通道见 sandbox/nodeObject。
   * 不注入就没有这一组。
   */
  nodes?: NodeOps
  /** 节点在数据根下的磁盘路径（files.* 空路径兜底与镜像对账用）；不注入就退回按标题拼 */
  docPath?: (nodeId: string) => string | null
  /** 临时变量：拿最新的一份，写入时回调给 store 落盘。作用域是当前节点；不注入就没有 tmp 这一组 */
  tmp?: () => {
    nodeId?: string
    entries: Record<string, TmpEntry>
    onChange: (next: Record<string, TmpEntry>) => void
  }
  /**
   * 资源库（本目标 `static/` 下的文件，见 learn/static）；不注入就没有 res 这一组。
   *
   * 与 doc / node 两组的关键差别：它要碰磁盘（读文本、读图、删文件），所以方法是异步的；
   * 而且「读图片」有个硬约定——**绝不把 base64 放进返回值**。返回值走的是文本通道
   * （先 safeJson、再被裁到 3 万字符，见 AgentToolResult.images 的说明），
   * 一张图的 base64 进去只会剩一段乱码。图片挂在返回值的 images 上，
   * 由工具收集、由运行时作为图片片段送上下一跳。
   */
  resources?: ResourceOps
  /**
   * 未注入时沙箱里没有 state 这一组。
   */
  /** 出题 / 读卷 / 判分 / 写错题讲解 / 删卷；未注入时沙箱里没有 exam 这一组 */
  exam?: {
    create: (payload: Record<string, unknown>) => AgentToolResult
    /** 读卷：给了 attemptId 就读那一次考试（判分与讲解都要看某一次的历史记录） */
    read: (attemptId?: string) => AgentToolResult
    grade: (payload: Record<string, unknown>) => AgentToolResult
    rotateSheet: (payload: Record<string, unknown>) => Promise<AgentToolResult> | AgentToolResult
    previewCrop: (payload: Record<string, unknown>) => Promise<AgentToolResult> | AgentToolResult
    cropAnswer: (payload: Record<string, unknown>) => Promise<AgentToolResult> | AgentToolResult
    explain: (payload: Record<string, unknown>) => AgentToolResult
    remove: (payload: Record<string, unknown>) => AgentToolResult
  }
  /**
   * 记忆（memory.*，见 learn/memory）；未注入时沙箱里没有 memory 这一组。
   * 记忆**不会**被拼进系统提示词——agent 需要时必须主动 list/get，这是这条边界的一半；
   * 另一半（什么时候该记、记哪一类）写在提示词里。
   */
  memory?: MemoryOps
  /**
   * 日程（schedule.*，见 learn/schedule）：给用户排日程、改、删、标记完成。
   *
   * 边界：agent 负责**写**这张表，响铃与确认都在用户手里——它不能替用户「确认」。
   * 与 memory 同一条纪律：日程绝不自动进上下文，需要时自己 list。
   */
  schedule?: ScheduleOps
  /**
   * 目标级持久化函数（method.*，见 learn/methods）；未注入就没有 method 这一组。
   *
   * find 返回的是**源码**而不是执行结果：执行发生在 buildApi 的 method.call 里——
   * 那里才能拿到「当前这次编排的 api」注入给函数（函数体里 await api.node.get(uuid) 的 content
   * 用的就是它）。测试探针与超级文档的桥各自拿到的 api 不同，但执行语义一致。
   */
  methods?: MethodOps
  /** 工作流登记表（wf.*，见 learn/workflows）；未注入就没有 wf 这一组 */
  workflows?: WorkflowOps
  /** 代码块伪编译的交付口（见 lib/codeArtifacts）；未注入就没有 code 这一组 */
  code?: CodeOps
  /**
   * 学习者画像（userInfo.*，见 user/fields 与 learn/agentOps）；未注入就没有这一组。
   *
   * 与 memory 同一条边界：**画像不会被拼进系统提示词**——导师需要时自己 get。
   * 头像不走这条路（它是几百 KB 的 data URL，进上下文就是灾难）。
   */
  /** 工作区目录（workspace.*，见 learn/workspace）；未注入就没有这一组 */
  workspace?: WorkspaceOps
  /** 读网页（web.*，见 learn/webDocs）；未注入就没有这一组 */
  web?: WebOps
  /**
   * 看图（see，顶层 api，见 learn/see）：把一张「模型递过来的图」转存进资源库并挂到
   * 下一跳。未注入就没有这个顶层 api（自由聊天、子代理都没有——前者没有目标资源库，
   * 后者刻意不敞）。
   *
   * 与 res.read 读图是**同一条图像通道**：图片不进返回值文本（文本通道会把 base64
   * 截成乱码），宿主存好图后在返回值上挂 images，由 execute 收集、运行时送上下一跳。
   */
  see?: (input: SeeRequest) => Promise<unknown>
  /** 上下文压缩（compact，见 learn/compact）；未注入就没有它 */
  compact?: CompactOps
  userInfo?: UserInfoOps
  /** 引用 chip 的生成与校验（chip.build / chip.check，见 learn/ops/chip）；未注入就没有这一组 */
  chip?: ChipOps
  /** 交付账（delivery.submit，见 agent/delivery）；由当轮宿主注入，未注入就没有这一组 */
  delivery?: DeliveryOps
  /** 阻塞等待（wait，毫秒）；未注入就没有 wait */
  wait?: (ms: number) => Promise<void>
  /** 结构化表单询问（ask）：显示表单并阻塞到用户提交/取消；未注入就没有 ask */
  ask?: (form: AskFormPayload) => Promise<unknown>
  /** 提示音（tiktok）：响一声系统提示音，提醒用户来看 */
  tiktok?: () => Promise<void> | void
  /**
   * 界面操作（ui.*）：交换主栏、吐司、定位文档、滚动、截图、DOM 交互。
   * 这些 api 都要「界面在场」——文档区没有打开的文档时，部分调用会明确失败。
   */
  ui?: UiOps
  /**
   * 内置浏览器（browser.*，见 learn/web/browserOps）：界面上开着的网页页签的
   * 打开、管理、页面读取与操作、截图。依赖界面注入（webview 元素在渲染层），
   * 未注入就没有这一组。
   */
  browser?: BrowserOps
  /**
   * 外部 MCP 服务（mcp.*，见 agent/mcp/ops）：用户配置的真实外部工具
   * （list 看服务与工具 / discover 现场探测 / call 调用）。
   * MCP 总开关关着就没有这一组——与旧做法「关闭时不注入任何 MCP 工具」同一口径。
   */
  /** 外部 MCP 服务 */
  mcp?: McpOps
  /** 视频资源与选集信息（video.*） */
  video?: VideoOps
  /** 项目路径读写（project.*，见 learn/ops/project）：对已声明 project 节点的真实路径做文件操作 */
  project?: ProjectOps
  /** 一次编排的中止信号：用户点「停止」时，正在等用户的 ask 等调用要能立刻退出 */
  signal?: AbortSignal
  timeoutMs?: number
  /** 测试可注入一个假的沙箱执行器，从而不依赖浏览器 Worker */
  runSandbox?: (req: SandboxRequest) => Promise<SandboxReply>
  /**
   * api 组白名单（子代理专用）：给出时，名单外的组在 callApi 通道口被当场拒绝——
   * 「execute 的 api 按需开放」的硬闸（不是提示词君子协定）。不设就是全量（导师）。
   */
  apiAllow?: string[]
  /**
   * execute 参数说明里的 api 清单（子代理专用）：给了就替换默认的那份全量说明，
   * 让子代理只看到它真有的 api（清单从 apiCatalog 按组生成，见 subagent/groups）。
   */
  apiBrief?: string
  /**
   * subagent 组（create / run / resume / intervene / interrupt / view / delete / wait）：
   * **导师专用**的子代理管理通道（实现见 subagent/manager）。SUBAGENT_ALLOWED_GROUPS
   * 不含这一组——子代理的 apiAllow 白名单永远放不进它，不递归在通道口就被挡死。
   */
  subagent?: SubAgentSandboxApi
  /**
   * permission 组（list / revoke / request）：外部路径放行的查看、撤销与审批。
   * **导师专用**——SUBAGENT_ALLOWED_GROUPS 不含这一组（改放行配置是导师与用户
   * 之间的事，不从子代理手里过）。宿主实现见 agent/permissions。
   */
  permission?: PermissionOps
  /**
   * 动态提示词注入的触发回调（**导师专用**，见 learn/ai/promptModules）：本次编排里
   * 模型第一次用到某个低频 api 组（或写出了 plot / 动画内容）时，execute 把对应的
   * 模块 key 报给宿主；宿主负责去重（同一上下文只注入一次）与落库。子代理不注入——
   * 它们的规范在各自 def 的 system 里。
   */
  onPromptModule?: (key: string) => void
}

/* ---------- permission：路径放行 ---------- */

/** permission.request 的入参（api 层已把 path 归一化为非空字符串） */
export interface PermissionRequestPayload {
  /** 要放行的目录（绝对路径，或相对数据根的路径） */
  path: string
  /** 为什么需要它——原样显示在审批卡片上 */
  reason?: string
}

/**
 * permission 组的宿主实现：外部路径放行的查看 / 撤销 / 审批（行为在 agent/permissions）。
 *
 * 与 ask 的分工：ask 是 agent-用户-agent（答案回到模型手里，怎么用由模型决定）；
 * permission.request 是 agent-用户-系统——用户批准后**由宿主直接把目录写进放行配置**
 * （agent/settings 的 permissions.allowedDirs，saveAgentSettings 会同步到主进程），
 * 模型只拿到「批准了没有」。可访问作用域 = 数据根目录（恒可访问、不可撤销）+ 放行清单。
 */
export interface PermissionOps {
  /** 当前可访问的作用域：数据根 root + 已放行目录 allowedDirs */
  list(): unknown
  /** 撤销一个已放行的目录（归一化后精确匹配；数据根不在清单里、无可撤销） */
  revoke(path: string): unknown
  /** 请求放行：弹审批并阻塞到用户抉择，批准由宿主落配置；返回值带 approved */
  request(payload: PermissionRequestPayload): Promise<unknown>
}

/** subagent.wait 的一条交付：交付正文（中断 / 出错为 null）与为什么 */
export interface SubWaitDelivery {
  agent: string
  name: string
  delivery: string | null
  status: 'complete' | 'incomplete' | 'interrupted' | 'error'
  issue?: string
}

/** subagent.wait 回执里「仍在跑」的一行 */
export interface SubWaitRunning {
  agent: string
  name: string
}

/** subagent.wait 的回执：error 存在即参数不对；timedOut / aborted 见字段说明 */export interface SubWaitResult {
  error?: string
  deliveries: SubWaitDelivery[]
  running: SubWaitRunning[]
  /** 到了最大时长还没人交付（导师该去 view 了） */
  timedOut?: boolean
  /** 等待期间用户停止了一轮，所有在跑的被级联中断 */
  aborted?: boolean
  note?: string
}

/** create / run 等的回执：error 存在即失败，其余字段按方法各有 */
export interface SubAgentApiResult {
  ok?: boolean
  error?: string
  note?: string
  agent?: string
  key?: string
  name?: string
  status?: string
  runs?: number
  recent?: Array<{ role: string; text: string; tools?: string[] }>
  [key: string]: unknown
}

/** subagent 组的宿主实现（导师专用；形状只在这里声明，行为在 subagent/manager） */
export interface SubAgentSandboxApi {
  /** 登记定义（不启动）：{ key, name?, system, tools? } */
  create(def: Record<string, unknown>): SubAgentApiResult
  /** 派任务并启动（后台跑，立即返回）：{ agent, task } */
  run(args: Record<string, unknown>): SubAgentApiResult
  /** 把被中断的 agent 从断点接着跑 */
  resume(agent: string): SubAgentApiResult
  /** 给运行中的 agent 插一条指令（消息完整后才插入） */
  intervene(agent: string, instruction: string): SubAgentApiResult
  /** 中断运行中的 agent（上下文保留，可 resume） */
  interrupt(agent: string): SubAgentApiResult
  /** 看状态与最近过程（监督回路的「查看」） */
  view(agent: string): SubAgentApiResult
  /** 删定义与会话（含挂起的交付；在跑的先中断） */
  remove(agent: string): SubAgentApiResult
  /** 等交付：首个完成即返回（带仍在跑清单），到 seconds 没人交付返回 timedOut */
  wait(args: Record<string, unknown>): Promise<SubWaitResult>
}

/* ---------- ask：结构化表单 ---------- */

/** 一道题的选项：模型可以直接给字符串（自动配 id），也可以给 { id, label } */
export interface AskOption {
  id: string
  label: string
}

export type AskQuestionType = 'single' | 'multiple' | 'short' | 'slider' | 'dual_slider' | 'upload'

export interface AskFileAttachment {
  name: string
  size: number
  type: string
  path?: string
  dataUrl?: string
}

/** 表单里的一道题（normalizeAskForm 归一化之后的形状） */
export interface AskQuestion {
  /** 题目 id；模型没给时按 q1、q2… 自动配 */
  id: string
  /** single 单选 / multiple 多选 / short 简答 / slider 单滑块 / dual_slider 双滑块 / upload 附件上传 */
  type: AskQuestionType
  prompt: string
  /** single / multiple 必给（2~8 项）；其余类型恒为空数组 */
  options: AskOption[]
  /**
   * 条件显示：只有当前面某道题的答案命中 oneOf 之一时，这道题才出现——
   * 「前面选了什么，会影响后面问什么」就靠它。oneOf 与选项 id、选项文字
   * 以及「其他」补充输入的原文做精确匹配。
   */
  when?: { id: string; oneOf: string[] } | null
  /**
   * 这道题的答案要写进画像的哪个字段（见 user/fields 的 ProfileField，如 'education'）。
   *
   * 标了它，用户**提交的那一刻**回答就直接落进画像（user/fields 的 patchFromAnswers），
   * 导师不必再 update 一次——「画像缺什么就问什么」的省事写法，也是画像唯一的
   * 结构化补全通道。没标就是普通问题，只是聊聊天。
   */
  userInfo?: ProfileField
  /**
   * **没有必答题**（曾经的 required 字段已移除）：用户懒得答的题就该留空——
   * 留空在返回的 answers 里只有 id/type/prompt，不是错误，模型不要追问。
   */

  // --- 滑块组件 (slider / dual_slider) ---
  /** 滑块最小值，默认 0 */
  min?: number
  /** 滑块最大值，默认 100 */
  max?: number
  /** 滑块步长，默认 1 */
  step?: number
  /** 单位或后缀（如 '%', 'px', '分', '岁'） */
  unit?: string
  /** 默认值：单滑块为 number，双滑块为 [number, number] */
  defaultValue?: number | [number, number]

  // --- 上传组件 (upload) ---
  /** 允许接受的文件类型过滤（如 'image/*', '.pdf,.docx,.txt'） */
  accept?: string
  /** 是否允许多选文件，默认 false */
  multipleFiles?: boolean
  /** 最大文件限制（MB），默认 32MB */
  maxSizeMb?: number
}

/** 一次 ask 的载荷：questions 已由 normalizeAskForm 归一化并校验过 */
export interface AskFormPayload {
  title: string
  questions: AskQuestion[]
}

/** 用户对一道题的回答 */
export interface AskAnswer {
  id: string
  type: AskQuestionType
  prompt: string
  /** single / multiple：选中项的文字 */
  picked?: string[]
  /** single / multiple：选中项的 id */
  pickedIds?: string[]
  /** 选了「其他」时用户输入的补充 */
  other?: string
  /** short：用户输入的正文 */
  text?: string
  /** slider：单滑块数值 */
  value?: number
  /** dual_slider：双滑块范围 [low, high] */
  rangeValue?: [number, number]
  /** upload：用户上传的文件附件列表 */
  files?: AskFileAttachment[]
}

/** 表单提交后的回答集（ask 的返回值里 answers 的形状） */
export type AskAnswers = AskAnswer[]

/* ---------- memory：记忆（工作 / 长期） ---------- */

/**
 * workspace.*：节点的工作区目录（见 learn/workspace）。
 *
 * 「工作区」是磁盘上**真实存在**的系统目录（users/<uid>/docs/<目标>/<节点>/workspace/）：
 * 用户在系统资源管理器里看得见、自己也能放文件；路径写法与文档 api 同构——
 * 节点路径在前、文件在后（极限/数据/实验.csv），省略 path 就是当前节点。只收文本。
 */
export interface WorkspaceOps {
  /** 列目录（path 省略 = 当前节点的工作区）；目录还不存在时回空清单 */
  list: (path?: string) => unknown
  /** 读一个文本文件；太长的截断并带 totalChars */
  read: (path?: string) => unknown
  /** 写一个文本文件（整份覆盖；父目录自动建），输入 { path, content } */
  write: (input: Record<string, unknown>) => unknown
  /** 定向检索行号与锚点：输入 { path, anchors: ['关键词1', '关键词2'] } 直接返回行号与匹配行，免去全文塞入上下文 */
  grep?: (input: Record<string, unknown> | string) => unknown
  /** 删除工作区文件或目录 */
  delete?: (path: unknown) => unknown
  /** 移动或重命名工作区文件或目录 */
  move?: (inputOrFrom: unknown, maybeTo?: unknown) => unknown
  /** 下载远程文件（图片、PDF、数据等）并保存到工作区文件 */
  download?: (urlOrInput: unknown, maybePath?: unknown) => unknown
}

/**
/**
 * 网络搜索与网页抓取（基于 DeepSeek 官方 Search API 与 Fetch API）。
 */
export interface WebOps {
  /** 抓一页（完全支持 DeepSeek Fetch API）：url 或 { url } → { title, content } */
  fetch: (arg: unknown) => Promise<unknown>
  /**
   * 网络搜索（完全支持 DeepSeek Search API）：
   * query/opts 或 { query, count?, ori_question?, localization?, need_content? }
   */
  search?: (queryOrArgs: unknown, opts?: Record<string, unknown>) => Promise<unknown>
}

/**
 * see 的入参（顶层 api，见 SandboxOptions.see 与 learn/see）。
 *
 * raw 是字符串写法：http(s) 图片地址、`data:image/...;base64,…`、或裸 base64；
 * 对象写法把字段拆开，还能补 mime（裸 base64 没有前缀时靠它，或靠魔数嗅探）与 name。
 * pdf 分支看一份 PDF 的页面：pdf 收 http(s) 地址 / moji:static/<uuid> / 用户相对路径，
 * page 从 1 起（单个或数组，一次最多 4 页），只渲染成图、不提取文字层。
 */
export interface SeeRequest {
  raw?: string
  url?: string
  base64?: string
  mime?: string
  name?: string
  pdf?: string
  page?: number | number[]
  /** 图片说明或题注（如 '图 3 整体架构'），直接写入静态资源库元数据 */
  caption?: string
  /** 排序序号（如 1, 2, 3），直接写入静态资源库元数据，便于 res.list 原样呈现 */
  order?: number
}

/**
 * memory.*：记忆（见 learn/memory）。
 *
 * 两类：**工作**（目标级，只有本目标的会话读得到，agent 觉得是负担就能删）与
 * **长期**（跨目标，删除必须 `{ confirm: true }`）。返回普通对象，失败用 { error }
 * （与 res.* 同一约定）。
 */
export interface MemoryOps {
  /** 清单：type 可选过滤；工作记忆只回当前目标那一份 */
  list: (query?: Record<string, unknown>) => unknown
  /** 读一条全文（uuid）；看不见的条目按「没有」处理 */
  get: (uuid: string) => unknown
  /** 新建：{ type, title, keys?, content }（type 省略按 work） */
  create: (payload: Record<string, unknown>) => unknown
  /** 更新：只改给了的字段（title / keys / content / type） */
  update: (uuid: string, patch: Record<string, unknown>) => unknown
  /** 删除：长期记忆需要 { confirm: true } */
  remove: (uuid: string, opts?: Record<string, unknown>) => unknown
}

/**
 * schedule.*：日程安排（见 learn/schedule）。
 *
 * 时间用 `date`（YYYY-MM-DD）+ `time`（HH:mm）；`date` 省略=今天（时间已过则顺延到明天）。
 * 失败一律回 `{ error }`（与 memory / res 同一约定）。
 */
export interface ScheduleOps {
  /** 列日程：from / to / days 都可选，默认今天起 7 天 */
  list: (query?: Record<string, unknown>) => unknown
  /** 新建：{ title, date?, time, minutes?, remindBefore?, note? } */
  create: (payload: Record<string, unknown>) => unknown
  /** 修改：只改给了的字段；done 可标记完成 */
  update: (id: string, patch: Record<string, unknown>) => unknown
  /** 标记完成（用户确认过的落账） */
  complete: (id: string) => unknown
  /** 删除一条 */
  remove: (id: string) => unknown
}

/**
 * compact：把这段对话压成一份**交接摘要**（见 learn/compact）。
 *
 * 摘要**不立刻生效**：先写进会话，等本轮 loop 结束后由宿主把旧消息标成失活
 * （把上下文从正在跑的循环底下抽走是不行的——见 useAgent 的 finally）。回执里会说明这一点，
 * 模型才不会以为「已经清空了」而重复调用。
 */
export interface CompactOps {
  /** { summary, tasks? } → 摘要成形并写入会话（等本轮结束后应用） */
  write: (input: Record<string, unknown>) => unknown
}

/* ---------- chip：引用 chip 的生成与校验 ---------- */

/**
 * chip.* 的宿主实现（见 learn/ops/chip）。build 把「拼对路径」从模型手里拿走——
 * 当场对 store 解析、生成的 payload 一定带 nodeId，定位不到就 ok:false；
 * check 让模型在交付前把草稿里的 chip 逐颗验一遍。
 */
export interface ChipOps {
  /** { type, path?, url?, note?, name?, examId?, attemptId?, dir?, title? } → { chip, type, title } 或 { ok:false, problem } */
  build: (input: Record<string, unknown>) => unknown
  /** 任意文本 → 逐颗解析其中的 #[{…}] 并验证定位 → { total, valid, invalid, problems? } */
  check: (text: string) => unknown
}

/* ---------- delivery：这一轮的交付账 ---------- */

/**
 * api.delivery.submit 的宿主实现：把「这轮交付了什么」记到本轮消息上。
 *
 * 为什么不让模型在正文里复述：正文写法每次都不同，界面没法统一展示，也留不下来
 * （见 agent/delivery 的说明）。这里只收结构化数据，宿主按路径 / URL 去重合并。
 */
export interface DeliveryOps {
  /** { files?: [{ path, action?, note? }], sources?: [{ title, url }] } → { ok, files, sources, error? } */
  submit: (input: Record<string, unknown>) => unknown
}

/* ---------- method：目标级持久化函数 ---------- */

/**
 * method.* 的宿主实现（见 learn/methods）。
 *
 * 与 memory 的分界：memory 存的是「判断与事实」（文本，给人与模型读）；
 * method 存的是**可执行的函数源码**——它存在的意义是被调用（agent 的编排里、
 * 以及超级文档的按钮经 api.method.call）。name 就是身份，create 同名覆盖。
 */
export interface MethodOps {
  /** 清单：名字、体量、更新时间（不带代码本身） */
  list: () => unknown
  /** 新建 / 覆盖；校验（含语法编译）失败回 { error } */
  create: (input: { name?: unknown; code?: unknown }) => unknown
  /** 按 name 删一条 */
  remove: (name: string) => unknown
  /** 按 name 取一份源码；没有回 null */
  find: (name: string) => { name: string; code: string } | null
}

/* ---------- wf：工作流登记表 ---------- */

/**
 * wf.* 的宿主实现（见 learn/workflows）：三级任务模板（内置 / 全局 / 目标级）的登记处。
 *
 * 与 method 的分界：method 存**可执行代码**（沙箱当场执行），wf 存**指令文本**——
 * 被触发时才以 user 消息整段进上下文，不进系统提示词。看、登记、删三件事之外，
 * 还有 invoke：让导师自己把活交给一条流程（见 invoke 的说明）。
 */
export interface WorkflowOps {
  /** 全部工作流（内置 + 全局 + 当前目标），带 id、名字、分级与指令体量 */
  list: (opts?: unknown) => unknown
  /** 获取单条工作流的完整详情与指令 */
  get?: (ref: string) => unknown
  /** 登记一条（global 或 goal 级，同名覆盖）；校验失败回 { error } */
  create: (input: unknown) => unknown
  /** 按 id 或名字删一条；内置的删不掉 */
  remove: (ref: string) => unknown
  invoke: (ref: string, opts: Record<string, unknown>) => unknown
}

/* ---------- code：代码块伪编译 ---------- */

/**
 * code.* 的宿主实现：伪编译产物的**交货口**（见 lib/codeArtifacts 的 submitCompile）。
 *
 * 为什么要有这么一条 api，而不是让宿主去读对话里那段围栏：产物是一条要落盘、
 * 要被代码块认领的数据，靠「猜哪段围栏是结果」是猜不准的（一轮对话里可能有好几块）。
 * key 由触发方给（它知道是哪一块代码），代码原文由宿主自己记着，模型只交 js 与说明。
 */
export interface CodeOps {
  /** 交付一份伪编译产物；key 对不上、js 为空时回 { error } */
  save: (input: unknown) => unknown
  /**
   * 判定「这段代码没有输出」，**当场停止编译**并把那块标成无输出（见 lib/codeArtifacts）。
   * 这是一条正经的交付，不是失败：有些代码块本来就是一堆定义，转译出来也没有任何东西可看。
   */
  silent: (input: unknown) => unknown
}

/* ---------- userInfo：学习者画像 ---------- */

/**
 * userInfo.* 的宿主实现（见 user/fields 与 learn/agentOps）。
 *
 * 为什么要有这两个 api：画像原先是被**塞进系统提示词**的——它一变（用户改一次资料），
 * 整段前缀缓存就作废，而绝大多数轮次根本用不到画像里的任何一项。改成主动取之后，
 * 提示词只与目标相关，「这份讲解要不要贴合这个人」由导师自己决定。
 *
 * get 回的是给模型看的那份（**不含头像**，见 user/fields 的 profileForModel）；
 * update 是**增量**语义：只写传进来的字段，其余原样保留。
 */
export interface UserInfoOps {
  /** 读画像；没有当前用户时回 { error } */
  get: () => unknown
  /** 增量更新；认不出的字段与写不进去的值要逐条说明（见 user/fields 的 coerceProfileValue） */
  update: (patch: unknown) => unknown | Promise<unknown>
}

/* ---------- ui：界面操作 ---------- */

/** ui.point 的定位请求：path 已解析成节点 + 文档，needle 是要在渲染结果里找的文字 */
export interface UiPointRequest {
  nodeId: string
  kind: SandboxDocKind
  /** 笔记名；kind 为 'note' 但省略时由界面取该节点第一份笔记 */
  note?: string
  /** 要定位/选中的文字（源文里按 line 或 regex 算出来的那一段，已折叠空白） */
  needle?: string
  /** 找不到 needle 时的兜底：按比例滚到文档的这个位置（0~1） */
  fallbackRatio?: number
}

/** ui.scroll 的请求：滚到顶/底，或按像素滚动 */
export interface UiScrollRequest {
  to?: 'top' | 'bottom'
  by?: number
}

/** ui.screenshot 的返回：截图已存进资源库，图片挂在 images 上由运行时送进下一跳 */
export type UiCaptureResult =
  | { ok: true; note?: string; images: MessageImage[] }
  | { ok: false; error: string }

export interface UiOps {
  toast?: (message: string) => void
  /** 打开/切换到某节点的文档页签并定位；located 说明定位是否成功 */
  point?: (req: UiPointRequest) => Promise<{ located: boolean }> | { located: boolean }
  scroll?: (req: UiScrollRequest) => void
  capture?: () => Promise<UiCaptureResult>
  /** ui.dom 的根：文档区元素；没有打开的文档时返回 null（会话建立会失败） */
  domRoot?: () => Element | null
  /**
   * 打开/切到一个节点的某份超级文档页签（ui.superdoc）。
   * opened 说明那份超级文档还在不在——删掉的打不开，别静默开一个空页签。
   */
  openSuper?: (req: { nodeId: string; name: string }) => Promise<{ opened: boolean }> | { opened: boolean }
}

/** browser.tabs 的元素：一枚存活网页页签的快照 */
export interface BrowserTabInfo {
  tabId: string
  url: string
  title: string
  active: boolean
  /** 页签所在分组格的 id */
  group: string
  /** 来源标识：通过文件节点打开的标记为 'fileNode'，用户主动新开的标记为 'user' */
  source?: 'fileNode' | 'user'
  fileNodeId?: string
  fileNodeTitle?: string
  goalId?: string
}

export type BrowserTarget = number | string

export interface BrowserIndexOpts {
  focus?: BrowserTarget
  target?: BrowserTarget
  maxDepth?: number
  collapse?: boolean
  full?: boolean
  expand?: number[]
}

export interface BrowserIndexResult {
  text: string
  count: number
  title: string
  url: string
  lines?: string[]
  error?: string
}

export interface BrowserTextOpts {
  maxChars?: number
  offset?: number
}

export interface BrowserTextResult {
  ok: boolean
  id: BrowserTarget
  text: string
  totalChars: number
  offset?: number
  hasMore?: boolean
  nextOffset?: number
  error?: string
}

export interface BrowserInspectOpts {
  nth?: number
}

export interface BrowserInspectResult {
  ok: boolean
  id: BrowserTarget
  matchCount?: number
  tag: string
  resolvedTag?: string
  idAttr?: string
  className?: string
  text?: string
  value?: string
  placeholder?: string
  href?: string
  checked?: boolean
  disabled?: boolean
  visible?: boolean
  warning?: string
  isEditable?: boolean
  rect?: { x: number; y: number; width: number; height: number }
  error?: string
}

export interface BrowserClickOpts {
  waitAfterMs?: number
}

export interface BrowserClickResult {
  ok: boolean
  tag?: string
  resolvedTag?: string
  visible?: boolean
  warning?: string
  openedTabId?: string
  navigated?: boolean
  error?: string
}

export interface BrowserFillOpts {
  clear?: boolean
  pressEnter?: boolean
}

export interface BrowserFillResult {
  ok: boolean
  tag?: string
  resolvedTag?: string
  resolvedType?: string
  wrote?: number
  readback?: string
  hint?: string
  error?: string
}

export interface BrowserTypeOpts {
  delayMs?: number
}

export interface BrowserTypeResult {
  ok: boolean
  tag?: string
  resolvedTag?: string
  typedChars?: number
  error?: string
}

export interface BrowserPressResult {
  ok: boolean
  key?: string
  dispatched?: boolean
  warning?: string
  error?: string
}

export interface BrowserScrollOpts {
  to?: 'top' | 'bottom'
  by?: number
  target?: BrowserTarget
}

export interface BrowserScrollResult {
  ok: boolean
  scrollY?: number
  scrollHeight?: number
  atBottom?: boolean
  containerScrollY?: number
  containerScrollHeight?: number
  containerAtBottom?: boolean
  documentScrollY?: number
  documentScrollHeight?: number
  documentAtBottom?: boolean
  error?: string
}

export interface BrowserQueryItem {
  id: number
  tag: string
  cls?: string
  idAttr?: string
  text: string
  href?: string
  value?: string
  placeholder?: string
  visible: boolean
  isEditable: boolean
  rect: { x: number; y: number; width: number; height: number }
}

export interface BrowserQueryOpts {
  limit?: number
}

export interface BrowserQueryResult {
  ok: boolean
  selector: string
  count: number
  matches: BrowserQueryItem[]
  error?: string
}

export interface BrowserWaitForOpts {
  timeoutMs?: number
  timeout?: number
  visible?: boolean
}

export interface BrowserWaitForResult {
  ok: boolean
  elapsedMs: number
  id?: number
  tag?: string
  visible?: boolean
  error?: string
}

export interface BrowserToImageOpts {
  /** 是否自动隔离/隐藏遮挡在目标元素上方的悬浮遮罩、吸顶栏与弹窗（默认 true） */
  isolate?: boolean
  /** 是否截取长内容的完整高度（如超长文章自动分段滚动并无缝拼接为长图，默认 true） */
  full?: boolean
  /** 截图周边留白边距（像素，默认 0） */
  padding?: number
  /** 长图拼接最大总高度限制（默认 16000px，防止无限滚动页面爆内存） */
  maxHeight?: number
  /** 图片保存名称（默认 'DOM元素截图' 或元素描述） */
  name?: string
  /** 导出格式（默认 'png'） */
  format?: 'png' | 'jpeg'
  /** JPEG 质量（1-100，仅 format 为 jpeg 时生效） */
  quality?: number
}

export interface BrowserToImageResult {
  ok: boolean
  url?: string
  uuid?: string
  path?: string
  width?: number
  height?: number
  tag?: string
  selector?: string
  slices?: number
  error?: string
  hint?: string
}

export interface BrowserScreenshotOpts {
  /** 可选：指定截取目标 DOM 元素（ID 或选择器）；若提供则自动按 DOM 元素转长图处理 */
  target?: BrowserTarget
  /** 是否隔离遮挡物（仅指定 target 时生效，默认 true） */
  isolate?: boolean
  /** 是否截取元素完整高度（默认 true） */
  full?: boolean
  /** 截图周边留白边距（像素，默认 0） */
  padding?: number
  /** 长图拼接最大总高度限制（默认 16000px） */
  maxHeight?: number
  /** 自定义名称 */
  name?: string
  path?: string
}

export interface BrowserScreenshotResult {
  ok: boolean
  path?: string
  url?: string
  uuid?: string
  width?: number
  height?: number
  error?: string
}

export interface BrowserToMarkdownOpts {
  /** 可选：直接将转换后的 Markdown 写入指定工作区文件（如 'workspace/article.md'），回执仅回字符数与行数，避免大量文本冲击上下文 */
  saveTo?: string
  maxChars?: number
}

export interface BrowserToMarkdownResult {
  ok: boolean
  markdown?: string
  chars?: number
  lines?: number
  saved?: boolean
  path?: string
  rel?: string
  diagnostics?: {
    images: number
    headings: number
    paragraphs: number
    codeBlocks: number
  }
  note?: string
  error?: string
}

export interface BrowserEvalOpts {
  /** 可选：将代码执行结果直接写入指定文件（如 'workspace/result.json'），回执仅回字符数与行数，避免大量文本冲击上下文 */
  saveTo?: string
}

export interface BrowserEvalResult {
  ok: boolean
  result?: unknown
  saved?: boolean
  path?: string
  rel?: string
  chars?: number
  lines?: number
  note?: string
  error?: string
}

/**
 * 内置浏览器（browser.*）的宿主实现（见 learn/web/browserOps）。
 * 涵盖网页页签生命周期（open / tabs / activate / close）与基础读写（index / text / inspect / click / fill / type / press / scroll / query / waitFor / screenshot / eval）。
 */
export interface BrowserOps {
  /** 开一个网页页签（纯关键词当搜索词处理）；回 tabId，返回时首屏基本加载完 */
  open(url: string): Promise<{ tabId: string; url: string; note?: string }>
  /** 全部存活的网页页签（信封 { tabs }——同组接口一致，别回裸数组） */
  tabs(): { tabs: BrowserTabInfo[] }
  /** 把某个页签切到前台 */
  activate(tabId: string): { ok: true }
  /** 关掉某个页签（不弹确认）；给数组就批量关（试错页签收尾用——用户自己开的别关） */
  close(tabId: string | string[]): { ok: true }
  /** 获取当前页面的压缩语义索引大纲（含 [id] 编号与 Shadow DOM 穿透） */
  index(tabId?: string, opts?: BrowserIndexOpts): Promise<BrowserIndexResult>
  /** 深入读取折叠正文或指定节点的文本（支持长文分段） */
  text(tabId: string | undefined, target: BrowserTarget, opts?: BrowserTextOpts): Promise<BrowserTextResult>
  /** 探测指定节点的详细属性（tag, value, placeholder, href, checked, rect 等，支持 nth 选择器） */
  inspect(tabId: string | undefined, target: BrowserTarget, opts?: BrowserInspectOpts): Promise<BrowserInspectResult>
  /** 自动滚到视口并智能点击指定节点 */
  click(tabId: string | undefined, target: BrowserTarget, opts?: BrowserClickOpts): Promise<BrowserClickResult>
  /** 智能输入文字（支持受控组件、原生组件与富文本框，自带写入自检 readback 防假阳性） */
  fill(tabId: string | undefined, target: BrowserTarget, text: string, opts?: BrowserFillOpts): Promise<BrowserFillResult>
  /** 逐字符按键仿真与 IME 模拟输入（为 B 站、知乎等 Shadow DOM 复杂富文本框量身定制的健壮输入通道） */
  type(tabId: string | undefined, target: BrowserTarget, text: string, opts?: BrowserTypeOpts): Promise<BrowserTypeResult>
  /** 模拟键盘按键（Enter, Escape, Tab, ArrowDown 等） */
  press(tabId: string | undefined, key: string, target?: BrowserTarget): Promise<BrowserPressResult>
  /** 滚动页面或指定局部容器 */
  scroll(tabId?: string, opts?: BrowserScrollOpts): Promise<BrowserScrollResult>
  /** 跨 Shadow DOM 全域检索选择器并返回匹配候选清单（每项带 [id]、text、href、rect、visible 等） */
  query(tabId: string | undefined, selector: string, opts?: BrowserQueryOpts): Promise<BrowserQueryResult>
  /** 智能等待选择器节点或指定文本出现（解决异步加载盲等硬等问题） */
  waitFor(tabId: string | undefined, targetOrText: string, opts?: BrowserWaitForOpts): Promise<BrowserWaitForResult>
  /** 截取当前网页视图并存入静态资源库，返回图片 moji:static 访问地址 */
  screenshot(tabId?: string, opts?: BrowserScreenshotOpts): Promise<BrowserScreenshotResult>
  /** 将指定 DOM 元素（ID 或选择器，穿透 Shadow DOM）转为图片存入资源库；自动消除遮挡层，支持超长文章长图无缝拼接 */
  toImage(tabId: string | undefined, target: BrowserTarget, opts?: BrowserToImageOpts): Promise<BrowserToImageResult>
  /** 别名：elementImage / elementScreenshot 同步支持 */
  elementImage?: (tabId: string | undefined, target: BrowserTarget, opts?: BrowserToImageOpts) => Promise<BrowserToImageResult>
  elementScreenshot?: (tabId: string | undefined, target: BrowserTarget, opts?: BrowserToImageOpts) => Promise<BrowserToImageResult>
  /** 在访客页面上下文中安全执行受控代码并返回 JSON（只读/枚举/透视终极保底武器） */
  /** 将指定 DOM 元素（ID 或选择器，穿透 Shadow DOM）转换为 Markdown 格式文本，尽可能保留图片、公式、表格、排版；支持 saveTo 落盘 */
  toMarkdown(tabId?: string, target?: BrowserTarget, opts?: BrowserToMarkdownOpts): Promise<BrowserToMarkdownResult>
  eval(tabId: string | undefined, code: string, opts?: BrowserEvalOpts): Promise<BrowserEvalResult>
}

export interface McpOps {
  /** 已启用服务与各自**缓存的**工具清单（不发网络请求） */
  list: () => unknown
  /**
   * 现场探测工具清单：给 server 就只探它（失败即 ok:false），
   * 省略则探全部已启用服务（逐服务回报，ok 由服务级字段表达）。
   */
  discover: (server?: string) => Promise<unknown>
  /** 调用某服务的一个工具；args 传对象（按工具公布的说明给），省略为空对象 */
  call: (server: string, tool: string, args?: unknown) => Promise<unknown>
}

/**
 * 资源库操作：沙箱里 res.* 的宿主实现（见 learn/agentOps 与 learn/static）。
 *
 * 除 list / info / refs 外都是异步的（要读写磁盘）。返回的普通对象会直接序列化给模型，
 * 因此**文字要写成人话**：模型只有这一句话能依据。
 */
export interface ResourceOps {
  /** 清单：本目标的全部资源（含引用数） */
  list: () => unknown
  /** 单条资源的详情 */
  info: (uuid: string) => unknown
  /** 读。文本回内容（可给区间）；图片不回数据，而是挂到下一跳；其它二进制只回元数据 */
  read: (uuid: string, range?: { start?: number; end?: number }) => Promise<unknown>
  /** 新建一份文本资源 */
  create: (input: { name: string; ext: string; content: string }) => Promise<unknown>
  /** 改名称 / 描述 / 文本内容 */
  update: (
    uuid: string,
    patch: { name?: string; description?: string; content?: string; caption?: string; order?: number },
  ) => Promise<unknown>
  /** 删。还被引用时必须 force 才动手 */
  remove: (uuid: string, force: boolean) => Promise<unknown>
  /** 被引用扫描：给了 uuid 就查这一条被谁引用，不给就列出全部资源的引用状况 */
  refs: (uuid?: string) => unknown
}

export interface VideoEpisodeInfo {
  page: number
  title: string
  source: string
  durationMs?: number
}

export interface VideoInfoResult {
  ok: boolean
  id: string
  title: string
  hasEpisodes: boolean
  episodeCount: number
  episodes: VideoEpisodeInfo[]
  error?: string
}

export interface VideoOps {
  list: () => Array<{ id: string; title: string; plugin: string }>
  get: (target: string) => Promise<VideoInfoResult>
}

/** 一条目录清单项（project.tree 的 entries） */
export interface ProjectTreeEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
  size: number
  mtimeMs: number
}

/**
 * 项目路径读写（project.*，见 learn/ops/project）：对**已声明**的 project 节点
 * 的真实路径及其子树做文件操作。寻址一律 uuid + subPath（subPath 相对该项目的根，
 * '/' 分隔，空串 = 根）；越出已声明根的操作一律拒绝。
 */
export interface ProjectOps {
  list: () => Promise<Array<{ uuid: string; title: string; path: string; pathKind: string; resolved: string | null }>>
  tree: (uuid: string, subPath?: string) =>
    Promise<{ ok: true; path: string; entries: ProjectTreeEntry[] } | { ok: false; error: string }>
  read: (uuid: string, subPath: string, opts?: { encoding?: 'utf8' | 'base64'; maxBytes?: number; offset?: number }) =>
    Promise<{ ok: true; content: string; encoding: string; size: number; totalChars?: number } | { ok: false; error: string }>
  write: (uuid: string, subPath: string, content: string, opts?: { encoding?: 'utf8' | 'base64'; overwrite?: boolean }) =>
    Promise<{ ok: true; path: string; bytesWritten: number } | { ok: false; error: string }>
  edit: (uuid: string, subPath: string, edit: { content?: string; replace?: { target: string; replacement: string; all?: boolean }; append?: string }) =>
    Promise<{ ok: true; path: string; modified: boolean } | { ok: false; error: string }>
  mkdir: (uuid: string, subPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  move: (uuid: string, subPath: string, toSubPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
  copy: (uuid: string, subPath: string, toSubPath: string, opts?: { overwrite?: boolean }) =>
    Promise<{ ok: true } | { ok: false; error: string }>
  delete: (uuid: string, subPath: string) => Promise<{ ok: true } | { ok: false; error: string }>
}

export interface SandboxRequest {
  body: string
  timeoutMs: number
  callApi: (name: string, args: unknown[]) => Promise<unknown>
}

export type SandboxReply =
  | { ok: true; value: unknown; ms: number }
  | { ok: false; error: string }

export interface ExecuteTool extends AgentTool {
  /** 最近一次编排实际调用了哪些 api（供界面显示，不进上下文） */
  lastCalls: () => SandboxCall[]
}