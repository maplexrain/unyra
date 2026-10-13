/**
 * 请求失败后的重试（agent/retry 的判据 + agent/runtime 的重发循环）。
 *
 * 这两块各自都要钉住，理由不同：
 * - 判据（哪类错值得重发）：判错一边是让用户干等五轮，另一边是把一次网络抖动
 *   当成永久失败——而它的输入只是一个错误对象，最好测；
 * - 循环（重发几次、吐出去的半截正文怎么撤）：这是「界面上出现两段拼接的回答」
 *   那种只在真机上才看得见的问题，用假流在测试里跑一遍更省事。
 *
 * 测试环境是 node（见 vitest.config，不引 jsdom），所以这里全是纯逻辑 + 假流。
 */
import { describe, expect, it } from 'vitest'
import { runAgent } from '../src/agent/runtime'
import { MAX_REQUEST_RETRIES, isRetryable, retryDelayMs, sleepMs } from '../src/agent/retry'
import { AiRequestError } from '../src/ai/types'
import { PrefixGateError } from '../src/agent/prefixGate'
import type { ResolvedProvider } from '../src/ai/client'
import type { ChatMessage, StreamChatOptions, StreamChatResult } from '../src/ai/types'
import type { AgentEvent, AgentPart, AgentTool } from '../src/agent/types'
import { applyEvent } from '../src/learn/agent/events'

const provider = { id: 't', label: 'T', baseUrl: 'http://localhost', apiKey: 'k' } as ResolvedProvider
const SYSTEM = '你是导师。'
const executeTool: AgentTool = {
  name: 'execute',
  description: '执行一段 JS',
  parameters: { type: 'object' },
  run: async () => ({ ok: true, content: '（工具回执）' }),
}

/** 没有状态码的失败：网络断了、流读到一半断了都长这样 */
const netError = () => new AiRequestError('网络请求失败，请检查网络连接')

/**
 * 一跳的剧本：`error` 表示这一趟失败（`chunks` 是断掉之前已经吐出去的字）。
 * 失败也算一次调用，因此重试的趟数与剧本里的条目一一对应。
 */
type Step = { content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> } | { chunks?: string[]; error: Error }

function fakeStream(script: Step[]) {
  const requests: ChatMessage[][] = []
  let i = 0
  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    requests.push(JSON.parse(JSON.stringify(opts.messages)))
    const step = script[i++]
    if (!step) throw new Error('剧本不够长：第 ' + (i + 1) + ' 趟没有台词')
    if ('error' in step) {
      // 与真实客户端一致：正文是经 onDelta 一点点吐出来的，断掉时已经吐出去的收不回
      for (const c of step.chunks ?? []) opts.onDelta?.({ content: c })
      throw step.error
    }
    if (step.content) opts.onDelta?.({ content: step.content })
    return {
      content: step.content,
      reasoning: '',
      toolCalls: step.toolCalls ?? [],
      finishReason: 'stop',
    }
  }
  return { requests, stream }
}

