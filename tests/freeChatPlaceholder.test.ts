// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useMessageList } from '../src/components/agent/panel/useMessageList'
import type { MessageListProps } from '../src/components/agent/panel/MessageList'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function TestHost(props: Partial<MessageListProps>) {
  const content = useMessageList({
    messages: [],
    summaryStart: 0,
    summary: null,
    summaryOpen: false,
    setSummaryOpen: vi.fn(),
    streaming: null,
    running: false,
    loopLabel: '',
    flashId: null,
    msgRefs: { current: new Map() },
    editing: null,
    setEditing: vi.fn(),
    saveEdit: vi.fn(),
    confirmDel: null,
    clickDelete: vi.fn(),
    setBubblePreview: vi.fn(),
    ...props,
  })
  return React.createElement('div', { 'data-testid': 'chat-container' }, content)
}

function renderComponent(props: Partial<MessageListProps>) {
  const div = document.createElement('div')
  const root = createRoot(div)
  act(() => {
    root.render(React.createElement(TestHost, props))
  })
  return div
}

describe('固定聊天（Free Chat）与超级导师空占位内容区分', () => {
  it('free 为 true（固定聊天tab）时展示自由对话专属占位与建议词，绝不展示导师文案', () => {
    const onSelectPrompt = vi.fn()
    const container = renderComponent({ free: true, onSelectPrompt })

    const text = container.textContent || ''
    // 标题与副标题验证
    expect(text).toContain('自由对话已就绪')
    expect(text).toContain('探索想法、快速答疑、方案构思或自由交流，随时随地开启对话')
    expect(text).not.toContain('超级导师已就绪')
    expect(text).not.toContain('针对当前知识点随思提问、拆解推导或生成笔记')

    // 建议词验证
    expect(text).toContain('帮我梳理一段思路或方案')
    expect(text).toContain('快速解答一个技术或日常疑问')
    expect(text).toContain('探讨一个观点的不同视角与利弊')
    expect(text).not.toContain('针对难点出一道随堂小测验')

    // 点击建议词测试
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBe(3)
    act(() => {
      buttons[0].click()
    })
    expect(onSelectPrompt).toHaveBeenCalledWith('帮我梳理一段思路或方案')
  })

  it('free 为 false（普通导师tab）时展示导师专属占位与建议词', () => {
    const onSelectPrompt = vi.fn()
    const container = renderComponent({ free: false, onSelectPrompt })

    const text = container.textContent || ''
    expect(text).toContain('超级导师已就绪')
    expect(text).toContain('针对当前知识点随思提问、拆解推导或生成笔记')
    expect(text).not.toContain('自由对话已就绪')

    expect(text).toContain('用直白的例子解释这个概念')
    expect(text).toContain('帮我梳理要点并整理进笔记')
    expect(text).toContain('针对难点出一道随堂小测验')

    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBe(3)
    act(() => {
      buttons[2].click()
    })
    expect(onSelectPrompt).toHaveBeenCalledWith('针对难点出一道随堂小测验')
  })
})
