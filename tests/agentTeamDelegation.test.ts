// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationMessage } from '../src/agent/types'
import { toChatHistory } from '../src/learn/agent/history'
import {
  agentStatus,
  armAwake,
  createDelegation,
  delegationTurnText,
  listAgents,
  onAgentTeamTurnStarted,
  onConversationTurnClosed,
  resetAgentTeamRegistry,
  setAgentTeamDispatcher,
  takeDeliveryInjection,
  type AgentDelegation,
  type AgentTeamDispatcher,
} from '../src/learn/agentTeam/delegations'
import { createTeamOps } from '../src/learn/ops/team'
import type { AgentProfileId } from '../src/agent/agentProfile'

/** 派发器 mock 组装：可按需覆写各探针 */
function makeDispatcher(over: Partial<AgentTeamDispatcher> = {}): AgentTeamDispatcher & {
  startTurn: ReturnType<typeof vi.fn>
  isConversationRunning: ReturnType<typeof vi.fn>
  resolveTargetConversation: ReturnType<typeof vi.fn>
} {
  const startTurn = vi.fn()
  const isConversationRunning = vi.fn(() => false)
  const resolveTargetConversation = vi.fn((agent: AgentProfileId, _goalId?: string | null) => (agent === 'tutor' ? 'tutor-conv' : 'free-conv'))
  return { startTurn, isConversationRunning, resolveTargetConversation, ...over } as never
}

