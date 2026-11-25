// @vitest-environment happy-dom
/**
 * 思维层一行：渠道 / 发信人 / 收信人 / 上下文占用始终可见；raw 信封只留在无障碍层；
 * 思考与工具直接平铺，不再先收进一层「思考与工具 · N 步」的组容器。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { MindMessageRow } from '../src/components/agent/panel/MindMessageRow'
import type { ConversationMessage } from '../src/agent/types'

describe('MindMessageRow', () => {
  it('用户入站：渠道、发信人、正文直接可见；raw 元信息只进无障碍层', () => {
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
    expect(host.querySelector('[data-mind-channel="user"]')?.textContent).toContain('用户')
    expect(host.textContent).toContain('Maxwell')
    expect(host.textContent).toContain('导师龟')
    expect(host.textContent).toContain('第一行正文')
    expect(host.textContent).toContain('第二行正文')
    const raw = host.querySelector('[data-mind-raw]')
    expect(raw?.textContent).toContain('time:')
    expect(raw?.textContent).toContain('channel:user')
    expect(raw?.textContent).toContain('id:e1')
    expect(raw?.textContent).toContain('roleId:u1')
    expect(raw?.textContent).toContain('roleName:Maxwell')
    expect(raw?.getAttribute('class')).toContain('sr-only')
    expect(msgRefs.current.has('m1')).toBe(true)
    // 思维层去掉气泡：用户正文所在的那层不再有圆角气泡底色
    expect(host.querySelector('[class*="bg-line/60"]')).toBeNull()

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('assistant 消息没有 channel 时退回角色名 + 回复标记，不伪造信封', () => {
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
    expect(host.textContent).toContain('回复')
    expect(host.textContent).toContain('回复正文')
    expect(host.querySelector('[data-mind-raw]')).toBeNull()
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('思考与工具直接平铺，不再先收进过程组容器', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const msg: ConversationMessage = {
      id: 'm3',
      role: 'assistant',
      ts: 1_700_000_000_000,
      usage: {
        contextTokens: 1200,
        contextWindow: 8000,
        totalTokens: 1300,
        outputTokens: 100,
        cacheReadTokens: 900,
        cacheMissTokens: 300,
        estimated: false,
      },
      parts: [
        { type: 'thinking', text: '先读一下资料' },
        {
          type: 'tool',
          id: 't1',
          name: 'execute',
          args: JSON.stringify({ description: '读资料', body: 'await api.node.list()' }),
          result: 'ok',
          ok: true,
          status: 'done',
        },
      ],
    }
    act(() => {
      root.render(
        createElement(MindMessageRow, {
          m: msg,
          agentName: '导师龟',
          faded: false,
          flash: false,
          setBubblePreview: vi.fn(),
        }),
      )
    })
    expect(host.textContent).toContain('↑1.2k')
    expect(host.textContent).toContain('15%')
    // 没有「思考与工具 · N 步」这一层组壳；思考与工具各自是一行折叠项
    expect(host.textContent).not.toContain('思考与工具')
    expect(host.textContent).toContain('思考过程')
    expect(host.textContent).toContain('读资料')
    expect(host.querySelectorAll('button').length).toBeGreaterThanOrEqual(2)

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})