/**
 * 这个文件负责什么：**stdio 传输的 MCP 会话**——把用户配置的一个本地 MCP 服务
 * （`npx xxx` 之类的命令）起成一个常驻子进程，用 JSON-RPC 2.0（按行分帧，走
 * stdin/stdout）完成 initialize 握手、tools/list 与 tools/call。
 *
 * 为什么住在主进程：渲染层拿不到 child_process（也不该拿到）。渲染层每调一次
 * mcp.discover / mcp.call，经 preload 把服务配置原样递过来（见 shared/ipc 的
 * McpStdioServerPayload），这里按**配置指纹**复用会话——同一份配置只起一个进程，
 * 配置改了（换命令 / 换参数）旧进程自动拆掉、下次用时重起。
 *
 * 与 SSE 传输的分工：那条在渲染层直接 fetch（见 src/agent/mcp/client 的 sse 分支），
 * 不经过这里；这里只管「真进程」这一条。
 *
 * 纪律（都是踩过的坑）：
 * - **Windows 上 npx 要 `npx.cmd` + shell**：裸 `npx` 的 spawn 是 ENOENT，
 *   Node 18.20 起 `.cmd` 不带 shell 又是 EINVAL——所以先按原样起、ENOENT 再补
 *   `.cmd` + shell 重试一次（见 spawnChild）；
 * - **stderr 要留尾巴**：npx 的安装失败、服务自己的报错全在 stderr，回执里带上
 *   最后几行，「为什么起不来」才是可诊断的；
 * - **stdout 只认 JSON 行**：不少服务会往 stdout 打横幅/日志，解析不了的行忽略；
 * - **超时即拆会话**：协议状态不明时留着进程只会让下一次调用继续挂；
 * - **孤儿进程不允许存在**：应用退出（Node exit/SIGINT/SIGTERM 钩子）与显式 stop
 *   都会连同**子进程树**一起杀（npx 是真服务进程的祖辈，只杀一层会留孤儿）。
 *
 * 本文件不 import electron（vitest 直接拿它起真进程做用例，见 tests/mcpStdio.test.ts）；
 * electron 那一侧（当前用户 / 目录 / 版本）由 electron/mcp/ipc.ts 经 McpStdioCtx 注入。
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process'
import type {
  McpStdioCallResult,
  McpStdioContentItem,
  McpStdioServerPayload,
  McpStdioTool,
  McpStdioToolsResult,
} from '../../shared/ipc'

/** 调用方（IPC 层）注入的上下文：cwd、客户端版本与两个超时（测试会缩短它们） */
export interface McpStdioCtx {
  /** 服务进程的工作目录（IPC 层传数据根目录：相对参数如 `./workspace` 有明确的落点） */
  cwd: string
  /** initialize 里报的客户端版本（clientInfo.version，用应用版本） */
  clientVersion: string
  /** initialize 的超时（毫秒）：npx 冷启动可能要下载包，给足 */
  initTimeoutMs?: number
  /** 一次请求（tools/list / tools/call）的超时（毫秒） */
  requestTimeoutMs?: number
}

/** MCP 协议版本（2024-11-05 是各家 SDK 都认的那一版；服务端回它自己支持的那份，不校验） */
const PROTOCOL_VERSION = '2024-11-05'
const DEFAULT_INIT_TIMEOUT_MS = 60_000
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
/** stderr 尾巴保留的行数 */
const STDERR_TAIL_LINES = 20
/** 报错回执里实际带出的 stderr 行数 */
const STDERR_REPORT_LINES = 6

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface McpSession {
  /** 配置指纹（同 id 不同配置 = 不同会话） */
  key: string
  serverId: string
  serverName: string
  child: ChildProcess
  /** initialize 完成的信号：完成前所有调用都在这里等 */
  ready: Promise<void>
  nextId: number
  pending: Map<number, Pending>
  buffer: string
  stderrTail: string[]
  /** 进程已退出（或启动失败）时的一句话原因；一旦有值，后续请求直接报它 */
  deadReason: string | null
  /** 主动关掉的会话（kill 之后 exit 事件不再当作故障处理） */
  exited: boolean
  initTimeoutMs: number
  requestTimeoutMs: number
}

const sessions = new Map<string, McpSession>()
/** 正在创建中的会话（并发调用同一服务时只起一个进程） */
const creating = new Map<string, Promise<McpSession>>()

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/* ---------- 进程与清理 ---------- */

