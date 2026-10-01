/**
 * 子代理链路的端到端测试：假流驱动「导师工具 → 子代理 runAgent → 交付回填」全程。
 *
 * 钉住的行为（见 docs/subagent-architecture.md）：
 * - 内置子代理不用登记直接派；未登记的 key 报错并列出现有的；
 * - agent_define 的校验（内置不可覆盖 / system 太短 / api 组白名单）；
 * - **只交付最终消息**：中间跳的观察不进 agent_run 的回执，但留在子会话里可以翻；
 * - **会话复用**：第二次任务的第一跳请求，以上一次实发的最后一跳为逐字节前缀
 *   （子会话也过前缀门禁——历史还原与实发的镜像纪律对子代理同样生效）；
 * - fresh 清空重开；中断（信号已废）无交付、状态记为 interrupted；
 * - execute 的 apiAllow 通道口硬校验：名单外的组当场被拒；
 * - **持久化归一化**：桶从磁盘回来时形状不对整桶丢弃、残留「运行中」复位「被中断」。
 */
import { describe, expect, it } from 'vitest'
import { createSubAgentTools, type SubAgentToolDeps } from '../src/agent/subagent/tools'
import { normalizeSubBucket, withTaskMessage, createSession } from '../src/agent/subagent/registry'
import type { SubAgentBucket } from '../src/agent/types'
import { WEB_SEARCH_DEF } from '../src/agent/subagent/builtin'
import { createExecuteTool } from '../src/agent/sandbox/execute'
import type { SandboxOptions, SandboxRequest, SandboxReply } from '../src/agent/sandbox/types'
import type { ResolvedProvider } from '../src/ai/client'
import type { ChatMessage, StreamChatOptions, StreamChatResult } from '../src/ai/types'
import type { AgentPart } from '../src/agent/types'
import { applyEvent } from '../src/learn/agent/events'

const provider = { id: 't', label: 'T', baseUrl: 'http://localhost', apiKey: 'k' } as ResolvedProvider

/**
 * 假流：按剧本逐跳返回，并记下每一跳实发的 messages。
 * 跨任务共用一个实例——requests 序列就是「第 1 次任务的各跳 + 第 2 次任务的各跳」。
 */
function fakeStream(script: Array<{ content: string; toolCalls?: Array<{ id: string; name: string; arguments: string }> }>) {
  const requests: ChatMessage[][] = []
  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    requests.push(JSON.parse(JSON.stringify(opts.messages)))
    const hop = script[requests.length - 1]
    if (!hop) throw new Error('剧本不够长：第 ' + requests.length + ' 跳没有台词')
    if (hop.content) opts.onDelta?.({ content: hop.content })
    return { content: hop.content, reasoning: '', toolCalls: hop.toolCalls ?? [], finishReason: 'stop' }
  }
  return { requests, stream }
}

const searchHop = (id: string) => ({
  content: '',
  toolCalls: [
    { id, name: 'execute', arguments: JSON.stringify({ description: '搜索', body: '((api)=>{ return await api.web.search("勾股定理") })' }) },
  ],
})

