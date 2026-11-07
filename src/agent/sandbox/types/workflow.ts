/**
 * 这个文件负责什么：沙箱类型契约的**wf（工作流登记表）**组的宿主实现 WorkflowOps
 * （三级任务模板的登记处，见 learn/workflows）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

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

