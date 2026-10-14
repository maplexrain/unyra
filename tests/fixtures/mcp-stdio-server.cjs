#!/usr/bin/env node
/**
 * 测试用的最小 MCP stdio 服务端（tests/mcpStdio.test.ts 的对手方）：
 * 按行读 JSON-RPC、按行回；实现 initialize / tools/list / tools/call 三个方法。
 *
 * 几个专门为用例留的口子：
 * - `--tag <v>`：回显进 `pid` 工具的结果（验证会话复用与「配置变了换进程」）；
 * - `--fail-fast`：收到 initialize 立刻写 stderr 并退出 3（验证「起不来」的回执）；
 * - `kill` 工具：不回执直接退出 9（验证「调用中进程没了」）；
 * - `slow` 工具：2 秒后才回（验证超时即拆会话）；
 * - 启动时往 **stdout** 打一行非 JSON 横幅（真实服务常有的噪声，客户端应忽略）。
 */
const readline = require('node:readline')

const TAG = (() => {
  const i = process.argv.indexOf('--tag')
  return i >= 0 ? String(process.argv[i + 1] ?? '') : ''
})()
const FAIL_FAST = process.argv.includes('--fail-fast')

// 故意打一行非 JSON：客户端应当忽略它而不是把整条流判死
process.stdout.write('mcp-fixture-server starting...\n')

const TOOLS = [
  {
    name: 'echo',
    description: '把 text 原样回显',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'pid',
    description: '回服务进程的 pid 与启动标签（验证会话复用）',
    inputSchema: { type: 'object', properties: {} },
  },
  { name: 'boom', description: '总是失败（工具级 isError）', inputSchema: { type: 'object', properties: {} } },
  { name: 'slow', description: '睡 2 秒再回（验证超时）', inputSchema: { type: 'object', properties: {} } },
  { name: 'kill', description: '不回执直接退出（验证调用中进程没了）', inputSchema: { type: 'object', properties: {} } },
]

const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
const replyError = (id, message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } }) + '\n')

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.method === 'initialize') {
    if (FAIL_FAST) {
      process.stderr.write('fixture: cannot start (模拟配置错误)\n')
      process.exit(3)
    }
    reply(msg.id, {
      protocolVersion: msg.params?.protocolVersion ?? '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'mcp-fixture', version: '0.0.1' },
    })
    return
  }
  if (msg.method === 'notifications/initialized') return
  if (msg.method === 'tools/list') {
    reply(msg.id, { tools: TOOLS })
    return
  }
  if (msg.method === 'tools/call') {
    const name = msg.params?.name
    const args = msg.params?.arguments ?? {}
    if (name === 'echo') return reply(msg.id, { content: [{ type: 'text', text: 'echo:' + String(args.text ?? '') }] })
    if (name === 'pid') return reply(msg.id, { content: [{ type: 'text', text: process.pid + ':' + TAG }] })
    if (name === 'boom') return reply(msg.id, { isError: true, content: [{ type: 'text', text: '炸了：这是工具级失败' }] })
    if (name === 'slow') return setTimeout(() => reply(msg.id, { content: [{ type: 'text', text: 'slow done' }] }), 2000)
    if (name === 'kill') {
      process.stderr.write('fixture: killed by tool\n')
      process.exit(9)
    }
    return replyError(msg.id, '未知工具：' + name)
  }
  if (msg.id !== undefined) replyError(msg.id, '未知方法：' + msg.method)
})
