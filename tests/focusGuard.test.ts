/**
 * 严格专注（守卫 agent + 专注报告）的单元用例：
 *
 * - 判定解析（parseVerdict）：约定 JSON、裹着话的 JSON、坏回复、缺字段的口径；
 * - 策略决策（decideGuardAction）：熔断 > 暂停 > 警告的优先级，与「按勾选的监控调整」
 *   ——只开摄像头不评判内容、只开屏幕用交互旧程度当「人不在」的代理；
 * - 番茄钟暂停（learn/pomodoro）：计时冻结在暂停那一刻、恢复整体后挪、
 *   落盘往返不丢 pausedAt（这条字段曾经真漏过，见 state.json 的说明）；
 * - 页签（learn/tabs + normalizeTab）：守卫页签不落盘（读回来就丢）、报告页签持久；
 * - 报告往返（buildFocusReport / normalizeFocusReport）：形状收口、坏文件不认。
 */
import { describe, expect, it } from 'vitest'

import {
  AWAY_INPUT_MS,
  buildFocusReport,
  decideGuardAction,
  guardSystemPrompt,
  normalizeFocusReport,
  parseVerdict,
  reportSpanLabel,
  type GuardMonitors,
} from '../src/learn/focusGuard'
import {
  emptyPomodoro,
  normalizePomodoro,
  pausePomodoro,
  pomodoroStatus,
  remainingMsOf,
  resumePomodoro,
  startPomodoro,
  tickPomodoro,
} from '../src/learn/pomodoro'
import { tabKey, tabNodeId, tabTitle, tabTrail } from '../src/learn/tabs'
import { normalizeTab } from '../src/learn/store/normalize/tabs'

/* ---------- parseVerdict ---------- */

describe('parseVerdict', () => {
  it('解析约定的 JSON', () => {
    const v = parseVerdict('{"present":true,"on_task":false,"privacy":false,"reason":"在看视频"}')
    expect(v).toEqual({ present: true, onTask: false, privacy: false, reason: '在看视频' })
  })

  it('裹着说明文字与代码块标记也挖得出来', () => {
    const v = parseVerdict('好的，这是我的判断：\n```json\n{"present":true,"on_task":true,"privacy":false,"reason":"做题"}\n```')
    expect(v?.onTask).toBe(true)
    expect(v?.reason).toBe('做题')
  })

  it('解析不动回 null（调用方记成「没看懂」，绝不瞎动作）', () => {
    expect(parseVerdict('他看起来在学习')).toBeNull()
    expect(parseVerdict('{"present":')).toBeNull()
  })

  it('缺字段按好的一边算：沉默不定罪', () => {
    expect(parseVerdict('{}')).toEqual({ present: true, onTask: true, privacy: false, reason: '' })
    const privacy = parseVerdict('{"privacy":true}')
    expect(privacy?.privacy).toBe(true)
    // 字符串布尔也认（个别模型会把布尔写成字符串）
    expect(parseVerdict('{"present":"false"}')?.present).toBe(false)
  })
})

/* ---------- decideGuardAction ---------- */

