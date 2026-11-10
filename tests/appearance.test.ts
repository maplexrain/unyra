import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  clampUiFontScale,
  UI_FONT_SCALE_MIN,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_DEFAULT,
} from '../src/lib/appearance'

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

  it('normalizeAppearance 支持 fontFamily 与 textStroke 设置项', () => {
    expect(DEFAULT_APPEARANCE.fontFamily).toBe('')
    expect(DEFAULT_APPEARANCE.textStrokeEnabled).toBe(false)
    expect(DEFAULT_APPEARANCE.textStrokeColor).toBe('#1f1b17')
    expect(DEFAULT_APPEARANCE.textStrokeWidth).toBe(1.0)

    const normalized = normalizeAppearance({
      fontFamily: "'Microsoft YaHei', sans-serif",
      textStrokeEnabled: true,
      textStrokeColor: '#ffffff',
      textStrokeWidth: 0.65,
    })

    expect(normalized.fontFamily).toBe("'Microsoft YaHei', sans-serif")
    expect(normalized.textStrokeEnabled).toBe(true)
    expect(normalized.textStrokeColor).toBe('#ffffff')
    expect(normalized.textStrokeWidth).toBe(0.65)

    // 限制范围在 0.0 - 1.0 之间
    const clampedMax = normalizeAppearance({ textStrokeWidth: 2.5 })
    expect(clampedMax.textStrokeWidth).toBe(1.0)

    const clampedMin = normalizeAppearance({ textStrokeWidth: -0.5 })
    expect(clampedMin.textStrokeWidth).toBe(0.0)
  })

  it('支持全局 UI 字体大小系数 uiFontScale 配置与夹取范围', () => {
    expect(DEFAULT_APPEARANCE.uiFontScale).toBe(1.0)
    expect(UI_FONT_SCALE_DEFAULT).toBe(1.0)
    expect(UI_FONT_SCALE_MIN).toBe(0.8)
    expect(UI_FONT_SCALE_MAX).toBe(1.4)

    // 默认空对象应回落到 1.0
    expect(normalizeAppearance({}).uiFontScale).toBe(1.0)

    // 正常系数
    const custom = normalizeAppearance({ uiFontScale: 1.15 })
    expect(custom.uiFontScale).toBe(1.15)

    // 超过上限 1.4 应被夹取到 1.4
    expect(clampUiFontScale(1.8)).toBe(1.4)
    expect(normalizeAppearance({ uiFontScale: 2.0 }).uiFontScale).toBe(1.4)

    // 低于下限 0.8 应被夹取到 0.8
    expect(clampUiFontScale(0.5)).toBe(0.8)
    expect(normalizeAppearance({ uiFontScale: 0.3 }).uiFontScale).toBe(0.8)

    // 非法数字回退默认
    expect(clampUiFontScale(NaN)).toBe(1.0)
  })
})
