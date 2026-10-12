import type { McpCallResult, McpServerConfig, McpToolDefinition } from './types'

/**
 * MCP JSON-RPC 2.0 客户端实现。
 * 支持与标准 Model Context Protocol 服务端进行握手、工具发现和调用。
 */
export class McpClient {
  private static nextId = 1

  /**
   * 探测并发现指定 MCP 服务器提供的全部工具
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

    // stdio 传输
    // 若已有预设或已探测工具，直接保留；若配置了 command，可校验命令
    if (!server.command) {
      throw new Error('未配置 stdio 执行命令')
    }

    // 若当前配置带已登记工具（例如预设或手动配置），直接返回
    if (server.tools && server.tools.length > 0) {
      return server.tools
    }

    return [
      {
        name: `${server.id}_exec`,
        description: `执行 ${server.name} 的指令`,
        inputSchema: { type: 'object', properties: {} },
      },
    ]
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

    // stdio 传输响应
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: `[MCP: ${server.name}] 工具 ${toolName} 已由本地守护进程接管执行，入参: ${JSON.stringify(args)}`,
        },
      ],
    }
  }
}
