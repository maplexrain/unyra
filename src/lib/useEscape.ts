/**
 * 弹窗/浮层共用的「按 Esc 关闭」。
 *
 * 单开一个文件：同一段 window keydown 监听在弹窗里重复了九处，其中三处逐字相同
 * （确认框、笔记样式面板、设置弹窗），另外几处只是回调不同（onClose / setOpen(false) /
 * onDecide('cancel', false)）。判断本身只有一句（e.key === 'Escape'），
 * 真正每抄一遍都要重想的是**挂监听、摘监听、卸载时机**这三件事。
 *
 * 回调拿 ref 兜住、监听只订阅一次：调用方几乎都传内联箭头函数，若把它写进依赖，
 * 每渲染一次就要摘挂一次监听——这不只是开销问题，卸载与重挂之间落下的那一次按键就丢了。
 * enabled 为 false 时连登记都不做（导出进行中、正在安装时按 Esc 应当什么都不发生）。
 */
import { useEffect, useRef } from 'react'

/** Esc → onClose。enabled 变化才重挂监听，onClose 的更换由 ref 兜住 */
export function useEscapeKey(onClose: () => void, enabled = true): void {
  const ref = useRef(onClose)
  useEffect(() => {
    ref.current = onClose
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ref.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
