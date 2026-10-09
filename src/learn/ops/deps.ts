/**
 * 沙箱 ops 的依赖形状：宿主注入什么能力（磁盘、画像、网页、出题），这一层又向 store 要什么。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：每一组 ops 与调用方都要用这些类型，
 * 单独成文件，看形状时不必翻实现。
 */

import type { SandboxOptions, WebOps } from '../../agent/tools'
import type { LearnStore, TmpEntry } from '../types'
import type { UserProfile } from '../../user/types'

export interface AgentOpsDeps {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  /** 这一轮冲着哪个节点来（沙箱里的「当前节点」） */
  nodeId: () => string | null
  /** 这一轮所属的目标（会话与 path 的基准） */
  goalId: () => string
  /** 当前节点的临时变量视图；不注入就没有 tmp 这一组 */
  tmp?: () => { nodeId?: string; entries: Record<string, TmpEntry>; onChange: (next: Record<string, TmpEntry>) => void }
  /** 出题 / 读卷 / 阅卷；不注入就没有 exam 这一组 */
  exam?: SandboxOptions['exam']
  /** 资源库要碰磁盘；不注入就没有 res 这一组 */
  resourceIo?: ResourceIo
  /** 工作区目录要碰磁盘（节点目录下的 workspace/，见 learn/workspace）；不注入就没有 workspace 这一组 */
  workspaceIo?: WorkspaceIo
  /** 学习者画像的读写（落在 user/store 上）；不注入就没有 userInfo 这一组 */
  userInfo?: UserInfoIo
  /**
   * 读网页（web.*）：不注入就没有这一组。
   *
   * 与 ResourceIo / UserInfoIo 同一条道理——抓取要网络、落盘要 storage，
   * 这里只把界面层给的实现接上去，agentOps 自己仍然可以在 Node 里裸跑。
   */
  web?: WebOps
  /**
   * wf.invoke 的落点（见 WorkflowOps.invoke）：沙箱里触发工作流只是**排队**，
   * 真正起那一轮的是宿主（一轮对话里就是 useAgent 的 runWorkflow）。
   *
   * 为什么不在这里直接跑：工作流的指令要作为一条新的 user 消息进上下文，
   * 而调用它的那一轮还在跑——在正在跑的循环底下插一条用户消息是不行的。
   * 不注入时 wf.invoke 回一句「这个执行环境触发不了」（超级文档的桥那一侧就是如此）。
   */
  invokeWorkflow?: (ref: string, opts: { params?: Record<string, string | number> }) => unknown
}

/**
 * 画像的读写能力（见 user/fields、user/store）。
 *
 * 与 ResourceIo 同样的道理：agentOps 要能在 Node 里裸跑（scripts/agent-ops.test.ts），
 * 所以「画像存在哪、怎么写盘」由界面层注入，这里只做校验与措辞。
 * update 回更新后的画像（写盘失败 / 没有当前用户时回 null）。
 */
export interface UserInfoIo {
  read: () => UserProfile | null
  update: (patch: Partial<UserProfile>) => Promise<UserProfile | null>
}

/**
 * 资源库的磁盘能力：由界面层注入（见 components/learn/LearnWorkspace）。
 *
 * 之所以不让 agentOps 直接 import lib/storage：这个模块要能在 Node 里裸跑
 * （见 scripts/agent-ops.test.ts 的探针），注入之后磁盘那一层可以换成假的，
 * 「清单改了但文件没写」这类错也才测得出来。
 */
export interface ResourceIo {
  readText: (rel: string) => Promise<string | null>
  writeText: (rel: string, content: string) => Promise<boolean>
  /** 读一张图的字节（挂给模型看用）；读不到回 null */
  readImage: (rel: string) => Promise<{ mime: string; data: string; url: string } | null>
  remove: (rel: string) => Promise<boolean>
}

/**
 * 工作区目录的磁盘能力（workspace.*，见 learn/ops/workspace）：由界面层注入。
 *
 * 与 ResourceIo 同一条纪律：agentOps 要能在 Node 里裸跑（scripts/agent-ops.test.ts 的探针），
 * 磁盘那一层可以换成假的。路径是「相对当前用户」的（docs/…/workspace/…），uid 前缀由实现补；
 * 结果形状与主进程的 storage:list/read/write 一致，错误原样透传给模型。
 */
export interface WorkspaceIo {
  /** 列目录；目录还不存在时回空清单（ok: true, entries: []） */
  list: (
    rel: string,
  ) => Promise<{ ok: true; entries: Array<{ name: string; dir: boolean }> } | { ok: false; error: string }>
  /** 读文本文件；不存在回 { ok: true, content: null }（与主进程 readText 同一口径） */
  read: (rel: string) => Promise<{ ok: true; content: string | null } | { ok: false; error: string }>
  /** 写文本文件（父目录自动建） */
  write: (rel: string, content: string) => Promise<{ ok: boolean; error?: string }>
}

/**
 * createExecuteTool 需要的宿主能力：沙箱选项里除去 timeoutMs / runSandbox（由调用方给），
 * tmp 与 exam 两组是选配的（没有就不注册，模型调了会得到「沙箱里没有这个 api」）。
 */
export type AgentOps = Omit<SandboxOptions, 'timeoutMs' | 'runSandbox' | 'tmp' | 'exam'> & {
  tmp?: SandboxOptions['tmp']
  exam?: SandboxOptions['exam']
}
