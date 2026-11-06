// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MessageActions } from '../src/components/agent/panel/MessageBubble'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('MessageActions 消息复制功能', () => {
  let writeTextMock: any

  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      configurable: true,
      writable: true,
    })
  })

  it('展示复制按钮，点击后调用 clipboard.writeText 并显示已复制反馈', async () => {
    const div = document.createElement('div')
    const root = createRoot(div)

    await act(async () => {
      root.render(React.createElement(MessageActions, { text: '这是需要被复制的消息内容' }))
    })

    const copyBtn = div.querySelector('button')
    expect(copyBtn).toBeTruthy()
    expect(copyBtn?.getAttribute('title')).toBe('复制内容')

    // 确认没有历史遗留的编辑与删除按钮
    const allButtons = div.querySelectorAll('button')
    expect(allButtons).toHaveLength(1)

    // 点击复制
    await act(async () => {
      copyBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(writeTextMock).toHaveBeenCalledWith('这是需要被复制的消息内容')
    expect(copyBtn?.textContent).toContain('已复制')
  })
})
