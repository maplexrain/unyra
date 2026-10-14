/**
 * MCP stdio 会话（electron/mcp/stdio）的真进程用例：对手方是 tests/fixtures 里的
 * 最小 JSON-RPC 服务端——用本机的 node 直起（不走 npx、不碰网络），所以又快又稳。
 *
 * 覆盖的就是这条链的每一环：起进程 → initialize 握手 → tools/list / tools/call →
 * 会话复用与换配置重起 → 起不来 / 中途退出 / 超时的回执。
 */
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mcpStdioCall, mcpStdioDiscover, stopMcpSessions, type McpStdioCtx } from '../electron/mcp/stdio'
import type { McpStdioServerPayload } from '../shared/ipc'

const FIXTURE = join(__dirname, 'fixtures', 'mcp-stdio-server.cjs')

const ctx = (over?: Partial<McpStdioCtx>): McpStdioCtx => ({
  cwd: join(__dirname, '..'),
  clientVersion: 'test',
  ...over,
})

const server = (over?: Partial<McpStdioServerPayload>): McpStdioServerPayload => ({
  id: 'fixture',
  name: 'Fixture',
  command: process.execPath,
  args: [FIXTURE],
  ...over,
})

/** 从 pid 工具的回执里取「pid:tag」 */
function pidOf(res: Awaited<ReturnType<typeof mcpStdioCall>>): string {
  if (!res.ok) throw new Error('call 失败：' + res.error)
  return res.content.map((c) => c.text ?? '').join('')
}

afterAll(() => stopMcpSessions())

describe('MCP stdio 会话（真进程：tests/fixtures 的最小服务端）', () => {
  it('discover：起进程、握手、tools/list（stdout 上的非 JSON 横幅被忽略）', async () => {
    const res = await mcpStdioDiscover(server(), ctx())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.tools.map((t) => t.name)).toEqual(['echo', 'pid', 'boom', 'slow', 'kill'])
    expect(res.tools[0].description).toBeTruthy()
  })

  it('call：echo 原样回显；先 discover 与否都能用（同一会话）', async () => {
    const res = await mcpStdioCall(server(), 'echo', { text: '你好' }, ctx())
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.isError).toBe(false)
    expect(res.content).toEqual([{ type: 'text', text: 'echo:你好' }])
  })

  it('会话复用：同一个服务连调两次是同一个进程', async () => {
    const a = await mcpStdioCall(server(), 'pid', {}, ctx())
    const b = await mcpStdioCall(server(), 'pid', {}, ctx())
    expect(pidOf(a)).toBe(pidOf(b))
  })

  it('并发调用共享同一次建会话（不会起出两个进程）', async () => {
    const [a, b] = await Promise.all([
      mcpStdioCall(server(), 'pid', {}, ctx()),
      mcpStdioCall(server(), 'pid', {}, ctx()),
    ])
    expect(pidOf(a)).toBe(pidOf(b))
  })

  it('换配置（同 id 不同参数）：旧进程拆掉、按新配置重起', async () => {
    const before = pidOf(await mcpStdioCall(server({ args: [FIXTURE, '--tag', 'A'] }), 'pid', {}, ctx()))
    const after = pidOf(await mcpStdioCall(server({ args: [FIXTURE, '--tag', 'B'] }), 'pid', {}, ctx()))
    expect(before.endsWith(':A')).toBe(true)
    expect(after.endsWith(':B')).toBe(true)
    expect(after).not.toBe(before)
  })

  it('stop：停掉会话后下一次调用换新进程', async () => {
    const before = pidOf(await mcpStdioCall(server({ args: [FIXTURE, '--tag', 'A'] }), 'pid', {}, ctx()))
    stopMcpSessions('fixture')
    const after = pidOf(await mcpStdioCall(server({ args: [FIXTURE, '--tag', 'A'] }), 'pid', {}, ctx()))
    expect(after).not.toBe(before)
  })

  it('工具级失败（isError）与协议级错误（JSON-RPC error）分开表达', async () => {
    const boom = await mcpStdioCall(server(), 'boom', {}, ctx())
    expect(boom.ok).toBe(true)
    if (boom.ok) {
      expect(boom.isError).toBe(true)
      expect(boom.content[0].text).toContain('炸了')
    }
    const nope = await mcpStdioCall(server(), '不存在的工具', {}, ctx())
    expect(nope.ok).toBe(false)
    if (!nope.ok) expect(nope.error).toContain('未知工具')
  })

  it('服务起不来（初始化前就退出）：回执带上退出码与 stderr 尾巴', async () => {
    const res = await mcpStdioDiscover(server({ id: 'fixture-fail', args: [FIXTURE, '--fail-fast'] }), ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('启动 MCP 服务')
      expect(res.error).toContain('code=3')
      expect(res.error).toContain('cannot start')
    }
  })

  it('命令不存在：回执说清是哪条命令、为什么起不来', async () => {
    const res = await mcpStdioDiscover(
      server({ id: 'fixture-missing', command: 'definitely-not-a-real-cmd-xyz-123', args: [] }),
      ctx(),
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('启动 MCP 服务')
      expect(res.error).toContain('definitely-not-a-real-cmd-xyz-123')
    }
  })

  it('调用中进程退出：请求当场失败并说明原因', async () => {
    const res = await mcpStdioCall(server({ id: 'fixture-kill' }), 'kill', {}, ctx())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('已退出')
      expect(res.error).toContain('code=9')
    }
  })

  it('请求超时：按超时拆会话，下一次调用换新进程', async () => {
    const slow = await mcpStdioCall(server({ id: 'fixture-slow' }), 'slow', {}, ctx({ requestTimeoutMs: 300 }))
    expect(slow.ok).toBe(false)
    if (!slow.ok) expect(slow.error).toContain('超时')
    const fresh = await mcpStdioCall(server({ id: 'fixture-slow' }), 'pid', {}, ctx())
    expect(fresh.ok).toBe(true)
  })

  it('参数校验：空工具名 / 空命令当场拒绝，不起进程', async () => {
    const noTool = await mcpStdioCall(server({ id: 'fixture-v' }), '  ', {}, ctx())
    expect(noTool.ok).toBe(false)
    const noCmd = await mcpStdioDiscover(server({ id: 'fixture-v', command: '' }), ctx())
    expect(noCmd.ok).toBe(false)
    if (!noCmd.ok) expect(noCmd.error).toContain('启动命令')
  })
})
