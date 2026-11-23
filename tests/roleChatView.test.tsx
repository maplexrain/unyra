// @vitest-environment happy-dom
/**
 * chat 层：用户第一人称、名字来自用户模块 / agent profile，不用「我」。
 */
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { RoleChatView } from '../src/components/agent/panel/RoleChatView'
import type { ChannelMessage } from '../src/agent/types'

const channel = (id: string, kind: 'user' | 'agent', direction: 'in' | 'out', from: string, text: string): ChannelMessage => ({
  id,
  kind,
  direction,
  from: { kind: kind === 'user' ? 'user' : 'role', id: from, name: from },
  to: { kind: 'role', id: 'tutor', name: '导师龟' },
  text,
  ts: 1000,
})

describe('RoleChatView', () => {
  it('用户消息按用户模块的名字显示；agent 消息显示真名，不再用「我」', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(
        createElement(RoleChatView, {
          channels: [
            channel('c1', 'user', 'in', '用户', '用户说的话'),
            channel('c2', 'user', 'out', '导师龟', 'agent 的回复'),
          ],
          agentName: '导师龟',
          agentAvatarId: undefined,
          agentVoice: 'tutor',
        }),
      )
    })

    expect(host.textContent).toContain('用户说的话')
    expect(host.textContent).toContain('agent 的回复')
    expect(host.textContent).toContain('导师龟')
    expect(host.textContent).not.toContain('我')
    // 用户模块没有加载时也走「未命名用户」，而不是历史信封里硬编码的“用户”
    expect(host.textContent).toContain('未命名用户')
    // 两侧都有头像位（agent 图标 / 用户兜底图标）
    expect(host.querySelectorAll('svg, img').length).toBeGreaterThanOrEqual(2)

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
