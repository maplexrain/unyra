import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearMockUpdate,
  formatBytes,
  isMockUpdateActive,
  mockUpdatePush,
  notesHtml,
} from '../src/lib/update'

describe('mockUpdate', () => {
  beforeEach(() => {
    clearMockUpdate()
  })

  it('initially has no active mock update', () => {
    expect(isMockUpdateActive()).toBe(false)
  })

  it('pushes mock update with ready phase and release notes', () => {
    mockUpdatePush()
    expect(isMockUpdateActive()).toBe(true)
  })

  it('allows overriding mock update version and releaseName', () => {
    mockUpdatePush({
      version: '2.0.0-beta',
      releaseName: '归一 v2.0 测试版',
    })
    expect(isMockUpdateActive()).toBe(true)
  })

  it('clears mock update and returns to idle', () => {
    mockUpdatePush()
    expect(isMockUpdateActive()).toBe(true)

    clearMockUpdate()
    expect(isMockUpdateActive()).toBe(false)
  })

  it('formats bytes correctly', () => {
    expect(formatBytes(1500)).toBe('2 KB')
    expect(formatBytes(50_000_000)).toBe('50.0 MB')
    expect(formatBytes(0)).toBe('—')
  })

  it('sanitizes notes HTML safely', () => {
    const raw = '<h3>新特性</h3><p>内容</p><script>alert("xss")</script>'
    const sanitized = notesHtml(raw)
    expect(sanitized).toContain('<h3>新特性</h3>')
    expect(sanitized).not.toContain('<script>')
  })
})
