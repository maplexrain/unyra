import type { AgentTool, AgentToolResult } from '../types'
import { McpClient } from './client'
import type { McpSettings } from './types'

/**
 * 将配置中所有已启用的 MCP 服务所提供的工具转化为标准 AgentTool 列表。
 * 工具名自动添加 mcp_{server_id}_{tool_name} 前缀以保证全局唯一和命名空间隔离。
 */
export function createMcpAgentTools(settings?: McpSettings | null): AgentTool[] {
  if (!settings || !settings.enabled) return []

  const tools: AgentTool[] = []
  const activeServers = settings.servers.filter((s) => s.enabled)

  for (const server of activeServers) {
    const serverTools = server.tools || []
    for (const tool of serverTools) {
      const sanitizedServerId = server.id.replace(/[^a-zA-Z0-9_]/g, '_')
      const sanitizedToolName = tool.name.replace(/[^a-zA-Z0-9_]/g, '_')
      const agentToolName = `mcp_${sanitizedServerId}_${sanitizedToolName}`

      tools.push({
        name: agentToolName,
        description: `[MCP: ${server.name}] ${tool.description || tool.name}`,
        parameters: tool.inputSchema && typeof tool.inputSchema === 'object'
          ? tool.inputSchema
          : { type: 'object', properties: {} },
        run: async (args: Record<string, unknown>): Promise<AgentToolResult> => {
          try {
            const res = await McpClient.callTool(server, tool.name, args)
            const textParts = res.content
              .filter((c) => c.type === 'text' && c.text)
              .map((c) => c.text!)
              .join('\n')

            const fallbackText = res.content.length ? JSON.stringify(res.content) : '执行成功，无额外文本输出'
            return {
              ok: !res.isError,
              content: textParts || fallbackText,
            }
          } catch (err: any) {
            return {
              ok: false,
              content: `MCP 工具调用异常: ${err.message || String(err)}`,
            }
          }
        },
      })
    }
  }

  return tools
}
