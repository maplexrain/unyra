/**
 * 在组件里登记快捷键的那一层。
 *
 * 单独一个文件：lib/shortcuts 要能被 Node 探针 import（它不依赖 React），
 * 而 React 的那点包装只在这一个地方需要。
 */

import { useEffect, useRef } from 'react'
import { subscribeShortcut, type ShortcutHandlers } from './shortcuts'

/**
 * 组件里用这个。handlers 每次渲染都是新对象，所以拿 ref 兜住再订阅一次——
 * 否则每渲染一次都要重挂键监听，按住说话会在中途被打断。
 *
 * enabled 为 false 时连登记都不做：那时候按下去应当什么都不发生（见语音输入的开关）。
 */
export function useShortcut(
  id: string,
  h: ShortcutHandlers & { enabled?: boolean },
): void {
  const ref = useRef(h)
  const enabled = h.enabled !== false
  useEffect(() => {
    ref.current = h
  })
  useEffect(() => {
    if (!enabled) return
    return subscribeShortcut(id, {
      down: (e) => ref.current.down?.(e),
      up: (e) => ref.current.up?.(e),
    })
  }, [id, enabled])
}