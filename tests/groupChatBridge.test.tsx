// @vitest-environment happy-dom
/**
 * 群聊桥：用户群聊发言 @ 谁就投给谁；没有 @ 时交给幕后的群消息调度 agent 判断。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendGroupMessage, getGroupChatMessages, groupThreadIdOf } from '../src/learn/groupChat'
import type { ChannelMessage } from '../src/agent/types'
import { resetChannelRegistry, setRoleWorkDispatcher, type RoleTurnRequest } from '../src/learn/roleWork/dispatch'
import { setGroupTriageRunner } from '../src/learn/roleWork/groupTriage'
import type { LearnStore } from '../src/learn/types'
import { useGroupChatBridge, type GroupChatBridge } from '../src/components/learn/workspace/useGroupChatBridge'

describe('useGroupChatBridge', () => {
  afterEach(() => {
    setRoleWorkDispatcher(null)
    setGroupTriageRunner(null)
    resetChannelRegistry()
  })

  it('用户发言：正文 @导师龟 时，即使 targetIds 错传设计龟，也只投给导师龟', () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-bridge-test',
            agents: [
              { id: 'tutor', name: '导师龟' },
              { id: 'dispatcher', name: '经理龟' },
              { id: 'designer', name: '设计龟' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      // 模拟 targetIds 被算错：正文 @导师龟，但目标列表传了 designer
      expect(bridge!.send('@导师龟 帮我查一下', ['designer'])).toBe(true)
    })
    expect(current.conversations.some((c) => c.id === 'cv:tutor:g-bridge-test')).toBe(true)
    expect(started).toHaveLength(1)
    expect(started[0]!.role).toBe('tutor')
    expect(started[0]!.stamp.channel).toBe('group')
    expect(started[0]!.text).toBe('@导师龟 帮我查一下')
    const logged = getGroupChatMessages().find(
      (m) => m.goalId === 'g-bridge-test' && m.text === '@导师龟 帮我查一下',
    )
    expect(logged?.kind).toBe('group')
    expect(logged?.cc?.[0]?.id).toBe('tutor')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('用户在评论串里发言：落到 `group:goal>根消息id`，并把 threadId 带给被回复的 role', () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))

    const goalId = 'g-bridge-thread'
    const root: ChannelMessage = {
      id: 'g-root',
      kind: 'group',
      direction: 'out',
      from: { kind: 'role', id: 'dispatcher', name: '经理龟' },
      to: { kind: 'group', id: 'group', name: '群聊' },
      text: '@导师龟 帮我讲一下',
      ts: 1000,
      cc: [{ kind: 'role', id: 'tutor', name: '导师龟' }],
      goalId,
      threadId: groupThreadIdOf(goalId, 'g-root'),
    }
    appendGroupMessage(root)

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const rootHost = createRoot(host)
    act(() => {
      rootHost.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId,
            agents: [
              { id: 'tutor', name: '导师龟' },
              { id: 'dispatcher', name: '经理龟' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      expect(bridge!.send('补充一处边界', ['tutor'], groupThreadIdOf(goalId, 'g-root'))).toBe(true)
    })
    expect(started).toHaveLength(1)
    expect(started[0]!.role).toBe('tutor')
    expect(started[0]!.stamp.threadId).toBe('group:g-bridge-thread>g-root')
    expect(started[0]!.stamp.threadRootId).toBe('g-root')
    const comment = getGroupChatMessages().find((m) => m.text === '补充一处边界')
    expect(comment?.threadId).toBe('group:g-bridge-thread>g-root')
    expect(comment?.threadRootId).toBe('g-root')
    act(() => {
      rootHost.unmount()
    })
    host.remove()
  })

  it('用户发言：@ 名字后没有空格时不算艾特，直接拒绝', () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-bridge-strict',
            agents: [
              { id: 'tutor', name: '导师龟' },
              { id: 'dispatcher', name: '经理龟' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      expect(bridge!.send('@导师龟，帮我查一下', ['designer'])).toBe(false)
    })
    expect(started).toHaveLength(0)
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('用户发言：句末 @导师龟 的尾随空格保留，严格语法才算成功', () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-bridge-tail',
            agents: [
              { id: 'tutor', name: '导师龟' },
              { id: 'dispatcher', name: '经理龟' },
              { id: 'designer', name: '设计龟' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      expect(bridge!.send('@导师龟 ', ['designer'])).toBe(true)
    })
    expect(started).toHaveLength(1)
    expect(started[0]!.role).toBe('tutor')
    expect(started[0]!.text).toBe('@导师龟 ')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('用户发言：多个 @ 都可抄送上下文，但只有首个 @ 作为 mention 激活', () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-bridge-multi',
            agents: [
              { id: 'tutor', name: '导师龟' },
              { id: 'dispatcher', name: '经理龟' },
              { id: 'designer', name: '设计龟' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      expect(bridge!.send('@导师龟 @设计龟 你们一起看一下', [])).toBe(true)
    })
    expect(started).toHaveLength(1)
    expect(started[0]!.role).toBe('tutor')
    const logged = getGroupChatMessages().find((m) => m.goalId === 'g-bridge-multi')
    expect(logged?.cc?.map((p) => p.id).sort()).toEqual(['designer', 'tutor'])
    expect(logged?.mention).toMatchObject({ kind: 'role', id: 'tutor' })
    act(() => {
      root.unmount()
    })
    host.remove()
  })


  it('用户发言：没有 @ 时交给群消息调度 agent，按结构化结果投递，不再默认经理龟', async () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))
    let seenText = ''
    setGroupTriageRunner(async (input) => {
      seenText = input.text
      expect(input.agents.map((a) => a.id)).toContain('tutor')
      return { agentId: 'tutor', reason: '教学问题', confidence: 0.9 }
    })

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-bridge-noat',
            agents: [
              { id: 'tutor', name: '导师龟', duty: '主讲与协调' },
              { id: 'dispatcher', name: '经理龟', duty: '接需求与派活' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      expect(bridge!.send('帮我把这周的安排列一下', [])).toBe(true)
    })
    await vi.waitFor(() => expect(started).toHaveLength(1))
    expect(seenText).toBe('帮我把这周的安排列一下')
    expect(started[0]!.role).toBe('tutor')
    expect(started[0]!.text).toBe('帮我把这周的安排列一下')
    expect(started[0]!.stamp.mention).toBe(true)
    const logged = getGroupChatMessages().find((m) => m.goalId === 'g-bridge-noat')
    expect(logged?.cc ?? []).toEqual([])
    // 用户正文没有点名，不伪造 cc / mention；选中目标只存在于投递内部。
    expect(logged?.mention).toBeUndefined()
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('无 @ 调度连续失败后进入手动兜底；用户指定目标再投递', async () => {
    let current = { conversations: [] } as unknown as LearnStore
    const set = (next: LearnStore): void => {
      current = next
    }
    const started: RoleTurnRequest[] = []
    setRoleWorkDispatcher(() => ({
      isConversationRunning: () => false,
      resolveRoleConversation: () => null,
      startRoleTurn: (req) => started.push(req),
      appendChannel: () => {},
    }))
    let attempts = 0
    setGroupTriageRunner(async () => {
      attempts += 1
      throw new Error('模型输出不是 JSON')
    })

    let bridge: GroupChatBridge | null = null
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(function Probe() {
          bridge = useGroupChatBridge({
            goalId: 'g-bridge-fallback',
            agents: [
              { id: 'tutor', name: '导师龟', duty: '主讲与协调' },
              { id: 'dispatcher', name: '经理龟', duty: '接需求与派活' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      expect(bridge!.send('帮我把这周的安排列一下', [])).toBe(true)
    })
    await vi.waitFor(() => expect(bridge!.triageFallback).not.toBeNull())
    // 首次 + 三次重试
    expect(attempts).toBe(4)
    expect(started).toHaveLength(0)
    expect(getGroupChatMessages().some((m) => m.goalId === 'g-bridge-fallback' && m.text === '帮我把这周的安排列一下')).toBe(true)

    act(() => {
      bridge!.assignTriageFallback('dispatcher')
    })
    expect(bridge!.triageFallback).toBeNull()
    expect(started).toHaveLength(1)
    expect(started[0]!.role).toBe('dispatcher')
    expect(started[0]!.stamp.mention).toBe(true)
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
