/**
 * 这个文件负责什么：IPC 契约的**外部 MCP 服务的本地进程会话（stdio 传输）**通道组——
 * 服务配置载荷、工具形状与 discover / tools/call 结果（见 electron/mcp/stdio）。
 * 原先与其它组同写在 shared/ipc.ts，按通道组拆到这里；形状逐字未动，
 * 对外一律经门面 shared/ipc.ts 原样转出，调用方 import 路径不变。
 */

/* ---------- 外部 MCP 服务的本地进程会话（stdio 传输，见 electron/mcp） ---------- */

/**
 * 把一个 stdio MCP 服务交给主进程时携带的配置：命令、参数与环境变量都来自
 * 用户设置（超级导师设置 → MCP）。会话按这份配置的指纹复用（见 electron/mcp/stdio）。
 * 谁在用：preload 的 mcp.discover / mcp.call ↔ 主进程 mcp:discover / mcp:call，
 * 渲染层 src/agent/mcp/client.ts 的 stdio 分支。
 */
export interface McpStdioServerPayload {
  id: string
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

/** MCP 工具在桥上的形状（名字 + 说明 + 入参 schema，原样来自服务端 tools/list） */
export interface McpStdioTool {
  name: string
  description?: string
  inputSchema?: unknown
}

/** discover 的结果：initialize + tools/list 之后的工具清单，或一句人话错误。谁在用：同下。 */
export type McpStdioToolsResult = { ok: true; tools: McpStdioTool[] } | { ok: false; error: string }

/** tools/call 回执里的一条内容（沿用 MCP 协议自己的形状） */
export interface McpStdioContentItem {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
}

/** call 的结果：服务端的 tools/call result（isError 是服务端自己标的），或一句人话错误。
 *  谁在用：preload 的 mcp.call（通道 mcp:call，主进程 electron/mcp/stdio.ts），
 *  渲染层 src/agent/mcp/client.ts 的 stdio 分支。 */
export type McpStdioCallResult =
  | { ok: true; isError: boolean; content: McpStdioContentItem[] }
  | { ok: false; error: string }

