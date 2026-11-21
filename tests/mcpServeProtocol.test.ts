/**
 * 对外 MCP 服务（electron/mcp/serveProtocol）的连接协议用例：token 握手的闸门、
 * initialize / tools/list / tools/call 的分发与回执形状、错误码与跨块分帧。
 * 纯逻辑用例：callTool 用桩，不碰管道（管道那侧是 electron 专属，见 serve.ts）。
 */
import { describe, expect, it } from 'vitest'
import { createServeConnection } from '../electron/mcp/serveProtocol'
import { MCP_SERVE_TOOLS } from '../shared/mcpServeTools'

/**
 * 建一条测试连接：收集写出的行与关闭原因。
 * 桩对**真实工具名**注入行为（协议层会按 manifest 挡掉未登记的名字，桩收不到）：
 * failOn 指定的工具抛异常（传输层失败），带 bad:true 的调用回 isError（工具级失败）。
 */
function harness(token = 'tok', failOn?: string) {
  const out: string[] = []
  let closed: string | null = null
  const conn = createServeConnection({
    token,
    version: 'test',
    callTool: async (tool, args) => {
      if (failOn && tool === failOn) throw new Error('渲染层炸了')
      return { requestId: 'x', content: JSON.stringify({ tool, args }), isError: args.bad === true }
    },
    close: (reason) => {
      closed = closed ?? reason
    },
    write: (line) => out.push(line),
  })
  return { conn, out, closedOf: () => closed }
}

const hello = (token = 'tok'): string =>
  JSON.stringify({ jsonrpc: '2.0', method: 'unyra/hello', params: { token } })

const req = (id: number, method: string, params?: Record<string, unknown>): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })

interface Reply {
  id?: unknown
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}
const parse = (line: string): Reply => JSON.parse(line)

/** 让异步 dispatch 的微队列跑完 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('对外 MCP 服务：连接协议', () => {
  it('握手是闸门：hello 之前到达的任何行都当场断开，一行都不回', () => {
    const h = harness()
    h.conn.feed(req(1, 'initialize', {}) + '\n')
    expect(h.closedOf()).toBeTruthy()
    expect(h.out).toHaveLength(0)
  })

  it('token 不对也断；hello 之后 initialize 原样回显协议版本', () => {
    const wrong = harness('tok')
    wrong.conn.feed(hello('wrong') + '\n')
    expect(wrong.closedOf()).toBeTruthy()

    const h = harness('tok')
    h.conn.feed(hello() + '\n')
    h.conn.feed(req(1, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'zc' } }) + '\n')
    expect(h.closedOf()).toBeNull()
    expect(h.out).toHaveLength(1)
    const res = parse(h.out[0]!)
    expect(res.id).toBe(1)
    expect(res.result?.protocolVersion).toBe('2025-06-18')
    expect(res.result?.serverInfo).toMatchObject({ name: 'unyra' })
    expect(typeof res.result?.instructions).toBe('string')
  })

  it('tools/list 回的就是 shared 清单（单一事实源）；ping 空回；通知不回', () => {
    const h = harness()
    h.conn.feed(hello() + '\n')
    h.conn.feed(req(1, 'tools/list') + '\n')
    h.conn.feed(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    h.conn.feed(req(2, 'ping') + '\n')
    expect((parse(h.out[0]!).result as { tools: unknown }).tools).toEqual(MCP_SERVE_TOOLS)
    expect(h.out).toHaveLength(2) // initialized 是通知：没有第二行回执
    expect(parse(h.out[1]!).result).toEqual({})
  })

  it('tools/call：回执折成 text content，isError 透传工具级失败', async () => {
    const h = harness()
    h.conn.feed(hello() + '\n')
    h.conn.feed(req(1, 'tools/call', { name: 'execute', arguments: { body: '((api)=>1)' } }) + '\n')
    h.conn.feed(req(2, 'tools/call', { name: 'execute', arguments: { body: 'x', bad: true } }) + '\n')
    await flush()
    const ok = parse(h.out[0]!).result as { content: Array<{ type: string; text: string }>; isError: boolean }
    expect(ok.content).toEqual([
      { type: 'text', text: JSON.stringify({ tool: 'execute', args: { body: '((api)=>1)' } }) },
    ])
    expect(ok.isError).toBe(false)
    const bad = parse(h.out[1]!).result as { isError: boolean }
    expect(bad.isError).toBe(true)
  })

  it('传输层失败（callTool 抛错）按 -32000 回，不是 isError', async () => {
    const h = harness('tok', 'execute')
    h.conn.feed(hello() + '\n')
    h.conn.feed(req(1, 'tools/call', { name: 'execute', arguments: { body: 'x' } }) + '\n')
    await flush()
    const res = parse(h.out[0]!)
    expect(res.result).toBeUndefined()
    expect(res.error?.code).toBe(-32000)
    expect(res.error?.message).toContain('渲染层炸了')
  })

  it('未知工具 -32602；未知方法 -32601', () => {
    const h = harness()
    h.conn.feed(hello() + '\n')
    h.conn.feed(req(1, 'tools/call', { name: 'nope' }) + '\n')
    h.conn.feed(req(2, 'resources/list') + '\n')
    expect(parse(h.out[0]!).error?.code).toBe(-32602)
    expect(parse(h.out[1]!).error?.code).toBe(-32601)
  })

  it('跨块分帧：消息被拦腰切开也能拼回来；坏行回 -32700', async () => {
    const h = harness()
    h.conn.feed(hello() + '\n')
    const msg = req(7, 'tools/list')
    h.conn.feed(msg.slice(0, 12))
    h.conn.feed(msg.slice(12) + '\n')
    await flush()
    expect((parse(h.out[0]!).result as { tools: unknown }).tools).toEqual(MCP_SERVE_TOOLS)

    h.conn.feed('这不是 JSON\n')
    await flush()
    expect(parse(h.out[1]!).error?.code).toBe(-32700)
  })
})
