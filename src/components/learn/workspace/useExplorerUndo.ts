/*
 * 这个文件负责：资源管理器区的撤回（Ctrl+Z）。
 *
 * 分工：删除前「捕获什么」是数据层的事（learn/undo，与各删除函数的级联逐项对账）；
 * 这里只持有那张栈、注册 Ctrl+Z、把恢复落回 store。删除类动作在动手前调 pushUndo
 * （传**删除前**的 store——捕获靠的就是旧引用），Ctrl+Z 弹出栈顶原样接回。
 *
 * 只覆盖界面上的删除（确认框走完的那几条）：agent 经 api.node.delete 删的东西不在
 * 这张栈里——那一侧的误删由「学习目标本身不能删」的守卫与对话上下文兜着。
 */

import { useCallback, useEffect, useRef } from 'react'
import type { LearnStore } from '../../../learn/types'
import { applyUndo, type ExplorerUndo } from '../../../learn/undo'

export interface ExplorerUndoDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
}

/** 撤回栈的深度：资源管理器的删除不是高频操作，25 步绰绰有余 */
const UNDO_LIMIT = 25

export function useExplorerUndo({ getLatest, set, onToast }: ExplorerUndoDeps) {
  const stack = useRef<ExplorerUndo[]>([])

  /** 删除类动作在动手**之前**调它（entry 由 learn/undo 的 capture* 从当时的 store 捕获） */
  const pushUndo = useCallback((entry: ExplorerUndo) => {
    stack.current.push(entry)
    if (stack.current.length > UNDO_LIMIT) stack.current.shift()
  }, [])

  const undo = useCallback(() => {
    const entry = stack.current.pop()
    if (!entry) return
    const r = applyUndo(getLatest(), entry)
    if (r.ok) set(r.store)
    onToast(r.message)
  }, [getLatest, set, onToast])

  /*
   * Ctrl+Z：window 上的**冒泡**监听 + 目标守卫。
   *
   * 不走 lib/shortcuts 的注册表：那边是捕获阶段的全局拦截，命中即 preventDefault——
   * 源码编辑器 textarea 的原生 undo 会当场被掐死。这里让事件先冒泡，只有
   * 「目标不是输入框 / 可编辑元素、栈里也真有东西」时才拦下来自己处理；
   * 超级文档跑在 iframe 里，键盘事件根本到不了这个 window，两边的 undo 互不相干。
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (!stack.current.length) return
      e.preventDefault()
      undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo])

  return { pushUndo, undo }
}
