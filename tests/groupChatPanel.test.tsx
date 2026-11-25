// @vitest-environment happy-dom
/**
 * 群聊层：只有对话列表；@ 指定投递，没有 @ 时由幕后的群消息调度 agent 判断。
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
    const delivery = host.querySelector('[data-delivery-block]')
    expect(delivery).not.toBeNull()
    // 交付账在 agent 气泡内侧底部，不再作为气泡外的一张独立卡片
    expect(delivery?.closest('.bg-bubble-agent')).not.toBeNull()
    act(() => {
      host.querySelector<HTMLButtonElement>('[data-bubble-detail-toggle]')?.click()
    })
    expect(host.textContent).toContain('详细依据')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('调度失败兜底：弹出成员选择，点选后交给指定 agent', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onAssign = vi.fn()
    const onDismiss = vi.fn()
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [],
          agents,
          onSend: vi.fn(() => true),
          triageFallback: {
            message: message('m1', { kind: 'user', id: 'u1', name: '用户' }, '@用户 帮我安排一下'),
            agents,
          },
          onAssignTriageFallback: onAssign,
          onDismissTriageFallback: onDismiss,
        }),
      )
    })
    const dialog = document.querySelector('[data-group-triage-fallback]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('群消息调度失败')
    act(() => {
      dialog?.querySelector<HTMLButtonElement>('[data-triage-agent="dispatcher"]')?.click()
    })
    expect(onAssign).toHaveBeenCalledWith('dispatcher')
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
    // 评论入口在气泡内部，不再挂在气泡下方的消息区
    expect(commentButton!.closest('[class*="bg-bubble-agent"]')).not.toBeNull()
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

  it('没有 @ 时提交空目标列表，交给群消息调度 agent，而不是默认点名调度龟', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSend = vi.fn(() => true)
    act(() => {
      root.render(createElement(GroupChatPanel, { messages: [], agents, onSend }))
    })
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement
    const scroll = host.querySelector<HTMLElement>('[data-message-scroll]')!
    const scrollTo = vi.fn()
    scroll.scrollTo = scrollTo
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    act(() => {
      setter?.call(textarea, '帮我把这周的安排列一下')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      host.querySelector<HTMLButtonElement>('button[title="发送"]')?.click()
    })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('帮我把这周的安排列一下', [], undefined)
    // 发出去的消息要落在最底下：即使此前往上翻过，也回到最新并恢复跟随
    await vi.waitFor(() => expect(scrollTo).toHaveBeenCalled())
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

  it('没有评论时不显示评论入口；有评论时入口铺满整行', () => {
    const plain = message('m1', { kind: 'role', id: 'tutor', name: '导师龟' }, '这一条还没有人评论')
    const commented = message('m2', { kind: 'role', id: 'dispatcher', name: '调度龟' }, '这一条已经有评论')
    commented.threadId = groupThreadIdOf('g1', 'm2')
    const reply = message('m3', { kind: 'role', id: 'tutor', name: '导师龟' }, '楼内回复')
    reply.threadId = groupThreadIdOf('g1', 'm2')
    reply.threadRootId = 'm2'

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(GroupChatPanel, { messages: [plain, commented, reply], agents, onSend: vi.fn(() => true) }),
      )
    })

    // 0 评论：连入口都不该有（开新串走右键菜单）
    expect(host.querySelector('button[title="group:g1>m1"]')).toBeNull()
    // 有评论：入口存在，且按钮自身铺满气泡可用宽度
    const entry = host.querySelector<HTMLButtonElement>('button[title="group:g1>m2"]')
    expect(entry).not.toBeNull()
    expect(entry!.className).toContain('w-full')
    expect(entry!.textContent).toContain('评论 1')

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('气泡右键菜单：复制写剪贴板，评论可直接开新评论串', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
      writable: true,
    })

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onToast = vi.fn()
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [message('m1', { kind: 'role', id: 'tutor', name: '导师龟' }, '右键我试试')],
          agents,
          onSend: vi.fn(() => true),
          onToast,
        }),
      )
    })

    const bubble = host.querySelector<HTMLElement>('[class*="bg-bubble-agent"]')
    expect(bubble).not.toBeNull()
    act(() => {
      bubble!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 240 }))
    })

    const menu = document.querySelector<HTMLElement>('[role="menu"]')
    expect(menu).not.toBeNull()
    const items = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    expect(items.map((b) => b.textContent)).toEqual(['复制', '评论'])

    await act(async () => {
      items[0]!.click()
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('右键我试试')
    expect(onToast).toHaveBeenCalledWith('已复制消息')
    expect(document.querySelector('[role="menu"]')).toBeNull()

    // 重新右键，走「评论」：0 评论也能开串
    act(() => {
      bubble!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 240 }))
    })
    const again = document.querySelector<HTMLElement>('[role="menu"]')!
    act(() => {
      Array.from(again.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === '评论')!.click()
    })
    expect(host.textContent).toContain('评论串')
    expect(host.textContent).toContain('原消息')
    expect(document.querySelector('[role="menu"]')).toBeNull()

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('顶部栏显示正在工作的头像组：多人叠放并显示人数', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [],
          agents: [
            { ...agents[0]!, running: true },
            { ...agents[1]!, running: true },
          ],
          onSend: vi.fn(() => true),
        }),
      )
    })
    const stack = host.querySelector('[data-working-agents]')
    expect(stack).not.toBeNull()
    expect(host.querySelector('[data-group-chat-header] [data-working-agents]')).not.toBeNull()
    expect(stack?.textContent).toContain('2 位工作中')
    expect(stack?.querySelectorAll('img, svg').length).toBeGreaterThanOrEqual(2)
    expect(stack?.className).toContain('group/working')
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('图片在气泡内宫格，普通文件挂气泡外；气泡宽 450', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const withAttachments: ChannelMessage = {
      ...message('m1', { kind: 'user', id: 'u1', name: '用户' }, '@导师龟 看下这两份'),
      attachments: {
        images: [
          { id: 'img-1', name: '猫.png', rel: 'static/img-1.png', mime: 'image/png', bytes: 120 },
        ],
        files: [{ name: '说明.txt', rel: 'static/note.txt', bytes: 20, binary: false }],
      },
    }
    act(() => {
      root.render(createElement(GroupChatPanel, { messages: [withAttachments], agents, onSend: vi.fn(() => true) }))
    })
    const imageButton = host.querySelector<HTMLButtonElement>('button[title^="猫.png"]')
    expect(imageButton).not.toBeNull()
    // 图片在气泡里，普通文件在气泡外
    expect(imageButton?.closest('.bg-bubble-user')).not.toBeNull()
    const fileButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('说明.txt'))
    expect(fileButton?.closest('.bg-bubble-user')).toBeNull()
    expect(host.querySelector('.max-w-\\[450px\\]')).not.toBeNull()
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('深链：打开群聊后滚到待定位的那条消息，并通知宿主清掉待定位 id', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const scrolled = vi.fn()
    const old = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrolled
    const handled = vi.fn()
    act(() => {
      root.render(
        createElement(GroupChatPanel, {
          messages: [
            message('m1', { kind: 'user', id: 'u1', name: '用户' }, '@导师龟 第一条'),
            message('m2', { kind: 'role', id: 'tutor', name: '导师龟' }, '@用户 第二条'),
          ],
          agents,
          onSend: vi.fn(() => true),
          focusMessageId: 'm2',
          onFocusMessageHandled: handled,
        }),
      )
    })
    await vi.waitFor(() => expect(scrolled).toHaveBeenCalled())
    expect(handled).toHaveBeenCalledTimes(1)
    HTMLElement.prototype.scrollIntoView = old
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('贴底时右下角不显示「回到最新」按钮', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(createElement(GroupChatPanel, { messages: [], agents, onSend: vi.fn(() => true) }))
    })
    expect(host.querySelector('[data-follow-latest]')).toBeNull()
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
