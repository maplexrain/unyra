/**
 * 子代理并发模型的端到端测试：假流驱动「subagent.run 后台启动 → 并发跑 → wait 收交付」全程。
 *
 * 钉住的行为（见 docs/subagent-architecture.md）：
 * - create 只登记不启动（校验失败不落任何东西）；run 立即返回、任务在后台跑；
 * - **并发**：多个 agent 同时在跑，wait 首个完成即返回（回执附仍在跑清单）；
 * - **挂起队列**：交付时没人在听就挂起，下一次 wait 把积压的一起领走；
 * - **等待超时**：到点没人交付返回 timedOut（监督回路的触发点），view 看得到过程；
 * - **介入**：指令在「当前消息完整」的边界插入（半段落库 + 指令入账），绝不打断半截输出；
 *   撞上「无工具调用」的收口时，最终消息补进历史、指令接着跑；
 * - **中断与恢复**：interrupt 在下一个边界生效；resume 从断点接着跑；
 * - 会话复用：第二单任务的第一跳请求，以上一次实发为逐字节前缀（镜像纪律）；
 * - execute 的 apiAllow 通道口硬校验（子代理永远拿不到 subagent 组——不递归）；
 * - 持久化归一化：孤儿会话剪掉、残留「运行中」复位「被中断」。
 */
import { describe, expect, it } from 'vitest'
import { createSubAgentManager, type SubAgentManagerDeps } from '../src/agent/subagent/manager'
import { normalizeSubBucket, createSession, withTaskMessage } from '../src/agent/subagent/registry'
import type { SubAgentBucket, SubAgentDef } from '../src/agent/types'
import { createExecuteTool } from '../src/agent/sandbox/execute'
import type { SandboxOptions, SandboxRequest, SandboxReply } from '../src/agent/sandbox/types'
import type { ResolvedProvider } from '../src/ai/client'
import type { ChatMessage, StreamChatOptions, StreamChatResult } from '../src/ai/types'
import type { AgentPart } from '../src/agent/types'
import { applyEvent } from '../src/learn/agent/events'

const provider = { id: 't', label: 'T', baseUrl: 'http://localhost', apiKey: 'k' } as ResolvedProvider

/** 本地定义替身（没有内置子代理）：key 不同、其余一致，api 面 = web + tmp */
const defOf = (key: string): SubAgentDef => ({
  key,
  name: '代理' + key,
  system: '检索与筛选代理：搜到、读到、交付一份带来源的结论。交付纪律写在这里，长度足以通过校验。',
  apiGroups: ['web', 'tmp'],
})

/** create 的参数版本（接口类型没有索引签名，摊开成字面量才能对上 Record） */
const defArg = (key: string): Record<string, unknown> => ({ ...defOf(key) })

/** 一次工具调用的跳：execute 调 web.search（越权时落到 doc.read，被白名单拦下） */
const toolHop = (id: string) => ({
  content: '',
  toolCalls: [
    { id, name: 'execute', arguments: JSON.stringify({ description: '查', body: '((api)=>{ return await api.web.search("勾股定理") })' }) },
  ],
})

interface Hop {
  content: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
}

/**
 * 假流：按最后一条 user 消息里的任务关键词路由各自的剧本（并发的多场任务互不串台），
 * 并记下每一跳实发的 messages（前缀镜像断言用）。
 */
function taskStream(routes: Array<{ match: string; hops: Hop[] }>) {
  const requests: ChatMessage[][] = []
  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    requests.push(JSON.parse(JSON.stringify(opts.messages)))
    // 按最后一条 user 消息路由：任务的续单、介入的指令都各自有台词
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
    const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')
    const route = routes.find((h) => text.includes(h.match))
    if (!route) throw new Error('没有匹配的剧本：' + text.slice(0, 80))
    const hop = route.hops.shift()
    if (!hop) throw new Error('剧本用完了：' + text.slice(0, 80))
    if (hop.content) opts.onDelta?.({ content: hop.content })
    return { content: hop.content, reasoning: '', toolCalls: hop.toolCalls ?? [], finishReason: 'stop' }
  }
  return { requests, stream }
}

