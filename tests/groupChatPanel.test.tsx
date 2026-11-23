// @vitest-environment happy-dom
/**
 * 群聊层：只有对话列表；用户必须 @ 至少一位 agent 才会进入对方通道。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { GroupChatPanel, mentionContextAt } from '../src/components/agent/panel/GroupChatPanel'
import { mentionedAgentsOf } from '../src/components/agent/panel/groupMentions'
import type { ChannelMessage } from '../src/agent/types'

const agents = [
  { id: 'tutor' as const, name: '导师龟', avatarId: 'turtle-tutor' },
  { id: 'dispatcher' as const, name: '调度龟', avatarId: 'turtle-dispatcher' },
]

const message = (id: string, from: ChannelMessage['from'], text: string): ChannelMessage => ({
  id,
  kind: 'group',
  direction: from.kind === 'user' ? 'in' : 'out',
  from,
  to: { kind: 'group', id: 'group', name: '群聊' },
  text,
  ts: 1000,
  mentions: [{ kind: 'role', id: 'tutor', name: '导师龟' }],
  goalId: 'g1',
})

describe('GroupChatPanel', () => {
  it('@ 解析只认已出现的完整名字，可一次点名多位', () => {
    expect(mentionedAgentsOf('@导师龟 请讲一下', agents).map((a) => a.id)).toEqual(['tutor'])
    expect(mentionedAgentsOf('@导师龟 @调度龟 你们分工', agents).map((a) => a.id)).toEqual([
      'tutor',
      'dispatcher',
    ])
    expect(mentionedAgentsOf('没有点名的群消息', agents)).toEqual([])
  })

  it('只画群聊对话，不画思维层；消息里的 @ 名单可见', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [
            message('m1', { kind: 'user', id: 'u1', name: '用户' }, '@导师龟 讲讲极限'),
            message('m2', { kind: 'role', id: 'tutor', name: '导师龟' }, '@导师龟 收到，已派 work'),
          ],
          agents,
          onSend: vi.fn(() => true),
        }),
      )
    })
    expect(host.textContent).toContain('@导师龟 讲讲极限')
    expect(host.textContent).toContain('@导师龟 收到，已派 work')
    expect(host.textContent).toContain('@ 导师龟')
    expect(host.textContent).not.toContain('思维')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('@ 提示只跟当前光标：删掉 @ 或名字后打空格就收起', () => {
    expect(mentionContextAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionContextAt('请大家 @导', 6)).toEqual({ start: 4, query: '导' })
    // 删掉 @ 后不应再有候选
    expect(mentionContextAt('请', 1)).toBeNull()
    // 名字选完补了空格，提示必须收起，不能一直挂着
    expect(mentionContextAt('@导师龟 ', 5)).toBeNull()
    expect(mentionContextAt('abc@导师龟', 8)).toBeNull()
  })

  it('只画最近一屏消息，旧消息不一次性塞进 DOM', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const many = Array.from({ length: 61 }, (_, i) =>
      message(`m${i}`, { kind: 'user', id: 'u1', name: '用户' }, `消息-${i}-内容`),
    )
    act(() => {
      root.render(createElement(GroupChatPanel, { messages: many, agents, onSend: vi.fn(() => true) }))
    })
    expect(host.textContent).toContain('消息-60-内容')
    expect(host.textContent).not.toContain('消息-0-内容')
    expect(host.textContent).toContain('向上滚动加载更早的消息')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('没有目标时输入区禁用并显示原因', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [],
          agents,
          disabledReason: '先选择学习目标',
          onSend: vi.fn(() => true),
        }),
      )
    })
    const textarea = host.querySelector('textarea')
    expect(textarea?.disabled).toBe(true)
    expect(host.textContent).toContain('先选择学习目标')
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
