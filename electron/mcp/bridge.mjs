#!/usr/bin/env node
/**
 * 归一 Unyra 的 MCP 哑桥：把外部 harness（ZCode / Claude Code 等）的 stdio MCP 会话
 * 一比一转发到应用主进程的命名管道上（见 electron/mcp/serve.ts）。
 *
 * harness 配置（mcpServers）：
 *   { "command": "node", "args": ["<本文件路径>"] }
 *
 * 行为：
 * - 读端点文件（%APPDATA%\unyra\mcp-endpoint.json；--endpoint <路径> 或环境变量
 *   UNYRA_MCP_ENDPOINT 可指到别处）拿管道名与 token；
 * - 连上后先发一行 unyra/hello（token 握手）——主进程在握手前收到的任何行都会
 *   被当成非法连接断掉；应用没在跑时本脚本给出可操作的报错并退出；
 * - 之后逐行转发，两端都按行缓冲（一行一条 JSON-RPC，与 MCP stdio 传输一致），
 *   对 harness 完全透明。
 */
import net from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = argv.indexOf('--endpoint')
const endpointFile =
  (flag >= 0 && argv[flag + 1]) ||
  process.env.UNYRA_MCP_ENDPOINT ||
  defaultEndpointFile()

function defaultEndpointFile() {
  if (process.platform === 'win32') return join(process.env.APPDATA || '', 'unyra', 'mcp-endpoint.json')
  if (process.platform === 'darwin') {
    return join(process.env.HOME || '', 'Library', 'Application Support', 'unyra', 'mcp-endpoint.json')
  }
  const config = process.env.XDG_CONFIG_HOME || join(process.env.HOME || '', '.config')
  return join(config, 'unyra', 'mcp-endpoint.json')
}

function fail(message) {
  process.stderr.write('[unyra-mcp] ' + message + '\n')
  process.exit(1)
}

/** 端点文件里带着应用的 pid：进程已经不在了就当场说明，别让 harness 挂在超时上 */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

if (!existsSync(endpointFile)) {
  fail('没找到端点文件 ' + endpointFile + '：归一 Unyra 还没启动（或旧版本还没有对外 MCP 服务）。先把应用打开再连接。')
}
let endpoint
try {
  endpoint = JSON.parse(readFileSync(endpointFile, 'utf8'))
} catch (err) {
  fail('端点文件读不出来（' + (err && err.message ? err.message : String(err)) + '）：' + endpointFile)
}
if (!endpoint || typeof endpoint.pipe !== 'string' || typeof endpoint.token !== 'string') {
  fail('端点文件不完整：' + endpointFile + '。重启一次归一 Unyra 让它重写这份文件。')
}
if (endpoint.pid && !pidAlive(endpoint.pid)) {
  fail('端点文件里的应用进程（pid ' + endpoint.pid + '）已经不在了：这是残留的旧文件。重启归一 Unyra 再连接。')
}

/* ---------- stdin → 管道（按行） ---------- */

let stdinBuf = ''
let socketReady = false
const socket = net.connect(endpoint.pipe)

socket.on('connect', () => {
  socketReady = true
  // token 握手必须排第一：主进程的连接状态机在 hello 之前只认这一条
  socket.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'unyra/hello', params: { token: endpoint.token } }) + '\n',
  )
  flushStdin()
})

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk
  if (socketReady) flushStdin()
})
process.stdin.on('end', () => socket.end())
process.stdin.on('error', () => socket.destroy())

function flushStdin() {
  let idx
  while ((idx = stdinBuf.indexOf('\n')) >= 0) {
    const line = stdinBuf.slice(0, idx)
    stdinBuf = stdinBuf.slice(idx + 1)
    if (line.trim()) socket.write(line + '\n')
  }
}

/* ---------- 管道 → stdout（按行） ---------- */

let pipeBuf = ''
socket.setEncoding('utf8')
socket.on('data', (chunk) => {
  pipeBuf += chunk
  let idx
  while ((idx = pipeBuf.indexOf('\n')) >= 0) {
    const line = pipeBuf.slice(0, idx)
    pipeBuf = pipeBuf.slice(idx + 1)
    if (line.trim()) process.stdout.write(line + '\n')
  }
})

socket.on('error', (err) => {
  fail(
    '连不上归一 Unyra 的管道（' + endpoint.pipe + '）：' +
      (err && err.message ? err.message : String(err)) +
      '。请确认应用正在运行。',
  )
})
socket.on('close', () => process.exit(0))
