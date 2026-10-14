/**
 * 这个文件负责什么：把用户配置的 MCP 服务包成 execute 沙箱里的 mcp 组
 * （mcp.list / mcp.discover / mcp.call，契约见 sandbox/types 的 McpOps）。
 *
 * 与旧做法的差别（需求原文：「改成用 execute 的 api 来实现」）：原先每个 MCP 工具
 * 都被翻译成一枚独立的 AgentTool（mcp_{服务}_{工具}）挂在模型每轮的 tools 清单上——
 * 外部工具越多，每轮请求的声明就越长，而且和「唯一的工具是 execute」的设计分了家。
 * 收进沙箱后：工具声明不再随 MCP 数量膨胀，发现与调用都在编排脚本里完成，
 * 与浏览器、网页这些组同一套用法。
 *
 * 三个入口的分工：
 * - list：读设置里缓存的工具清单（不发请求，快）；
 * - discover：现场探测（SSE 服务在渲染层直接请求；stdio 服务由主进程起进程后
 *   initialize + tools/list，见 electron/mcp），单独探一个失败就是失败（ok:false），
 *   全量探查则逐服务回报（ok 由服务级字段表达）；
 * - call：真正调用——**不校验工具名是否在缓存里**，以服务端为准（缓存可能过期）。
 *
 * 这里是纯装配：持有的是调用方给的**设置快照**（宿主每轮现取现建，见 useAgent），
 * 网络与 JSON-RPC 全在 client.ts——Node 探针里给一份假的设置就能把 api 面钉住。
 */
import { McpClient } from './client'
import type { McpCallResult, McpServerConfig, McpSettings, McpToolDefinition } from './types'
import type { McpOps } from '../sandbox/types'

/** 工具的展示形态：只留名字与描述（inputSchema 不进上下文——要细看就现场调对应工具试） */
function toolView(tool: McpToolDefinition): { name: string; description?: string } {
  return { name: tool.name, ...(tool.description ? { description: tool.description } : {}) }
}

/** 服务的展示形态：list / discover 共用 */
function serverView(server: McpServerConfig): Record<string, unknown> {
  return {
    id: server.id,
    name: server.name,
    ...(server.description ? { description: server.description } : {}),
    transport: server.transport,
    status: server.status ?? 'idle',
    tools: (server.tools ?? []).map(toolView),
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 造一份 mcp 组。**总开关关着返回 null**——宿主据此不注入这一组，
 * 与旧做法「关闭时不注入任何 MCP 工具」同一口径。
 */
export function makeMcpOps(settings?: McpSettings | null): McpOps | null {
  if (!settings || !settings.enabled) return null

  const all = (): McpServerConfig[] => (Array.isArray(settings.servers) ? settings.servers : [])
  const enabled = (): McpServerConfig[] => all().filter((s) => s.enabled)
  /** 服务名单（报「没找到」时给模型一条能改对的路） */
  const roster = (): string => {
    const list = all()
    if (!list.length) return '（还没有配置任何服务）'
    return list.map((s) => s.name + '（' + s.id + '）' + (s.enabled ? '' : '·未启用')).join('、')
  }
  /**
   * 按 id 或名称解析，并校验启用态——**不筛启用态地找**：
   * 找得到才有那句「它没启用」（模型据此告诉用户去设置里打开），否则只剩「没找到」。
   */
  const require = (name: string): McpServerConfig | { error: string } => {
    const key = name.trim()
    const target = all().find((s) => s.id === key) ?? all().find((s) => s.name === key) ?? null
    if (!target) return { error: '没有找到这个 MCP 服务：' + name + '。用户配置的服务：' + roster() }
    if (!target.enabled) {
      return { error: 'MCP 服务「' + target.name + '」当前未启用（用户可以在「超级导师设置 → MCP」里打开它）' }
    }
    return target
  }

  return {
    list: () => {
      const servers = enabled().map(serverView)
      const total = all().length
      return {
        ok: true,
        servers,
        ...(servers.length
          ? {}
          : {
              note: total
                ? '用户配置了 ' + total + ' 个 MCP 服务，但都未启用。'
                : '还没有配置任何 MCP 服务（「超级导师设置 → MCP」里可以添加）。',
            }),
      }
    },

    discover: async (server) => {
      if (server !== undefined) {
        const target = require(server)
        if ('error' in target) return { ok: false, error: target.error }
        try {
          const tools = await McpClient.discoverTools(target)
          return { ok: true, servers: [{ id: target.id, name: target.name, ok: true, tools: tools.map(toolView) }] }
        } catch (err) {
          return { ok: false, content: '探测「' + target.name + '」失败：' + messageOf(err) }
        }
      }
      const list = enabled()
      const results: unknown[] = []
      for (const s of list) {
        try {
          const tools = await McpClient.discoverTools(s)
          results.push({ id: s.id, name: s.name, ok: true, tools: tools.map(toolView) })
        } catch (err) {
          results.push({ id: s.id, name: s.name, ok: false, error: messageOf(err) })
        }
      }
      return {
        ok: true,
        servers: results,
        ...(list.length ? {} : { note: '当前没有已启用的 MCP 服务，没有可探测的对象。' }),
      }
    },

    call: async (server, tool, args) => {
      const target = require(server)
      if ('error' in target) return { ok: false, error: target.error }
      const toolName = tool.trim()
      if (!toolName) {
        return { ok: false, error: 'mcp.call 需要工具名：mcp.call(服务, 工具, 参数对象?)——服务与工具名见 api.mcp.list()' }
      }
      let payload: Record<string, unknown> | null = null
      if (args === undefined || args === null) payload = {}
      else if (typeof args === 'object' && !Array.isArray(args)) payload = args as Record<string, unknown>
      if (!payload) {
        return {
          ok: false,
          error:
            '参数要传一个对象（按该工具在 mcp.list / mcp.discover 里公布的说明给），' +
            '例如 mcp.call("服务", "工具", { query: "..." })',
        }
      }
      let res: McpCallResult
      try {
        res = await McpClient.callTool(target, toolName, payload)
      } catch (err) {
        return { ok: false, content: '调用 MCP 工具异常：' + messageOf(err) }
      }
      // 与旧的 AgentTool 同一个口径：文本内容优先，拿不到就退化成结构序列化
      const text = res.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text as string)
        .join('\n')
      const fallback = res.content.length ? JSON.stringify(res.content) : '（没有输出）'
      return {
        ok: !res.isError,
        server: target.id,
        name: target.name,
        tool: toolName,
        content: text || fallback,
      }
    },
  }
}
