/**
 * 这个文件负责什么：IPC 契约的「对外 MCP 服务」通道组——应用本身充当 MCP server，
 * 外部 harness（ZCode / Claude Code 等）经命名管道连进来调用工具。主进程收到
 * tools/call 后转发进渲染层的 guest 会话执行，回执原路送回：
 * 哑桥 electron/mcp/bridge.mjs ↔ 主进程 electron/mcp/serve ↔ 渲染层 src/agent/mcp/serveHost。
 * 对外经门面 shared/ipc.ts 原样转出。
 */

/* ---------- 对外 MCP 服务（应用 = MCP server，外部 harness = client） ---------- */

/**
 * 主进程 → 渲染层的一次工具调用：requestId 用来把回执配对回挂起的 tools/call。
 * 谁在用：preload 的 mcpServe.onCall ↔ 主进程 'mcpServe:call'（electron/mcp/serve.ts），
 * 渲染层 src/agent/mcp/serveHost.ts。
 */
export interface McpServeCall {
  requestId: string
  /** 工具名：目前只有 execute 与 api_manual（清单单一事实源见 shared/mcpServeTools） */
  tool: string
  args: Record<string, unknown>
}

/**
 * 渲染层 → 主进程的回执：content 是给 harness 的文本（MCP 的 text content），
 * isError 是 MCP tools/call 的「工具级失败」标记。guest 会话没有图片通道
 * （MessageImage 只带 rel 路径不带字节），图片类结果只回路径说明。
 * 谁在用：preload 的 mcpServe.reply ↔ 主进程 'mcpServe:reply'，渲染层 serveHost。
 */
export interface McpServeReply {
  requestId: string
  content: string
  isError: boolean
}

/**
 * 写进 userData/mcp-endpoint.json 的发现信息：哑桥按它找到管道、带 token 握手。
 * 应用每次启动重写（token 每次重生成），退出时删除；pid 让桥能识别残留的旧文件。
 */
export interface McpServeEndpoint {
  pipe: string
  token: string
  pid: number
  version: string
}

/**
 * 主进程侧的服务状态：设置页「对外 MCP 服务」面板的展示数据源。服务停着也回答。
 * 谁在用：preload 的 mcpServe.status / setEnabled ↔ 主进程 'mcpServe:status' /
 * 'mcpServe:setEnabled'（electron/mcp/serve.ts 的 registerMcpServeIpc）。
 */
export interface McpServeStatus {
  /** 设置里的开关（渲染层是事实源，主进程跟随） */
  enabled: boolean
  /** 管道是否正在监听 */
  listening: boolean
  pipe: string
  endpointFile: string
  /** 当前连着的 harness 数量 */
  connections: number
  /** 哑桥的当前落点（开发=仓库路径；打包=app.asar.unpacked 路径），配置片段直接用它 */
  bridgePath: string
  version: string
}
