/**
 * 柱形频谱纯数学层的用例（见 src/lib/audio/bars.ts）。
 *
 * 钉的都是肉眼验收不了的事：
 * 1. 频段对数分布且首尾相接：不重叠、不留缝、跳过直流频点，低频柱窄高频柱宽；
 * 2. 取值是段内峰值（不是均值），再压 gamma；
 * 3. 重力：涨即时、落缓慢、不跌穿目标。
 */
import { describe, expect, it } from 'vitest'
import { applyGravity, barRanges, BAR_COUNT, GAMMA, sampleBars } from '../src/lib/audio/bars'

describe('barRanges', () => {
  it('首尾相接：不重叠、不留缝，且从 1 号频点开始（跳过直流）', () => {
    const ranges = barRanges(44100, 1024, BAR_COUNT)
    expect(ranges).toHaveLength(BAR_COUNT)
    expect(ranges[0][0]).toBe(1)
    for (let i = 0; i < BAR_COUNT; i++) {
      const [start, end] = ranges[i]
      expect(end).toBeGreaterThan(start)
      if (i > 0) expect(start).toBeGreaterThanOrEqual(ranges[i - 1][1])
    }
  })

  it('低频柱窄、高频柱宽（对数分布）', () => {
    const ranges = barRanges(44100, 1024, BAR_COUNT)
    const first = ranges[0][1] - ranges[0][0]
    const last = ranges[BAR_COUNT - 1][1] - ranges[BAR_COUNT - 1][0]
    expect(last).toBeGreaterThan(first * 4)
  })

  it('频段不越过频点数上限', () => {
    const ranges = barRanges(44100, 1024, BAR_COUNT)
    expect(ranges[BAR_COUNT - 1][1]).toBeLessThanOrEqual(1024)
  })
})

describe('sampleBars', () => {
  it('均匀频谱 → 各柱等高，值是 gamma 整形后的 128/255', () => {
    const freq = new Uint8Array(1024).fill(128)
    const out = new Float32Array(BAR_COUNT)
    sampleBars(freq, barRanges(44100, 1024, BAR_COUNT), out)
    for (const v of out) expect(v).toBeCloseTo(Math.pow(128 / 255, GAMMA), 5)
  })

  it('段内取峰值：只照亮峰所在的那根柱', () => {
    const ranges = barRanges(44100, 1024, BAR_COUNT)
    const freq = new Uint8Array(1024)
    freq[ranges[5][0]] = 255
    const out = new Float32Array(BAR_COUNT)
    sampleBars(freq, ranges, out)
    expect(out[5]).toBe(1)
    for (let i = 0; i < BAR_COUNT; i++) if (i !== 5) expect(out[i]).toBe(0)
  })
})

describe('applyGravity', () => {
  it('上升即时到位，下降按 fall 线性回落', () => {
    const shown = new Float32Array([0.2, 0.8, 0])
    const target = new Float32Array([0.6, 0.3, 0])
    applyGravity(shown, target, 0.05)
    expect(shown[0]).toBeCloseTo(0.6) // 涨：一步到顶
    expect(shown[1]).toBeCloseTo(0.75) // 跌：0.8 - 0.05
    expect(shown[2]).toBeCloseTo(0)
  })

  it('下降不会跌穿目标', () => {
    const shown = new Float32Array([0.06])
    applyGravity(shown, new Float32Array([0.04]), 0.05)
    expect(shown[0]).toBeCloseTo(0.04)
  })
})
