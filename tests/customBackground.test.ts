import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CUSTOM_BACKGROUND,
  normalizeCustomBackground,
} from '../src/lib/customBackground'

describe('customBackground', () => {
  it('默认配置使用 70% 不透明度', () => {
    expect(DEFAULT_CUSTOM_BACKGROUND.uiOpacity).toBe(70)
    expect(DEFAULT_CUSTOM_BACKGROUND.enabled).toBe(false)
    expect(DEFAULT_CUSTOM_BACKGROUND.mode).toBe('single')
  })

  it('normalizeCustomBackground 规范化非法与缺省参数', () => {
    const empty = normalizeCustomBackground({})
    expect(empty.uiOpacity).toBe(70)
    expect(empty.blur).toBe(0)
    expect(empty.enabled).toBe(false)

    const custom = normalizeCustomBackground({
      enabled: true,
      uiOpacity: 55,
      blur: 12,
    })
    expect(custom.enabled).toBe(true)
    expect(custom.uiOpacity).toBe(55)
    expect(custom.blur).toBe(12)
  })

  it('normalizeCustomBackground 限制不透明度与虚化在有效范围', () => {
    const low = normalizeCustomBackground({ uiOpacity: 10, blur: -5 })
    expect(low.uiOpacity).toBe(30)
    expect(low.blur).toBe(0)

    const high = normalizeCustomBackground({ uiOpacity: 120, blur: 50 })
    expect(high.uiOpacity).toBe(95)
    expect(high.blur).toBe(30)
  })

  it('normalizeCustomBackground 严格去重图组 ID', () => {
    const dup = normalizeCustomBackground({
      groups: [
        { id: 'g1', name: 'Group 1', images: [] },
        { id: 'g1', name: 'Group 1 duplicate', images: [] },
        { id: 'g2', name: 'Group 2', images: [] },
      ],
    })
    const g1Count = dup.groups.filter((g) => g.id === 'g1').length
    expect(g1Count).toBe(1)
  })
})