/** 沙箱基座：web 组是真的假（可观察调用），doc.* 只有形状（子代理不该碰到） */
function makeSandboxBase(calls: string[]): SandboxOptions {
  return {
    nodeId: () => null,
    resolveNode: () => ({ ok: false, message: '没有这个节点' }),
    resolveDoc: () => ({ ok: false, message: '没有这份文档' }),
    docOps: {} as never,
    nodeOps: {} as never,
    web: {
      fetch: async () => {
        throw new Error('不该在测试里抓网页')
      },
      read: async () => {
        throw new Error('不该在测试里读网页')
      },
      search: async (q: string) => {
        calls.push('web.search:' + q)
        return { ok: true, engine: 'baidu', results: [] }
      },
    },
    // 假执行器：body 里写了 web.search 就调它，否则调 doc.read（越权，应被白名单拦下）
    runSandbox: async (req: SandboxRequest): Promise<SandboxReply> => {
      const want = /web\.search\(([^)]*)\)/.exec(req.body)
      const name = want ? 'web.search' : 'doc.read'
      calls.push('callApi:' + name)
      try {
        return {
          ok: true,
          value: await req.callApi(name, want ? [want[1].replace(/['"]/g, '')] : ['']),
          ms: 1,
        }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  } as SandboxOptions
}

function makeDeps(opts?: { sandbox?: SandboxOptions; signal?: AbortSignal; stream?: SubAgentToolDeps['stream'] }) {
  let bucket: SubAgentBucket = { defs: [], sessions: [] }
  const deps: SubAgentToolDeps & { bucket: () => SubAgentBucket } = {
    conversationId: 'conv1',
    sandbox: opts?.sandbox ?? makeSandboxBase([]),
    provider,
    model: 'test-model',
    contextWindow: 100_000,
    signal: opts?.signal ?? new AbortController().signal,
    getBucket: () => bucket,
    setBucket: (update) => {
      bucket = update(bucket)
    },
    onEvent: () => {},
    ...(opts?.stream ? { stream: opts.stream } : {}),
    bucket: () => bucket,
  }
  return deps
}

type ToolDict = Record<string, ReturnType<typeof createSubAgentTools>[number]>
function toolsDict(deps: SubAgentToolDeps): ToolDict {
  return Object.fromEntries(createSubAgentTools(deps).map((t) => [t.name, t]))
}
const CTX = { nodeId: null, goalId: '' }

describe('agent_define', () => {
  it('内置 key 不可覆盖', async () => {
    const d = toolsDict(makeDeps())
    const r = await d['agent_define']!.run({ key: 'web-search', system: '一个想抢内置名号的定义，写得足够长。' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.content).toContain('内置')
  })

  it('system 太短拒收', async () => {
    const d = toolsDict(makeDeps())
    const r = await d['agent_define']!.run({ key: 'helper', system: '太短' }, CTX)
    expect(r.ok).toBe(false)
  })

  it('api 组白名单外的组拒收', async () => {
    const d = toolsDict(makeDeps())
    const r = await d['agent_define']!.run(
      { key: 'helper', system: '一个想拿 ui 与 ask 的定义，写得足够长。', tools: ['ui', 'ask'] },
      CTX,
    )
    expect(r.ok).toBe(false)
    expect(r.content).toContain('ui、ask')
  })

  it('合法定义落进桶，并出现在 agent_list 里', async () => {
    const deps = makeDeps()
    const d = toolsDict(deps)
    const r = await d['agent_define']!.run(
      { key: 'reader', name: '文档通读', system: '通读长文档并交付结构化摘要的子代理，交付纪律写在这里。', tools: ['doc', 'tmp'] },
      CTX,
    )
    expect(r.ok).toBe(true)
    const list = await d['agent_list']!.run({}, CTX)
    expect(list.content).toContain('reader')
    expect(deps.bucket().defs[0]!.apiGroups).toEqual(['doc', 'tmp'])
  })
})

describe('agent_run', () => {
  it('内置 web-search 不用登记直接派；交付回填、中间过程只留子会话', async () => {
    const calls: string[] = []
    const deps = makeDeps({ sandbox: makeSandboxBase(calls), stream: fakeStream([searchHop('t1'), { content: 'DELIVERY-TEXT：勾股定理是直角三角形的边长关系。', toolCalls: [] }]).stream })
    const d = toolsDict(deps)
    const r = await d['agent_run']!.run({ agent: 'web-search', task: '查一下勾股定理的证明思路' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.content).toContain('DELIVERY-TEXT')
    expect(r.content).toContain('【子代理交付')
    // web.search 真的调到了（apiAllow 放行、注入生效）
    expect(calls).toContain('callApi:web.search')

    const session = deps.bucket().sessions[0]!
    expect(session.runs).toBe(1)
    // 会话里是「任务 + 回复」两条；回复的 parts 里留着工具卡片（中间过程可翻，但不外传）
    expect(session.messages).toHaveLength(2)
    expect(session.messages[0]!.role).toBe('user')
    expect(session.messages[1]!.parts.some((p) => p.type === 'tool')).toBe(true)
    expect(session.lastDelivery).toContain('DELIVERY-TEXT')
  })

  it('只交付最终消息：中间跳的观察不进导师回执', async () => {
    const deps = makeDeps({
      stream: fakeStream([
        { content: 'OBSERVED-SECRET 中间观察', toolCalls: [{ id: 't1', name: 'execute', arguments: '{"description":"查","body":"((api)=>1)"}' }] },
        { content: 'FINAL-DELIVERY', toolCalls: [] },
      ]).stream,
    })
    const d = toolsDict(deps)
    const r = await d['agent_run']!.run({ agent: 'web-search', task: '任务' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.content).toContain('FINAL-DELIVERY')
    expect(r.content).not.toContain('OBSERVED-SECRET')
  })

  it('会话复用：第二次任务的第一跳请求，以上一次实发为逐字节前缀', async () => {
    const calls: string[] = []
    const { requests, stream } = fakeStream([
      searchHop('t1'),
      { content: '第一次的交付', toolCalls: [] },
      searchHop('t3'),
      { content: '第二次的交付', toolCalls: [] },
    ])
    const deps = makeDeps({ sandbox: makeSandboxBase(calls), stream })
    const d = toolsDict(deps)
    await d['agent_run']!.run({ agent: 'web-search', task: '第一个任务' }, CTX)
    await d['agent_run']!.run({ agent: 'web-search', task: '第二个任务' }, CTX)
    expect(deps.bucket().sessions[0]!.runs).toBe(2)
    // 前缀性质：第 3 个请求（第 2 次任务第 1 跳）的消息数组，以第 2 个请求
    // （第 1 次任务最后一跳）的消息数组开头——服务端的前缀缓存认的是消息数组，
    // 比对要去掉外层 []（整串 JSON 比对会被结尾的 ] 与 , 干扰）
    const prevSeq = JSON.stringify(requests[1]).slice(1, -1)
    const nextSeq = JSON.stringify(requests[2]).slice(1, -1)
    expect(nextSeq.startsWith(prevSeq)).toBe(true)
    // 复用的凭据就是上下文：第二次任务看得到第一次的交付
    expect(JSON.stringify(requests[2])).toContain('第一次的交付')
  })

  it('fresh:true 清空上下文重开', async () => {
    const { stream } = fakeStream([
      searchHop('t1'),
      { content: '第一次的交付', toolCalls: [] },
      searchHop('t3'),
      { content: '第二次的交付', toolCalls: [] },
    ])
    const deps = makeDeps({ stream })
    const d = toolsDict(deps)
    await d['agent_run']!.run({ agent: 'web-search', task: '第一个任务' }, CTX)
    const r = await d['agent_run']!.run({ agent: 'web-search', task: '第二个任务', fresh: true }, CTX)
    expect(r.ok).toBe(true)
    const session = deps.bucket().sessions[0]!
    expect(session.messages).toHaveLength(2)
    expect(JSON.stringify(session.messages)).not.toContain('第一个任务')
  })

  it('未登记的 key 报错并列出现有的', async () => {
    const d = toolsDict(makeDeps())
    const r = await d['agent_run']!.run({ agent: 'no-such', task: '任务' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.content).toContain('web-search')
  })

  it('信号已废时：中断、无交付、状态 interrupted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const deps = makeDeps({ signal: ctrl.signal, stream: fakeStream([searchHop('t1'), { content: '不该跑到这里', toolCalls: [] }]).stream })
    const d = toolsDict(deps)
    const r = await d['agent_run']!.run({ agent: 'web-search', task: '任务' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.content).toContain('中止')
    expect(r.content).not.toContain('不该跑到这里')
    expect(deps.bucket().sessions[0]!.status).toBe('interrupted')
  })
})

describe('execute 的 apiAllow 通道口', () => {
  it('名单外的组当场被拒，报错里写明开放了哪些组', async () => {
    const calls: string[] = []
    const sub = createExecuteTool({ ...makeSandboxBase(calls), apiAllow: ['web', 'tmp'] })
    const r = await sub.run({ description: '越权读文档', body: '((api)=>1)' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.content).toContain('只开放了')
  })

  it('名单内的组照常放行', async () => {
    const calls: string[] = []
    const sub = createExecuteTool({ ...makeSandboxBase(calls), apiAllow: ['web', 'tmp'] })
    const r = await sub.run({ description: '搜索', body: '((api)=>{ return await api.web.search("x") })' }, CTX)
    expect(r.ok).toBe(true)
    expect(calls).toContain('callApi:web.search')
  })
})

/**
 * 持久化归一化（parse.ts 在载入时调用）：桶从磁盘回来时防御手改数据与旧版本，
 * 并把进程被杀时残留的「运行中」复位为「被中断」。
 */
describe('normalizeSubBucket（载入归一化）', () => {
  it('JSON 往返后形状保持，消息原样回来', () => {
    const session = withTaskMessage(createSession(WEB_SEARCH_DEF), '任务一').session
    const raw = JSON.parse(JSON.stringify({ defs: [], sessions: [session] }))
    const back = normalizeSubBucket(raw)
    expect(back).toBeDefined()
    expect(back!.sessions[0]!.defKey).toBe('web-search')
    expect(back!.sessions[0]!.messages).toHaveLength(1)
    expect(back!.sessions[0]!.status).toBe('idle')
  })

  it('残留的 running 复位为 interrupted（进程被杀时那场任务已经没了）', () => {
    const session = { ...withTaskMessage(createSession(WEB_SEARCH_DEF), '任务').session, status: 'running' as const }
    const back = normalizeSubBucket({ defs: [], sessions: [session] })
    expect(back!.sessions[0]!.status).toBe('interrupted')
  })

  it('形状不对整桶丢弃；空桶不给', () => {
    expect(normalizeSubBucket('不是对象')).toBeUndefined()
    expect(normalizeSubBucket({ defs: '乱写', sessions: 42 })).toBeUndefined()
    expect(normalizeSubBucket({ defs: [], sessions: [] })).toBeUndefined()
    expect(normalizeSubBucket({ defs: [{ key: 1 }], sessions: [] })).toBeUndefined()
  })
})

/** 事件累加的冒烟：applyEvent 对子代理的事件流同样成立（hop 边界） */
describe('applyEvent on sub transcript', () => {
  it('工具跳与正文跳之间有 hop 边界', () => {
    const parts: AgentPart[] = []
    applyEvent(parts, { type: 'tool-call', id: 't1', name: 'execute', args: '{}' })
    applyEvent(parts, { type: 'tool-result', id: 't1', name: 'execute', result: 'ok', ok: true })
    applyEvent(parts, { type: 'hop' })
    applyEvent(parts, { type: 'text', delta: '交付' })
    // tool-result 原地合并进 tool-call 那一片，不新增
    expect(parts).toHaveLength(3)
    expect(parts[1]!.type).toBe('hop')
    expect(parts[2]!.type).toBe('text')
  })
})