/** 杀死进程及其子进程树（与 base/process 同一套：npx 是服务进程的祖辈，只杀一层会留孤儿） */
function killProcessTree(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
    } else {
      try {
        process.kill(-pid)
      } catch {
        process.kill(pid)
      }
    }
  } catch {
    // 进程可能已自行退出，忽略异常
  }
}

/** 主动关一个会话：杀进程树、拒掉还在等的请求；exit 事件随后到达时不再当故障 */
function killSession(session: McpSession): void {
  session.exited = true
  if (session.child.pid && !session.child.killed) killProcessTree(session.child.pid)
  const reason = 'MCP 服务「' + session.serverName + '」的会话已关闭'
  for (const [, p] of session.pending) {
    clearTimeout(p.timer)
    p.reject(new Error(reason))
  }
  session.pending.clear()
}

/** 会话故障（超时 / 进程没了 / 握手失败）：钉上原因、拒掉所有等待者、杀掉进程 */
function fail(session: McpSession, reason: string): void {
  const r = session.deadReason ?? reason
  session.deadReason = r
  for (const [, p] of session.pending) {
    clearTimeout(p.timer)
    p.reject(new Error(r))
  }
  session.pending.clear()
  if (!session.exited) killSession(session)
}

/** 停掉某个服务（或全部）的会话：用户禁用 / 删除服务、改配置后由调用方触发 */
export function stopMcpSessions(serverId?: string): void {
  for (const [key, s] of sessions) {
    if (serverId !== undefined && s.serverId !== serverId) continue
    killSession(s)
    sessions.delete(key)
  }
}

/** 应用退出时全量清理（级联杀掉全部 MCP 子进程，绝不留孤儿） */
export function cleanupAllMcpSessions(): void {
  stopMcpSessions()
}

// 与 base/process 同款的进程级退出钩子
process.once('exit', cleanupAllMcpSessions)
process.once('SIGINT', cleanupAllMcpSessions)
process.once('SIGTERM', cleanupAllMcpSessions)

/* ---------- 起进程 ---------- */

/**
 * 起一个子进程；Windows 上「裸名找不到」时补 `.cmd` + shell 再试一次
 * （npx / npm 这一类都是 .cmd 包装：见文件头的纪律一）。
 */
async function spawnChild(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<ChildProcess> {
  const isWin = process.platform === 'win32'
  const merged = { ...process.env, ...env }
  const attempt = (cmd: string, shell: boolean): Promise<ChildProcess> =>
    new Promise((resolve, reject) => {
      let settled = false
      const child = spawn(cmd, args, { cwd, env: merged, shell, stdio: ['pipe', 'pipe', 'pipe'] })
      child.once('spawn', () => {
        if (settled) return
        settled = true
        resolve(child)
      })
      child.once('error', (err) => {
        if (settled) return
        settled = true
        reject(err)
      })
    })

  const needsShell = /\.(cmd|bat)$/i.test(command)
  try {
    return await attempt(command, isWin && needsShell)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // 裸名（无路径、无扩展名）在 Windows 上找不到时，按 .cmd 包装再试一次
    const retryable = isWin && code === 'ENOENT' && !/[\\/.]/.test(command)
    if (!retryable) throw err
    return await attempt(command + '.cmd', true)
  }
}

/* ---------- JSON-RPC ---------- */

function fingerprintOf(server: McpStdioServerPayload): string {
  const env = Object.entries(server.env ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => k + '=' + v)
    .join('\n')
  return [server.id, server.command, (server.args ?? []).join('\u0000'), env].join('\u0001')
}

function stderrTailText(session: McpSession): string {
  if (!session.stderrTail.length) return ''
  return '\n[stderr]\n' + session.stderrTail.slice(-STDERR_REPORT_LINES).join('\n')
}

function onStderr(session: McpSession, chunk: string): void {
  for (const raw of chunk.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    session.stderrTail.push(line.slice(0, 500))
    if (session.stderrTail.length > STDERR_TAIL_LINES) session.stderrTail.shift()
  }
}

/** stdout 数据：按行拆、逐行解析；非 JSON 行忽略（不少服务会打横幅/日志） */
function onStdout(session: McpSession, chunk: string): void {
  session.buffer += chunk
  let idx: number
  while ((idx = session.buffer.indexOf('\n')) >= 0) {
    const line = session.buffer.slice(0, idx).trim()
    session.buffer = session.buffer.slice(idx + 1)
    if (!line) continue
    let msg: { id?: unknown; result?: unknown; error?: { message?: string } }
    try {
      msg = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof msg.id !== 'number') continue
    const pending = session.pending.get(msg.id)
    if (!pending) continue
    session.pending.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.error) {
      pending.reject(new Error(msg.error.message || '服务端返回错误：' + JSON.stringify(msg.error)))
    } else {
      pending.resolve(msg.result)
    }
  }
}

