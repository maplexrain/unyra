// @vitest-environment happy-dom
/**
 * 群聊桥：用户群聊发言只投给被 @ 的 role，并落同一份群流水。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { getGroupChatMessages } from '../src/learn/groupChat'
import { resetChannelRegistry, setRoleWorkDispatcher, type RoleTurnRequest } from '../src/learn/roleWork/dispatch'
import type { LearnStore } from '../src/learn/types'
import { useGroupChatBridge, type GroupChatBridge } from '../src/components/learn/workspace/useGroupChatBridge'

describe('useGroupChatBridge', () => {
  afterEach(() => {
    setRoleWorkDispatcher(null)
    resetChannelRegistry()
  })

  it('用户发言：先落群流水，只给被 @ 的 role 投递 group 入站', () => {
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
              { id: 'dispatcher', name: '调度龟' },
            ],
            getLatest: () => current,
            set,
          })
          return null
        }),
      )
    })
    act(() => {
      expect(bridge!.send('@导师龟 帮我查一下', ['tutor'])).toBe(true)
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
    expect(logged?.mentions?.[0]?.id).toBe('tutor')
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