describe('decideGuardAction', () => {
  const verdict = (over: Partial<Parameters<typeof decideGuardAction>[0]> = {}) => ({
    present: true,
    onTask: true,
    privacy: false,
    reason: '',
    ...over,
  })

  it('隐私风险一律熔断——其他字段说了什么都不算', () => {
    expect(decideGuardAction(verdict({ privacy: true }), { screen: true, camera: true }, 0)).toBe('fuse')
    expect(decideGuardAction(verdict({ privacy: true, present: false }), { screen: false, camera: true }, 100)).toBe('fuse')
  })

  it('有摄像头：人不在就暂停（内容好坏无所谓）', () => {
    expect(decideGuardAction(verdict({ present: false }), { screen: true, camera: true }, 0)).toBe('pause')
    expect(decideGuardAction(verdict({ present: false, onTask: false }), { screen: false, camera: true }, 0)).toBe('pause')
  })

  it('只有屏幕：用交互旧程度当「人不在」的代理，超过阈值暂停', () => {
    expect(decideGuardAction(verdict(), { screen: true, camera: false }, AWAY_INPUT_MS + 1)).toBe('pause')
    expect(decideGuardAction(verdict(), { screen: true, camera: false }, null)).toBe('pause')
  })

  it('人在学：都开也不动作', () => {
    expect(decideGuardAction(verdict(), { screen: true, camera: true }, 100)).toBe('none')
  })

  it('人在但分心：只有看得到屏幕才警告', () => {
    expect(decideGuardAction(verdict({ onTask: false }), { screen: true, camera: true }, 100)).toBe('warn')
    expect(decideGuardAction(verdict({ onTask: false }), { screen: true, camera: false }, 100)).toBe('warn')
    // 只开摄像头时模型被提示词要求恒真，这里再兜一道：看不到屏幕就没有发言权
    expect(decideGuardAction(verdict({ onTask: false }), { screen: false, camera: true }, 100)).toBe('none')
  })
})

/* ---------- 系统提示词 ---------- */

describe('guardSystemPrompt', () => {
  it('按勾选的监控现算：只开摄像头时不许评判内容', () => {
    const cameraOnly = guardSystemPrompt({ screen: false, camera: true })
    expect(cameraOnly).toContain('不要对「是否在学习」下任何结论')
    expect(cameraOnly).toContain('摄像头画面')
    // 注意力判定（手机/掌机）只在屏幕监控同开时才交代——只开摄像头时 warn 永远不会发
    expect(cameraOnly).not.toContain('掌上游戏机')
    const both = guardSystemPrompt({ screen: true, camera: true })
    expect(both).toContain('屏幕截图')
    expect(both).toContain('privacy')
    expect(both).toContain('掌上游戏机')
  })
})

/* ---------- 番茄钟的暂停 ---------- */

describe('pomodoro pause', () => {
  const t0 = 1_700_000_000_000

  it('暂停时剩余时间冻结，恢复时把整段暂停从这一段里扣掉', () => {
    const started = startPomodoro(emptyPomodoro(), { focusMinutes: 25, groups: 2 }, t0).store
    // 跑了 10 分钟后暂停
    const paused = pausePomodoro(started, t0 + 10 * 60_000)
    const frozen = remainingMsOf(paused.current, t0 + 20 * 60_000)
    expect(frozen).toBe(15 * 60_000) // 冻结在暂停那一刻，墙上的钟随便走
    // 又过了 5 分钟恢复：这一段的起点整体后挪 5 分钟
    const resumed = resumePomodoro(paused, t0 + 15 * 60_000)
    expect(resumed.current?.pausedAt ?? null).toBeNull()
    expect(remainingMsOf(resumed.current, t0 + 15 * 60_000 + 30_000)).toBe(15 * 60_000 - 30_000)
  })

  it('暂停期间 tick 不推进（也不写盘：原样返回同一个 store）', () => {
    const paused = pausePomodoro(startPomodoro(emptyPomodoro(), {}, t0).store, t0)
    const out = tickPomodoro(paused, t0 + 3 * 60 * 60_000)
    expect(out.store).toBe(paused)
    expect(out.records).toHaveLength(0)
  })

  it('重复暂停与没暂停就恢复都是空操作（对象身份不变）', () => {
    const started = startPomodoro(emptyPomodoro(), {}, t0).store
    const paused = pausePomodoro(started, t0)
    expect(pausePomodoro(paused, t0 + 1)).toBe(paused)
    expect(resumePomodoro(started, t0 + 1)).toBe(started)
    const empty = emptyPomodoro()
    expect(pausePomodoro(empty, t0)).toBe(empty)
  })

  it('落盘往返不丢 pausedAt（state.json 整份重写，漏一个字段就读不回来）', () => {
    const paused = pausePomodoro(startPomodoro(emptyPomodoro(), { focusMinutes: 30, groups: 3 }, t0).store, t0 + 60_000)
    const round = normalizePomodoro(JSON.parse(JSON.stringify(paused)))
    expect(round.current?.pausedAt).toBe(t0 + 60_000)
    expect(pomodoroStatus({ pomodoro: round }, t0 + 120_000).paused).toBe(true)
    // 没暂停过的会话不带这个字段
    const plain = normalizePomodoro(JSON.parse(JSON.stringify(startPomodoro(emptyPomodoro(), {}, t0).store)))
    expect(plain.current?.pausedAt ?? null).toBeNull()
  })
})