function send(session: McpSession, message: Record<string, unknown>): void {
  if (session.exited) throw new Error(session.deadReason ?? '会话已关闭')
  if (!session.child.stdin) throw new Error('MCP 进程没有 stdin 通道')
  session.child.stdin.write(JSON.stringify(message) + '\n')
}

function request(session: McpSession, method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (session.deadReason) {
      reject(new Error(session.deadReason))
      return
    }
    const id = session.nextId++
    const timer = setTimeout(() => {
      // 超时说明协议状态已不可信：拆掉整个会话，下次调用重来（见文件头纪律四）
      const msg = '调用 ' + method + ' 超时（' + Math.round(timeoutMs / 1000) + ' 秒），已重置与该服务的连接'
      fail(session, msg)
      if (sessions.get(session.key) === session) sessions.delete(session.key)
    }, timeoutMs)
    session.pending.set(id, { resolve, reject, timer })
    try {
      send(session, { jsonrpc: '2.0', id, method, params })
    } catch (err) {
      clearTimeout(timer)
      session.pending.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/* ---------- 会话生命周期 ---------- */

function createSession(
  server: McpStdioServerPayload,
  child: ChildProcess,
  key: string,
  ctx: McpStdioCtx,
): McpSession {
  const session: McpSession = {
    key,
    serverId: server.id,
    serverName: server.name || server.id,
    child,
    ready: Promise.resolve(),
    nextId: 1,
    pending: new Map(),
    buffer: '',
    stderrTail: [],
    deadReason: null,
    exited: false,
    initTimeoutMs: ctx.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
    requestTimeoutMs: ctx.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  }
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (d: string) => onStdout(session, d))
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (d: string) => onStderr(session, d))
  child.on('error', (err) => {
    // spawn 阶段的错误由 spawnChild 的 promise 兜住；能到这里的都是运行中出的
    if (session.exited) return
    session.deadReason = session.deadReason ?? 'MCP 服务「' + session.serverName + '」进程出错：' + messageOf(err)
  })
  // 用 'close' 而不是 'exit'：等 stdio 流都收完再报死因，stderr 尾巴才是完整的
  //（'exit' 可能先于最后一段 stderr 到达）。主动关掉的不算故障（exited 已置真）。
  child.on('close', (code, signal) => {
    if (session.exited) return
    fail(
      session,
      'MCP 服务「' + session.serverName + '」进程已退出（code=' + String(code) +
        (signal ? ', signal=' + signal : '') + '）' + stderrTailText(session),
    )
    if (sessions.get(session.key) === session) sessions.delete(session.key)
  })
  return session
}

/** initialize 握手：应答之后按协议补一条 initialized 通知，之后才允许 tools/list */
async function handshake(session: McpSession, clientVersion: string): Promise<void> {
  await request(
    session,
    'initialize',
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'unyra', version: clientVersion },
    },
    session.initTimeoutMs,
  )
  send(session, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
}

async function startSession(server: McpStdioServerPayload, ctx: McpStdioCtx, key: string): Promise<McpSession> {
  // 同一个服务 id 的旧会话（命令 / 参数换过了）先拆：不留下两代进程
  for (const [k, s] of sessions) {
    if (s.serverId === server.id && k !== key) {
      killSession(s)
      sessions.delete(k)
    }
  }
  const child = await spawnChild(
    server.command,
    Array.isArray(server.args) ? server.args.map(String) : [],
    ctx.cwd,
    server.env ?? {},
  ).catch((err: unknown) => {
    // spawn 失败（命令不存在 / 没装 Node 之类）：把「是什么命令、为什么起不来」一次说清
    throw new Error(
      '启动 MCP 服务「' + (server.name || server.id) + '」失败：' + messageOf(err) +
        '（命令：' + server.command + '。请确认本机装了对应运行时，比如 Node/npx）',
    )
  })
  const session = createSession(server, child, key, ctx)
  sessions.set(key, session)
  session.ready = handshake(session, ctx.clientVersion).catch((err) => {
    const reason = '启动 MCP 服务「' + session.serverName + '」失败：' + messageOf(err) + stderrTailText(session)
    fail(session, reason)
    if (sessions.get(key) === session) sessions.delete(key)
    throw new Error(reason)
  })
  await session.ready
  return session
}

