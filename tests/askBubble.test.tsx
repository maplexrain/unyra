/** ask 气泡：表单、倒计时条与超时后失效态 */
// @vitest-environment happy-dom
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskBubble } from '../src/components/agent/panel/AskBubble'
import type { ChannelAsk } from '../src/agent/types'

const ask = (status: ChannelAsk['status'], expiresAt: number): ChannelAsk => ({
  id: 'ask-1',
  form: {
    title: '确认难度',
    questions: [
      {
        id: 'level',
        type: 'single',
        prompt: '这次想练哪一档？',
        options: [
          { id: 'easy', label: '基础' },
          { id: 'hard', label: '挑战' },
        ],
      },
    ],
  },
  expiresAt,
  status,
})

const roots: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []
afterEach(() => {
  for (const { root, host } of roots) {
    act(() => root.unmount())
    host.remove()
  }
  roots.length = 0
})

describe('AskBubble', () => {
  it('pending 时显示表单、身份与倒计时条', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push({ root, host })
    act(() => {
      root.render(createElement(AskBubble, { ask: ask('pending', Date.now() + 60_000), actorName: '导师龟' }))
    })
    expect(host.textContent).toContain('导师龟')
    expect(host.textContent).toContain('确认难度')
    expect(host.textContent).toContain('基础')
    expect(host.querySelector('[aria-label="剩余时间"]')).not.toBeNull()
  })

  it('超时后只保留失效态，不再渲染可交互表单', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push({ root, host })
    act(() => {
      root.render(createElement(AskBubble, { ask: ask('expired', Date.now() - 1), actorName: '导师龟' }))
    })
    expect(host.textContent).toContain('表单已失效')
    expect(host.querySelector('textarea')).toBeNull()
  })

  it('倒计时到 0 会触发一次 onExpire', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push({ root, host })
    const onExpire = vi.fn()
    act(() => {
      root.render(
        createElement(AskBubble, {
          ask: ask('pending', Date.now() - 1),
          actorName: '导师龟',
          onExpire,
        }),
      )
    })
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('鼠标进入 / 移出会通知宿主暂停 / 恢复计时', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    roots.push({ root, host })
    const onHover = vi.fn()
    act(() => {
      root.render(
        createElement(AskBubble, {
          ask: ask('pending', Date.now() + 60_000),
          actorName: '导师龟',
          onHover,
        }),
      )
    })
    const bubble = host.firstElementChild as HTMLElement
    act(() => {
      bubble.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(onHover).toHaveBeenLastCalledWith(true)
    act(() => {
      bubble.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    expect(onHover).toHaveBeenLastCalledWith(false)
  })
})
