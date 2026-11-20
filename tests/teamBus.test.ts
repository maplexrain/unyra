/**
 * TeamBus 多 Agent 协作内核测试
 *
 * 核心验证场景：
 * 1. 多实例物理隔离：多 Agent 同时运行，断言各自 prefixGate 独立、Workers/Mailbox 互不干扰；
 * 2. 双层异步协作全闭环（Mentor Host -> TeamBus -> Author Host -> Author Worker -> 静默回执 Mentor）；
 * 3. 三道防死循环护栏：自委派拦截、路径防环拦截、MAX_HOPS=3 拦截；
 * 4. 协作频道路由与静默广播：默认分发 Leader、@精准路由、公告不引发链式闲聊；
 * 5. 角色最小权限白名单验证：各角色 API 白名单物理隔离且全员硬禁 subagent。
 */

import { describe, expect, it, beforeEach } from 'vitest'
import { clearPrefixGatesForTests } from '../src/agent/prefixGate'
import { TeamBus } from '../src/agent/team/teamBus'
import { DEFAULT_TEAM_PROFILES, MULTI_EXPERT_PROFILES } from '../src/agent/team/presets'
import { createTeamHostTools } from '../src/agent/team/teamTools'
import { createSuperWorkerTools } from '../src/learn/superAgent/workerRig'
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

