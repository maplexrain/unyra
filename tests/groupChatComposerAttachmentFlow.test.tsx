// @vitest-environment happy-dom
/**
 * 群聊输入区的附件从「系统文件选择」到「点发送」的完整前端链路。
 *
 * 回归的是用户实际遇到的症状：输入区看得见附件，点发送后群消息却没有 attachments。
 * 这一层不碰磁盘，只验 pick → pending → onSend 第四参有没有把引用带出去。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const pickAttach = vi.fn(async () => ({ ok: true, paths: ['C:\\tmp\\shot.png'] }))
const readAttach = vi.fn(async () => ({
  ok: true,
  name: 'shot.png',
  bytes: 12,
  kind: 'image' as const,
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
}))

vi.mock('../src/lib/native', () => ({
  native: () => ({ local: { pickAttach, readAttach } }),
}))

import { GroupChatPanel } from '../src/components/agent/panel/GroupChatPanel'

const agents = [{ id: 'tutor' as const, name: '导师龟' }]

function typeText(host: HTMLElement, value: string): void {
  const textarea = host.querySelector('textarea') as HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('群聊输入区附件链路', () => {
  it('文件选择器的图片先进入待发送列，发送时作为 images 传给宿主', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSend = vi.fn(() => true)

    act(() => {
      root.render(createElement(GroupChatPanel, { messages: [], agents, onSend }))
    })
    const attachButton = [...host.querySelectorAll('button')].find((b) => b.title === '添加附件')
    expect(attachButton).not.toBeNull()

    await act(async () => {
      attachButton!.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host.querySelector('[data-group-composer-attachments]')).not.toBeNull()
    expect(host.querySelector('[data-group-composer-attachments] img')).not.toBeNull()

    typeText(host, '看这张图')
    await act(async () => {
      ;[...host.querySelectorAll('button')].find((b) => b.title === '发送')!.click()
      await Promise.resolve()
    })

    expect(onSend).toHaveBeenCalledTimes(1)
    const call = onSend.mock.calls[0] as unknown[]
    const attachments = call[3] as { images?: { name: string }[] } | undefined
    expect(attachments?.images?.map((i) => i.name)).toEqual(['shot.png'])

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
