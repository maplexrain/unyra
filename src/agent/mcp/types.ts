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
    description: '抓取互联网任意网页并提取为整洁的 Markdown / 纯文本内容，供导师研读。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@tokenizin/mcp-npx-fetch'],
    defaultTools: [
      {
        name: 'fetch_markdown',
        description: '抓取指定网址并转换为 Markdown 正文',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: '待抓取的网页地址' } },
          required: ['url'],
        },
      },
      {
        name: 'fetch_html',
        description: '抓取指定网址并返回原始 HTML',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: '待抓取的网页地址' } },
          required: ['url'],
        },
      },
      {
        name: 'fetch_txt',
        description: '抓取指定网址并返回纯文本（去标签）',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: '待抓取的网页地址' } },
          required: ['url'],
        },
      },
      {
        name: 'fetch_json',
        description: '抓取指定网址并解析为 JSON',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: '待抓取的网页地址' } },
          required: ['url'],
        },
      },
    ],
  },
  {
    id: 'mcp-filesystem',
    name: 'Filesystem (本地文件系统)',
    description:
      '安全访问受信任的本地文件夹目录，读取、搜索和写入代码与文档文件。' +
      '最后一个参数是放行的目录（默认 . 指应用数据目录；改成你自己的文件夹路径即可）。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    defaultTools: [
      {
        name: 'read_text_file',
        description: '读取本地文本文件内容',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件路径' } },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: '写入本地文件（覆盖或新建）',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '要写入的内容' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: '列出指定目录下的全部子文件与子文件夹',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件夹路径' } },
          required: ['path'],
        },
      },
      {
        name: 'search_files',
        description: '按文件名或内容递归搜索文件',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '起始文件夹' },
            pattern: { type: 'string', description: '搜索词（文件名或内容）' },
          },
          required: ['path', 'pattern'],
        },
      },
    ],
  },
  {
    id: 'mcp-sqlite',
    name: 'SQLite (本地轻量数据库)',
    description:
      '查询本地 SQLite 数据库、浏览表结构。数据库文件按调用传路径（query / schema 的 db 参数）；' +
      '默认只读安全闸（仅允许 SELECT / PRAGMA / EXPLAIN）。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-sqlite-server'],
    defaultTools: [
      {
        name: 'query',
        description: '对指定 SQLite 数据库执行只读 SQL 查询，返回表格结果',
        inputSchema: {
          type: 'object',
          properties: {
            db: { type: 'string', description: '.db / .sqlite 文件路径' },
            sql: { type: 'string', description: 'SQL 语句（只读）' },
          },
          required: ['db', 'sql'],
        },
      },
      {
        name: 'schema',
        description: '查看数据库的全部表、列与行数',
        inputSchema: {
          type: 'object',
          properties: { db: { type: 'string', description: '.db / .sqlite 文件路径' } },
          required: ['db'],
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
