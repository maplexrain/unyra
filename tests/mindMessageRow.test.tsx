// @vitest-environment happy-dom
/**
 * 思维层每一行：默认折叠、点开才出正文；用户消息在思维层也不带气泡壳。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { MindMessageRow } from '../src/components/agent/panel/MindMessageRow'
import type { ConversationMessage } from '../src/agent/types'

describe('MindMessageRow', () => {
  it('默认折叠：正文不在 DOM；点开后才挂载，并且用户消息没有聊天气泡底色', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const msg: ConversationMessage = {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: '预览行\n展开后才出现的正文' }],
      ts: 1000,
    }
    const msgRefs = { current: new Map<string, HTMLDivElement>() }

    act(() => {
      root.render(
        createElement(MindMessageRow, {
          m: msg,
          agentName: '小龟',
          faded: false,
          flash: false,
          msgRefs,
          setBubblePreview: vi.fn(),
        }),
      )
    })

    expect(host.querySelector('[data-mind-message-id="m1"]')).not.toBeNull()
    expect(host.textContent).not.toContain('展开后才出现的正文')
    expect(host.querySelector('[class*="bg-line/60"]')).toBeNull()

    act(() => {
      host.querySelector<HTMLButtonElement>('button')!.click()
    })
    expect(host.textContent).toContain('展开后才出现的正文')
    expect(msgRefs.current.has('m1')).toBe(true)
    // 思维层去掉气泡：用户正文所在的那层不再有圆角气泡底色
    expect(host.querySelector('[class*="bg-line/60"]')).toBeNull()

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