/* ---------- 页签 ---------- */

describe('guard / report tabs', () => {
  it('身份与标题：守卫全局一份，报告按 id 一签', () => {
    expect(tabKey({ kind: 'guard' })).toBe('g:guard')
    expect(tabKey({ kind: 'report', reportId: 'f1abc' })).toBe('r:f1abc')
    expect(tabTitle({ kind: 'guard' }, () => undefined)).toBe('守卫 Agent')
    expect(tabTitle({ kind: 'report', reportId: 'f1abc' }, () => undefined)).toBe('专注报告')
  })

  it('都不挂节点、也没有路径后缀', () => {
    expect(tabNodeId({ kind: 'guard' })).toBeNull()
    expect(tabNodeId({ kind: 'report', reportId: 'f1' })).toBeNull()
    expect(tabTrail({ kind: 'report', reportId: 'f1' }, () => 'x')).toBe('')
  })

  it('落盘往返：报告页签持久，守卫页签读回来就丢（上下文不跨重启活着）', () => {
    const byId = new Map()
    const report = normalizeTab({ id: 'r:f1', ref: { kind: 'report', reportId: 'f1' }, createdAt: 1 }, byId)
    expect(report?.ref).toEqual({ kind: 'report', reportId: 'f1' })
    expect(normalizeTab({ id: 'g:guard', ref: { kind: 'guard' }, createdAt: 1 }, byId)).toBeNull()
  })
})

/* ---------- 报告 ---------- */

describe('focus report', () => {
  const input = {
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_000_000 + 25 * 60_000,
    focusMinutes: 25,
    groups: 3,
    completedGroups: 1,
    monitors: { screen: true, camera: false } as GuardMonitors,
    outcome: 'stopped' as const,
    pausedMs: 60_000,
    pauseCount: 1,
    pauseSpans: [{ at: 1_700_000_060_000, resumedAt: 1_700_000_120_000 }],
    warnings: [{ at: 1_700_000_300_000, reason: '在看视频' }],
    rounds: [
      { at: 1_700_000_060_000, screen: true, camera: false, verdict: { present: true, onTask: false, privacy: false, reason: '在看视频' }, action: 'warn' as const, reason: '在看视频' },
    ],
  }

  it('构建 → 落盘往返字段不丢', () => {
    const report = buildFocusReport(input)
    expect(report.id).toMatch(/^f[0-9a-z]+$/)
    const back = normalizeFocusReport(JSON.parse(JSON.stringify(report)))
    expect(back).not.toBeNull()
    expect(back!.startedAt).toBe(input.startedAt)
    expect(back!.outcome).toBe('stopped')
    expect(back!.pauseSpans).toEqual(input.pauseSpans)
    expect(back!.warnings).toEqual(input.warnings)
    expect(back!.rounds[0]?.verdict?.reason).toBe('在看视频')
  })

  it('坏文件不认：id 缺了 / 起止倒挂都回 null', () => {
    expect(normalizeFocusReport({})).toBeNull()
    expect(normalizeFocusReport({ ...input, id: 'not-valid' })).toBeNull()
    expect(normalizeFocusReport({ ...input, id: 'f1', endedAt: 1 })).toBeNull()
  })

  it('时段标签用于侧栏与页签', () => {
    expect(reportSpanLabel(1_700_000_000_000, 1_700_000_000_000)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2} – \d{2}-\d{2} \d{2}:\d{2}$/)
  })
})
