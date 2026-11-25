// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  chatReadMark,
  markChatRead,
  resetChatReadIndexCache,
  unreadAfter,
  useChatReadIndex,
} from '../src/components/agent/panel/messageReadIndex'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const m = (id: string, ts: number) => ({ id, ts })

function Probe({ list, pinned }: { list: { id: string; ts: number }[]; pinned: boolean }) {
  const unread = useChatReadIndex('group:probe', list, pinned)
  return React.createElement('span', { 'data-unread': String(unread) })
}

describe('消息浏览记录（按通道）', () => {
  beforeEach(() => {
    localStorage.clear()
    resetChatReadIndexCache()
  })

  it('没有浏览记录时算 0；记到第一条后只数它后面的', () => {
    const list = [m('a', 10), m('b', 20), m('c', 30)]
    expect(unreadAfter(list, null)).toBe(0)
    expect(markChatRead('group:g1', list[0], 3)).toBe(true)
    expect(unreadAfter(list, chatReadMark('group:g1'))).toBe(2)
    // 同一条再记一次不重复写
    expect(markChatRead('group:g1', list[0], 3)).toBe(false)
  })

  it('通道彼此隔离：读了一级群聊不影响评论串', () => {
    const list = [m('a', 10), m('b', 20)]
    markChatRead('group:g1', list[1], 2)
    expect(unreadAfter(list, chatReadMark('group:g1'))).toBe(0)
    expect(unreadAfter(list, chatReadMark('group:g1:thread:r1'))).toBe(0)

    markChatRead('group:g1:thread:r1', list[0], 2)
    expect(unreadAfter(list, chatReadMark('group:g1:thread:r1'))).toBe(1)
    // 一级群聊的记录不被评论串的推进覆盖
    expect(chatReadMark('group:g1')!.id).toBe('b')
    expect(chatReadMark('group:g1:thread:r1')!.id).toBe('a')
  })

  it('记录的消息 id 已被历史裁掉时按 ts 兜底，不会把旧消息算成新消息', () => {
    const trimmed = [m('x', 100), m('y', 200)]
    expect(unreadAfter(trimmed, { id: 'gone', ts: 50, total: 999 })).toBe(2)
    expect(unreadAfter(trimmed, { id: 'gone', ts: 150, total: 999 })).toBe(1)
    expect(unreadAfter(trimmed, { id: 'gone', ts: 250, total: 999 })).toBe(0)
  })

  it('hook：贴底时推进浏览位置，脱离后新到的消息才计入角标', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const a = m('a', 10)
    const b = m('b', 20)
    const c = m('c', 30)

    act(() => {
      root.render(React.createElement(Probe, { list: [a], pinned: true }))
    })
    act(() => {
      root.render(React.createElement(Probe, { list: [a, b], pinned: true }))
    })
    expect(chatReadMark('group:probe')!.id).toBe('b')
    expect(host.querySelector('[data-unread]')?.getAttribute('data-unread')).toBe('0')

    act(() => {
      root.render(React.createElement(Probe, { list: [a, b, c], pinned: false }))
    })
    expect(host.querySelector('[data-unread]')?.getAttribute('data-unread')).toBe('1')

    act(() => {
      root.unmount()
    })
    host.remove()
  })
})