/** 按 useAgent 的方式跑一轮：事件既记流水，也累加进 parts */
async function runTurn(script: Step[], extra: Partial<Parameters<typeof runAgent>[0]> = {}) {
  const { requests, stream } = fakeStream(script)
  const parts: AgentPart[] = []
  const events: AgentEvent[] = []
  await runAgent({
    provider,
    model: 'test-model',
    system: SYSTEM,
    messages: [{ role: 'user', content: '讲讲递归' }],
    tools: [],
    ctx: { nodeId: null, goalId: 'g1' },
    stream,
    // 测试里不退避：真等那几档只会拖慢用例
    sleep: async () => {},
    onEvent: (e) => {
      events.push(e)
      applyEvent(parts, e)
    },
    ...extra,
  })
  const retries = events.filter((e) => e.type === 'retry')
  const notices = events.filter((e) => e.type === 'notice')
  const errors = events.filter((e) => e.type === 'error')
  const text = parts
    .filter((p): p is Extract<AgentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
  return { requests, parts, events, retries, notices, errors, text }
}

describe('哪类错值得重发 (isRetryable)', () => {
  it('没有状态码的一律重试（网络 / 超时 / 流断 / 空响应都落在这里）', () => {
    expect(isRetryable(new AiRequestError('网络请求失败，请检查网络连接'))).toBe(true)
    expect(isRetryable(new AiRequestError('响应超时，连接可能已中断'))).toBe(true)
    expect(isRetryable(new AiRequestError('服务未返回数据流'))).toBe(true)
    // 连不是 AiRequestError 的异常也算瞬时故障（默认放行）
    expect(isRetryable(new Error('别的什么错'))).toBe(true)
  })

  it('5xx 与限流类一律重试', () => {
    for (const s of [408, 409, 425, 429, 500, 502, 503, 504, 529]) {
      expect(isRetryable(new AiRequestError('x', s)), 'status ' + s).toBe(true)
    }
  })

  it('请求本身就是错的不重试：重发几次也不会变绿', () => {
    for (const s of [400, 401, 402, 403, 404, 405, 413, 422]) {
      expect(isRetryable(new AiRequestError('x', s)), 'status ' + s).toBe(false)
    }
  })

  it('前缀门禁不重试：那是我们自己的上下文不变量被破坏', () => {
    expect(isRetryable(new PrefixGateError('前缀变了'))).toBe(false)
  })
})

describe('退避的节奏 (retryDelayMs / sleepMs)', () => {
  it('800 → 1600 → 3200，之后封顶 4000', () => {
    expect(retryDelayMs(1)).toBe(800)
    expect(retryDelayMs(2)).toBe(1600)
    expect(retryDelayMs(3)).toBe(3200)
    expect(retryDelayMs(4)).toBe(4000)
    expect(retryDelayMs(5)).toBe(4000)
    expect(retryDelayMs(50)).toBe(4000)
    // 越靠后等得越久，但不会无限涨
    expect(retryDelayMs(1)).toBeLessThanOrEqual(retryDelayMs(2))
    expect(retryDelayMs(9)).toBe(retryDelayMs(5))
  })

  it('等待能被中止打断（用户点了停止不该还要干等一档）', async () => {
    const ac = new AbortController()
    const t0 = Date.now()
    setTimeout(() => ac.abort(), 10)
    await sleepMs(10_000, ac.signal)
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('已经中止过就不再等', async () => {
    const ac = new AbortController()
    ac.abort()
    const t0 = Date.now()
    await sleepMs(10_000, ac.signal)
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('正常等待是真的等了那么久', async () => {
    const t0 = Date.now()
    await sleepMs(20)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10)
  })
})

describe('运行时的重发循环', () => {
  it('网络抖两下：重发后照常答完，正文只有最后那一趟的', async () => {
    const r = await runTurn([{ error: netError() }, { error: netError() }, { content: '讲完了。' }])

    expect(r.requests).toHaveLength(3)
    expect(r.retries).toHaveLength(2)
    expect(r.errors).toHaveLength(0)
    expect(r.text).toBe('讲完了。')
    // 用户该看见「正在重试（第 n/5 次）」，而不是一声不吭地卡住
    expect(r.notices).toHaveLength(2)
    expect(r.events[r.events.length - 1].type).toBe('done')
  })

  it('失败那趟吐出去的半截正文要撤掉，不能和新回答叠成两段', async () => {
    const r = await runTurn([
      { chunks: ['这道题我先', '算一下导数'], error: netError() },
      { content: '完整答案：导数是……' },
    ])
    expect(r.text).toBe('完整答案：导数是……')
    expect(r.text).not.toContain('这道题我先')
  })

  it('重试发的是同一份上下文（前缀缓存不会因此作废）', async () => {
    const r = await runTurn([{ error: netError() }, { error: netError() }, { content: '好。' }])
    expect(r.requests[1]).toEqual(r.requests[0])
    expect(r.requests[2]).toEqual(r.requests[0])
  })

  it('Key 无效这类错：一次就报，不重试', async () => {
    const r = await runTurn([{ error: new AiRequestError('API Key 无效或没有访问权限', 401) }])
    expect(r.requests).toHaveLength(1)
    expect(r.retries).toHaveLength(0)
    expect(r.errors).toHaveLength(1)
    // 没重试过就不必提「已重试 N 次」
    expect(r.errors[0]).toMatchObject({ message: 'API Key 无效或没有访问权限' })
  })

  it('最多重试 5 次：第 6 趟仍失败就收场，并把次数说出来', async () => {
    const r = await runTurn([
      { error: netError() },
      { error: netError() },
      { error: netError() },
      { error: netError() },
      { error: netError() },
      { error: netError() },
    ])
    // 1 次首次 + 5 次重试
    expect(r.requests).toHaveLength(MAX_REQUEST_RETRIES + 1)
    expect(r.retries).toHaveLength(MAX_REQUEST_RETRIES)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toMatchObject({
      message: expect.stringContaining('已重试 5 次仍然失败'),
    })
  })

  it('第 5 次重试成功也算过（用满额度之后的那一趟还能救回来）', async () => {
    const r = await runTurn([
      { error: netError() },
      { error: netError() },
      { error: netError() },
      { error: netError() },
      { error: netError() },
      { content: '第六趟成了。' },
    ])
    expect(r.errors).toHaveLength(0)
    expect(r.text).toBe('第六趟成了。')
    expect(r.retries).toHaveLength(5)
  })

  it('退避期间被中止：按取消收场，不报错也不再发一次', async () => {
    const ac = new AbortController()
    const waits: number[] = []
    const r = await runTurn([{ error: netError() }, { error: netError() }], {
      signal: ac.signal,
      // 第一档退避就把停止按下：后面那趟不该再发出去
      sleep: async (ms) => {
        waits.push(ms)
        ac.abort()
      },
    })
    expect(waits).toEqual([800])
    expect(r.requests).toHaveLength(1)
    expect(r.errors).toHaveLength(0)
    expect(r.events[r.events.length - 1].type).toBe('done')
  })

  /**
   * 预算是**每跳**的，不是每轮的：一轮可能跑几十跳，按轮算的话前几跳就把额度花光，
   * 后面同样一次抖动却直接报错。
   */
  it('重试预算每一跳各自重新计数（第一跳用满也不影响第二跳）', async () => {
    const r = await runTurn(
      [
        { error: netError() },
        { error: netError() },
        { error: netError() },
        { error: netError() },
        { error: netError() },
        {
          content: '先查一下笔记。',
          toolCalls: [{ id: 'call-1', name: 'execute', arguments: '{"body":"read"}' }],
        },
        { error: netError() },
        { error: netError() },
        { content: '查到了，下面开讲。' },
      ],
      { tools: [executeTool] },
    )
    // 第一跳 6 趟（含 5 次重试）+ 第二跳 3 趟（含 2 次重试）
    expect(r.requests).toHaveLength(9)
    expect(r.retries).toHaveLength(7)
    expect(r.errors).toHaveLength(0)
    expect(r.parts.some((p) => p.type === 'tool')).toBe(true)
    expect(r.text).toContain('查到了，下面开讲。')
  })
})
