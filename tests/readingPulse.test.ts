/**
 * 有效阅读进度条的单元用例。
 *
 * 钉的是刻度的边界：一分钟一格、十格一轮回、整分钟那一刻是「新的颜色从 0 开始」
 * 而不是「旧的停在满格」。这几处错一点，进度条就会在整分钟时闪回或卡住——
 * 而它每秒都在用户眼皮底下，错了很难不被看见。
 */
import { describe, expect, it } from 'vitest'

import { PULSE_COLORS, PULSE_STEPS, pulseFrame } from '../src/lib/readingPulse'

const SEC = 1000

describe('刻度', () => {
  it('没有有效阅读时什么都不画', () => {
    expect(pulseFrame(0)).toBeNull()
    expect(pulseFrame(-1)).toBeNull()
    expect(pulseFrame(Number.NaN)).toBeNull()
  })

  it('第一分钟：配色 0 号，底下一格是空的（没有「上一条颜色」可垫）', () => {
    const half = pulseFrame(30 * SEC)
    expect(half?.minute).toBe(0)
    expect(half?.step).toBe(0)
    expect(half?.fraction).toBeCloseTo(0.5, 5)
    expect(half?.color).toBe(PULSE_COLORS[0])
    expect(half?.previous).toBeNull()
  })

  it('整分钟是「换色重走」：59.9 秒还在 0 号，满 60 秒变 1 号且从 0 开始', () => {
    const almost = pulseFrame(59_900)
    expect(almost?.step).toBe(0)
    expect(almost?.fraction).toBeGreaterThan(0.99)

    const next = pulseFrame(60 * SEC)
    expect(next?.minute).toBe(1)
    expect(next?.step).toBe(1)
    expect(next?.fraction).toBe(0)
    expect(next?.color).toBe(PULSE_COLORS[1])
    // 上一分钟的颜色垫在下面：新的一格要「盖掉」它
    expect(next?.previous).toBe(PULSE_COLORS[0])
  })

  it('十格一轮回：第 9 分钟是最后一色，第 10 分钟回到第一色', () => {
    expect(pulseFrame(9 * 60 * SEC + 10 * SEC)?.step).toBe(9)
    expect(pulseFrame(10 * 60 * SEC)?.step).toBe(0)
    expect(pulseFrame(10 * 60 * SEC)?.color).toBe(PULSE_COLORS[0])
    expect(pulseFrame(10 * 60 * SEC)?.previous).toBe(PULSE_COLORS[9])
  })

  it('长阅读继续按轮回走（23 分钟 → 3 号格）', () => {
    const f = pulseFrame(23 * 60 * SEC + 30 * SEC)
    expect(f?.minute).toBe(23)
    expect(f?.step).toBe(23 % PULSE_STEPS)
    expect(f?.color).toBe(PULSE_COLORS[3])
    expect(f?.fraction).toBeCloseTo(0.5, 5)
  })

  it('十格颜色两两不同（看得出「又走完一分钟」）', () => {
    expect(new Set(PULSE_COLORS).size).toBe(PULSE_STEPS)
  })
})
