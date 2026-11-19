import { describe, expect, it, beforeEach } from 'vitest'
import { SuperAgentEngine } from '../src/agent/super/engine'
import { clearPrefixGatesForTests } from '../src/agent/prefixGate'
import type { ResolvedProvider } from '../src/ai/client'
import type { StreamChatOptions, StreamChatResult } from '../src/ai/types'
import type { SuperAgentEvent } from '../src/agent/super/types'

const testProvider: ResolvedProvider = {
  id: 'mock-provider',
  label: 'Mock Provider',
  baseUrl: 'http://localhost/mock',
  apiKey: 'test-key',
}

interface MockHop {
  content?: string
  reasoning?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
}

interface ScriptRoute {
  match: string
  hops: MockHop[]
}

/**
 * 构建可按关键词路由的 Mock Stream 替身
 */
function createMockStream(routes: ScriptRoute[]) {
  let hostCalls = 0
  let workerCalls = 0
  const historyLog: Array<{ system: string; messages: any[] }> = []

  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    const sysMsg = opts.messages.find((m) => m.role === 'system')
    const sysText = typeof sysMsg?.content === 'string' ? sysMsg.content : ''
    historyLog.push({
      system: sysText,
      messages: JSON.parse(JSON.stringify(opts.messages)),
    })

    const isHost = sysText.includes('Frontline Host')
    if (isHost) {
      hostCalls++
    } else {
      workerCalls++
    }

    // 寻找最近的一条 user 消息（多跳 ReAct 中最后一条消息可能是 tool 结果）
    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
    const text = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')

    const route = routes.find((r) => text.includes(r.match) || sysText.includes(r.match))
    if (!route) {
      throw new Error(`[MockStream] 未匹配到测试剧本路由。最后 user 消息: ${text.slice(0, 100)}`)
    }

    const hop = route.hops.shift()
    if (!hop) {
      throw new Error(`[MockStream] 剧本跳步已用尽。匹配规则: ${route.match}`)
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
    getHistoryLog: () => historyLog,
  }
}

