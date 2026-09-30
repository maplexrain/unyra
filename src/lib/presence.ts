import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 浮层与弹窗的「进退场」：动画归 CSS，什么时候真正卸载归 React。
 *
 * 为什么需要这两个钩子：条件渲染（`{open && <div/>}`）会在关闭的一瞬间把节点
 * 从 DOM 里摘掉，退场动画根本没有机会播——于是菜单总是「啪」地消失。
 * 反过来，纯 CSS 又没法在动画结束后把元素删掉。所以由这里接管时序：
 * 先标记「正在退场」，等动画时长过去再卸载 / 调用真正的关闭。
 *
 * 两个时长必须与 index.css 里的动画时长一致（.moji-out / .moji-dialog-out）。
 */
export const EXIT_MS = 130

/**
 * 浮层用：把展开状态交给这个钩子，关闭时先播退场再卸载。
 *
 * 它自己持有 open，而不是从外面传进来：退场要等一个定时器，若 open 由外部
 * 状态决定，就得用 effect 去同步「外面关了 → 我该开始播动画了」，
 * 而 effect 里 setState 会多一轮渲染（还被 react-hooks 规则拦）。
 * 状态由事件驱动更直接：谁调用 setOpen，谁就触发这一套时序。
 *
 * - `open`：逻辑上的展开状态（点外面收起、Esc 都用它）
 * - `mounted`：要不要渲染
 * - `closing`：用进场那套类还是退场那套
 */
export function usePresence(
  initial = false,
  exitMs = EXIT_MS,
): { open: boolean; setOpen: (next: boolean) => void; mounted: boolean; closing: boolean } {
  const [open, setOpenState] = useState(initial)
  const [mounted, setMounted] = useState(initial)
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | null>(null)

  const setOpen = useCallback(
    (next: boolean) => {
      // 退场播到一半又被打开：取消卸载，直接回到进场态
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
      setOpenState(next)
      if (next) {
        setMounted(true)
        setClosing(false)
        return
      }
      // 本来就没渲染过（例如带着「关」的初值首挂），不必演一遍退场
      setClosing(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setMounted(false)
        setClosing(false)
      }, exitMs)
    },
    [exitMs],
  )

  // 组件卸载时清掉待执行的定时器
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  return { open, setOpen, mounted, closing }
}

/**
 * 弹窗用：把 `onClose` 换成 `close`，先播退场再真的关。
 *
 * 遮罩点击、Esc、右上角关闭、保存后关闭都该走 `close`——只要有一处漏了，
 * 那条路径就会「啪」地消失，与其它路径不一致。
 *
 * `leaveThen` 是同一套时序的通用版：有些动作本身就会让父组件把弹窗撤掉
 * （例如「保存并关闭」是先写数据、父组件随即卸载），这种就用
 * `leaveThen(() => 保存())`，让动画先播完再动数据。
 *
 * 回调返回 `false` 表示**这次没走成**：退场撤回来、弹窗留在原地，
 * 之后还能再提交一次。用于「先校验、不通过就别关」的场合（见 NoteDialog 的保存）。
 */
export function useLeaving(
  onClose: () => void,
  exitMs = EXIT_MS,
): { leaving: boolean; close: () => void; leaveThen: (fn: () => boolean | void) => void } {
  const [leaving, setLeaving] = useState(false)
  const fired = useRef(false)
  const timer = useRef<number | null>(null)

  const leaveThen = useCallback(
    (fn: () => boolean | void) => {
      if (fired.current) return
      fired.current = true
      setLeaving(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        if (fn() === false) {
          // 没走成：退场撤回来。fired 也要复位，否则再点一次保存会被当成重复提交
          fired.current = false
          setLeaving(false)
        }
      }, exitMs)
    },
    [exitMs],
  )

  const close = useCallback(() => leaveThen(onClose), [leaveThen, onClose])

  // 父组件自己把弹窗撤掉时，别让定时器再去动一次状态
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  return { leaving, close, leaveThen }
}
