import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../src/lib/appearance'

describe('appearance agentLeft default', () => {
  it('默认外观配置中 agentLeft 应为 false（文档区默认在主位，Agent 栏在右侧）', () => {
    expect(DEFAULT_APPEARANCE.agentLeft).toBe(false)
  })

  it('normalizeAppearance 在缺省或空对象时默认保持文档区在主位（agentLeft: false）', () => {
    const empty = normalizeAppearance({})
    expect(empty.agentLeft).toBe(false)

    const invalid = normalizeAppearance(null)
    expect(invalid.agentLeft).toBe(false)
  })

  it('normalizeAppearance 正确识别并保留用户明确配置的 agentLeft', () => {
    const withAgentLeft = normalizeAppearance({ agentLeft: true })
    expect(withAgentLeft.agentLeft).toBe(true)

    const withDocLeft = normalizeAppearance({ agentLeft: false })
    expect(withDocLeft.agentLeft).toBe(false)
  })

  it('normalizeAppearance 支持 fontFamily, textStroke 与 showTips 设置项', () => {
    expect(DEFAULT_APPEARANCE.fontFamily).toBe('')
    expect(DEFAULT_APPEARANCE.textStrokeEnabled).toBe(false)
    expect(DEFAULT_APPEARANCE.textStrokeColor).toBe('#1f1b17')
    expect(DEFAULT_APPEARANCE.textStrokeWidth).toBe(1.0)
    expect(DEFAULT_APPEARANCE.showTips).toBe(true)

    const normalized = normalizeAppearance({
      fontFamily: "'Microsoft YaHei', sans-serif",
      textStrokeEnabled: true,
      textStrokeColor: '#ffffff',
      textStrokeWidth: 0.65,
      showTips: false,
    })

    expect(normalized.fontFamily).toBe("'Microsoft YaHei', sans-serif")
    expect(normalized.textStrokeEnabled).toBe(true)
    expect(normalized.textStrokeColor).toBe('#ffffff')
    expect(normalized.textStrokeWidth).toBe(0.65)
    expect(normalized.showTips).toBe(false)

    // 限制范围在 0.0 - 1.0 之间
    const clampedMax = normalizeAppearance({ textStrokeWidth: 2.5 })
    expect(clampedMax.textStrokeWidth).toBe(1.0)

    const clampedMin = normalizeAppearance({ textStrokeWidth: -0.5 })
    expect(clampedMin.textStrokeWidth).toBe(0.0)
  })
})
