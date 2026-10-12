/**
 * Model Context Protocol (MCP) 基础设施类型定义。
 *
 * 遵循官方 MCP 协议标准 (JSON-RPC 2.0)，支持工具发现、资源接入与工具调用。
 */

export type McpTransport = 'sse' | 'stdio'

export interface McpToolDefinition {
  /** 工具标识名称 */
  name: string
  /** 工具功能说明 */
  description?: string
  /** 工具参数的 JSON Schema */
  inputSchema?: Record<string, unknown>
}

export interface McpServerConfig {
  /** 唯一标识，如 'fetch-server' */
  id: string
  /** 展示名称，如 '网页内容抓取 (Fetch)' */
  name: string
  /** 描述说明 */
  description?: string
  /** 传输类型：sse (HTTP/SSE) 或 stdio (命令行进程) */
  transport: McpTransport
  /** SSE / HTTP 端点地址，如 http://localhost:8000/sse */
  url?: string
  /** stdio 命令，如 npx, python, node */
  command?: string
  /** stdio 命令参数列表，如 ['-y', '@modelcontextprotocol/server-fetch'] */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 是否启用该服务 */
  enabled: boolean
  /** 探测/缓存到的工具列表 */
  tools?: McpToolDefinition[]
  /** 当前连接状态 */
  status?: 'connected' | 'idle' | 'error' | 'connecting'
  /** 最近一次报错信息 */
  lastError?: string
  /** 最近一次探测或调用时间 */
  updatedAt?: number
}

export interface McpCallContentItem {
  type: 'text' | 'image' | 'resource'
  text?: string
  data?: string
  mimeType?: string
}

export interface McpCallResult {
  content: McpCallContentItem[]
  isError?: boolean
}

export interface McpSettings {
  /** MCP 总开关 */
  enabled: boolean
  /** 配置的 MCP 服务器列表 */
  servers: McpServerConfig[]
}

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: true,
  servers: [],
}

/** 常用官方与社区 MCP 服务预设，供用户一键快速添加 */
export interface McpPreset {
  id: string
  name: string
  description: string
  transport: McpTransport
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  defaultTools?: McpToolDefinition[]
}

export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'mcp-fetch',
    name: 'Fetch (网页抓取与 Markdown 转换)',
    description: '抓取互联网任意网页并提取为整洁的 Markdown 文档内容，供导师研读。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    defaultTools: [
      {
        name: 'fetch',
        description: '从给定的 URL 抓取内容并转换为结构化 Markdown',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '待抓取的网页地址' },
          },
          required: ['url'],
        },
      },
    ],
  },
  {
    id: 'mcp-filesystem',
    name: 'Filesystem (本地文件系统)',
    description: '安全访问受信任的本地文件夹目录，读取、搜索和写入代码与文档文件。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', './workspace'],
    defaultTools: [
      {
        name: 'read_file',
        description: '读取本地文件内容',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件相对或绝对路径' },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_directory',
        description: '列出指定目录下的全部子文件与子文件夹',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件夹路径' },
          },
          required: ['path'],
        },
      },
    ],
  },
  {
    id: 'mcp-sqlite',
    name: 'SQLite (本地轻量数据库)',
    description: '连接本地 SQLite 数据库文件，执行 SQL 查询和数据统计。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', 'data.db'],
    defaultTools: [
      {
        name: 'read_query',
        description: '执行 SELECT 只读查询并返回表格结果',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'SQL SELECT 语句' },
          },
          required: ['query'],
        },
      },
    ],
  },
  {
    id: 'mcp-remote-service',
    name: 'HTTP/SSE 远端 MCP 服务',
    description: '连接局域网或远程服务器上部署的 HTTP/SSE 协议 MCP 微服务。',
    transport: 'sse',
    url: 'http://localhost:8000/sse',
    defaultTools: [
      {
        name: 'remote_query',
        description: '调用远端知识库或分析服务',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '查询词' },
          },
          required: ['query'],
        },
      },
    ],
  },
]
