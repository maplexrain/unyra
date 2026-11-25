// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { FollowLatestButton } from '../src/components/agent/panel/MessageBubble'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

describe('FollowLatestButton（回到最新 + 新消息角标）', () => {
  it('有未读时显示数字角标，点击回到最新；99 以上收成 99+', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onClick = vi.fn()
    act(() => {
      root.render(createElement(FollowLatestButton, { onClick, unread: 91, className: 'right-4' }))
    })
    expect(host.querySelector('[data-unread-badge]')?.textContent).toBe('91')
    expect(host.querySelector('button')?.className).toContain('rounded-full')
    expect(host.querySelector('button')?.className).toContain('right-4')
    act(() => {
      host.querySelector<HTMLButtonElement>('button')!.click()
    })
    expect(onClick).toHaveBeenCalledTimes(1)
    act(() => {
      root.unmount()
    })
    host.remove()
  })

  it('没有未读时不显角标；角标超过 99 显示 99+', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(createElement(FollowLatestButton, { onClick: vi.fn(), unread: 0 }))
    })
    expect(host.querySelector('[data-unread-badge]')).toBeNull()
    act(() => {
      root.render(createElement(FollowLatestButton, { onClick: vi.fn(), unread: 120 }))
    })
    expect(host.querySelector('[data-unread-badge]')?.textContent).toBe('99+')
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
