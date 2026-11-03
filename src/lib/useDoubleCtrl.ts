/**
 * 双击 Ctrl：两下 Ctrl 之间没有按过别的键才算数。
 *
 * 节点宇宙浮层快捷唤出/收起交互：
 * - 只有单独快速连按两下 Ctrl（中途无组合字母、无其他修饰键，repeat 连发过滤）才触发；
 * - 避免 Ctrl+C / Ctrl+V 等组合操作误触发。
 */
import { useEffect, useRef } from 'react'

/** 两下 Ctrl 之间允许的最大间隔（毫秒） */
const DEFAULT_WINDOW_MS = 400

export function useDoubleCtrl(onFire: () => void, windowMs = DEFAULT_WINDOW_MS): void {
  const fireRef = useRef(onFire)
  useEffect(() => {
    fireRef.current = onFire
  }, [onFire])

  useEffect(() => {
    /** 上一记 Ctrl 的时刻；0 = 当前没有「第一下」等着 */
    let lastCtrl = 0

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Control') {
        // 中间按过别的键（如 Ctrl+C 中的 C）：这对作废
        lastCtrl = 0
        return
      }
      // 长按不放会产生连续 keydown，那不是「第二下」
      if (e.repeat) return

      const now = performance.now()
      if (lastCtrl && now - lastCtrl <= windowMs) {
        lastCtrl = 0
        fireRef.current()
        return
      }
      lastCtrl = now
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [windowMs])
}
