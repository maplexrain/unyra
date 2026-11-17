// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getCalculatorState,
  openCalculator,
  closeCalculator,
  toggleCalculator,
  setCalculatorMode,
} from '../src/lib/calculatorState'
import {
  formatNumberOutput,
  factorial,
  getBaseValues,
} from '../src/components/tools/calculator/calculatorEngine'
import { filterCalcOptions } from '../src/components/learn/workspace/VimCalcDropdown'
import { executeVimCommand } from '../src/lib/vimExecutor'

describe('Calculator State & Commands', () => {
  beforeEach(() => {
    closeCalculator()
    setCalculatorMode('standard')
  })

  it('toggles calculator open and closed', () => {
    expect(getCalculatorState().isOpen).toBe(false)
    const opened = toggleCalculator()
    expect(opened).toBe(true)
    expect(getCalculatorState().isOpen).toBe(true)

    const closed = toggleCalculator()
    expect(closed).toBe(false)
    expect(getCalculatorState().isOpen).toBe(false)
  })

  it('opens calculator with specific mode', () => {
    openCalculator('scientific')
    expect(getCalculatorState().isOpen).toBe(true)
    expect(getCalculatorState().mode).toBe('scientific')

    setCalculatorMode('programmer')
    expect(getCalculatorState().mode).toBe('programmer')
  })

  it('handles :calc Vim command properly', () => {
    // 初始关闭状态下执行 :calc -> 打开
    closeCalculator()
    const r1 = executeVimCommand('calc')
    expect(r1.success).toBe(true)
    expect(getCalculatorState().isOpen).toBe(true)

    // 打开状态下执行 :calc -> 关闭
    const r2 = executeVimCommand('calc')
    expect(r2.success).toBe(true)
    expect(getCalculatorState().isOpen).toBe(false)

    // 执行带参数的 :calc scientific
    const r3 = executeVimCommand('calc scientific')
    expect(r3.success).toBe(true)
    expect(getCalculatorState().isOpen).toBe(true)
    expect(getCalculatorState().mode).toBe('scientific')

    // 执行带参数的 :calc programmer
    const r4 = executeVimCommand('calc programmer')
    expect(r4.success).toBe(true)
    expect(getCalculatorState().mode).toBe('programmer')

    // 中文别名支持 :calc 科学
    const r5 = executeVimCommand('calc 科学')
    expect(r5.success).toBe(true)
    expect(getCalculatorState().mode).toBe('scientific')
  })

  it('filters calc options for autocomplete dropdown', () => {
    const all = filterCalcOptions('')
    expect(all.length).toBe(3)

    const sci = filterCalcOptions('sci')
    expect(sci.length).toBe(1)
    expect(sci[0].kind).toBe('scientific')

    const prog = filterCalcOptions('程序员')
    expect(prog.length).toBe(1)
    expect(prog[0].kind).toBe('programmer')
  })
})

describe('Calculator Engine', () => {
  it('formats number outputs without floating point inaccuracies', () => {
    expect(formatNumberOutput(0.1 + 0.2)).toBe('0.3')
    expect(formatNumberOutput(42)).toBe('42')
    expect(formatNumberOutput(NaN)).toBe('Error')
    expect(formatNumberOutput(Infinity)).toBe('Infinity')
  })

  it('calculates factorials accurately', () => {
    expect(factorial(0)).toBe(1)
    expect(factorial(1)).toBe(1)
    expect(factorial(5)).toBe(120)
    expect(factorial(-1)).toBeNaN()
  })

  it('converts BigInt to all 4 programmer bases', () => {
    const res = getBaseValues(255n, 64)
    expect(res.hex).toBe('FF')
    expect(res.dec).toBe('255')
    expect(res.oct).toBe('377')
    expect(res.bin.endsWith('1111 1111')).toBe(true)
  })
})
