// @vitest-environment happy-dom
/**
 * 全局群消息推送：顶部居中、可点击跳到群聊；关闭按钮只关本条提示。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { GroupMentionPush } from '../src/components/learn/workspace/GroupMentionPush'

describe('GroupMentionPush', () => {
  it('固定在顶部水平居中，显示 @用户 的群消息并支持点击跳转', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onOpen = vi.fn()
    const onClose = vi.fn()
    act(() => {
      root.render(
        createElement(GroupMentionPush, {
          push: {
            id: 'g1',
            goalId: 'goal-1',
            fromName: '导师龟',
            text: '@用户 极限讲义更新好了',
          },
          onOpen,
          onClose,
        }),
      )
    })
    const push = document.querySelector('[data-group-mention-push]')
    expect(push).not.toBeNull()
    expect(push!.className).toContain('left-1/2')
    expect(push!.className).toContain('top-4')
    expect(push!.className).toContain('-translate-x-1/2')
    expect(push!.textContent).toContain('导师龟')
    expect(push!.textContent).toContain('@用户 极限讲义更新好了')
    act(() => {
      push!.querySelector<HTMLElement>('[role="button"]')?.click()
    })
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ goalId: 'goal-1' }))
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      push!.querySelector<HTMLButtonElement>('[aria-label="关闭推送"]')?.click()
    })
    expect(onClose).toHaveBeenCalled()
    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
