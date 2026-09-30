/**
 * 超级导师设置的单元用例。
 *
 * 归一化是这个模块唯一的逻辑，也是最容易被绕过的一处：setting.yaml 是人手能改的，
 * 旧版本写进去的值也可能越界。阈值一旦是 0 或 2（比如手改成了 200%），
 * 压缩就会变成「每一轮都压」或者「永远不压」——两种都不会报错，只会让人觉得
 * 「这软件怎么突然变呆了」。所以这里钉的是夹取与兜底。
 */
import { describe, expect, it } from 'vitest'

import {
  COMPACT_THRESHOLD_MAX,
  COMPACT_THRESHOLD_MIN,
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
} from '../src/agent/settings'

describe('agent 设置的归一化', () => {
  it('什么都没有时给默认值：自动压缩、70%', () => {
    const s = normalizeAgentSettings(null)
    expect(s.compact).toEqual({ auto: true, threshold: 0.7 })
    expect(normalizeAgentSettings(undefined).compact.threshold).toBe(0.7)
    expect(normalizeAgentSettings({}).compact.auto).toBe(true)
  })

  it('阈值夹在可选区间里', () => {
    expect(normalizeAgentSettings({ compact: { threshold: 0.1 } }).compact.threshold).toBe(COMPACT_THRESHOLD_MIN)
    expect(normalizeAgentSettings({ compact: { threshold: 3 } }).compact.threshold).toBe(COMPACT_THRESHOLD_MAX)
    expect(normalizeAgentSettings({ compact: { threshold: 0.85 } }).compact.threshold).toBe(0.85)
  })

  it('旧设置里的 keepRecent 是陌生字段：忽略它，别让旧形状漏进新形状', () => {
    // 压缩从「保留最近几条」改成了「一条都不留」：这个字段不再有人读。
    // 若归一化把它原样带出去，界面与提示词都会以为还有一个「保留条数」的旋钮。
    expect('keepRecent' in normalizeAgentSettings({ compact: { keepRecent: 8 } }).compact).toBe(false)
  })

  it('乱七八糟的类型不会抛异常，逐项回落到默认值', () => {
    const s = normalizeAgentSettings({ compact: { auto: '是', threshold: 'x' } })
    expect(s.compact.auto).toBe(DEFAULT_AGENT_SETTINGS.compact.auto)
    expect(s.compact.threshold).toBe(DEFAULT_AGENT_SETTINGS.compact.threshold)
  })

  it('只给一部分字段时，另一部分保持默认', () => {
    const s = normalizeAgentSettings({ compact: { auto: false } })
    expect(s.compact.auto).toBe(false)
    expect(s.compact.threshold).toBe(0.7)
  })
})
