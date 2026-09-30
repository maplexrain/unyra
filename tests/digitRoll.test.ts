/**
 * 跳字的纯逻辑：哪几位该跳。
 *
 * 这层逻辑值得钉死的原因很实际——「每秒重跳整串」与「只跳变了的那一位」在代码上
 * 只差一行，在眼睛里的差别却是「安静地走」与「一直在闪」。
 */
import { describe, expect, it } from 'vitest'

import { changedDigits, digitSlots } from '../src/lib/digitRoll'

describe('哪几位变了', () => {
  it('只跳动了的那一位', () => {
    expect(changedDigits('10:00', '10:01')).toEqual([0])
    expect(changedDigits('10:00', '10:00')).toEqual([])
  })

  it('进位时连着跳：59 秒 → 00 秒，个位与十位都变（中间的冒号不算）', () => {
    expect(changedDigits('10:59', '11:00')).toEqual([0, 1, 3])
  })

  it('宽度变了也认得出（从右往左对齐）：59:59 → 1:00:00 只多出左边那一位', () => {
    const moved = changedDigits('59:59', '1:00:00')
    // 右边两位（秒）+ 原来那位 9 分 + 新出来的两位
    expect(moved).toContain(0)
    expect(moved).toContain(1)
    expect(moved).toContain(6)
    expect(moved).toHaveLength(6)
  })

  it('日期时间串：只有秒那两格会动', () => {
    expect(changedDigits('2026/02/14 21:04:07', '2026/02/14 21:04:08')).toEqual([0])
    expect(changedDigits('2026/02/14 21:04:59', '2026/02/14 21:05:00')).toEqual([0, 1, 3])
  })
})

describe('切位', () => {
  it('从左到右排，每一项带从右数的序号', () => {
    expect(digitSlots('12:30')).toEqual([
      { ch: '1', fromEnd: 4 },
      { ch: '2', fromEnd: 3 },
      { ch: ':', fromEnd: 2 },
      { ch: '3', fromEnd: 1 },
      { ch: '0', fromEnd: 0 },
    ])
  })

  it('空格也算一位（顶栏那颗钟里「日期 时间」靠它隔开）', () => {
    expect(digitSlots('a b').map((s) => s.ch)).toEqual(['a', ' ', 'b'])
  })
})
