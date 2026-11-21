/**
 * 这个文件负责什么：**对外 MCP 服务的宿主**——应用本身充当 MCP server。
 * 主进程在命名管道（\\.\pipe\unyra-mcp）上监听，每条连接一个协议实例（./serveProtocol）；
 * tools/call 经 'mcpServe:call' 转发进渲染层的 guest 会话（src/agent/mcp/serveHost）
 * 执行，回执经 'mcpServe:reply' 按 requestId 配对回来。
 *
 * 发现与鉴权：启动时把 { 管道名, token, pid, 版本 } 写进 userData/mcp-endpoint.json，
 * 退出时删除。哑桥（electron/mcp/bridge.mjs）由外部 harness 以 stdio 方式拉起，
 * 读这份文件找到管道、带 token 握手——应用没在跑时桥当场给出可操作的报错。
 *
 * 与 electron/mcp/stdio 的分工：那边是**消费**外部 MCP 服务（渲染层配置的工具源），
 * 这边是**对外提供**——方向相反，互不依赖。
 */
import { app, ipcMain } from 'electron'
import net from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { mainWindow } from '../app/windows'
import { createServeConnection } from './serveProtocol'
import type { McpServeCall, McpServeReply, McpServeEndpoint, McpServeStatus } from '../../shared/ipc'

const PIPE_NAME = '\\\\.\\pipe\\unyra-mcp'
const ENDPOINT_FILE = 'mcp-endpoint.json'
/** 等渲染层回执的总闸：execute 一次编排被沙箱 15 秒上限罩住，api_manual 是纯渲染；
 *  120 秒是给两端都留了余量的上限 */
const FORWARD_TIMEOUT_MS = 120_000
/** 并发连接上限：本地 harness 不会超过一两个，上限只为兜住失控的连接堆积 */
const MAX_CONNECTIONS = 8

let server: net.Server | null = null
let token = ''
let started = false
let connections = 0
/** 开关（渲染层设置是事实源，经 setEnabled 推过来；默认开） */
let enabled = true
/** will-quit 只挂一次：stop/start 循环反复 startMcpServe 时不叠加监听 */
let quitHooked = false
/** 等渲染层回执的挂起表：requestId → resolve/reject + 定时器 */
const pending = new Map<
  string,
  { resolve: (r: McpServeReply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
>()

/** 端点文件的落点：userData 钉死在 %APPDATA%\unyra（见 electron/main.ts），路径稳定 */
function endpointPath(): string {
  return path.join(app.getPath('userData'), ENDPOINT_FILE)
}

function writeEndpoint(): void {
  const info: McpServeEndpoint = { pipe: PIPE_NAME, token, pid: process.pid, version: app.getVersion() }
  try {
    writeFileSync(endpointPath(), JSON.stringify(info, null, 2), 'utf8')
  } catch (err) {
    console.error('[mcp-serve] 端点文件写不进去：', err)
  }
}

/** 把一次 tools/call 转发进渲染层（guest 会话），等回执或超时 */
function forwardCall(tool: string, args: Record<string, unknown>): Promise<McpServeReply> {
  const win = mainWindow()
  if (!win || win.isDestroyed()) {
    return Promise.reject(new Error('应用界面还没就绪（窗口未打开或已销毁），稍后再试。'))
  }
  const requestId = randomUUID()
  const call: McpServeCall = { requestId, tool, args }
  return new Promise<McpServeReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('工具执行超时（' + Math.round(FORWARD_TIMEOUT_MS / 1000) + ' 秒无回执）。'))
    }, FORWARD_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timer })
    win.webContents.send('mcpServe:call', call)
  })
}

/** 渲染层的回执通道：只做配对转发（与其它 ipc 文件同一套约定：逻辑在 serve） */
function onReply(_e: unknown, reply: McpServeReply): void {
  const p = reply && typeof reply.requestId === 'string' ? pending.get(reply.requestId) : undefined
  if (!p) return
  pending.delete(reply.requestId)
  clearTimeout(p.timer)
  p.resolve(reply)
}

export function startMcpServe(): void {
  if (started) return
  started = true
  token = randomBytes(24).toString('hex')
  ipcMain.on('mcpServe:reply', onReply)
  server = net.createServer((socket) => {
    if (connections >= MAX_CONNECTIONS) {
      socket.destroy()
      return
    }
    connections++
    socket.setEncoding('utf8')
    const conn = createServeConnection({
      token,
      version: app.getVersion(),
      callTool: forwardCall,
      close: (reason) => {
        console.log('[mcp-serve] 连接关闭：' + reason)
        socket.destroy()
      },
      write: (line) => socket.write(line + '\n'),
    })
    socket.on('data', (chunk) => conn.feed(String(chunk)))
    socket.on('error', () => conn.end())
    socket.on('close', () => {
      conn.end()
      connections = Math.max(0, connections - 1)
    })
  })
  server.on('error', (err) => {
    console.error('[mcp-serve] 管道服务出错：', err)
  })
  server.listen(PIPE_NAME, () => {
    console.log('[mcp-serve] 对外 MCP 服务已就绪：' + PIPE_NAME)
    writeEndpoint()
  })
  if (!quitHooked) {
    quitHooked = true
    app.once('will-quit', stopMcpServe)
  }
}

export function stopMcpServe(): void {
  if (!started) return
  started = false
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.reject(new Error('应用正在退出，本次调用没有完成。'))
  }
  pending.clear()
  ipcMain.removeListener('mcpServe:reply', onReply)
  try {
    server?.close()
  } catch {
    // 关一个已经断掉的监听不报错
  }
  server = null
  try {
    if (existsSync(endpointPath())) rmSync(endpointPath())
  } catch {
    // 删不掉就留着：文件里带 pid，桥连不上时能给出可读的报错
  }
}

/** 哑桥的当前落点：开发=仓库源文件；打包=asar 解包后的真实文件（普通 Node 读不了 asar） */
function bridgePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'mcp-bridge.mjs')
    : path.join(app.getAppPath(), 'electron', 'mcp', 'bridge.mjs')
}

/**
 * 管理面的两条通道（设置页「对外 MCP 服务」分页用）：
 * - status 随时能问（服务停着也回答）；
 * - setEnabled 由渲染层推（设置是事实源）——关 = 停服删端点文件，开 = 起服写端点文件。
 */
export function registerMcpServeIpc(): void {
  const status = (): McpServeStatus => ({
    enabled,
    listening: started && !!server,
    pipe: PIPE_NAME,
    endpointFile: endpointPath(),
    connections,
    bridgePath: bridgePath(),
    version: app.getVersion(),
  })
  ipcMain.handle('mcpServe:status', () => status())
  ipcMain.handle('mcpServe:setEnabled', (_e, on: unknown) => {
    enabled = on !== false
    if (enabled && !started) startMcpServe()
    if (!enabled && started) stopMcpServe()
    return status()
  })
}
