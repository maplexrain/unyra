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

  it('外部 agent 消息铺满整行、去掉边框圆角，超过 400px 可展开/收起', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const longText = Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行正文`).join('\n')
    const msg: ConversationMessage = {
      id: 'm4',
      role: 'user',
      ts: 1_700_000_000_000,
      parts: [{ type: 'text', text: longText }],
      channel: {
        channel: 'agent',
        from: { kind: 'role', id: 'researcher', name: '调研龟' },
        to: { kind: 'role', id: 'tutor', name: '导师龟' },
        ts: 1_700_000_000_000,
        envelopeId: 'e4',
      },
    }
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 900,
    })
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
    const row = host.querySelector('[data-mind-message-id="m4"]')
    expect(row?.getAttribute('data-mind-collapsible')).toBe('true')
    expect(row?.getAttribute('data-mind-expanded')).toBe('false')
    expect(row?.className).not.toContain('rounded-lg')
    expect(row?.className).toContain('border-l-2')
    expect(row?.querySelector('.max-h-\\[400px\\]')).not.toBeNull()
    expect(row?.querySelector('.flex-1')).not.toBeNull()
    const toggle = Array.from(row?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('展开全文'),
    )
    expect(toggle).not.toBeUndefined()
    act(() => {
      toggle?.click()
    })
    expect(row?.getAttribute('data-mind-expanded')).toBe('true')
    expect(row?.querySelector('.max-h-\\[400px\\]')).toBeNull()
    expect(row?.textContent).toContain('收起')
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original)
    else delete (HTMLElement.prototype as any).scrollHeight
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('同一条消息的思考 / 工具 / 正文拆成同等级的行，只有首行重复发信人抬头', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const msg: ConversationMessage = {
      id: 'm5',
      role: 'assistant',
      ts: 1_700_000_000_000,
      parts: [
        { type: 'thinking', text: '先读一下资料' },
        {
          type: 'tool',
          id: 't5',
          name: 'execute',
          args: JSON.stringify({ description: '读资料', body: 'await api.node.list()' }),
          result: 'ok',
          ok: true,
          status: 'done',
        },
        { type: 'text', text: '资料读完了。' },
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

    const units = [...host.querySelectorAll<HTMLElement>('[data-mind-unit-id]')]
    expect(units).toHaveLength(3)
    expect(units.map((row) => row.getAttribute('data-mind-part-type'))).toEqual([
      'thinking',
      'tool',
      'text',
    ])
    // 一条消息只有一个抬头，后面两步不再重复「导师龟 00:00」
    expect(host.querySelectorAll('[data-mind-channel]')).toHaveLength(1)
    expect(host.querySelectorAll('[data-mind-message-id="m5"]')).toHaveLength(1)
    for (const row of units) {
      expect(row.className).not.toContain('rounded-lg')
    }
    expect(units[0].textContent).toContain('思考过程')
    expect(units[1].textContent).toContain('读资料')
    expect(units[2].textContent).toContain('资料读完了。')

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('work 消息拆成原子行后，每一行都标明属于哪只 work', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const msg: ConversationMessage = {
      id: 'wm5',
      role: 'assistant',
      ts: 1_700_000_000_000,
      parts: [
        { type: 'text', text: '先派发任务' },
        {
          type: 'tool',
          id: 't6',
          name: 'execute',
          args: JSON.stringify({ description: '派发', body: 'await api.work.send({})' }),
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
          agentName: '调研龟',
          faded: false,
          flash: false,
          work: { id: 'w1', name: 'medium-tools-article' },
          setBubblePreview: vi.fn(),
        }),
      )
    })

    const units = [...host.querySelectorAll<HTMLElement>('[data-mind-unit-id]')]
    expect(units).toHaveLength(2)
    expect(units.every((row) => row.getAttribute('data-work-message') === 'w1')).toBe(true)
    expect(units.every((row) => row.getAttribute('data-work-marker') === 'medium-tools-article')).toBe(true)
    expect(units.every((row) => row.querySelector('[data-work-chip]')?.textContent?.includes('Work') ?? false)).toBe(true)
    expect(units.every((row) => !row.className.includes('bg-amber-500/10'))).toBe(true)
    expect(units.every((row) => row.style.filter === 'brightness(0.8)')).toBe(true)
    expect(units.every((row) => row.getAttribute('data-mind-unit-ts') === '1700000000000')).toBe(true)
    expect(units.every((row) => /\d{2}:\d{2}/.test(row.textContent ?? ''))).toBe(true)
    expect(units[0].textContent).toContain('medium-tools-article')
    expect(units[1].textContent).toContain('Work')
    expect(units[1].textContent).toContain('medium-tools-article')
    expect(units[1].querySelector('[data-mind-channel]')).toBeNull()

    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('work 收发两个方向用不同左侧色条区分', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const inbound: ConversationMessage = {
      id: 'win',
      role: 'user',
      ts: 1_700_000_000_000,
      parts: [{ type: 'text', text: 'role 派给 work 的任务' }],
      channel: {
        channel: 'work',
        from: { kind: 'role', id: 'tutor', name: '导师龟' },
        to: { kind: 'work', id: 'w1', name: '调研-A' },
        ts: 1_700_000_000_000,
        envelopeId: 'e-in',
      },
    }
    const outbound: ConversationMessage = {
      id: 'wout',
      role: 'assistant',
      ts: 1_700_000_000_100,
      parts: [{ type: 'text', text: 'work 交回 role 的交付' }],
      channel: {
        channel: 'work',
        from: { kind: 'work', id: 'w1', name: '调研-A' },
        to: { kind: 'role', id: 'tutor', name: '导师龟' },
        ts: 1_700_000_000_100,
        envelopeId: 'e-out',
      },
    }
    act(() => {
      root.render(
        createElement(
          'div',
          null,
          createElement(MindMessageRow, {
            m: inbound,
            agentName: '导师龟',
            faded: false,
            flash: false,
            work: { id: 'w1', name: '调研-A' },
            setBubblePreview: vi.fn(),
          }),
          createElement(MindMessageRow, {
            m: outbound,
            agentName: '导师龟',
            faded: false,
            flash: false,
            setBubblePreview: vi.fn(),
          }),
        ),
      )
    })
    const inRow = host.querySelector('[data-mind-message-id="win"]')
    const outRow = host.querySelector('[data-mind-message-id="wout"]')
    expect(inRow?.getAttribute('data-work-transfer')).toBe('work-in')
    expect(inRow?.className).toContain('border-l-amber-500/70')
    expect(outRow?.getAttribute('data-work-transfer')).toBe('work-out')
    expect(outRow?.className).toContain('border-l-violet-500/70')
    expect((inRow as HTMLElement | null)?.style.filter).toBe('brightness(0.8)')
    expect((outRow as HTMLElement | null)?.style.filter).toBe('brightness(0.8)')
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