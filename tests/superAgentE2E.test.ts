/**
 * 三平面 SuperAgent 端到端集成验收测试 (E2E)
 *
 * 验证目标：
 * 1. 真实 3 轮多跳 + 磁盘持久化反序列化冷重启续聊（严格通过 toChatHistory + assertPrefixStable + splitHostUserDisplay）；
 * 2. Worker request_input 挂起审批 + 直连快通道唤醒闭环（严格验证 Host 全程零开销、零唤醒）。
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { SuperAgentEngine, hydrateSuperAgentState } from '../src/agent/super/engine'
import { clearPrefixGatesForTests } from '../src/agent/prefixGate'
import { splitHostUserDisplay } from '../src/agent/super/projection'
import type { SuperAgentEvent } from '../src/agent/super/types'
import type { ResolvedProvider } from '../src/ai/client'
import type { StreamChatOptions, StreamChatResult } from '../src/ai/types'

const testProvider: ResolvedProvider = {
  id: 'mock-provider',
  label: 'Mock Provider',
  baseUrl: 'http://localhost/mock',
  apiKey: 'test-key',
}

interface MockHop {
  content?: string
  reasoning?: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: string
  }>
}

interface ScriptRoute {
  match: string
  hops: MockHop[]
}

function createE2EMockStream(routes: ScriptRoute[]) {
  let hostCalls = 0
  let workerCalls = 0

  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    const sysMsg = opts.messages.find((m) => m.role === 'system')
    const sysText = typeof sysMsg?.content === 'string' ? sysMsg.content : ''
    const isHost = sysText.includes('Frontline Host')
    if (isHost) {
      hostCalls++
    } else {
      workerCalls++
    }

    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
    const userText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : JSON.stringify(lastUser?.content ?? '')

    const route = routes.find((r) => userText.includes(r.match) || sysText.includes(r.match))
    if (!route) {
      throw new Error(`[E2E MockStream] 未匹配到测试剧本路由: ${userText.slice(0, 100)}`)
    }

    const hop = route.hops.shift()
    if (!hop) {
      throw new Error(`[E2E MockStream] 剧本跳步已用尽。匹配规则: ${route.match}`)
    }

    if (hop.reasoning) {
      opts.onDelta?.({ reasoning: hop.reasoning })
    }
    if (hop.content) {
      opts.onDelta?.({ content: hop.content })
    }

    return {
      content: hop.content || '',
      reasoning: hop.reasoning || '',
      toolCalls: hop.toolCalls || [],
      finishReason: 'stop',
    }
  }

  return {
    stream,
    getHostCalls: () => hostCalls,
    getWorkerCalls: () => workerCalls,
  }
}

describe('SuperAgent 真实端到端集成 (Phase 4 E2E)', () => {
  beforeEach(() => {
    clearPrefixGatesForTests()
  })

  it('1. 完整 3 轮多跳调度 + 序列化冷重启续聊 + 严格前缀门禁对齐', async () => {
    const scopeId = 'e2e-scope-1'
    const events: SuperAgentEvent[] = []

    // 剧本设定：
    // Turn 1: Host 派单 (Hop 1 tool_call -> Hop 2 总结)；Worker (Hop 1 text -> 完工)
    // Turn 2: 重启后续聊，Host 消费回执并回复用户
    // Turn 3: Host 再次派单
    const mock = createE2EMockStream([
      {
        match: '编写微积分极限讲义',
        hops: [
          {
            reasoning: '用户需要系统讲义，我来调用 spawn_worker 委派后台工单。',
            toolCalls: [
              {
                id: 'call_spawn_1',
                name: 'spawn_worker',
                arguments: JSON.stringify({
                  title: '极限讲义调研',
                  goal: '编写微积分第一章极限核心讲义',
                  tags: ['微积分', '极限'],
                }),
              },
            ],
          },
          {
            content: '已为您创建工单「极限讲义调研」，后台工坊已开始独立推演。',
          },
        ],
      },
      {
        match: '微积分第一章极限核心讲义',
        hops: [
          {
            content: '# 第一章 极限的概念\n\n极限是微积分的核心基石，描述变量无限接近时的行为。',
          },
        ],
      },
      {
        match: '讲义写好了吗',
        hops: [
          {
            reasoning: '我看到了头部注入的后台回执，工单已完成并产出了讲义，我直接向用户汇报。',
            content: '后台工坊已完成极限讲义的编写，内容已沉淀为产物，您可以随时查阅！',
          },
        ],
      },
      {
        match: '再出两道练习题',
        hops: [
          {
            reasoning: '需要练习题，再次派发后台工单。',
            toolCalls: [
              {
                id: 'call_spawn_2',
                name: 'spawn_worker',
                arguments: JSON.stringify({
                  title: '极限练习题编写',
                  goal: '出两道极限相关的典型考题',
                  tags: ['习题'],
                }),
              },
            ],
          },
          {
            content: '已为您创建练习题编写工单。',
          },
        ],
      },
      {
        match: '出两道极限相关的典型考题',
        hops: [
          {
            content: '1. 计算 lim (x->0) sin(x)/x\n2. 证明极限的唯一性。',
          },
        ],
      },
    ])

    // --- Turn 1: 发起派单 ---
    const engine1 = new SuperAgentEngine({
      id: scopeId,
      provider: testProvider,
      model: 'deepseek-chat',
      chatFn: mock.stream,
      onEvent: (e) => events.push(e),
    })

    await engine1.sendUserMessage('帮我编写微积分极限讲义')

    // 确认 Host 完成单轮调度
    expect(engine1.getState().hostMessages.length).toBe(2) // user + assistant
    const workers = Object.values(engine1.getState().workers)
    expect(workers.length).toBe(1)
    const worker1 = workers[0]
    expect(worker1.title).toBe('极限讲义调研')

    // 等待 Worker 异步完成
    let waitLoops = 0
    while (worker1.status === 'running' && waitLoops < 20) {
      await new Promise((r) => setTimeout(r, 20))
      waitLoops++
    }
    expect(worker1.status).toBe('done')
    expect(worker1.artifacts.length).toBe(1)
    expect(engine1.getState().mailbox.length).toBe(1)
    expect(engine1.getState().mailbox[0].title).toBe('极限讲义调研')

    // --- 模拟 Electron 冷重启 ---
    // 1. 将状态序列化为 JSON 字符串
    const savedJson = JSON.stringify(engine1.getState())
    // 2. 清空进程内存前缀门禁记录（模拟应用退出重启）
    clearPrefixGatesForTests()
    // 3. 反序列化并调用 hydrateSuperAgentState 归一化
    const reloadedState = hydrateSuperAgentState(JSON.parse(savedJson))
    expect(reloadedState.mailbox.length).toBe(1)

    // 重建新实例
    const engine2 = new SuperAgentEngine({
      id: scopeId,
      initialState: reloadedState,
      provider: testProvider,
      model: 'deepseek-chat',
      chatFn: mock.stream,
      onEvent: (e) => events.push(e),
    })

    // --- Turn 2: 冷重启后发消息，验证自动拼头注入与展示剥离 ---
    await engine2.sendUserMessage('讲义写好了吗？')

    // 验证 Mailbox 被原子消费
    expect(engine2.getState().mailbox.length).toBe(0)

    // 验证第 2 轮 user 消息
    const turn2UserMsg = engine2.getState().hostMessages[2]
    expect(turn2UserMsg.role).toBe('user')
    const rawPayload = turn2UserMsg.parts.find((p) => p.type === 'text')?.text || ''
    expect(rawPayload).toContain('【后台工作回执（共 1 项）】')
    expect(rawPayload).toContain('极限讲义调研')

    // 验证展示剥离函数 splitHostUserDisplay 保留干净用户气泡
    const display = splitHostUserDisplay(rawPayload)
    expect(display.userText).toBe('讲义写好了吗？')
    expect(display.mailboxCount).toBe(1)

    // --- Turn 3: 连续对话，严格验证前缀门禁在多轮历史下的稳定性 ---
    await engine2.sendUserMessage('再出两道练习题')

    const workersAfterTurn3 = Object.values(engine2.getState().workers)
    expect(workersAfterTurn3.length).toBe(2)

    // 等待第 2 个 Worker 完成
    waitLoops = 0
    while (workersAfterTurn3[1].status === 'running' && waitLoops < 20) {
      await new Promise((r) => setTimeout(r, 20))
      waitLoops++
    }
    expect(workersAfterTurn3[1].status).toBe('done')
  })

  it('2. Worker request_input 挂起审批 + 直连快通道唤醒闭环（Host 零开销零唤醒）', async () => {
    const scopeId = 'e2e-scope-2'
    const events: SuperAgentEvent[] = []

    // 剧本设定：
    // Host 派单生成试卷；Worker Hop 1 调用 request_input 提问；
    // 直连快通道回复答案后，Worker Hop 2 产出最终交付正文
    const mock = createE2EMockStream([
      {
        match: '生成高数试卷',
        hops: [
          {
            reasoning: '派单给专职试卷编排工坊。',
            toolCalls: [
              {
                id: 'call_spawn_exam',
                name: 'spawn_worker',
                arguments: JSON.stringify({
                  title: '高数期末卷编排',
                  goal: '编排一份高等数学期末测试卷',
                }),
              },
            ],
          },
          {
            content: '已派发试卷编排工单。',
          },
        ],
      },
      {
        match: '高等数学期末测试卷',
        hops: [
          {
            reasoning: '需要向用户确认是否需要包含多元微积分的大题。',
            toolCalls: [
              {
                id: 'call_req_input',
                name: 'request_input',
                arguments: JSON.stringify({
                  question: '请问本份试卷需要包含多元函数偏导与二重积分大题吗？',
                }),
              },
            ],
          },
        ],
      },
      {
        match: '需要包含多元微积分',
        hops: [
          {
            reasoning: '收到用户明确答复，开始生成完整试卷。',
            content: '# 高等数学期末测试卷\n\n一、极限计算\n二、多元函数偏导大题\n三、二重积分计算',
          },
        ],
      },
    ])

    const engine = new SuperAgentEngine({
      id: scopeId,
      provider: testProvider,
      model: 'deepseek-chat',
      chatFn: mock.stream,
      onEvent: (e) => events.push(e),
    })

    // Turn 1: Host 派单
    await engine.sendUserMessage('生成高数试卷')
    const hostCallsBefore = mock.getHostCalls()

    // 找到新启动的 Worker
    const workers = Object.values(engine.getState().workers)
    expect(workers.length).toBe(1)
    const worker = workers[0]

    // 等待 Worker 执行到 request_input 挂起
    let waitLoops = 0
    while (worker.status === 'running' && waitLoops < 20) {
      await new Promise((r) => setTimeout(r, 20))
      waitLoops++
    }

    // 严格断言：Worker 进入 waiting_input 状态，且提取到挂起提问
    expect(worker.status).toBe('waiting_input')
    expect(worker.waitingPrompt).toBe('请问本份试卷需要包含多元函数偏导与二重积分大题吗？')
    expect(events.some((e) => e.type === 'worker-need-input')).toBe(true)

    // 严格断言：在此期间 Host 绝未被唤醒（调 Host 次数完全不变）
    expect(mock.getHostCalls()).toBe(hostCallsBefore)

    // --- 直连快通道回复，唤醒 Worker ---
    await engine.sendUserMessage('需要包含多元微积分大题', { targetWorkerId: worker.id })

    // 严格断言：向直连通道发消息，Host 依然绝未被唤醒！
    expect(mock.getHostCalls()).toBe(hostCallsBefore)

    // 等待 Worker 恢复执行并收口完成
    waitLoops = 0
    while (worker.status !== 'done' && waitLoops < 20) {
      await new Promise((r) => setTimeout(r, 20))
      waitLoops++
    }

    // 验证 Worker 顺利交付
    expect(worker.status).toBe('done')
    expect(worker.chatText).toContain('多元函数偏导大题')
    expect(worker.artifacts.length).toBe(1)

    // 完工后静默入队 mailbox
    expect(engine.getState().mailbox.length).toBe(1)
    expect(engine.getState().mailbox[0].status).toBe('done')
  })
})
