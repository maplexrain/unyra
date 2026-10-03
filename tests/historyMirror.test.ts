/**
 * 历史还原与 runtime 实发的**逐跳镜像**测试（前缀缓存能否命中的唯一判据）。
 *
 * 用假流驱动 runAgent 跑完一轮（含工具跳），按 useAgent 的方式累加 parts，
 * 再用 toChatHistory 还原成下一轮的历史——断言「上一轮实发的最后一跳」是
 * 「下一轮请求」的逐字节前缀。任何一处结构对不上，这条测试都会红。
 */
import { describe, expect, it } from 'vitest'
import { runAgent } from '../src/agent/runtime'
import type { ResolvedProvider } from '../src/ai/client'
import type { AgentEvent, AgentPart, AgentTool, ConversationMessage } from '../src/agent/types'
import { applyEvent } from '../src/learn/agent/events'
import { toChatHistory } from '../src/learn/agent/history'
import type { ChatMessage, StreamChatOptions, StreamChatResult } from '../src/ai/types'

const provider = { id: 't', label: 'T', baseUrl: 'http://localhost', apiKey: 'k' } as ResolvedProvider
const SYSTEM = '你是导师。'
const executeTool: AgentTool = {
  name: 'execute',
  description: '执行一段 JS',
  parameters: { type: 'object' },
  run: async () => ({ ok: true, content: '（工具回执）' }),
}

/** 假流：按剧本逐跳返回，并把每一跳实发的 messages 快照记下来 */
function fakeStream(script: Array<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>) {
  const requests: ChatMessage[][] = []
  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    requests.push(JSON.parse(JSON.stringify(opts.messages)))
    const hop = script[requests.length - 1]
    if (!hop) throw new Error('剧本不够长：第 ' + requests.length + ' 跳没有台词')
    // 与真实客户端一致：正文经 onDelta 流出（useAgent 靠它把正文累进 parts）
    if (hop.content) opts.onDelta?.({ content: hop.content })
    return { content: hop.content, reasoning: '', toolCalls: hop.toolCalls ?? [], finishReason: 'stop' }
  }
  return { requests, stream }
}

/** 按 useAgent 的方式把事件累加进 parts（applyEvent 已含 hop 标记的处理） */
async function runTurn(
  script: Parameters<typeof fakeStream>[0],
  userText: string,
): Promise<{ requests: ChatMessage[][]; parts: AgentPart[] }> {
  const { requests, stream } = fakeStream(script)
  const parts: AgentPart[] = []
  await runAgent({
    provider,
    model: 'test-model',
    system: SYSTEM,
    messages: [{ role: 'user', content: userText }],
    tools: [executeTool],
    ctx: { nodeId: 'n1', goalId: 'g1' },
    stream,
    onEvent: (e: AgentEvent) => applyEvent(parts, e),
  })
  return { requests, parts }
}

/** 把「实发过的用户消息 + 累加出的回复 parts」还原成下一轮的历史，并拼上系统提示词 */
function nextTurnRequests(userText: string, parts: AgentPart[]): ChatMessage[] {
  const user: ConversationMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: userText }], ts: 0 }
  const assistant: ConversationMessage = { id: 'a1', role: 'assistant', parts, ts: 0 }
  return [{ role: 'system', content: SYSTEM } as ChatMessage, ...toChatHistory([user, assistant])]
}

