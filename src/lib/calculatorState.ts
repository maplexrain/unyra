/**
 * calculatorState: 全局悬浮计算器状态管理器。
 *
 * 管理计算器的展开/收起状态与当前运算模式（标准、科学、程序员），
 * 允许由 Vim 冒号命令（:calc）、顶部工具栏菜单（ToolsButton）及全局快捷操作共同调度。
 */

export type CalculatorMode = 'standard' | 'scientific' | 'programmer'

export interface CalculatorState {
  isOpen: boolean
  mode: CalculatorMode
}

let currentState: CalculatorState = {
  isOpen: false,
  mode: 'standard',
}

const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // 容错防崩
    }
  })
}

export function getCalculatorState(): CalculatorState {
  return currentState
}

export function subscribeCalculator(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 打开计算器，可选指定模式（如果不传则沿用上次模式） */
export function openCalculator(mode?: CalculatorMode): void {
  currentState = {
    isOpen: true,
    mode: mode ?? currentState.mode,
  }
  notify()
}

/** 关闭计算器 */
export function closeCalculator(): void {
  if (!currentState.isOpen) return
  currentState = {
    ...currentState,
    isOpen: false,
  }
  notify()
}

/** 切换计算器展开/收起状态（如果打开且指定了不同模式，则切换模式） */
export function toggleCalculator(mode?: CalculatorMode): boolean {
  if (currentState.isOpen) {
    if (mode && mode !== currentState.mode) {
      currentState = {
        ...currentState,
        mode,
      }
      notify()
      return true
    }
    closeCalculator()
    return false
  } else {
    openCalculator(mode)
    return true
  }
}

/** 切换计算器模式 */
export function setCalculatorMode(mode: CalculatorMode): void {
  if (currentState.mode === mode) return
  currentState = {
    ...currentState,
    mode,
  }
  notify()
}