function delegateNow(input: {
  fromConversationId?: string
  toAgent?: AgentProfileId
  toConversationId?: string
  instruction?: string
  preemptibleUntil?: number
  now?: number
}): AgentDelegation {
  return createDelegation({
    fromAgent: 'tutor',
    fromConversationId: input.fromConversationId ?? 'from-conv',
    toAgent: input.toAgent ?? 'tutor',
    toConversationId: input.toConversationId ?? 'target-conv',
    goalId: 'goal-1',
    instruction: input.instruction ?? '整理本周笔记',
    preemptibleUntil: input.preemptibleUntil ?? 0,
    now: input.now ?? 10_000,
  }).delegation
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAgentTeamRegistry()
  setAgentTeamDispatcher(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('team.delegate 插队算法（从队尾往前找可越过尾段）', () => {
  it('全部已到期 = 排队尾（新委托自己的窗口不影响自己的落位）', () => {
    const spy = vi.fn()
    setAgentTeamDispatcher(() => makeDispatcher({ isConversationRunning: () => true, startTurn: spy }))
    // 目标忙碌：登记不启动（startTurn 不被调）
    const a = delegateNow({ preemptibleUntil: 0, now: 10_000 })
    expect(a.status).toBe('pending')
    expect(spy).not.toHaveBeenCalled()
    const b = delegateNow({ preemptibleUntil: 0, now: 10_000 })
    // a、b 都已到期（preemptibleUntil=0 < now）：c 只能排到队尾——
    // d 自己声明了很长的允许期也没用（那是给「后来的委托」越过它用的）
    const c = delegateNow({ preemptibleUntil: 0, now: 10_000 })
    const d = delegateNow({ preemptibleUntil: 10_000 + 60_000, now: 10_000 })
    expect(agentStatus('tutor').pending.map((p) => p.id)).toEqual([a.id, b.id, c.id, d.id])
  })

  it('全部在允许期内：新委托插队到最前', () => {
    setAgentTeamDispatcher(() => makeDispatcher({ isConversationRunning: () => true }))
    const x = delegateNow({ preemptibleUntil: 70_000, now: 10_000 })
    // y 自己也在允许期内：登记时即越过 x
    const y = delegateNow({ preemptibleUntil: 70_000, now: 10_000 })
    expect(agentStatus('tutor').pending.map((p) => p.id)).toEqual([y.id, x.id])
    // z 越过 x、y 插到最前
    const z = delegateNow({ preemptibleUntil: 0, now: 20_000 })
    expect(agentStatus('tutor').pending.map((p) => p.id)).toEqual([z.id, y.id, x.id])
  })

  it('尾段在允许期内、前段已到期：新委托越过尾段、不越前段', () => {
    setAgentTeamDispatcher(() => makeDispatcher({ isConversationRunning: () => true }))
    const solid1 = delegateNow({ preemptibleUntil: 0, now: 10_000 })
    const solid2 = delegateNow({ preemptibleUntil: 0, now: 10_000 })
    const soft1 = delegateNow({ preemptibleUntil: 70_000, now: 10_000 })
    // soft2 自己也在允许期内：登记时同样越过 soft1（后来的插队的口径一致）
    const soft2 = delegateNow({ preemptibleUntil: 70_000, now: 10_000 })
    // 从队尾往前：soft2、soft1 都在允许期内可被越过；solid2 已到期即停 → 插在 solid2 之后
    const jumper = delegateNow({ preemptibleUntil: 0, now: 20_000 })
    expect(agentStatus('tutor').pending.map((p) => p.id)).toEqual([solid1.id, solid2.id, jumper.id, soft2.id, soft1.id])
    expect(jumper.preemptibleUntil).toBe(0)
    expect(soft1.preemptibleUntil).toBe(70_000)
  })
})

describe('team.delegate 启动与 team.complete 交付回传', () => {
  it('目标空闲：登记即启动（process 口径）；complete 回传给空闲的委托者（激活）', () => {
    const dispatcher = makeDispatcher()
    setAgentTeamDispatcher(() => dispatcher)
    const d = delegateNow({ instruction: '出一份随堂小测' })
    // 目标空闲 → 立即启动
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(1)
    const start = dispatcher.startTurn.mock.calls[0]?.[0] as { conversationId: string; kind: string; delegation: AgentDelegation }
    expect(start).toMatchObject({ conversationId: 'target-conv', kind: 'process' })
    expect(start.delegation.id).toBe(d.id)
    expect(d.status).toBe('running')
    // 委托者（from-conv）空闲 → complete 激活它
    const completeOps = createTeamOps({ teamFrom: () => ({ conversationId: 'target-conv', agent: 'tutor', goalId: 'goal-1' }) })
    const r = completeOps.complete({ result: '小测已出好，共 5 题。' })
    expect(r).toMatchObject({ ok: true, delivered: 'activated' })
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(2)
    const deliverCall = dispatcher.startTurn.mock.calls[1]?.[0] as { conversationId: string; kind: string; delegation: AgentDelegation }
    expect(deliverCall).toMatchObject({ conversationId: 'from-conv', kind: 'deliver' })
    expect(deliverCall.delegation.result).toContain('小测已出好')
    expect(d.status).toBe('done')
  })

  it('委托者运行中：交付进注入缓冲，由委托者当前轮的跳边界取走', () => {
    const dispatcher = makeDispatcher({ isConversationRunning: (conv) => conv === 'from-conv' })
    setAgentTeamDispatcher(() => dispatcher)
    delegateNow({ instruction: '查一个资料' })
    const completeOps = createTeamOps({ teamFrom: () => ({ conversationId: 'target-conv', agent: 'tutor', goalId: 'goal-1' }) })
    const r = completeOps.complete({ result: '查到了：……' })
    // 委托者正在跑 → 注入缓冲（当前轮单次 loop 结束后插入）
    expect(r).toMatchObject({ ok: true, delivered: 'injected' })
    const injection = takeDeliveryInjection('from-conv')
    expect(injection?.text).toContain('查到了')
    expect(takeDeliveryInjection('from-conv')).toBeNull()
  })

  it('缓冲未消费就收口：交付转激活（不丢）', () => {
    const dispatcher = makeDispatcher({ isConversationRunning: (conv) => conv === 'from-conv' })
    setAgentTeamDispatcher(() => dispatcher)
    delegateNow({})
    const completeOps = createTeamOps({ teamFrom: () => ({ conversationId: 'target-conv', agent: 'tutor', goalId: 'goal-1' }) })
    void completeOps.complete({ result: '结果文本' })
    // 委托者那一轮没再进下一跳就收口了 → 缓冲转激活
    onConversationTurnClosed('from-conv', { now: 20_000 })
    expect(dispatcher.startTurn).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'from-conv', kind: 'deliver' }))
  })

  it('complete 校验：承接会话不匹配 / 重复收口都拒绝', () => {
    setAgentTeamDispatcher(() => makeDispatcher())
    delegateNow({})
    const wrongOps = createTeamOps({ teamFrom: () => ({ conversationId: 'not-target', agent: 'tutor', goalId: 'goal-1' }) })
    expect(wrongOps.complete({ result: 'x' })).toMatchObject({ ok: false })
    const rightOps = createTeamOps({ teamFrom: () => ({ conversationId: 'target-conv', agent: 'tutor', goalId: 'goal-1' }) })
    expect(rightOps.complete({ result: '交付' })).toMatchObject({ ok: true })
    expect(rightOps.complete({ result: '再交付一次' })).toMatchObject({ ok: false })
  })
})