describe('toChatHistory 与 runtime 实发的逐跳镜像', () => {
  it('两跳回合（先说一句再调工具）：下一轮历史以最后一跳实发为逐字节前缀', async () => {
    const userText = '讲讲递归'
    const { requests, parts } = await runTurn(
      [
        { content: '让我先读一下笔记。', toolCalls: [{ id: 'call-1', name: 'execute', arguments: '{"body":"read"}' }] },
        { content: '读完了，下面开讲。' },
      ],
      userText,
    )
    expect(requests.length).toBe(2)
    const next = nextTurnRequests(userText, parts)
    const lastHop = requests[1]
    expect(next.length).toBeGreaterThan(lastHop.length)
    expect(next.slice(0, lastHop.length)).toEqual(lastHop)
    // 末尾追加的是最后一跳自己的正文（它当时还没来得及随任何请求发出）
    expect(next[lastHop.length]).toEqual({ role: 'assistant', content: '读完了，下面开讲。' })
  })

  it('同一响应里两次工具调用（一次 push 两条 tool_calls）也要对上', async () => {
    const userText = '把两份笔记都读一遍'
    const { requests, parts } = await runTurn(
      [
        {
          content: '',
          toolCalls: [
            { id: 'call-a', name: 'execute', arguments: '{"body":"read1"}' },
            { id: 'call-b', name: 'execute', arguments: '{"body":"read2"}' },
          ],
        },
        { content: '都读完了。' },
      ],
      userText,
    )
    const lastHop = requests[1]
    // 实发结构：一条 assistant 带两条 tool_calls，紧跟两条 tool 返回
    expect(lastHop[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call-a' }, { id: 'call-b' }] })
    expect(lastHop[3]).toMatchObject({ role: 'tool', tool_call_id: 'call-a' })
    expect(lastHop[4]).toMatchObject({ role: 'tool', tool_call_id: 'call-b' })
    const next = nextTurnRequests(userText, parts)
    expect(next.slice(0, lastHop.length)).toEqual(lastHop)
  })

  it('三跳回合（中间跳也有正文）逐字节对齐', async () => {
    const userText = '写一份大纲'
    const { requests, parts } = await runTurn(
      [
        { content: '先看看节点结构。', toolCalls: [{ id: 'c1', name: 'execute', arguments: '{"body":"list"}' }] },
        { content: '再看看现有文档。', toolCalls: [{ id: 'c2', name: 'execute', arguments: '{"body":"read"}' }] },
        { content: '大纲写好了。' },
      ],
      userText,
    )
    expect(requests.length).toBe(3)
    const next = nextTurnRequests(userText, parts)
    expect(next.slice(0, requests[2].length)).toEqual(requests[2])
  })

  it('没有 hop 标记的旧数据按整轮一段兜底还原（不抛错）', () => {
    const user: ConversationMessage = { id: 'u', role: 'user', parts: [{ type: 'text', text: '问' }], ts: 0 }
    const legacy: ConversationMessage = {
      id: 'a',
      role: 'assistant',
      ts: 0,
      parts: [
        { type: 'tool', id: 'x1', name: 'execute', args: '{}', result: 'r1', ok: true, status: 'done' },
        { type: 'text', text: '答' },
      ],
    }
    const history = toChatHistory([user, legacy])
    expect(history).toHaveLength(3)
    expect(history[1]).toMatchObject({ role: 'assistant', content: '答', tool_calls: [{ id: 'x1' }] })
    expect(history[2]).toMatchObject({ role: 'tool', tool_call_id: 'x1' })
  })

  it('mid-loop 注入的提示词模块：还原时在片段位置补发 user 消息，与实发逐字节前缀', async () => {
    const MODULE = '【提示词模块 · 超级文档】规范全文……'
    const userText = '做个交互小工具'
    let injected = false
    const { requests, stream } = fakeStream([
      { content: '', toolCalls: [{ id: 'call-1', name: 'execute', arguments: '{"body":"sdoc"}' }] },
      { content: '做完了。' },
    ])
    const parts: AgentPart[] = []
    await runAgent({
      provider,
      model: 'test-model',
      system: SYSTEM,
      messages: [{ role: 'user', content: userText }],
      tools: [executeTool],
      ctx: { nodeId: 'n1', goalId: 'g1' },
      stream,
      onEvent: (e: AgentEvent) => applyEvent(parts, e),
      // 与 useAgent 的回调同一套动作：边界上把模块记成回复的片段，文本交回 runtime；
      // 只注一次——key 入账后队列就空了（再注会违反去重，这里如实模拟）
      injections: async () => {
        if (injected) return null
        injected = true
        parts.push({ type: 'prompt-module', key: 'sdoc', text: MODULE })
        return MODULE
      },
    })
    expect(requests.length).toBe(2)
    // 实发：第二跳里模块 user 消息紧跟在工具结果之后
    const lastHop = requests[1]
    expect(lastHop[lastHop.length - 1]).toEqual({ role: 'user', content: MODULE })
    // 还原：模块片段在原位置变成同一条 user 消息，整份历史以最后一跳为逐字节前缀
    const next = nextTurnRequests(userText, parts)
    expect(next.slice(0, lastHop.length)).toEqual(lastHop)
    expect(next[lastHop.length]).toMatchObject({ role: 'assistant', content: '做完了。' })
  })
})
