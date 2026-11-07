/**
 * 这个文件负责什么：沙箱类型契约的**mcp（外部 MCP 服务）**组的宿主实现 McpOps
 * （行为见 agent/mcp/ops）。
 * 原先与其它组同写在 src/agent/sandbox/types.ts，按 API 能力组拆到这里；形状逐字未动，
 * 对外一律经门面 src/agent/sandbox/types.ts 原样转出，调用方 import 路径不变。
 */

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