describe('收口没 complete：提醒 → 重试 → 作废', () => {
  it('连续三轮没收口：两次回队首以提醒口径再启动，第三次作废并告知委托者', () => {
    const dispatcher = makeDispatcher()
    setAgentTeamDispatcher(() => dispatcher)
    delegateNow({ instruction: '做个总结' })
    expect(dispatcher.startTurn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'process' }))
    // 第一轮收口没 complete → 记一次尝试、回队首、空闲启动用提醒口径
    onConversationTurnClosed('target-conv', { now: 11_000 })
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(2)
    expect(dispatcher.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'remind', conversationId: 'target-conv' }))
    // 第二轮同样 → 提醒再启动
    onConversationTurnClosed('target-conv', { now: 12_000 })
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(3)
    expect(dispatcher.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'remind' }))
    // 第三轮仍没收口 → 作废，失败结果传回委托者（激活）
    onConversationTurnClosed('target-conv', { now: 13_000 })
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(4)
    const last = dispatcher.startTurn.mock.calls[3]?.[0] as { conversationId: string; kind: string; delegation: AgentDelegation }
    expect(last).toMatchObject({ conversationId: 'from-conv', kind: 'deliver' })
    expect(last.delegation.status).toBe('failed')
    expect(last.delegation.result).toContain('作废')
  })

  it('仅聊天承接方：收口即自动交付（最后一条回复就是交付结果）', () => {
    const dispatcher = makeDispatcher({ resolveTargetConversation: (agent) => (agent === 'free' ? 'free-conv' : 'tutor-conv') })
    setAgentTeamDispatcher(() => dispatcher)
    delegateNow({ toAgent: 'free', toConversationId: 'free-conv', instruction: '闲聊一个问题' })
    expect(dispatcher.startTurn).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'free-conv', kind: 'process' }))
    onConversationTurnClosed('free-conv', { now: 11_000, autoCompleteResult: '这是仅聊天的回答全文' })
    const deliverCall = dispatcher.startTurn.mock.calls[1]?.[0] as { conversationId: string; kind: string; delegation: AgentDelegation }
    expect(deliverCall).toMatchObject({ conversationId: 'from-conv', kind: 'deliver' })
    expect(deliverCall.delegation.result).toBe('这是仅聊天的回答全文')
  })

  it('目标还有排队中的委托：一轮收口后空闲接续下一条', () => {
    const dispatcher = makeDispatcher()
    setAgentTeamDispatcher(() => dispatcher)
    const first = delegateNow({ instruction: '任务一' })
    const second = delegateNow({ instruction: '任务二' })
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(1)
    // 第一条完成收口：先触发交付激活（委托者空闲）→ 再空闲接续第二条
    const completeOps = createTeamOps({ teamFrom: () => ({ conversationId: 'target-conv', agent: 'tutor', goalId: 'goal-1' }) })
    void completeOps.complete({ id: first.id, result: '任务一完成' })
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(2)
    expect(dispatcher.startTurn).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: 'from-conv', kind: 'deliver' }))
    onConversationTurnClosed('target-conv', { now: 20_000 })
    const thirdCall = dispatcher.startTurn.mock.calls[2]?.[0] as { kind: string; delegation: AgentDelegation }
    expect(thirdCall).toMatchObject({ kind: 'process', delegation: { id: second.id } })
  })
})

