// @vitest-environment happy-dom
/**
 * 群聊层：只有对话列表；用户必须 @ 至少一位 agent 才会进入对方通道。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { GroupChatPanel, mentionContextAt } from '../src/components/agent/panel/GroupChatPanel'
import { mentionedAgentsOf } from '../src/components/agent/panel/groupMentions'
import { groupThreadIdOf } from '../src/learn/groupChat'
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
    expect(mentionedAgentsOf('@导师龟，请讲一下', agents)).toEqual([])
    expect(mentionedAgentsOf('请找 @导师龟', agents)).toEqual([])
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
    expect(host.textContent).toContain('@导师龟')
    expect(host.textContent).not.toContain('思维')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('姓名时间行展示 @ 与发送者状态；不再有独立 mention 行，交付账和详细层可展开', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const m: ChannelMessage = {
      ...message('m1', { kind: 'role', id: 'tutor', name: '导师龟' }, '@用户 极限讲义已经更新'),
      detail: '详细依据：先补了极限定义，再补了夹逼定理例题，最后把产物放到 微积分/极限。',
      mention: { kind: 'role', id: 'dispatcher', name: '调度龟' },
      delivery: { files: [{ path: '微积分/极限', action: 'updated' }], sources: [] },
    }
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [m],
          agents: [{ ...agents[0]!, running: true }, agents[1]!],
          onSend: vi.fn(() => true),
        }),
      )
    })
    const meta = host.querySelector('[data-message-meta]')
    expect(meta?.textContent).toContain('导师龟')
    expect(meta?.textContent).toContain('@导师龟')
    expect(meta?.textContent).toContain('工作中')
    expect(host.querySelector('[data-agent-status="running"]')).not.toBeNull()
    expect(host.querySelector('[data-mention-agent]')).toBeNull()
    expect(host.textContent).toContain('本轮交付')
    expect(host.textContent).not.toContain('详细依据')
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-bubble-detail-toggle]')?.click()
    })
    expect(host.textContent).toContain('详细依据')
    act(() => {
      root.unmount()
    })
    host.remove()
  })


  it('一级列表只画主楼；点「评论」进入评论串后才看到楼内回复', () => {
    const rootMessage = message('m1', { kind: 'role', id: 'dispatcher', name: '调度龟' }, '@导师龟 帮我查一下')
    rootMessage.threadId = groupThreadIdOf('g1', 'm1')
    const comment = message('m2', { kind: 'role', id: 'tutor', name: '导师龟' }, '@调度龟 收到，已开工')
    comment.threadId = groupThreadIdOf('g1', 'm1')
    comment.threadRootId = 'm1'

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [rootMessage, comment],
          agents,
          onSend: vi.fn(() => true),
        }),
      )
    })
    expect(host.textContent).toContain('@导师龟 帮我查一下')
    expect(host.textContent).not.toContain('@调度龟 收到，已开工')
    const commentButton = host.querySelector<HTMLButtonElement>('button[title="group:g1>m1"]')
    expect(commentButton).not.toBeNull()
    act(() => {
      commentButton!.click()
    })
    expect(host.textContent).toContain('评论串')
    expect(host.textContent).toContain('原消息')
    expect(host.textContent).toContain('@调度龟 收到，已开工')
    expect(host.textContent).toContain('group:g1>m1')

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