describe('SuperAgent 三平面架构内核 (Phase 1)', () => {
  beforeEach(() => {
    clearPrefixGatesForTests()
  })

  it('1. Fast Path 零调度直答：简单问答由 Host 直接回复，不创建 Worker', async () => {
    const events: SuperAgentEvent[] = []
    const mock = createMockStream([
      {
        match: '1+1等于几',
        hops: [{ content: '1+1等于2。这是简单的数学公理。' }],
      },
    ])

    const engine = new SuperAgentEngine({
      provider: testProvider,
      model: 'test-model',
      chatFn: mock.stream,
      onEvent: (e) => events.push(e),
    })

    await engine.sendUserMessage('你好，请问1+1等于几？')

    const state = engine.getState()
    expect(mock.getHostCalls()).toBe(1)
    expect(mock.getWorkerCalls()).toBe(0)
    expect(Object.keys(state.workers)).toHaveLength(0)

    const textDeltas = events.filter((e) => e.type === 'host-text-delta').map((e: any) => e.delta)
    expect(textDeltas.join('')).toContain('1+1等于2')
    expect(state.hostMessages).toHaveLength(2)
  })

  it('2. 异步派单 + 零拷贝直出 + 静默入队 + Cache门禁稳定通过', async () => {
    const events: SuperAgentEvent[] = []

    const mock = createMockStream([
      // Host 第一次被触发：识别需要编写大纲，发起 spawn_worker
      {
        match: '请帮我编写微积分大纲',
        hops: [
          {
            toolCalls: [
              {
                id: 'call-1',
                name: 'spawn_worker',
                arguments: JSON.stringify({
                  title: '微积分大纲编写',
                  goal: '梳理极限与导数两章的教学大纲',
                  tags: ['微积分', '大纲'],
                }),
              },
            ],
          },
          {
            content: '已为您委派微积分专员，后台正在全力整理大纲。',
          },
        ],
      },
      // Worker 专员执行剧本
      {
        match: '梳理极限与导数两章的教学大纲',
        hops: [
          {
            reasoning: '正在梳理知识图谱...',
            content: '### 微积分大纲成果\n1. 极限的本质\n2. 导数与变化率',
          },
        ],
      },
      // 用户第 2 轮发问：Host 消费 mailbox 后的第二次触发
      {
        match: '大纲完成了吗',
        hops: [
          {
            content: '微积分专员已经完成了大纲输出，主要包含极限的本质与导数两大部分。',
          },
        ],
      },
    ])

    const engine = new SuperAgentEngine({
      provider: testProvider,
      model: 'test-model',
      chatFn: mock.stream,
      onEvent: (e) => events.push(e),
    })

    // 第一轮：派单（Host 经历 2 跳：第 1 跳调用 spawn_worker，第 2 跳告诉用户已派单）
    await engine.sendUserMessage('请帮我编写微积分大纲')

    // 验证 Host 第一轮即刻结束，且 Host 在本轮内完成 2 跳
    expect(mock.getHostCalls()).toBe(2)

    // 等待 Worker 异步完成
    await new Promise((resolve) => setTimeout(resolve, 50))

    const state = engine.getState()
    const workers = Object.values(state.workers)
    expect(workers).toHaveLength(1)
    const worker = workers[0]
    expect(worker.status).toBe('done')
    expect(worker.chatText).toContain('### 微积分大纲成果')
    expect(worker.artifacts).toHaveLength(1)

    // 验证零拷贝直推事件到达前端
    const chatDeltas = events.filter((e) => e.type === 'worker-chat-delta').map((e: any) => e.delta)
    expect(chatDeltas.join('')).toContain('### 微积分大纲成果')

    // 验证回执静默入队 Mailbox 与黑板更新
    expect(state.mailbox).toHaveLength(1)
    expect(state.mailbox[0].title).toBe('微积分大纲编写')
    expect(state.mailbox[0].status).toBe('done')
    expect(state.blackboard).toHaveLength(1)
    expect(state.blackboard[0].tags).toContain('微积分')

    // 关键断言：此时 Host 的 LLM 调用次数依然为 2（绝对没有因为 Worker 完成而自动唤醒 Host！）
    expect(mock.getHostCalls()).toBe(2)

    // 第二轮：用户再次提问，验证 mailbox 拼入 user 消息头，且前缀门禁零报错通过
    await engine.sendUserMessage('大纲完成了吗？')

    expect(mock.getHostCalls()).toBe(3)
    // 验证 mailbox 已被一次性消费清空
    expect(engine.getState().mailbox).toHaveLength(0)

    // 检查第 2 轮发给 Host 的 user 消息内容包含了回执头
    const lastUserMsg = engine.getState().hostMessages[2]
    expect(lastUserMsg.parts[0].type).toBe('text')
    const userPayload = (lastUserMsg.parts[0] as any).text
    expect(userPayload).toContain('【后台工作回执（共 1 项）】')
    expect(userPayload).toContain('微积分大纲编写')
    expect(userPayload).toContain('大纲完成了吗？')
  })

  it('3. 双 Worker 并发 + 运行中跳边界 steer_worker', async () => {
    let unblockHop1: () => void
    const hop1Barrier = new Promise<void>((resolve) => {
      unblockHop1 = resolve
    })

    const mock = createMockStream([
      // Worker 1: 带着工具调用，等待屏障放行
      {
        match: '并发任务1',
        hops: [
          {
            toolCalls: [
              {
                id: 'tc-w1',
                name: 'mock_tool',
                arguments: '{}',
              },
            ],
          },
          {
            content: '第一阶段完成，收到补充指令后接着做。',
          },
        ],
      },
      // Worker 1 消费介入指令后的下一跳
      {
        match: '请加上第二阶段要求',
        hops: [
          {
            content: '已根据补充指令完成最终交付。',
          },
        ],
      },
      // Worker 2: 独立并行任务
      {
        match: '并发任务2',
        hops: [
          {
            content: '任务2已极速完成。',
          },
        ],
      },
    ])

    const dummyTool = {
      name: 'mock_tool',
      description: '测试假工具',
      parameters: { type: 'object' },
      run: async () => {
        await hop1Barrier
        return { ok: true, content: 'ok' }
      },
    }

    const engine = new SuperAgentEngine({
      provider: testProvider,
      model: 'test-model',
      chatFn: mock.stream,
      createWorkerTools: () => [dummyTool],
    })

    const w1 = engine.spawnWorker({ title: '任务1', goal: '并发任务1' })
    const w2 = engine.spawnWorker({ title: '任务2', goal: '并发任务2' })

    expect(w1.status).toBe('running')
    expect(w2.status).toBe('running')

    // 在 w1 还在运行过程中，向其插队指令
    const steerRes = engine.steerWorker(w1.workerId, '请加上第二阶段要求')
    expect(steerRes.ok).toBe(true)

    // 放行 w1 的第一跳
    unblockHop1!()

    // 等待两项任务都收口
    await new Promise((resolve) => setTimeout(resolve, 80))

    const state = engine.getState()
    expect(state.workers[w1.workerId].status).toBe('done')
    expect(state.workers[w2.workerId].status).toBe('done')
    expect(state.workers[w1.workerId].chatText).toContain('已根据补充指令完成最终交付')
    expect(state.workers[w2.workerId].chatText).toContain('任务2已极速完成')
  })

  it('4. 直连快通道：带 targetWorkerId 直接驱动目标 Worker，Host 调用次数为 0', async () => {
    const mock = createMockStream([
      {
        match: '最初任务',
        hops: [{ content: '初稿已完成。' }],
      },
      {
        match: '再精简成两句话',
        hops: [{ content: '已精简：要点一与要点二。' }],
      },
    ])

    const engine = new SuperAgentEngine({
      provider: testProvider,
      model: 'test-model',
      chatFn: mock.stream,
    })

    const { workerId } = engine.spawnWorker({ title: '写作专员', goal: '最初任务' })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(mock.getHostCalls()).toBe(0)
    expect(mock.getWorkerCalls()).toBe(1)

    // 通过直连快通道发送指令
    await engine.sendUserMessage('再精简成两句话', { targetWorkerId: workerId })
    await new Promise((resolve) => setTimeout(resolve, 30))

    // 验证：Host 依然一次都没被调用
    expect(mock.getHostCalls()).toBe(0)
    expect(mock.getWorkerCalls()).toBe(2)
    expect(engine.getState().workers[workerId].chatText).toContain('已精简：要点一与要点二')
  })

  it('5. 黑板检索 (query_blackboard) 与跨 Worker 产物引用 (inputArtifactIds)', async () => {
    const mock = createMockStream([
      // Host 检索黑板并派发新任务
      {
        match: '基于之前的笔记出题',
        hops: [
          {
            toolCalls: [
              {
                id: 'call-q',
                name: 'query_blackboard',
                arguments: JSON.stringify({ query: '线性代数' }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: 'call-s',
                name: 'spawn_worker',
                arguments: JSON.stringify({
                  title: '线性代数考卷',
                  goal: '根据前置大纲出 3 道矩阵题',
                  inputArtifactIds: ['art-linear-1'],
                }),
              },
            ],
          },
          {
            content: '已为您创建考卷编写任务，已关联先前的线性代数大纲产物。',
          },
        ],
      },
      // 新 Worker 响应剧本
      {
        match: '根据前置大纲出 3 道矩阵题',
        hops: [
          {
            content: '已参考前置产物，题目如下：1. 计算矩阵特征值...',
          },
        ],
      },
    ])

    const engine = new SuperAgentEngine({
      provider: testProvider,
      model: 'test-model',
      chatFn: mock.stream,
      initialState: {
        workers: {
          'w-prev': {
            id: 'w-prev',
            title: '线性代数大纲整理',
            goal: '梳理特征值大纲',
            status: 'done',
            messages: [],
            chatText: '线性代数大纲正文...',
            artifacts: [
              {
                id: 'art-linear-1',
                workerId: 'w-prev',
                title: '线代大纲',
                content: '第1节：行列式；第2节：矩阵特征值',
                kind: 'text',
                updatedAt: Date.now(),
              },
            ],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
        blackboard: [
          {
            workerId: 'w-prev',
            title: '线性代数大纲整理',
            goal: '梳理特征值大纲',
            status: 'done',
            summary: '产出线代大纲',
            artifactIds: ['art-linear-1'],
            tags: ['线性代数', '大纲'],
            updatedAt: Date.now(),
          },
        ],
      },
    })

    await engine.sendUserMessage('请基于之前的笔记出题')

    // 等待 Worker 异步完成
    await new Promise((resolve) => setTimeout(resolve, 50))

    const state = engine.getState()
    const newWorker = Object.values(state.workers).find((w) => w.title === '线性代数考卷')
    expect(newWorker).toBeDefined()

    // 验证新 Worker 的第一条输入消息中准确注入了前置产物正文
    const firstMsg = newWorker!.messages[0]
    expect(firstMsg.parts[0].type).toBe('text')
    const firstText = (firstMsg.parts[0] as any).text
    expect(firstText).toContain('【前置产物参考】')
    expect(firstText).toContain('第2节：矩阵特征值')
    expect(newWorker!.chatText).toContain('已参考前置产物')
  })
})