describe('team.awake（收口后延迟自启动）', () => {
  it('计时从本轮收口才开始，到点自启动', () => {
    const dispatcher = makeDispatcher()
    setAgentTeamDispatcher(() => dispatcher)
    armAwake('some-conv', 30_000, 1_000)
    // 本轮还没收口：不到点
    vi.advanceTimersByTime(60_000)
    expect(dispatcher.startTurn).not.toHaveBeenCalled()
    // 收口 → 才开始计时
    onConversationTurnClosed('some-conv', { now: 1_000 })
    vi.advanceTimersByTime(29_999)
    expect(dispatcher.startTurn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(dispatcher.startTurn).toHaveBeenCalledWith({ conversationId: 'some-conv', kind: 'awake' })
  })

  it('期间启动过则失效：到点不再自启动', () => {
    const dispatcher = makeDispatcher()
    setAgentTeamDispatcher(() => dispatcher)
    armAwake('some-conv', 30_000, 1_000)
    onConversationTurnClosed('some-conv', { now: 1_000 })
    // 期间用户发消息 / 委托激活触发了新一轮
    onAgentTeamTurnStarted('some-conv')
    vi.advanceTimersByTime(60_000)
    expect(dispatcher.startTurn).not.toHaveBeenCalled()
  })
})

describe('team.ops 探针（Node 裸跑）', () => {
  it('list / status 在无派发器时也能答；delegate 无承接会话时优雅拒绝', () => {
    const ops = createTeamOps({ teamFrom: () => ({ conversationId: 'from-conv', agent: 'tutor', goalId: 'goal-1' }) })
    expect(ops.list()).toMatchObject({ ok: true, agents: [{ id: 'free' }, { id: 'tutor' }, { id: 'examiner' }, { id: 'grader' }, { id: 'researcher' }] })
    expect(listAgents().map((a) => a.id)).toEqual(['free', 'tutor', 'examiner', 'grader', 'researcher'])
    const st = ops.status('tutor') as { ok: boolean; isRunning: boolean; pendingCount: number }
    expect(st).toMatchObject({ ok: true, isRunning: false, pendingCount: 0 })
    expect((ops.status('ghost') as { ok: boolean }).ok).toBe(false)
    // 无派发器 → 解析不到承接会话 → 优雅拒绝
    expect((ops.delegate({ to: 'tutor', instruction: 'x' }) as { ok: boolean }).ok).toBe(false)
    // 参数校验
    expect((ops.delegate({ to: 'tutor' }) as { ok: boolean }).ok).toBe(false)
    expect((ops.complete({ result: '   ' }) as { ok: boolean }).ok).toBe(false)
    expect((ops.awake('nope') as { ok: boolean }).ok).toBe(false)
    expect((ops.awake(-5) as { ok: boolean }).ok).toBe(false)
    expect((ops.awake({ seconds: 3 }) as { ok: boolean }).ok).toBe(true)
    expect((ops.awake(1_500) as { ok: boolean }).ok).toBe(true)
  })

  it('delegate 走通全链：排队 → 启动 → complete 交付 → 队列清空', () => {
    const dispatcher = makeDispatcher()
    setAgentTeamDispatcher(() => dispatcher)
    const delegatorOps = createTeamOps({ teamFrom: () => ({ conversationId: 'from-conv', agent: 'tutor', goalId: 'goal-1' }) })
    const r = delegatorOps.delegate({ to: 'tutor', instruction: '检查今日学习打卡', preemptibleMs: 60_000 }) as {
      ok: boolean
      id: string
      position: number
    }
    expect(r.ok).toBe(true)
    expect(r.position).toBe(0)
    expect(dispatcher.startTurn).toHaveBeenCalledTimes(1)
    // 承接方收口（承接会话就是解析出的 tutor-conv）
    const delegateeOps = createTeamOps({ teamFrom: () => ({ conversationId: 'tutor-conv', agent: 'tutor', goalId: 'goal-1' }) })
    const done = delegateeOps.complete({ result: '今日打卡已完成 3/5。' }) as { ok: boolean; delivered: string }
    expect(done.ok).toBe(true)
    expect(done.delivered).toBe('activated')
    const st = delegatorOps.status('tutor') as { ok: boolean; processing: unknown; pendingCount: number }
    expect(st.processing).toBeNull()
    expect(st.pendingCount).toBe(0)
  })
})

describe('委托交付的跳边界注入：历史镜像逐字节重放', () => {
  it('team-delivery 片段还原成一条 user 消息，位置与 runtime 实发一致', () => {
    const msg: ConversationMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: '正在处理' },
        { type: 'hop' },
        { type: 'tool', id: 't1', name: 'execute', args: '{}', result: 'ok', ok: true, status: 'done' },
        // 注入发生在这一跳的边界：实发侧 pushInjection('user') 恒为 user
        { type: 'team-delivery', delegationId: 'd1', text: '委托交付全文XYZ' },
        { type: 'hop' },
        { type: 'text', text: '收到交付，继续干活' },
      ],
      ts: 1,
    }
    const history = toChatHistory([msg])
    expect(history).toEqual([
      { role: 'assistant', content: '正在处理' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'execute', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'ok' },
      // 实发侧 pushInjection('user') 在此处插入的，就是这条
      { role: 'user', content: '委托交付全文XYZ' },
      { role: 'assistant', content: '收到交付，继续干活' },
    ])
  })
})

describe('启动轮指令口径', () => {
  it('process / remind / deliver / awake 各说各的话', () => {
    const d = delegateNow({ instruction: '整理本周笔记并出一份小测' })
    const process = delegationTurnText('process', d)
    expect(process).toContain('整理本周笔记并出一份小测')
    expect(process).toContain('team.complete')
    const remind = delegationTurnText('remind', d)
    expect(remind).toContain('尚未收口')
    const deliver = delegationTurnText('deliver', { ...d, status: 'done', result: '全部完成' })
    expect(deliver).toContain('全部完成')
    const awake = delegationTurnText('awake')
    expect(awake).toContain('自启动')
  })
})
