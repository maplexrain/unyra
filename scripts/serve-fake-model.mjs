/**
 * 假的 OpenAI 兼容模型：把「模型 → execute → 沙箱 → 结果」这条链路真跑一遍，不花钱、不联网。
 *
 * 为什么值得有一个：这条链路上最容易坏的都是**看不见的那一层**——工具返回值长什么样、
 * 失败时模型究竟看到什么、沙箱里那个 api 到底注册没有。这些只在真发一次请求时才暴露，
 * 而「拿真模型跑一遍」既慢又要花钱，于是很容易被跳过。与 serve-updates.mjs 是同一个思路：
 * 把外部依赖换成照着真实协议写的本地实现，验收才能变成一条随时可跑的命令。
 *
 * 用法（三步）：
 *   1. 写一个剧本文件，默认导出一个数组，每一项要么是
 *        { tool: { description, body } }   → 回一次 execute 工具调用（body 就是要执行的 JS）
 *        { text: '……' }                   → 回一段正文，这一轮结束
 *      每收到一次请求消费一项；剧本的 mtime 变了就把进度归零（改剧本即重跑）。
 *   2. node scripts/serve-fake-model.mjs --script <剧本.mjs> [--port 8799] [--log 日志.jsonl]
 *   3. 在设置里加一个「自定义 · OpenAI 兼容」提供商，地址填 http://127.0.0.1:8799/v1、
 *      模型随便填（/models 会回 fake-model），然后在对话里说一句话。
 *
 * 每次请求都会把「模型这次看到的最后一条工具结果」写进日志——**那是验收的证据**：
 * 工具的返回值到底长什么样，看日志比看界面清楚得多。
 *
 * 注意它**只**做协议回放：不解析 messages、不判断该调哪个工具，剧本写什么就回什么。
 */
import { createServer } from 'node:http'
import { statSync, appendFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const port = Number(arg('--port', '8799'))
const scriptPath = arg('--script', 'steps.mjs')
const logPath = arg('--log', 'node_modules/.tmp/fake-model.jsonl')

let lastMtime = 0
let step = 0
const steps = async () => {
  const mtime = statSync(scriptPath).mtimeMs
  if (mtime !== lastMtime) {
    lastMtime = mtime
    step = 0
  }
  const mod = await import(pathToFileURL(scriptPath).href + '?v=' + mtime)
  return Array.isArray(mod.default) ? mod.default : []
}

const json = (res, code, value) => {
  const body = JSON.stringify(value)
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

const send = (res, obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n')

createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const url = new URL(req.url, 'http://127.0.0.1')

  if (url.pathname.endsWith('/models')) {
    json(res, 200, { object: 'list', data: [{ id: 'fake-model', object: 'model' }] })
    return
  }
  if (!url.pathname.endsWith('/chat/completions')) {
    json(res, 404, { error: { message: '没有这个端点：' + url.pathname } })
    return
  }

  let body = {}
  try { body = JSON.parse(raw) } catch {}
  const messages = Array.isArray(body.messages) ? body.messages : []
  const lastTool = [...messages].reverse().find((m) => m && m.role === 'tool')
  const list = await steps()
  const now = list[step] ?? { text: '（脚本已经用完了，第 ' + (step + 1) + ' 次请求没有对应的步骤）' }
  step++

  appendFileSync(
    logPath,
    JSON.stringify({
      n: step,
      model: body.model,
      toolResult: lastTool ? String(lastTool.content) : null,
      reply: now.tool ? { tool: now.tool.description } : { text: now.text },
    }) + '\n',
  )

  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
  const base = { id: 'fake-' + step, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'fake-model' }
  send(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
  if (now.tool) {
    send(res, {
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_' + step,
                type: 'function',
                function: { name: 'execute', arguments: JSON.stringify({ description: now.tool.description ?? '', body: now.tool.body ?? '' }) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })
    send(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
  } else {
    for (const piece of String(now.text ?? '').match(/[\s\S]{1,24}/g) ?? []) {
      send(res, { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
    }
    send(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  }
  send(res, { ...base, choices: [], usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } })
  res.write('data: [DONE]\n\n')
  res.end()
}).listen(port, '127.0.0.1', () => {
  writeFileSync(logPath, '')
  console.log('假模型就绪：http://127.0.0.1:' + port + '/v1（把提供商的接口地址填成它）')
  console.log('剧本：' + scriptPath + '　日志：' + logPath)
})