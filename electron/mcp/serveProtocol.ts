/**
 * 这个文件负责什么：**对外 MCP 服务的连接协议**（纯逻辑，不 import electron，
 * vitest 直接拿它做用例，见 tests/mcpServeProtocol.test.ts）——每一条管道连接
 * 一个实例：token 握手、按行分帧的 JSON-RPC 2.0 分发（initialize / tools/list /
 * tools/call / ping）、回执组装。electron 那一侧（管道监听、端点文件、渲染层
 * 转发）由 electron/mcp/serve.ts 注入。
 *
 * 握手为什么在 MCP 之外加一条 unyra/hello：stdio 传输的 MCP 本身没有鉴权通道，
 * 而命名管道对同机所有进程开放。哑桥（electron/mcp/bridge.mjs）连上后先发一行
 * 带 token 的 hello 再开始转发 harness 的消息——对 harness 完全不可见，对管道
 * 则是唯一的闸门。hello 之前到达的任何行、token 不对，都当场断开。
 *
 * 帧纪律与 electron/mcp/stdio（客户端那一侧）一致：JSON-RPC 按行分帧；
 * 我们自己写的输出保证整行，输入端容忍跨块（见 buffer 拼行）。
 */
import type { McpServeReply } from '../../shared/ipc'
import { MCP_SERVE_PROTOCOL_VERSION, MCP_SERVE_TOOLS } from '../../shared/mcpServeTools'

/** callTool 的实现方（serve.ts）：转发进渲染层并等回执；传输层失败抛异常 → JSON-RPC error */
export type ServeCallTool = (tool: string, args: Record<string, unknown>) => Promise<McpServeReply>

export interface ServeConnectionDeps {
  /** 桥握手行里必须带来的 token（serve.ts 每次启动重生成） */
  token: string
  /** initialize 的 serverInfo.version（应用版本） */
  version: string
  callTool: ServeCallTool
  /** 连接必须被强制关掉时回调（token 不对等）；serve.ts 据此销毁 socket */
  close: (reason: string) => void
  /** 把一行 JSON 写回给桥（不含换行符；serve.ts 负责补 \n） */
  write: (line: string) => void
}

interface JsonRpcMessage {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

export function createServeConnection(deps: ServeConnectionDeps): {
  feed: (chunk: string) => void
  end: () => void
} {
  let buffer = ''
  /** 'hello'：等第一条（桥的 token 握手）；'ready'：开始正常 MCP 分发 */
  let phase: 'hello' | 'ready' = 'hello'
  let ended = false

  const reply = (id: unknown, result: unknown): void => {
    if (ended) return
    deps.write(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }
  const replyError = (id: unknown, code: number, message: string): void => {
    if (ended) return
    deps.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
  }

  const dispatch = async (msg: JsonRpcMessage): Promise<void> => {
    /** 有 id 才是请求；没有 id 的是通知（不回执） */
    const id = typeof msg.id === 'number' || typeof msg.id === 'string' ? msg.id : null
    const method = typeof msg.method === 'string' ? msg.method : ''
    const params =
      msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)
        ? (msg.params as Record<string, unknown>)
        : {}
    switch (method) {
      case 'initialize': {
        // 客户点名的协议版本原样回给它：各家 SDK 的版本不同，宽松回显兼容性最好
        const requested =
          typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_SERVE_PROTOCOL_VERSION
        reply(id, {
          protocolVersion: requested,
          capabilities: { tools: {} },
          serverInfo: { name: 'unyra', title: '归一 Unyra', version: deps.version },
          instructions:
            '归一 Unyra（本地优先的 AI 学习应用）的数据工具面。用 execute 在沙箱里写 JS 编排 ' +
            'node/memory/res/workspace/web/tmp 六个域的 api 操作学习数据；api_manual 现查每个 api 的用法。' +
            '先 api_manual 看 node 组与总览，再动手。',
        })
        return
      }
      case 'notifications/initialized':
        return // 通知：无回执
      case 'ping':
        reply(id, {})
        return
      case 'tools/list':
        reply(id, { tools: MCP_SERVE_TOOLS })
        return
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name.trim() : ''
        if (!MCP_SERVE_TOOLS.some((t) => t.name === name)) {
          replyError(
            id,
            -32602,
            '没有这个工具：' + (name || '（空）') + '。可用：' + MCP_SERVE_TOOLS.map((t) => t.name).join('、'),
          )
          return
        }
        const args =
          params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
            ? (params.arguments as Record<string, unknown>)
            : {}
        try {
          const r = await deps.callTool(name, args)
          // 工具级失败（ok:false）走 isError，不是 JSON-RPC error：模型要读 content 里的失败清单
          reply(id, { content: [{ type: 'text', text: r.content }], isError: r.isError === true })
        } catch (err) {
          // 传输层失败（界面没就绪 / 渲染层超时）：不是工具级失败，按协议错误回
          replyError(id, -32000, err instanceof Error ? err.message : String(err))
        }
        return
      }
      default:
        if (id !== null) replyError(id, -32601, '不支持的方法：' + method)
    }
  }

  const handleLine = (line: string): void => {
    if (ended) return
    if (phase === 'hello') {
      let ok = false
      try {
        const msg = JSON.parse(line) as { method?: unknown; params?: { token?: unknown } }
        ok =
          msg.method === 'unyra/hello' &&
          typeof msg.params?.token === 'string' &&
          (msg.params.token as string) === deps.token
      } catch {
        ok = false
      }
      if (!ok) {
        ended = true
        deps.close('token 握手失败：连接必须先发 unyra/hello（见 electron/mcp/bridge.mjs），token 见端点文件')
        return
      }
      phase = 'ready'
      return
    }
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(line) as JsonRpcMessage
    } catch {
      replyError(null, -32700, '不是合法的 JSON-RPC 行：' + line.slice(0, 120))
      return
    }
    void dispatch(msg)
  }

  return {
    feed: (chunk: string) => {
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '').trim()
        buffer = buffer.slice(idx + 1)
        if (line) handleLine(line)
        if (ended) return
      }
    },
    end: () => {
      ended = true
    },
  }
}