function createTeamMockStream(routes: ScriptRoute[]) {
  const agentCalls: Record<string, number> = {}

  const stream = async (opts: StreamChatOptions): Promise<StreamChatResult> => {
    const sysMsg = opts.messages.find((m) => m.role === 'system')
    const sysText = typeof sysMsg?.content === 'string' ? sysMsg.content : ''

    // 统计调用者（通过唯一前缀识别当前 Agent，防止队友花名册干扰）
    const allProfiles = [...DEFAULT_TEAM_PROFILES, ...MULTI_EXPERT_PROFILES]
    for (const p of allProfiles) {
      if (sysText.includes(`「${p.name}」`)) {
        agentCalls[p.id] = (agentCalls[p.id] || 0) + 1
      }
    }

    const lastUser = [...opts.messages].reverse().find((m) => m.role === 'user')
    const userText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : JSON.stringify(lastUser?.content ?? '')

    const route = routes.find((r) => userText.includes(r.match) || sysText.includes(r.match))
    if (!route) {
      throw new Error(`[TeamMockStream] 未匹配到路由: ${userText.slice(0, 100)}`)
    }

    const hop = route.hops.shift()
    if (!hop) {
      throw new Error(`[TeamMockStream] 跳步耗尽: ${route.match}`)
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
    getAgentCalls: (id: string) => agentCalls[id] || 0,
  }
}

describe('TeamBus 多 Agent 协作内核 (Phase 5)', () => {
  beforeEach(() => {
    clearPrefixGatesForTests()
  })

  it('1. 多实例物理隔离：多 Agent 拥有独立的 state.id、前缀门禁与会话历史', async () => {
    const scopeId = 'test-isolate-scope'
    const mock = createTeamMockStream([
      {
        match: '学习计划',
        hops: [{ content: '总导师已制定计划。' }],
      },
      {
        match: '搜集资料',
        hops: [{ content: '讲义研究员已检索权威资料。' }],
      },
    ])

    const bus = new TeamBus({
      scopeId,
      profiles: MULTI_EXPERT_PROFILES,
      provider: testProvider,
      model: 'mock-model',
      chatFn: mock.stream,
    })

    const mentor = bus.getAgentEngine('agent-mentor')
    const author = bus.getAgentEngine('agent-author')

    expect(mentor).toBeDefined()
    expect(author).toBeDefined()
    expect(mentor!.getState().id).toBe(`${scopeId}:agent-mentor`)
    expect(author!.getState().id).toBe(`${scopeId}:agent-author`)

    // 分别给两个 Agent 发消息
    await bus.sendDirectMessage('agent-mentor', '请给我一个学习计划')
    await bus.sendDirectMessage('agent-author', '请搜集资料')

    // 验证状态隔离
    expect(mentor!.getState().hostMessages.length).toBe(2)
    expect(author!.getState().hostMessages.length).toBe(2)
    expect(mentor!.getState().hostMessages[1].parts[0]).toMatchObject({
      text: '总导师已制定计划。',
    })
    expect(author!.getState().hostMessages[1].parts[0]).toMatchObject({
      text: '讲义研究员已检索权威资料。',
    })
  })

  it('2. 双层异步协作全闭环（Mentor Host -> TeamBus -> Author Host -> Author Worker -> 静默回执 Mentor）', async () => {
    const scopeId = 'test-collab-scope'

    // 设定 4 个路由阶段：
    // 1. Mentor Host 派单给 Author
    // 2. Author Host 接单并 spawn_worker 启动内部工坊
    // 3. Author Worker 执行并产出交付正文
    // 4. 用户下一轮找 Mentor，Mentor 消费回执并总结
    const mock = createTeamMockStream([
      {
        match: '请帮我准备一份微积分极限讲义',
        hops: [
          {
            reasoning: '讲义撰写任务需要委派给讲义研究员',
            toolCalls: [
              {
                id: 'call-del-1',
                name: 'delegate_to_agent',
                arguments: JSON.stringify({
                  targetAgentId: 'agent-author',
                  task: '撰写微积分极限讲义',
                  announceInChannel: true,
                }),
              },
            ],
          },
          {
            content: '已为您安排讲义研究员深入撰写讲义，稍后汇报。',
          },
        ],
      },
      {
        match: '【跨专家协作委派单】',
        hops: [
          {
            reasoning: '收到委派任务，启动内部工坊专职 Worker 编写',
            toolCalls: [
              {
                id: 'call-spawn-1',
                name: 'spawn_worker',
                arguments: JSON.stringify({
                  title: '极限讲义编撰',
                  goal: '撰写微积分极限讲义',
                }),
              },
            ],
          },
          {
            content: '已启动内部工坊专职工单，正在执行撰写。',
          },
        ],
      },
      {
        match: '任务目标：撰写微积分极限讲义',
        hops: [
          {
            content: '## 微积分极限讲义\n这是微积分极限的严格定义与核心例题解析。',
          },
        ],
      },
      {
        match: '讲义写好了吗',
        hops: [
          {
            content: '讲义研究员已交付极限讲义，包含严格定义与核心例题。',
          },
        ],
      },
    ])

    const bus = new TeamBus({
      scopeId,
      profiles: MULTI_EXPERT_PROFILES,
      provider: testProvider,
      model: 'mock-model',
      chatFn: mock.stream,
    })

    const mentor = bus.getAgentEngine('agent-mentor')!
    const author = bus.getAgentEngine('agent-author')!

    // Step 1: 用户发给总导师，总导师异步派发给讲义研究员
    await bus.sendDirectMessage('agent-mentor', '请帮我准备一份微积分极限讲义')

    // 验证总导师 Host 完成且尚未拿到回执（因为是异步派发）
    expect(mentor.getState().hostMessages.length).toBe(2)
    const mentorCallsAfterDispatch = mock.getAgentCalls('agent-mentor')
    expect(mentorCallsAfterDispatch).toBe(2) // Hop 1 (tool) + Hop 2 (text)

    // 等待后台 Author Worker 异步完成与结算
    await new Promise((r) => setTimeout(r, 150))

    // 验证 Author Worker 产出了交付物
    const authorWorkers = Object.values(author.getState().workers)
    expect(authorWorkers.length).toBe(1)
    expect(authorWorkers[0].status).toBe('done')
    expect(authorWorkers[0].artifacts.length).toBe(1)

    // 验证 TeamState 中的委派记录已达终态
    const teamState = bus.getTeamState()
    const delRecord = Object.values(teamState.delegations)[0]
    expect(delRecord).toBeDefined()
    expect(delRecord.status).toBe('done')
    expect(delRecord.fromAgentId).toBe('agent-mentor')
    expect(delRecord.targetAgentId).toBe('agent-author')

    // 验证协作频道记录了派单与交付公告
    expect(teamState.channelMessages.some((m) => m.content.includes('跨专家协作派单'))).toBe(true)
    expect(teamState.channelMessages.some((m) => m.content.includes('协作工单完成交付'))).toBe(true)

    // 关键铁律验证：Author 运行期间，Mentor 的 LLM 调用次数绝不增加（静默入队）
    expect(mock.getAgentCalls('agent-mentor')).toBe(mentorCallsAfterDispatch)
    expect(mentor.getState().mailbox.length).toBe(1)
    const receipt = mentor.getState().mailbox[0]
    expect(receipt.sourceType).toBe('agent')
    expect(receipt.sourceAgentName).toBe('讲义研究员')
    expect(receipt.status).toBe('done')

    // Step 2: 用户下一轮发消息给总导师，总导师自动消费回执并向用户汇报
    await bus.sendDirectMessage('agent-mentor', '讲义写好了吗？')

    // 验证总导师成功消费了 Mailbox 回执，且前缀门禁零报错通过
    expect(mentor.getState().mailbox.length).toBe(0)
    expect(mentor.getState().hostMessages.length).toBe(4)
    const lastUserMsg = mentor.getState().hostMessages[2].parts[0]
    expect((lastUserMsg as { text: string }).text).toContain('【后台工作回执（共 1 项）】')
    expect((lastUserMsg as { text: string }).text).toContain('[来自专家: 讲义研究员]')
  })

  it('3. 三道防死循环护栏：自委派、路径防环与跳数超限硬拦截', async () => {
    const listMock = () => []
    const dispatchMock = () => ({ ok: true, delegationId: 'del-mock', message: 'ok' })
    const postMock = () => ({ ok: true, message: 'ok' })

    // 护栏 1：禁止自委派 (A -> A)
    const mentorTools = createTeamHostTools({
      selfAgentId: 'agent-mentor',
      selfAgentName: '总导师',
      listTeammates: listMock,
      delegateToAgent: dispatchMock,
      postChannelMessage: postMock,
      getActiveDelegation: () => null,
    })
    const delegateTool = mentorTools.find((t) => t.name === 'delegate_to_agent')!

    const selfRes = await delegateTool.run({
      targetAgentId: 'agent-mentor',
      task: '自己做',
    }, {} as any)
    expect(selfRes.ok).toBe(false)
    expect(selfRes.content).toContain('禁止向自己委派任务')

    // 护栏 2：路径防环 (A -> B -> A 拦截)
    const authorTools = createTeamHostTools({
      selfAgentId: 'agent-author',
      selfAgentName: '讲义研究员',
      listTeammates: listMock,
      delegateToAgent: dispatchMock,
      postChannelMessage: postMock,
      getActiveDelegation: () => ({
        delegationId: 'del-incoming',
        fromAgentId: 'agent-mentor',
        chain: ['agent-mentor'],
        hopCount: 1,
        task: '做研究',
      }),
    })
    const authorDelegate = authorTools.find((t) => t.name === 'delegate_to_agent')!

    const loopRes = await authorDelegate.run({
      targetAgentId: 'agent-mentor',
      task: '又回去了',
    }, {} as any)
    expect(loopRes.ok).toBe(false)
    expect(loopRes.content).toContain('环路委派')

    // 护栏 3：跳数上限 (MAX_COLLAB_HOPS = 3 拦截)
    const labTools = createTeamHostTools({
      selfAgentId: 'agent-lab',
      selfAgentName: '实验室工程师',
      listTeammates: listMock,
      delegateToAgent: dispatchMock,
      postChannelMessage: postMock,
      getActiveDelegation: () => ({
        delegationId: 'del-deep',
        fromAgentId: 'agent-director',
        chain: ['agent-mentor', 'agent-author', 'agent-director'],
        hopCount: 3,
        task: '深层委派',
      }),
    })
    const labDelegate = labTools.find((t) => t.name === 'delegate_to_agent')!

    const hopRes = await labDelegate.run({
      targetAgentId: 'agent-examiner',
      task: '第四跳',
    }, {} as any)
    expect(hopRes.ok).toBe(false)
    expect(hopRes.content).toContain('跳数超限')
  })

  it('4. 协作频道路由与静默广播：未 @ 默认路由 Leader，带 @ 精准路由，公告不引发链式闲聊', async () => {
    const scopeId = 'test-channel-route'
    const mock = createTeamMockStream([
      {
        match: '普通频道消息',
        hops: [{ content: '总导师在协作频道答复。' }],
      },
      {
        match: '请帮我出一套中值定理的卷子',
        hops: [{ content: '测评官已接单出卷。' }],
      },
    ])

    const bus = new TeamBus({
      scopeId,
      profiles: MULTI_EXPERT_PROFILES,
      provider: testProvider,
      model: 'mock-model',
      chatFn: mock.stream,
    })

    // 4.1 普通消息未 @ 任何人 -> 默认路由给总导师 (Leader)
    await bus.sendChannelMessage('这是普通频道消息')
    expect(mock.getAgentCalls('agent-mentor')).toBe(1)
    expect(mock.getAgentCalls('agent-examiner')).toBe(0)

    // 4.2 明确 @测评官 -> 精准路由给 agent-examiner
    await bus.sendChannelMessage('@测评官 请帮我出一套中值定理的卷子')
    expect(mock.getAgentCalls('agent-examiner')).toBe(1)

    // 4.3 专家向频道发布公告 -> 仅写入频道，不引发其他专家链式调用
    const mentorCallsBefore = mock.getAgentCalls('agent-mentor')
    bus.postChannelAnnouncement('agent-director', '课堂编排完成，正在渲染分幕。')

    const msgs = bus.getTeamState().channelMessages
    const lastMsg = msgs[msgs.length - 1]
    expect(lastMsg.isAnnouncement).toBe(true)
    expect(lastMsg.senderName).toBe('互动课堂导演')
    expect(mock.getAgentCalls('agent-mentor')).toBe(mentorCallsBefore)
  })

  it('5. 角色最小权限白名单验证：各角色 API 白名单严格隔离，且全员硬禁 subagent', () => {
    const directorProfile = MULTI_EXPERT_PROFILES.find((p) => p.id === 'agent-director')!
    const examinerProfile = MULTI_EXPERT_PROFILES.find((p) => p.id === 'agent-examiner')!

    // 检查预设声明
    expect(directorProfile.allowedApiGroups).toContain('classroom')
    expect(directorProfile.allowedApiGroups).not.toContain('exam')
    expect(directorProfile.allowedApiGroups).not.toContain('subagent')

    expect(examinerProfile.allowedApiGroups).toContain('exam')
    expect(examinerProfile.allowedApiGroups).not.toContain('classroom')
    expect(examinerProfile.allowedApiGroups).not.toContain('subagent')

    // 检查沙箱工具装配
    const directorTools = createSuperWorkerTools({
      allowedGroups: directorProfile.allowedApiGroups,
    })
    const examinerTools = createSuperWorkerTools({
      allowedGroups: examinerProfile.allowedApiGroups,
    })

    const directorExec = directorTools.find((t) => t.name === 'execute')!
    const examinerExec = examinerTools.find((t) => t.name === 'execute')!

    const directorBody = (directorExec.parameters as { properties: { body: { description: string } } }).properties.body.description
    const examinerBody = (examinerExec.parameters as { properties: { body: { description: string } } }).properties.body.description

    expect(directorBody).toContain('classroom')
    expect(directorBody).not.toContain('exam.grade')
    expect(directorBody).not.toContain('subagent.create')

    expect(examinerBody).toContain('exam')
    expect(examinerBody).not.toContain('classroom.schema')
    expect(examinerBody).not.toContain('subagent.create')
  })

  it('6. 团队与专家独立持久化验证：团队状态与各专家状态物理隔离落盘并能安全读回', async () => {
    const {
      saveTeamState,
      flushTeamState,
      loadTeamState,
      saveTeamAgentState,
      flushTeamAgentState,
      loadTeamAgentState,
    } = await import('../src/learn/superAgent/persist')

    const scopeId = 'test-persist-team-scope'

    // 保存团队状态
    const teamStateToSave = {
      scopeId,
      agents: [...DEFAULT_TEAM_PROFILES],
      channelMessages: [
        {
          id: 'msg-1',
          senderId: 'user',
          senderName: '学习者',
          avatar: '👤',
          content: '开始学习',
          timestamp: 123456,
        },
      ],
      delegations: {},
      updatedAt: 123456,
    }
    saveTeamState(scopeId, teamStateToSave)
    await flushTeamState(scopeId)

    const loadedTeam = await loadTeamState(scopeId)
    expect(loadedTeam).toBeDefined()
    expect(loadedTeam?.channelMessages.length).toBe(1)
    expect(loadedTeam?.channelMessages[0].content).toBe('开始学习')

    // 分别保存两个专家的独立状态
    const mentorState = {
      id: `${scopeId}:agent-mentor`,
      hostSystemPrompt: '导师提示词',
      hostMessages: [],
      workers: {},
      mailbox: [],
      blackboard: [
        {
          workerId: 'w-1',
          title: '规划大纲',
          goal: '规划大纲',
          status: 'done' as const,
          summary: '已完成规划',
          artifactIds: ['art-1'],
          tags: ['大纲'],
          updatedAt: 123456,
        },
      ],
    }

    const authorState = {
      id: `${scopeId}:agent-author`,
      hostSystemPrompt: '研究员提示词',
      hostMessages: [],
      workers: {},
      mailbox: [],
      blackboard: [
        {
          workerId: 'w-2',
          title: '撰写讲义',
          goal: '撰写讲义',
          status: 'done' as const,
          summary: '已完成讲义',
          artifactIds: ['art-2'],
          tags: ['讲义'],
          updatedAt: 123456,
        },
      ],
    }

    saveTeamAgentState(scopeId, 'agent-mentor', mentorState)
    saveTeamAgentState(scopeId, 'agent-author', authorState)
    await flushTeamAgentState(scopeId, 'agent-mentor')
    await flushTeamAgentState(scopeId, 'agent-author')

    // 独立读取并验证互不串台
    const loadedMentor = await loadTeamAgentState(scopeId, 'agent-mentor')
    const loadedAuthor = await loadTeamAgentState(scopeId, 'agent-author')

    expect(loadedMentor.id).toBe(`${scopeId}:agent-mentor`)
    expect(loadedMentor.blackboard[0].title).toBe('规划大纲')
    expect(loadedAuthor.id).toBe(`${scopeId}:agent-author`)
    expect(loadedAuthor.blackboard[0].title).toBe('撰写讲义')
  })

  it('7. TASK #10 回归验证：频道消息回写闭环、精炼摘要截断与指针携带', async () => {
    const scopeId = 'test-channel-reply-and-summary'
    const longDeliveryText = '这里是一篇极其冗长、超过数百字的讲义交付正文：微积分极限的严格定义采用ε-δ语言描述。设函数f(x)在点x0的去心邻域内有定义...' + 'A'.repeat(500)

    const mock = createTeamMockStream([
      {
        match: '请向频道打招呼',
        hops: [{ content: '你好！我是总导师，随时准备协助你的学习规划。' }],
      },
      {
        match: '【跨专家协作委派单】',
        hops: [
          {
            content: longDeliveryText,
          },
        ],
      },
    ])

    const bus = new TeamBus({
      scopeId,
      profiles: MULTI_EXPERT_PROFILES,
      provider: testProvider,
      model: 'mock-model',
      chatFn: mock.stream,
    })

    // 1. 测试频道发言与专家回复回写闭环
    await bus.sendChannelMessage('请向频道打招呼')

    const msgs = bus.getTeamState().channelMessages
    expect(msgs.length).toBe(2)
    expect(msgs[0].senderId).toBe('user')
    expect(msgs[0].content).toBe('请向频道打招呼')

    // 关键回归：专家的回复必须写回 channelMessages，绝不可造成用户面对空气
    const replyMsg = msgs[1]
    expect(replyMsg.senderId).toBe('agent-mentor')
    expect(replyMsg.senderName).toBe('总导师')
    expect(replyMsg.content).toContain('我是总导师，随时准备协助你的学习规划')
    expect(replyMsg.refAgentId).toBe('agent-mentor')

    // 2. 测试委派完成时写入频道的精炼摘要截断（<= 120 字）与指针携带
    const mentorTools = createTeamHostTools({
      selfAgentId: 'agent-mentor',
      selfAgentName: '总导师',
      listTeammates: () => bus.listTeammates('agent-mentor'),
      delegateToAgent: (params) => (bus as any).dispatchDelegation({ ...params, fromAgentId: 'agent-mentor' }),
      postChannelMessage: (content) => {
        bus.postChannelAnnouncement('agent-mentor', content)
        return { ok: true, message: 'ok' }
      },
      getActiveDelegation: () => null,
    })
    const delegateTool = mentorTools.find((t) => t.name === 'delegate_to_agent')!

    const dispatchRes = await delegateTool.run({
      targetAgentId: 'agent-author',
      task: '撰写长讲义',
      announceInChannel: true,
    }, {} as any)
    expect(dispatchRes.ok).toBe(true)

    // 等待委派结算完成
    await new Promise((r) => setTimeout(r, 60))

    const updatedMsgs = bus.getTeamState().channelMessages
    const deliveryMsg = updatedMsgs.find((m) => m.content.includes('完成交付'))
    expect(deliveryMsg).toBeDefined()
    expect(deliveryMsg?.refAgentId).toBe('agent-author')
    expect(deliveryMsg?.refWorkerId).toBeDefined()
    expect(deliveryMsg?.briefSummary).toBeDefined()
    // 摘要必须截断在 <= 125 字符（含省略号），绝不在频道糊 500+ 字长文
    expect(deliveryMsg!.briefSummary!.length).toBeLessThanOrEqual(125)
    expect(deliveryMsg!.briefSummary!.endsWith('...')).toBe(true)
  })

  it('8. resetAll 应彻底清空所有 Agent 的会话、工单、黑板及协作频道记录', async () => {
    const mock = createTeamMockStream([
      {
        match: '你好',
        hops: [{ content: '你好，我是总导师！' }],
      },
    ])

    const bus = new TeamBus({
      scopeId: 'test-scope-reset',
      provider: testProvider,
      model: 'mock-model',
      chatFn: mock.stream,
    })

    // 先发送一条频道消息
    await bus.sendChannelMessage('你好')
    expect(bus.getTeamState().channelMessages.length).toBeGreaterThan(0)

    const mentorEng = bus.getAgentEngine('agent-mentor')!
    expect(mentorEng.getState().hostMessages.length).toBeGreaterThan(0)

    // 执行全量重置
    bus.resetAll()

    // 验证协作频道被清空
    const teamSt = bus.getTeamState()
    expect(teamSt.channelMessages).toEqual([])
    expect(teamSt.delegations).toEqual({})

    // 验证所有 Agent 的内部上下文被清空
    for (const profile of DEFAULT_TEAM_PROFILES) {
      const eng = bus.getAgentEngine(profile.id)!
      const st = eng.getState()
      expect(st.hostMessages).toEqual([])
      expect(st.workers).toEqual({})
      expect(st.mailbox).toEqual([])
      expect(st.blackboard).toEqual([])
    }
  })

  it('9. 默认单导师模型：作为团队唯一 Agent，拥有全量 API 白名单与完整的 Host + Workers 架构', async () => {
    // 9.1 验证默认团队仅有 1 位 Agent（导师）
    expect(DEFAULT_TEAM_PROFILES).toHaveLength(1)
    const soloMentor = DEFAULT_TEAM_PROFILES[0]
    expect(soloMentor.id).toBe('agent-mentor')
    expect(soloMentor.name).toBe('导师')
    expect(soloMentor.isLeader).toBe(true)

    // 9.2 验证单导师 Worker 白名单覆盖全量 25 组 API（且严格禁用 subagent）
    expect(soloMentor.allowedApiGroups.length).toBeGreaterThanOrEqual(20)
    expect(soloMentor.allowedApiGroups).toContain('node')
    expect(soloMentor.allowedApiGroups).toContain('web')
    expect(soloMentor.allowedApiGroups).toContain('classroom')
    expect(soloMentor.allowedApiGroups).toContain('exam')
    expect(soloMentor.allowedApiGroups).toContain('code')
    expect(soloMentor.allowedApiGroups).toContain('workspace')
    expect(soloMentor.allowedApiGroups).not.toContain('subagent')

    // 9.3 验证 Worker 沙箱工具包含全量核心接口
    const soloTools = createSuperWorkerTools({
      allowedGroups: soloMentor.allowedApiGroups,
    })
    const execTool = soloTools.find((t) => t.name === 'execute')!
    const desc = (execTool.parameters as { properties: { body: { description: string } } }).properties.body.description
    expect(desc).toContain('classroom')
    expect(desc).toContain('exam')
    expect(desc).toContain('node')
    expect(desc).toContain('workspace')
    expect(desc).not.toContain('subagent.create')

    // 9.4 验证默认 TeamBus 只初始化该导师，且能正常处理消息
    const mock = createTeamMockStream([
      {
        match: '导师你好',
        hops: [{ content: '你好，我是你的全能导师。' }],
      },
    ])
    const bus = new TeamBus({
      scopeId: 'test-solo-mentor-scope',
      provider: testProvider,
      model: 'mock-model',
      chatFn: mock.stream,
    })

    const loadedProfiles = bus.getTeamState().agents
    expect(loadedProfiles).toHaveLength(1)
    expect(loadedProfiles[0].id).toBe('agent-mentor')

    await bus.sendDirectMessage('agent-mentor', '导师你好')
    const mentorEng = bus.getAgentEngine('agent-mentor')!
    expect(mentorEng.getState().hostMessages.length).toBe(2)
    expect(mentorEng.getState().hostMessages[1].parts[0]).toMatchObject({
      text: '你好，我是你的全能导师。',
    })
  })
})