/** 取（或建）一个服务会话；同一指纹并发调用共享同一次创建 */
async function ensureSession(server: McpStdioServerPayload, ctx: McpStdioCtx): Promise<McpSession> {
  const key = fingerprintOf(server)
  const existing = sessions.get(key)
  if (existing && !existing.deadReason) {
    await existing.ready
    return existing
  }
  if (existing) sessions.delete(key)
  let pending = creating.get(key)
  if (!pending) {
    pending = startSession(server, ctx, key).finally(() => {
      creating.delete(key)
    })
    creating.set(key, pending)
  }
  return await pending
}

/* ---------- 对外：两个动作（discover / call） ---------- */

function validateServer(server: McpStdioServerPayload | null | undefined): string | null {
  if (!server || typeof server !== 'object') return '没有拿到 MCP 服务配置'
  if (!server.id || !String(server.id).trim()) return 'MCP 服务缺少 id'
  if (typeof server.command !== 'string' || !server.command.trim()) {
    return 'MCP 服务「' + (server.name || server.id) + '」没有配置启动命令（stdio 传输需要 command）'
  }
  return null
}

function normalizeTools(raw: unknown): McpStdioTool[] {
  if (!Array.isArray(raw)) return []
  const out: McpStdioTool[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const t = item as Record<string, unknown>
    const name = typeof t.name === 'string' ? t.name.trim() : ''
    if (!name) continue
    out.push({
      name,
      ...(typeof t.description === 'string' ? { description: t.description } : {}),
      ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
    })
  }
  return out
}

function normalizeContent(raw: unknown): McpStdioContentItem[] {
  if (!Array.isArray(raw)) return []
  const out: McpStdioContentItem[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const type = c.type === 'image' || c.type === 'resource' ? c.type : 'text'
    out.push({
      type,
      ...(typeof c.text === 'string' ? { text: c.text } : {}),
      ...(typeof c.data === 'string' ? { data: c.data } : {}),
      ...(typeof c.mimeType === 'string' ? { mimeType: c.mimeType } : {}),
    })
  }
  return out
}

/**
 * 探测工具清单：起会话（或复用）→ initialize → tools/list。
 * 失败一句话说清（含 stderr 尾巴），渲染层直接展示这句。
 */
export async function mcpStdioDiscover(
  server: McpStdioServerPayload,
  ctx: McpStdioCtx,
): Promise<McpStdioToolsResult> {
  const invalid = validateServer(server)
  if (invalid) return { ok: false, error: invalid }
  try {
    const session = await ensureSession(server, ctx)
    const result = (await request(session, 'tools/list', {}, session.requestTimeoutMs)) as { tools?: unknown }
    return { ok: true, tools: normalizeTools(result?.tools) }
  } catch (err) {
    return { ok: false, error: messageOf(err) }
  }
}

/**
 * 调用一个工具：起会话（或复用）→ tools/call。
 * 服务端把工具执行失败标在 `isError` 上（协议层面不是错误），原样透传——
 * 「工具跑了但业务失败」与「根本没跑起来」在渲染层是两种回显。
 */
export async function mcpStdioCall(
  server: McpStdioServerPayload,
  tool: string,
  args: unknown,
  ctx: McpStdioCtx,
): Promise<McpStdioCallResult> {
  const invalid = validateServer(server)
  if (invalid) return { ok: false, error: invalid }
  const toolName = String(tool ?? '').trim()
  if (!toolName) return { ok: false, error: 'mcp.call 需要工具名' }
  const payload =
    args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  try {
    const session = await ensureSession(server, ctx)
    const result = (await request(
      session,
      'tools/call',
      { name: toolName, arguments: payload },
      session.requestTimeoutMs,
    )) as { content?: unknown; isError?: unknown }
    return { ok: true, isError: result?.isError === true, content: normalizeContent(result?.content) }
  } catch (err) {
    return { ok: false, error: messageOf(err) }
  }
}
