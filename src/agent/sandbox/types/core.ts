/**
 * 这个文件负责什么：沙箱类型契约的**传输核心**组——SandboxCall（一次 api 调用的落账）、
 * SandboxRequest / SandboxReply（worker 传输协议）与 ExecuteTool（execute 工具的形状）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */
import type { AgentTool } from '../../types'

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
