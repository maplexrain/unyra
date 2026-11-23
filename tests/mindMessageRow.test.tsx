// @vitest-environment happy-dom
/**
 * 思维层第一行：**不折叠、不可折叠**，正文与 raw 元信息直接可见；用户消息不带气泡。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { MindMessageRow } from '../src/components/agent/panel/MindMessageRow'
import type { ConversationMessage } from '../src/agent/types'

describe('MindMessageRow', () => {
  it('第一层直接铺开：没有折叠按钮，正文与 raw 元信息始终可见', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const msg: ConversationMessage = {
      id: 'm1',
      role: 'user',
      parts: [{ type: 'text', text: '第一行正文\n第二行正文' }],
      ts: 1_700_000_000_000,
      channel: {
        channel: 'user',
        from: { kind: 'user', id: 'u1', name: 'Maxwell' },
        to: { kind: 'role', id: 'tutor', name: '导师龟' },
        ts: 1_700_000_000_000,
        envelopeId: 'e1',
      },
    }
    const msgRefs = { current: new Map<string, HTMLDivElement>() }

    act(() => {
      root.render(
        createElement(MindMessageRow, {
          m: msg,
          agentName: '导师龟',
          faded: false,
          flash: false,
          msgRefs,
          setBubblePreview: vi.fn(),
        }),
      )
    })

    expect(host.querySelector('[data-mind-message-id="m1"]')).not.toBeNull()
    expect(host.textContent).toContain('第一行正文')
    expect(host.textContent).toContain('第二行正文')
    const raw = host.querySelector('[data-mind-raw]')
    expect(raw?.textContent).toContain('time:')
    expect(raw?.textContent).toContain('channel:user')
    expect(raw?.textContent).toContain('id:e1')
    expect(raw?.textContent).toContain('roleId:u1')
    expect(raw?.textContent).toContain('roleName:Maxwell')
    // 第一层不允许折叠：整行没有折叠按钮
    expect(host.querySelector('button')).toBeNull()
    expect(msgRefs.current.has('m1')).toBe(true)
    // 思维层去掉气泡：用户正文所在的那层不再有圆角气泡底色
    expect(host.querySelector('[class*="bg-line/60"]')).toBeNull()

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('assistant 消息没有 channel 时退回角色名 + 时间，不伪造信封', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(MindMessageRow, {
          m: {
            id: 'm2',
            role: 'assistant',
            parts: [{ type: 'text', text: '回复正文' }],
            ts: 1_700_000_000_000,
          },
          agentName: '导师龟',
          faded: false,
          flash: false,
          setBubblePreview: vi.fn(),
        }),
      )
    })
    expect(host.textContent).toContain('导师龟')
    expect(host.textContent).toContain('回复正文')
    expect(host.querySelector('[data-mind-raw]')).toBeNull()
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
