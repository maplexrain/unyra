/**
 * 柱形频谱纯数学层的用例（见 src/lib/audio/bars.ts）。
 *
 * 钉的都是肉眼验收不了的事：
 * 1. 柱数按宽度现算：按目标柱距取整并夹在上下限里；
 * 2. 频段对数分布且首尾相接：不重叠、不留缝、跳过直流频点，低频柱窄高频柱宽；
 * 3. 取值是段内峰值（不是均值），再压 gamma；
 * 4. 段间平滑把单柱尖刺摊给邻居，常数信号不被抹平；
 * 5. 重力：柱身与峰值帽都涨即时、落缓慢，帽比柱身落得慢、都不跌穿目标；
 * 6. 静音呼吸：恒定小幅涟漪、不超过 amp、不把满高柱顶过 1。
 */
import { describe, expect, it } from 'vitest'
import {
  addBreath,
  applyGravity,
  barCount,
  barRanges,
  GAMMA,
  sampleBars,
  smoothBars,
} from '../src/lib/audio/bars'

describe('barCount', () => {
  it('按目标柱距向下取整（200px → 28 根，264px → 37 根）', () => {
    expect(barCount(200)).toBe(28)
    expect(barCount(264)).toBe(37)
  })

  it('夹在上下限里：再窄不少于 8 根，再宽不多于 96 根', () => {
    expect(barCount(20)).toBe(8)
    expect(barCount(4000)).toBe(96)
  })
})

describe('barRanges', () => {
  it('首尾相接：不重叠、不留缝，且从 1 号频点开始（跳过直流）', () => {
    const ranges = barRanges(44100, 1024, 28)
    expect(ranges).toHaveLength(28)
    expect(ranges[0][0]).toBe(1)
    for (let i = 0; i < 28; i++) {
      const [start, end] = ranges[i]
      expect(end).toBeGreaterThan(start)
      if (i > 0) expect(start).toBeGreaterThanOrEqual(ranges[i - 1][1])
    }
  })

  it('低频柱窄、高频柱宽（对数分布）', () => {
    const ranges = barRanges(44100, 1024, 28)
    const first = ranges[0][1] - ranges[0][0]
    const last = ranges[28 - 1][1] - ranges[28 - 1][0]
    expect(last).toBeGreaterThan(first * 4)
  })

  it('频段不越过频点数上限', () => {
    const ranges = barRanges(44100, 1024, 28)
    expect(ranges[28 - 1][1]).toBeLessThanOrEqual(1024)
  })
})

describe('sampleBars', () => {
  it('均匀频谱 → 各柱等高，值是 gamma 整形后的 128/255', () => {
    const freq = new Uint8Array(1024).fill(128)
    const out = new Float32Array(28)
    sampleBars(freq, barRanges(44100, 1024, 28), out)
    for (const v of out) expect(v).toBeCloseTo(Math.pow(128 / 255, GAMMA), 5)
  })

  it('段内取峰值：只照亮峰所在的那根柱', () => {
    const ranges = barRanges(44100, 1024, 28)
    const freq = new Uint8Array(1024)
    freq[ranges[5][0]] = 255
    const out = new Float32Array(28)
    sampleBars(freq, ranges, out)
    expect(out[5]).toBe(1)
    for (let i = 0; i < 28; i++) if (i !== 5) expect(out[i]).toBe(0)
  })
})

describe('smoothBars', () => {
  it('单柱尖刺被摊薄（三点盒滤波），端点不动', () => {
    const values = new Float32Array([0, 1, 0])
    smoothBars(values)
    expect(values[1]).toBeCloseTo(0.5, 5)
    expect(values[0]).toBe(0)
    expect(values[2]).toBe(0)
  })

  it('常数信号平滑后不变', () => {
    const values = new Float32Array([0.4, 0.4, 0.4, 0.4])
    smoothBars(values)
    for (const v of values) expect(v).toBeCloseTo(0.4, 5)
  })
})

describe('applyGravity', () => {
  it('柱身上升即时到位，下降按 fall 线性回落', () => {
    const shown = new Float32Array([0.2, 0.8, 0])
    const caps = new Float32Array([0.2, 0.8, 0])
    const target = new Float32Array([0.6, 0.3, 0])
    applyGravity(shown, caps, target, 0.05, 0.02)
    expect(shown[0]).toBeCloseTo(0.6) // 涨：一步到顶
    expect(shown[1]).toBeCloseTo(0.75) // 跌：0.8 - 0.05
    expect(shown[2]).toBeCloseTo(0)
  })

  it('峰值帽上涨同样即时，但下落比柱身慢——悬在柱身上方', () => {
    const shown = new Float32Array([0.8])
    const caps = new Float32Array([0.8])
    applyGravity(shown, caps, new Float32Array([0]), 0.05, 0.02)
    expect(shown[0]).toBeCloseTo(0.75)
    expect(caps[0]).toBeCloseTo(0.78)
    expect(caps[0]).toBeGreaterThan(shown[0])
  })

  it('柱身与帽下降都不跌穿目标', () => {
    const shown = new Float32Array([0.06])
    const caps = new Float32Array([0.045])
    applyGravity(shown, caps, new Float32Array([0.04]), 0.05, 0.02)
    expect(shown[0]).toBeCloseTo(0.04)
    expect(caps[0]).toBeCloseTo(0.04)
  })
})

describe('addBreath', () => {
  it('t=0 时第 0 根柱抬半幅（sin(0)=0），涟漪在柱间错相游动', () => {
    const values = new Float32Array([0, 0])
    addBreath(values, 0, 0.05)
    expect(values[0]).toBeCloseTo(0.025, 5)
    expect(values[1]).toBeLessThan(0.025) // 相位滞后，此刻更低
    expect(values[1]).toBeGreaterThanOrEqual(0)
  })

  it('静音（全 0）时涟漪不超幅', () => {
    const values = new Float32Array(28)
    addBreath(values, 9876, 0.055)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0.055)
    }
  })

  it('已满高的柱不被顶过 1', () => {
    const values = new Float32Array([1, 1])
    addBreath(values, 1234, 0.055)
    for (const v of values) expect(v).toBeLessThanOrEqual(1)
  })
})
