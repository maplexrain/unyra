/**
 * 这个文件负责什么：沙箱类型契约的**总装配**——SandboxOptions，宿主向沙箱注入的
 * 全部能力面（各组的可选字段分别指向同目录各能力组文件里的接口）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */
import type { AgentToolResult } from '../../types'
import type { TmpEntry } from '../../../learn/types'
import type { ResolvedNodeRef, ResolvedDocRef, SandboxDocKind } from '../refs'
import type { NodeOps } from '../nodeObject'
import type { SandboxRequest, SandboxReply } from './core'
import type { PermissionOps } from './permission'
import type { SubAgentSandboxApi } from './subagent'
import type { AskFormPayload } from './ask'
import type { WorkspaceOps } from './workspace'
import type { WebOps } from './web'
import type { SeeRequest } from './see'
import type { MemoryOps } from './memory'
import type { ScheduleOps } from './schedule'
import type { CompactOps } from './compact'
import type { ChipOps } from './chip'
import type { DeliveryOps } from './delivery'
import type { MethodOps } from './method'
import type { WorkflowOps } from './workflow'
import type { CodeOps } from './code'
import type { UserInfoOps } from './userInfo'
import type { UiOps } from './ui'
import type { BrowserOps } from './browser'
import type { McpOps } from './mcp'
import type { ResourceOps } from './resources'
import type { VideoOps } from './video'
import type { ProjectOps } from './project'

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

