// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAgentViewMode,
  setAgentViewMode,
  subscribeAgentViewMode,
} from '../src/components/agent/agentViewMode'

describe('agentViewMode', () => {
  beforeEach(() => {
    localStorage.clear()
    setAgentViewMode('chat')
  })

  it('全局共用一份：切换后所有订阅者立即看到同一个值', () => {
    const seen: string[] = []
    const unsubscribe = subscribeAgentViewMode(() => seen.push(getAgentViewMode()))
    setAgentViewMode('mind')
    expect(getAgentViewMode()).toBe('mind')
    expect(seen).toEqual(['mind'])
    setAgentViewMode('mind')
    expect(seen).toEqual(['mind'])
    setAgentViewMode('chat')
    expect(seen).toEqual(['mind', 'chat'])
    unsubscribe()
  })

  it('刷新后沿用上次停留的层', async () => {
    setAgentViewMode('mind')
    expect(localStorage.getItem('moji:agent:viewMode')).toBe('mind')
    vi.resetModules()
    const fresh = await import('../src/components/agent/agentViewMode')
    expect(fresh.getAgentViewMode()).toBe('mind')
  })
})
