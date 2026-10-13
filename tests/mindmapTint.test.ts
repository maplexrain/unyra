/**
 * 思维导图节点自定义颜色（tint）的读盘归一与取色。
 *
 * 这几条守的是同一件事：**画不出来的颜色绝不能进渲染**，以及「有没有自定义色」
 * 在数据里只有一种表示（空串 / 'default' / 不认识的词都算「没有」）。
 */
import { describe, expect, it } from 'vitest'
import {
  TINT_PALETTE,
  normalizeTint,
  tintColor,
  tintSwatch,
} from '../src/components/learn/outline/mindmapTint'
import { normalizeNode } from '../src/learn/store/normalize/node'

describe('思维导图节点颜色 (tint)', () => {
  it('认调色板里的色名', () => {
    expect(normalizeTint('竹青')).toBe('竹青')
    expect(normalizeTint('墨灰')).toBe('墨灰')
    // 前后空白不碍事
    expect(normalizeTint('  黛蓝  ')).toBe('黛蓝')
  })

  it('空串 / default / 不认识的词 / 非字符串一律当「没有自定义色」', () => {
    expect(normalizeTint('')).toBeNull()
    expect(normalizeTint('   ')).toBeNull()
    // default 是菜单里那一格的名字，落到数据上等于「我没改过」
    expect(normalizeTint('default')).toBeNull()
    // 手改数据里可能写成色值或别的词——一律丢掉，绝不让它进渲染
    expect(normalizeTint('#ff0000')).toBeNull()
    expect(normalizeTint('蓝色')).toBeNull()
    expect(normalizeTint(undefined)).toBeNull()
    expect(normalizeTint(null)).toBeNull()
    expect(normalizeTint(42)).toBeNull()
  })

  it('调色板第一项是「默认」，它不参与取色（没有自定义色就是 null）', () => {
    expect(TINT_PALETTE[0].name).toBe('default')
    expect(tintColor('default', false)).toBeNull()
    expect(tintColor(undefined, false)).toBeNull()
    expect(tintColor('竹青', false)).toBe('#059669')
  })

  it('同一个色名在浅色与深色下给不同的值', () => {
    const light = tintColor('竹青', false)
    const dark = tintColor('竹青', true)
    expect(light).not.toBe(dark)
    // 深色底上要提亮，否则糊成一片
    expect(light).toBe('#059669')
    expect(dark).toBe('#34d399')
  })

  it('每个色名都有浅色与深色两档，且都能取到值', () => {
    for (const sw of TINT_PALETTE) {
      if (sw.name === 'default') continue
      expect(sw.light).toMatch(/^#[0-9a-f]{6}$/i)
      expect(sw.dark).toMatch(/^#[0-9a-f]{6}$/i)
      expect(tintColor(sw.name, false)).toBe(sw.light)
      expect(tintColor(sw.name, true)).toBe(sw.dark)
      expect(normalizeTint(sw.name)).toBe(sw.name)
    }
  })

  it('tintSwatch 取到那一项（菜单要高亮当前是哪一格）；认识不出来时 null', () => {
    expect(tintSwatch('丹砂')?.label).toBe('丹砂')
    expect(tintSwatch('default')?.name).toBe('default')
    expect(tintSwatch('不存在的颜色')).toBeNull()
    expect(tintSwatch(undefined)).toBeNull()
  })

  it('读盘：认识的颜色留一个 tint 键，不认识 / 空的不留', () => {
    const base = { id: 'n1', title: '导数', goalId: 'g1' }
    expect(normalizeNode({ ...base, tint: '松石' })?.tint).toBe('松石')
    expect(normalizeNode({ ...base, tint: '' })).not.toHaveProperty('tint')
    expect(normalizeNode({ ...base, tint: 'default' })).not.toHaveProperty('tint')
    expect(normalizeNode({ ...base, tint: '瞎写的' })).not.toHaveProperty('tint')
    // 老数据没有这一项：一样是没有，而不是空
    expect(normalizeNode(base)).not.toHaveProperty('tint')
  })
})
