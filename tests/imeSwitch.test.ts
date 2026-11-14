// @vitest-environment happy-dom
/**
 * Vim 输入法自动切换（lib/imeSwitch）的单元用例：
 * 钉的是「普通模式切英文直通、插入模式恢复原输入法」这条状态机，以及三个 no-op 口
 * （vim 没开、开关关着、本来就是英文键盘）。桥是注入的假货——真实换布局走 screenHelper。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { onVimModeChanged, isVimImeSwitchEnabled, setVimImeSwitchEnabled } from '../src/lib/imeSwitch'
import { setVimEnabled } from '../src/lib/vimSettings'

/** 一枚中文输入法的 HKL（低 16 位 = 0x0804 简体中文） */
const PINYIN_HKL = 0x08040804
const EN_US_HKL = 0x04090409

let currentHkl: number = PINYIN_HKL
const calls: Array<{ op: 'get' | 'set'; hkl?: number }> = []

// 测试桩只挂 imeSwitch 认识的两个方法，其余 tools 成员缺失
;(window as any).mojiNative = {
  tools: {
    imeGetActive: async () => {
      calls.push({ op: 'get' })
      return currentHkl
    },
    imeSetActive: async (hkl: number) => {
      calls.push({ op: 'set', hkl })
      currentHkl = hkl
      return true
    },
  },
}

/** onVimModeChanged 是发后不管的异步：让微任务与计时器都跑完再断言 */
const settle = () => new Promise<void>((r) => setTimeout(r, 10))

beforeEach(() => {
  calls.length = 0
  currentHkl = PINYIN_HKL
  setVimEnabled(true)
  setVimImeSwitchEnabled(true)
})

describe('vim 输入法自动切换 (imeSwitch)', () => {
  it('缺省开启，且开关落盘后读回生效', () => {
    expect(isVimImeSwitchEnabled()).toBe(true)
    setVimImeSwitchEnabled(false)
    expect(isVimImeSwitchEnabled()).toBe(false)
    setVimImeSwitchEnabled(true)
    expect(isVimImeSwitchEnabled()).toBe(true)
  })

  it('进普通模式：记住当前输入法并切到英文直通；回插入模式恢复原输入法', async () => {
    onVimModeChanged(false) // Esc：普通模式
    await settle()
    expect(calls).toEqual([
      { op: 'get' },
      { op: 'set', hkl: EN_US_HKL },
    ])
    expect(currentHkl).toBe(EN_US_HKL)

    onVimModeChanged(true) // i：回插入模式
    await settle()
    expect(calls[calls.length - 1]).toEqual({ op: 'set', hkl: PINYIN_HKL })
    expect(currentHkl).toBe(PINYIN_HKL)
  })

  it('本来就是英文键盘时不动（不多一次投递，也不覆盖「原输入法」的记忆）', async () => {
    currentHkl = EN_US_HKL
    onVimModeChanged(false)
    await settle()
    expect(calls).toEqual([{ op: 'get' }])
    onVimModeChanged(true)
    await settle()
    // 没切过就不该乱恢复
    expect(calls).toEqual([{ op: 'get' }])
    expect(currentHkl).toBe(EN_US_HKL)
  })

  it('vim 没开启或开关关着时一律 no-op', async () => {
    setVimEnabled(false)
    onVimModeChanged(false)
    await settle()
    expect(calls).toEqual([])

    setVimEnabled(true)
    setVimImeSwitchEnabled(false)
    onVimModeChanged(false)
    await settle()
    expect(calls).toEqual([])
  })

  it('桥不在场（WebUI / 非 win32）时静默跳过', async () => {
    const stub = (window as any).mojiNative
    ;(window as any).mojiNative = undefined
    try {
      onVimModeChanged(false)
      await settle()
      expect(calls).toEqual([])
    } finally {
      ;(window as any).mojiNative = stub
    }
  })
})
