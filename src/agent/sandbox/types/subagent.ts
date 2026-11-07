/**
 * 这个文件负责什么：沙箱类型契约的**subagent（子代理）**组——wait 回执、通用回执与
 * 宿主实现 SubAgentSandboxApi。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

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

