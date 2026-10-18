/**
 * 双击 Shift：两下 Shift 之间**没有按过别的键**才算数。
 *
 * 为什么不是一条普通的组合键：Shift 单独按下去不产生任何字符，它是最不容易与
 * 输入冲突的「召唤键」；而双击这种手势没法写进 lib/shortcuts 的注册表（那是
 * 「修饰键 + 主键」的形状），所以单独收在这里。
 *
 * 「中间没按过别的键」这一条是必须的：按住 Shift 打一串大写字母、或者用
 * Shift+方向键选一段字，其间都会再落下若干次 Shift keydown——不做这个过滤，
 * 打字快一点就会莫名把窗口召唤出来。
 */
import { useEffect, useRef } from 'react'

/** 两下 Shift 之间允许的最大间隔（毫秒）：太短会漏掉手慢的，太长又会误触 */
const DEFAULT_WINDOW_MS = 400

export function useDoubleShift(onFire: () => void, windowMs = DEFAULT_WINDOW_MS): void {
  const fireRef = useRef(onFire)
  useEffect(() => {
    fireRef.current = onFire
  }, [onFire])

  useEffect(() => {
    /** 上一记 Shift 的时刻；0 = 当前没有「第一下」等着 */
    let lastShift = 0
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') {
        // 中间按过别的键（含 Shift+字母这种组合里那个字母）：这一对作废
        lastShift = 0
        return
      }
      // 按住不放会连发 keydown，那不是「第二下」
      if (e.repeat) return
      const now = performance.now()
      if (lastShift && now - lastShift <= windowMs) {
        lastShift = 0
        fireRef.current()
        return
      }
      lastShift = now
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [windowMs])
}
