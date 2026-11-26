import { describe, expect, it } from 'vitest'
import { mindInspectorVisible, MIND_INSPECTOR_MIN_WIDTH } from '../src/components/agent/panel/mindLayout'

describe('mind 右侧状态面板宽度判据', () => {
  it('只在思维层且页宽达到 1400 时显示', () => {
    expect(mindInspectorVisible('chat', 2000)).toBe(false)
    expect(mindInspectorVisible('mind', MIND_INSPECTOR_MIN_WIDTH - 1)).toBe(false)
    expect(mindInspectorVisible('mind', MIND_INSPECTOR_MIN_WIDTH)).toBe(true)
  })
})
