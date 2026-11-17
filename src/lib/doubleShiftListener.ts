/**
 * doubleShiftListener: 全局双击 Shift 键检测器（类似 IntelliJ IDEA Search Everywhere）。
 * 在 400ms 内快速连按两次 Shift 键（且中间未按下任何其他键），呼出全局 Vim 命令行的 open 模式。
 */

import { openGlobalCommandBar } from './commandBarFocus'

let lastShiftTime = 0
let hadInterveningKey = false

export function initDoubleShiftListener(): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') {
      // 忽略持续长按 Shift 触发的 repeat 事件
      if (e.repeat) return

      const now = Date.now()
      const delta = now - lastShiftTime

      // 50ms <= delta <= 400ms 且期间未发生其他任何按键
      if (!hadInterveningKey && delta >= 50 && delta <= 400) {
        lastShiftTime = 0
        hadInterveningKey = false
        e.preventDefault()
        e.stopPropagation()
        openGlobalCommandBar({ mode: ':', prefill: 'open ' })
        return
      }

      lastShiftTime = now
      hadInterveningKey = false
    } else {
      // 任何其他按键按下均重置双击判定，确保诸如 Shift+A 组合键不误触发
      hadInterveningKey = true
      lastShiftTime = 0
    }
  }

  window.addEventListener('keydown', handleKeyDown, true)
  return () => {
    window.removeEventListener('keydown', handleKeyDown, true)
  }
}
