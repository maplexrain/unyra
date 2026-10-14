import { native } from '../../lib/native'
import type { McpStdioServerPayload } from '../../../shared/ipc'
import type { McpCallResult, McpServerConfig, McpToolDefinition } from './types'

/**
 * MCP JSON-RPC 2.0 客户端（渲染层一侧）。两条传输各走各的路：
 *
 * - **sse**：渲染层直接 fetch（POST JSON-RPC，见下）——远端 HTTP 端点没有进程可言；
 * - **stdio**：交给**主进程**的本地会话（spawn 子进程 + stdin/stdout 上的 JSON-RPC，
 *   见 electron/mcp/stdio）——渲染层拿不到 child_process，这里只把服务配置递过去、
 *   把回执原样带回。会话复用、握手、超时与进程清理都在主进程那一侧。
 */
export class McpClient {
  private static nextId = 1

  /**
   * 探测并发现指定 MCP 服务器提供的全部工具（现场探测：stdio 会真的把服务进程起起来）
   */
  static async discoverTools(server: McpServerConfig): Promise<McpToolDefinition[]> {
    if (!server.enabled) return server.tools ?? []

    if (server.transport === 'sse') {
      const url = server.url?.trim()
      if (!url) throw new Error('未配置有效的 SSE 服务端 URL')

      try {
        // 1. 发起 tools/list JSON-RPC 请求
        const rpcPayload = {
          jsonrpc: '2.0',
          id: McpClient.nextId++,
          method: 'tools/list',
          params: {},
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify(rpcPayload),
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`)
        }

        const data = await res.json()
        if (data.error) {
          throw new Error(data.error.message || 'RPC 返回错误')
        }

        const tools: McpToolDefinition[] = (data.result?.tools || []).map((t: any) => ({
          name: String(t.name || ''),
          description: t.description ? String(t.description) : undefined,
          inputSchema: t.inputSchema || t.parameters,
        }))

        return tools
      } catch (err: any) {
        throw new Error(`连接 SSE 服务失败: ${err.message || String(err)}`)
      }
    }

    // stdio 传输：交给主进程的本地会话（起进程、initialize、tools/list 全在那边；
    // 「npx 包不存在 / 命令起不来」这类话在错误里原样带回）
    if (!server.command) {
      throw new Error('未配置 stdio 执行命令')
    }
    const bridge = stdioBridge()
    if (!bridge) {
      throw new Error('stdio 传输需要桌面应用环境：没有找到主进程桥（请用 npm run electron:dev 启动）')
    }
    const res = await bridge.discover(stdioPayloadOf(server))
    if (!res.ok) throw new Error(res.error)
    // 桥上的 inputSchema 是 unknown（主进程不做形状假设）：这里收窄成目录那套形状
    return res.tools.map((t) => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      ...(t.inputSchema && typeof t.inputSchema === 'object'
        ? { inputSchema: t.inputSchema as Record<string, unknown> }
        : {}),
    }))
  }

  /**
   * 调用指定的 MCP 工具
   */
  static async callTool(
    server: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    if (!server.enabled) {
      return {
        isError: true,
        content: [{ type: 'text', text: `MCP 服务 [${server.name}] 当前处于禁用状态` }],
      }
    }

    if (server.transport === 'sse') {
      const url = server.url?.trim()
      if (!url) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'MCP 服务器缺少有效的 URL' }],
        }
      }

      try {
        const rpcPayload = {
          jsonrpc: '2.0',
          id: McpClient.nextId++,
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(rpcPayload),
        })

        if (!res.ok) {
          return {
            isError: true,
            content: [{ type: 'text', text: `MCP 服务调用返回 HTTP ${res.status}: ${res.statusText}` }],
          }
        }

        const data = await res.json()
        if (data.error) {
          return {
            isError: true,
            content: [{ type: 'text', text: `MCP 工具执行报错: ${data.error.message || JSON.stringify(data.error)}` }],
          }
        }

        const result = data.result
        if (result?.content && Array.isArray(result.content)) {
          return {
            isError: !!result.isError,
            content: result.content,
          }
        }

        return {
          isError: false,
          content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `网络调用异常: ${err.message || String(err)}` }],
        }
      }
    }

    // stdio 传输：交给主进程的本地会话（工具级失败由服务端标在 isError 上，原样透传）
    const bridge = stdioBridge()
    if (!bridge) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'stdio 传输需要桌面应用环境：没有找到主进程桥（请用 npm run electron:dev 启动）' }],
      }
    }
    const res = await bridge.call(stdioPayloadOf(server), toolName, args)
    if (!res.ok) {
      return { isError: true, content: [{ type: 'text', text: res.error }] }
    }
    return { isError: res.isError, content: res.content }
  }
}

/**
 * 取主进程的 stdio 桥；拿不到（浏览器里跑、或极老的 preload）返回 null——
 * 调用方据此给出「需要桌面应用环境」的可读回执。
 */
function stdioBridge(): ReturnType<typeof native>['mcp'] | null {
  try {
    return native().mcp ?? null
  } catch {
    return null
  }
}

/** 递给主进程的服务配置：只带起进程用得着的字段（工具缓存不进桥） */
function stdioPayloadOf(server: McpServerConfig): McpStdioServerPayload {
  return {
    id: server.id,
    name: server.name,
    command: server.command ?? '',
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
  }
}
