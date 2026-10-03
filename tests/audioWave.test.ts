/**
 * 波浪可视化纯数学层的用例（见 src/lib/audio/wave.ts）。
 *
 * 钉的都是肉眼验收不了的事：
 * 1. 取点均匀铺满、首尾对齐采样首尾（波形不许凭空多出或丢掉一段）；
 * 2. 空间平滑把单点尖刺摊给邻居，但常数信号本身不被抹平；
 * 3. 时间平滑按 follow 逼近上一帧，首帧（prev=null）不缩水；
 * 4. 自适应增益：峰值瞬抬慢落、静音后爬回上限、大响度不放大（下限 0.9）。
 */
import { describe, expect, it } from 'vitest'
import { autoGain, sampleWave, WAVE_POINTS } from '../src/lib/audio/wave'

describe('sampleWave', () => {
  it('常数信号取点后仍是常数（平滑不许抹掉波形本身）', () => {
    const samples = new Float32Array(2048).fill(0.5)
    const ys = new Float32Array(WAVE_POINTS)
    sampleWave(samples, ys, null, 0.5)
    for (const v of ys) expect(v).toBeCloseTo(0.5, 5)
  })

  it('首尾点对齐采样的首尾', () => {
    const samples = new Float32Array(1000)
    samples[0] = -1
    samples[999] = 1
    const ys = new Float32Array(WAVE_POINTS)
    sampleWave(samples, ys, null, 1)
    expect(ys[0]).toBeCloseTo(-1, 5)
    expect(ys[WAVE_POINTS - 1]).toBeCloseTo(1, 5)
  })

  it('单点尖刺被摊给邻居（空间平滑生效），且不再孤立', () => {
    // 取点是最近邻（2048→160 大部分采样被跳过），尖刺必须放在会被取到的位置：
    // 第 80 个点对应采样 round(80 * 2047 / 159) = 1030
    const samples = new Float32Array(2048)
    samples[1030] = 1
    const ys = new Float32Array(WAVE_POINTS)
    sampleWave(samples, ys, null, 1)
    const at = ys.indexOf(Math.max(...ys))
    expect(at).toBe(80)
    expect(ys[at]).toBeCloseTo(0.5, 5) // 尖峰分了一半给两侧邻居
    expect(ys[at - 1]).toBeCloseTo(0.25, 5)
    expect(ys[at + 1]).toBeCloseTo(0.25, 5)
  })

  it('时间平滑按 follow 插值；首帧 prev=null 不缩水', () => {
    const samples = new Float32Array(64).fill(0.8)
    const ys = new Float32Array(32)
    sampleWave(samples, ys, null, 0.5)
    expect(ys[10]).toBeCloseTo(0.8, 5)
    sampleWave(samples, ys, new Float32Array(32), 0.5)
    expect(ys[10]).toBeCloseTo(0.4, 5) // 0 + (0.8 - 0) * 0.5
  })

  it('长度不一致的 prev 不参与平滑（防御）', () => {
    const samples = new Float32Array(64).fill(0.8)
    const ys = new Float32Array(32)
    sampleWave(samples, ys, new Float32Array(7), 0.5)
    expect(ys[0]).toBeCloseTo(0.8, 5)
  })
})

describe('autoGain', () => {
  it('峰值瞬抬：一帧就到目标增益（恰好抬到 92%）', () => {
    const peak = { value: 0 }
    const gain = autoGain(peak, new Float32Array(2048).fill(0.46), 0.998)
    expect(peak.value).toBeCloseTo(0.46, 5)
    expect(gain).toBeCloseTo(0.92 / 0.46, 5)
  })

  it('慢落：声音停下后峰值衰减、增益爬回来', () => {
    const peak = { value: 0.46 }
    const gain = autoGain(peak, new Float32Array(2048), 0.99)
    expect(peak.value).toBeCloseTo(0.4554, 5) // 0.46 * 0.99
    expect(gain).toBeCloseTo(0.92 / 0.4554, 5)
  })

  it('增益有下限 0.9：大响度不放大', () => {
    const gain = autoGain({ value: 0 }, new Float32Array(2048).fill(4), 0.998)
    expect(gain).toBe(0.9)
  })

  it('静音里增益最多爬到峰值地板（0.25）对应的上限', () => {
    const gain = autoGain({ value: 0 }, new Float32Array(2048), 0.998)
    expect(gain).toBeCloseTo(0.92 / 0.25, 5)
  })
})