/** 沙箱基座：web 组是真的假（可观察调用）；hang 存在时工具调用会挂起（模拟长任务），直到它落地 */
function makeSandboxBase(calls: string[], hang?: Promise<unknown>): SandboxOptions {
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
    runSandbox: async (req: SandboxRequest): Promise<SandboxReply> => {
      const want = /web\.search\(([^)]*)\)/.exec(req.body)
      const name = want ? 'web.search' : 'doc.read'
      calls.push('callApi:' + name)
      if (hang) await hang
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

function makeManager(opts?: { sandbox?: SandboxOptions; stream?: SubAgentManagerDeps['stream'] }) {
  let bucket: SubAgentBucket = { defs: [], sessions: [] }
  const manager = createSubAgentManager({
    getBucket: () => bucket,
    setBucket: (update) => {
      bucket = update(bucket)
    },
    onEvent: () => {},
    ...(opts?.stream ? { stream: opts.stream } : {}),
  })
  manager.setTurn({ sandbox: opts?.sandbox ?? makeSandboxBase([]), provider, model: 'test-model', contextWindow: 100_000 })
  return { manager, bucket: () => bucket }
}
const CTX = { nodeId: null, goalId: '' }
/** 让微任务队列跑干净（后台任务的假流全是即时 resolve，一拍就够） */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

describe('subagent.create', () => {
  it('只登记不启动；校验失败不落任何东西', async () => {
    const { manager, bucket } = makeManager()
    expect((await manager.api.create({ key: '9bad', system: 'key 不合法的定义，写得足够长。' })).error).toBeTruthy()
    expect((await manager.api.create({ key: 'helper', system: '太短' })).error).toContain('太短')
    expect(
      (await manager.api.create({ key: 'helper2', system: '一个想拿 ui 与 ask 的定义，写得足够长。', tools: ['ui', 'ask'] })).error,
    ).toContain('ui、ask')
    expect(bucket().defs).toHaveLength(0)
    expect(bucket().sessions).toHaveLength(0)
    const ok = await manager.api.create({ key: 'worker', name: '工人', system: '一个足够长的系统提示词，写清角色与交付纪律。', tools: ['doc', 'tmp'] })
    expect(ok.ok).toBe(true)
    expect(bucket().defs).toHaveLength(1)
    // 只登记：会话一个都没有（run 才启动）
    expect(bucket().sessions).toHaveLength(0)
    expect(bucket().defs[0]!.apiGroups).toEqual(['doc', 'tmp'])
    // 同 key 再登记即覆盖
    await manager.api.create({ key: 'worker', system: '换一个也足够长的系统提示词，写清新的角色与交付纪律。' })
    expect(bucket().defs).toHaveLength(1)
  })
})

describe('subagent.run / wait（并发与首个完成）', () => {
  it('run 立即返回、任务在后台跑；wait 首个完成即返回并附仍在跑清单', async () => {
    const { stream } = taskStream([
      { match: 'A任务', hops: [{ content: 'A交付', toolCalls: [] }] },
      { match: 'B任务', hops: [{ content: 'B交付', toolCalls: [] }] },
    ])
    const { manager, bucket } = makeManager({ stream })
    await manager.api.create(defArg('a1'))
    await manager.api.create(defArg('b1'))
    const r1 = await manager.api.run({ agent: 'a1', task: '做 A任务' })
    const r2 = await manager.api.run({ agent: 'b1', task: '做 B任务' })
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    // 首个完成者的交付（另一个还在跑）
    const w1 = await manager.api.wait({ seconds: 5 })
    expect(w1.timedOut).toBeUndefined()
    expect(w1.deliveries).toHaveLength(1)
    expect(w1.running).toHaveLength(1)
    // 第二位
    const w2 = await manager.api.wait({ seconds: 5 })
    expect(w2.deliveries).toHaveLength(1)
    expect([w1.deliveries[0]!.agent, w2.deliveries[0]!.agent].sort()).toEqual(['a1', 'b1'])
    expect(w2.running).toHaveLength(0)
    // 都收完了：立即返回空
    const w3 = await manager.api.wait({ seconds: 5 })
    expect(w3.deliveries).toHaveLength(0)
    expect(w3.running).toHaveLength(0)
    // 会话账本：任务 + 回复，交付与次数都在（跑完状态回空闲）
    expect(bucket().sessions).toHaveLength(2)
    for (const s of bucket().sessions) {
      expect(s.runs).toBe(1)
      expect(s.messages).toHaveLength(2)
      expect(s.lastDelivery).toContain('交付')
      expect(s.status).toBe('idle')
    }
  })

  it('交付时没人在听就挂起；下一次 wait 把积压的一起领走', async () => {
    const { stream } = taskStream([
      { match: 'A任务', hops: [{ content: 'A交付', toolCalls: [] }] },
      { match: 'B任务', hops: [{ content: 'B交付', toolCalls: [] }] },
    ])
    const { manager } = makeManager({ stream })
    await manager.api.create(defArg('a1'))
    await manager.api.create(defArg('b1'))
    await manager.api.run({ agent: 'a1', task: '做 A任务' })
    await manager.api.run({ agent: 'b1', task: '做 B任务' })
    // 都跑完了但没人 wait：交付挂起（绝不丢）
    await tick()
    const w = await manager.api.wait({ seconds: 5 })
    expect(w.deliveries).toHaveLength(2)
    expect(w.running).toHaveLength(0)
  })

  it('会话复用：第二单任务的第一跳请求，以上一次实发为逐字节前缀', async () => {
    const { requests, stream } = taskStream([
      { match: '第一批', hops: [{ content: '第一次的交付', toolCalls: [] }] },
      { match: '第二批', hops: [{ content: '第二次的交付', toolCalls: [] }] },
    ])
    const { manager } = makeManager({ stream })
    await manager.api.create(defArg('seq'))
    await manager.api.run({ agent: 'seq', task: '查 第一批' })
    await manager.api.wait({ seconds: 5 })
    await manager.api.run({ agent: 'seq', task: '查 第二批' })
    const w = await manager.api.wait({ seconds: 5 })
    expect(w.deliveries[0]!.delivery).toBe('第二次的交付')
    // 前缀性质：第 2 个请求（第 2 次任务第 1 跳）的消息数组，以第 1 个请求开头——
    // 服务端的前缀缓存认的是消息数组，比对要去掉外层 []
    const prevSeq = JSON.stringify(requests[0]).slice(1, -1)
    const nextSeq = JSON.stringify(requests[1]).slice(1, -1)
    expect(nextSeq.startsWith(prevSeq)).toBe(true)
    // 复用的凭据就是上下文：第二单任务看得到第一单的交付
    expect(JSON.stringify(requests[1])).toContain('第一次的交付')
  })
})

describe('监督回路（超时 / 查看 / 介入 / 中断 / 恢复）', () => {
  it('到点没人交付返回 timedOut；view 看得到在跑的过程；交付后 wait 领回', async () => {
    let release!: () => void
    const gate = new Promise<string>((r) => {
      release = () => r('工具结果')
    })
    const { stream } = taskStream([{ match: '长任务', hops: [toolHop('t1'), { content: '最终交付', toolCalls: [] }] }])
    const { manager } = makeManager({ sandbox: makeSandboxBase([], gate), stream })
    await manager.api.create(defArg('slow'))
    await manager.api.run({ agent: 'slow', task: '做 长任务' })
    const w1 = await manager.api.wait({ seconds: 1 })
    expect(w1.timedOut).toBe(true)
    expect(w1.deliveries).toHaveLength(0)
    expect(w1.running).toEqual([{ agent: 'slow', name: '代理slow' }])
    const v = await manager.api.view('slow')
    expect(v.status).toBe('running')
    expect(JSON.stringify(v.recent)).toContain('长任务')
    release()
    const w2 = await manager.api.wait({ seconds: 5 })
    expect(w2.deliveries).toHaveLength(1)
    expect(w2.deliveries[0]!.delivery).toBe('最终交付')
    expect(w2.running).toHaveLength(0)
  })

  it('介入：指令等当前消息完整后才插入（半段落库 + 指令入账），模型下一跳看到它', async () => {
    let release!: () => void
    const gate = new Promise<string>((r) => {
      release = () => r('工具结果')
    })
    const { requests, stream } = taskStream([
      // 第一跳是工具调用；介入指令插进来之后，续跳的台词挂在指令那条路由下
      { match: '研究任务', hops: [toolHop('t1')] },
      { match: '别挖了', hops: [{ content: '按新口径的交付', toolCalls: [] }] },
    ])
    const { manager, bucket } = makeManager({ sandbox: makeSandboxBase([], gate), stream })
    await manager.api.create(defArg('digger'))
    await manager.api.run({ agent: 'digger', task: '做 研究任务' })
    // 工具还挂着（当前消息没输出完整）：此刻介入，必须排队等边界
    const iv = await manager.api.intervene('digger', '别挖了，换条路：直接给结论。')
    expect(iv.ok).toBe(true)
    release()
    const w = await manager.api.wait({ seconds: 5 })
    expect(w.deliveries[0]!.delivery).toBe('按新口径的交付')
    // 第二跳的请求里，最后一条是介入指令（user 消息）
    const last = requests[1]!
    expect(last[last.length - 1]!.role).toBe('user')
    expect(JSON.stringify(last)).toContain('换条路')
    // 会话账本：任务 → assistant（含工具卡片的半场） → user（介入指令） → assistant（交付）
    const msgs = bucket().sessions[0]!.messages
    expect(msgs).toHaveLength(4)
    expect(msgs[1]!.role).toBe('assistant')
    expect(msgs[1]!.parts.some((p) => p.type === 'tool')).toBe(true)
    expect(msgs[2]!.role).toBe('user')
    expect(JSON.stringify(msgs[2]!.parts)).toContain('换条路')
    expect(msgs[3]!.role).toBe('assistant')
  })

  it('介入撞上「无工具调用」的收口：最终消息补进历史、指令接着跑（不打断已完整的消息）', async () => {
    let release!: (v?: string) => void
    const gate = new Promise<StreamChatResult>((r) => {
      release = () => r({ content: '首答，但还没说完', reasoning: '', toolCalls: [], finishReason: 'stop' })
    })
    const requests: ChatMessage[][] = []
    const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
      requests.push(JSON.parse(JSON.stringify(opts.messages)))
      if (requests.length === 1) {
        // 第一跳捏在手里：正文要经 onDelta 增量给出（运行时的 text 事件只来自增量）
        const result = await gate
        if (result.content) opts.onDelta?.({ content: result.content })
        return result
      }
      const reply = '按介入指令的续答'
      opts.onDelta?.({ content: reply })
      return { content: reply, reasoning: '', toolCalls: [], finishReason: 'stop' }
    }
    const { manager, bucket } = makeManager({ stream })
    await manager.api.create(defArg('talker'))
    await manager.api.run({ agent: 'talker', task: '做 闲聊任务' })
    await manager.api.intervene('talker', '补一句：口径改成 X。')
    release()
    const w = await manager.api.wait({ seconds: 5 })
    expect(w.deliveries[0]!.delivery).toBe('按介入指令的续答')
    // 第二跳请求：[..., assistant(首答), user(介入)]
    const last = requests[1]!
    expect(last[last.length - 2]!.role).toBe('assistant')
    expect(last[last.length - 1]!.role).toBe('user')
    expect(JSON.stringify(last)).toContain('口径改成 X')
    // 会话账本与请求镜像：任务 → assistant(首答) → user(介入) → assistant(续答)
    const msgs = bucket().sessions[0]!.messages
    expect(msgs).toHaveLength(4)
  })

  it('中断在下一个边界生效；resume 从断点接着跑', async () => {
    let release!: () => void
    const gate = new Promise<string>((r) => {
      release = () => r('工具结果')
    })
    const { requests, stream } = taskStream([{ match: '慢任务', hops: [toolHop('t1'), { content: '恢复后的交付', toolCalls: [] }] }])
    const { manager, bucket } = makeManager({ sandbox: makeSandboxBase([], gate), stream })
    await manager.api.create(defArg('pausable'))
    await manager.api.run({ agent: 'pausable', task: '做 慢任务' })
    const stop = await manager.api.interrupt('pausable')
    expect(stop.ok).toBe(true)
    release()
    const w1 = await manager.api.wait({ seconds: 5 })
    expect(w1.deliveries[0]!.status).toBe('interrupted')
    expect(w1.deliveries[0]!.delivery).toBeNull()
    const s = bucket().sessions[0]!
    expect(s.status).toBe('interrupted')
    // 中断时的半场已落库（任务 + 含工具卡片的 assistant）
    expect(s.messages).toHaveLength(2)
    const r = await manager.api.resume('pausable')
    expect(r.ok).toBe(true)
    // resume 的第一跳请求以中断那跳的工具结果收尾（镜像：模型从工具观察处继续）
    expect(requests[1]![requests[1]!.length - 1]!.role).toBe('tool')
    const w2 = await manager.api.wait({ seconds: 5 })
    expect(w2.deliveries[0]!.delivery).toBe('恢复后的交付')
    expect(bucket().sessions[0]!.runs).toBe(2)
  })

  it('删除：删定义与会话，挂起交付一并清掉', async () => {
    const { stream } = taskStream([{ match: '一次性任务', hops: [{ content: '交付了', toolCalls: [] }] }])
    const { manager, bucket } = makeManager({ stream })
    await manager.api.create(defArg('oneshot'))
    await manager.api.run({ agent: 'oneshot', task: '做 一次性任务' })
    await tick()
    expect(bucket().defs).toHaveLength(1)
    const d = await manager.api.remove('oneshot')
    expect(d.ok).toBe(true)
    expect(bucket().defs).toHaveLength(0)
    expect(bucket().sessions).toHaveLength(0)
    const w = await manager.api.wait({ seconds: 5 })
    expect(w.deliveries).toHaveLength(0)
  })

  it('前置条件：run 未登记的 key 指回 create；正在跑的重复 run 被拒；resume/idle 与 intervene/非运行被拒；wait 必带 seconds', async () => {
    let release!: () => void
    const gate = new Promise<string>((r) => {
      release = () => r('工具结果')
    })
    const { stream } = taskStream([{ match: '长任务', hops: [toolHop('t1'), { content: '交付', toolCalls: [] }] }])
    const { manager } = makeManager({ sandbox: makeSandboxBase([], gate), stream })
    expect((await manager.api.run({ agent: 'nope', task: '任务' })).error).toContain('create')
    await manager.api.create(defArg('busy'))
    expect((await manager.api.wait({ seconds: 0 })).error).toContain('seconds')
    expect((await manager.api.wait({})).error).toContain('seconds')
    await manager.api.run({ agent: 'busy', task: '做 长任务' })
    expect((await manager.api.run({ agent: 'busy', task: '再做 长任务' })).error).toContain('正在跑')
    expect((await manager.api.resume('busy')).error).toContain('正在跑')
    expect((await manager.api.intervene('busy', '')).error).toBeTruthy()
    expect((await manager.api.interrupt('nobody')).error).toBeTruthy()
    release()
    await manager.api.wait({ seconds: 5 })
    // 空闲时 resume 不成立（没有可恢复的任务）；介入只对运行中的有意义
    expect((await manager.api.resume('busy')).error).toContain('run')
    expect((await manager.api.intervene('busy', '改方向')).error).toContain('run')
    // 空转的 wait 立即返回空
    const w = await manager.api.wait({ seconds: 5 })
    expect(w.deliveries).toHaveLength(0)
    expect(w.running).toHaveLength(0)
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

  it('子代理的 apiAllow 到不了 subagent 组（不递归在通道口硬挡）', async () => {
    const calls: string[] = []
    const sub = createExecuteTool({ ...makeSandboxBase(calls), apiAllow: ['web', 'tmp'] })
    const r = await sub.run(
      { description: '越权派子代理', body: '((api)=>{ return await api.subagent.run({ agent: "x", task: "y" }) })' },
      CTX,
    )
    expect(r.ok).toBe(false)
    expect(r.content).toContain('只开放了')
  })
})

/**
 * 持久化归一化（parse.ts 在载入时调用）：桶从磁盘回来时防御手改数据与旧版本，
 * 把进程被杀时残留的「运行中」复位为「被中断」，孤儿会话（定义不在了）剪掉。
 */
describe('normalizeSubBucket（载入归一化）', () => {
  it('JSON 往返后形状保持，消息原样回来', () => {
    const def = defOf('searcher')
    const session = withTaskMessage(createSession(def), '任务一').session
    const raw = JSON.parse(JSON.stringify({ defs: [def], sessions: [session] }))
    const back = normalizeSubBucket(raw)
    expect(back).toBeDefined()
    expect(back!.sessions[0]!.defKey).toBe('searcher')
    expect(back!.sessions[0]!.messages).toHaveLength(1)
    expect(back!.sessions[0]!.status).toBe('idle')
  })

  it('孤儿会话剪掉：defKey 没有对应的定义（内置时代的残留）不回来', () => {
    const live = withTaskMessage(createSession(defOf('reader')), '任务').session
    const orphan = withTaskMessage(createSession(defOf('web-search')), '内置时代的任务').session
    const back = normalizeSubBucket({ defs: [defOf('reader')], sessions: [live, orphan] })
    expect(back!.sessions).toHaveLength(1)
    expect(back!.sessions[0]!.defKey).toBe('reader')
    // 全是孤儿 → 整桶不给
    expect(normalizeSubBucket({ defs: [], sessions: [orphan] })).toBeUndefined()
  })

  it('残留的 running 复位为 interrupted（进程被杀时那场任务已经没了）', () => {
    const session = { ...withTaskMessage(createSession(defOf('searcher')), '任务').session, status: 'running' as const }
    const back = normalizeSubBucket({ defs: [defOf('searcher')], sessions: [session] })
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
