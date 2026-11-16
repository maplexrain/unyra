import { useEffect, useRef } from 'react'
import { isVimEnabled } from '../../../lib/vimSettings'
import { openGlobalCommandBar } from '../../../lib/commandBarFocus'
import { docScrollElement, scrollToDoc } from '../../../lib/docDom'
import { triggerShortcutAction } from '../../../lib/shortcuts'
import { focusedGroup } from '../../../learn/groups'
import { viewOf } from '../../../learn/tabs'
import type { LearnStore } from '../../../learn/types'

export interface UseBrowseVimParams {
  getLatest: () => LearnStore
  onToast?: (msg: string) => void
  nextTab?: () => void
  prevTab?: () => void
}

/** 判定事件目标是否为可输入编辑元素或浮层对话框 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.closest('.cm-editor, .cm-content, [role="textbox"]')) return true
  if (target.closest('.modal-scrim, [role="dialog"], [role="menu"]')) return true
  if (target.closest('[data-command-bar]')) return true
  return false
}

/**
 * 允许页面处于浏览模式（只读阅读态）下使用 Vim 快捷键进行只读浏览与导航。
 */
export function useBrowseVim({ getLatest, onToast, nextTab, prevTab }: UseBrowseVimParams): void {
  const pendingPrefix = useRef<{ key: string; time: number } | null>(null)
  const lastToastTime = useRef<number>(0)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 未开启 Vim 或处于文本输入区域时忽略
      if (!isVimEnabled() || isEditableTarget(e.target)) return

      // 若当前活动页签正处于源码编辑模式，交由 CodeMirror Vim 自身接管
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      const activeTab = group?.tabs.find((t) => t.id === group.active)
      if (activeTab && viewOf(activeTab, false) === 'source') {
        return
      }

      const key = e.key
      const isCtrl = e.ctrlKey || e.metaKey
      const isAlt = e.altKey

      if (isAlt) return

      const now = Date.now()
      const prefix = pendingPrefix.current
      if (prefix && now - prefix.time > 600) {
        pendingPrefix.current = null
      }

      // 1. 冒号唤起全局命令栏（支持 :edit, :q, :tabo, :open 等）
      if (!isCtrl && (key === ':' || (e.shiftKey && key === ';'))) {
        e.preventDefault()
        e.stopPropagation()
        pendingPrefix.current = null
        openGlobalCommandBar({ prefill: ':' })
        return
      }

      // 2. 双键组合序列判断 (如 gg, gt, gT, zz, zt, zb)
      if (pendingPrefix.current) {
        const pKey = pendingPrefix.current.key
        pendingPrefix.current = null

        if (pKey === 'g') {
          if (key === 'g') {
            e.preventDefault()
            e.stopPropagation()
            scrollToDoc({ to: 'top' })
            return
          }
          if (key === 't') {
            e.preventDefault()
            e.stopPropagation()
            nextTab?.()
            return
          }
          if (key === 'T') {
            e.preventDefault()
            e.stopPropagation()
            prevTab?.()
            return
          }
        }

        if (pKey === 'z') {
          if (key === 't') {
            e.preventDefault()
            e.stopPropagation()
            scrollToDoc({ to: 'top' })
            return
          }
          if (key === 'b') {
            e.preventDefault()
            e.stopPropagation()
            scrollToDoc({ to: 'bottom' })
            return
          }
          if (key === 'z') {
            e.preventDefault()
            e.stopPropagation()
            const box = docScrollElement()
            if (box) {
              box.scrollBy({ top: box.clientHeight / 4, behavior: 'smooth' })
            }
            return
          }
        }
      }

      // 3. 单键序列前缀触发
      if (!isCtrl && (key === 'g' || key === 'z')) {
        pendingPrefix.current = { key, time: now }
        return
      }

      // 4. 滚动浏览控制
      if (!isCtrl && (key === 'j' || key === 'ArrowDown')) {
        e.preventDefault()
        e.stopPropagation()
        scrollToDoc({ by: 80 })
        return
      }

      if (!isCtrl && (key === 'k' || key === 'ArrowUp')) {
        e.preventDefault()
        e.stopPropagation()
        scrollToDoc({ by: -80 })
        return
      }

      if (!isCtrl && (key === 'h' || key === 'ArrowLeft')) {
        e.preventDefault()
        e.stopPropagation()
        const box = docScrollElement()
        box?.scrollBy({ left: -60, behavior: 'smooth' })
        return
      }

      if (!isCtrl && (key === 'l' || key === 'ArrowRight')) {
        e.preventDefault()
        e.stopPropagation()
        const box = docScrollElement()
        box?.scrollBy({ left: 60, behavior: 'smooth' })
        return
      }

      // 5. 翻页与大跨度跳动 (Ctrl+d, Ctrl+u, d, u, Ctrl+f, Ctrl+b, G)
      if ((isCtrl && key === 'd') || (!isCtrl && key === 'd')) {
        e.preventDefault()
        e.stopPropagation()
        const box = docScrollElement()
        if (box) box.scrollBy({ top: box.clientHeight * 0.5, behavior: 'smooth' })
        else scrollToDoc({ by: 300 })
        return
      }

      if ((isCtrl && key === 'u') || (!isCtrl && key === 'u')) {
        e.preventDefault()
        e.stopPropagation()
        const box = docScrollElement()
        if (box) box.scrollBy({ top: -box.clientHeight * 0.5, behavior: 'smooth' })
        else scrollToDoc({ by: -300 })
        return
      }

      if (isCtrl && key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        const box = docScrollElement()
        if (box) box.scrollBy({ top: box.clientHeight * 0.85, behavior: 'smooth' })
        else scrollToDoc({ by: 500 })
        return
      }

      if (isCtrl && key === 'b') {
        e.preventDefault()
        e.stopPropagation()
        const box = docScrollElement()
        if (box) box.scrollBy({ top: -box.clientHeight * 0.85, behavior: 'smooth' })
        else scrollToDoc({ by: -500 })
        return
      }

      if (isCtrl && key === 'e') {
        e.preventDefault()
        e.stopPropagation()
        scrollToDoc({ by: 40 })
        return
      }

      if (isCtrl && key === 'y') {
        e.preventDefault()
        e.stopPropagation()
        scrollToDoc({ by: -40 })
        return
      }

      if (!isCtrl && key === 'G') {
        e.preventDefault()
        e.stopPropagation()
        scrollToDoc({ to: 'bottom' })
        return
      }

      // 6. 搜索 (/)
      if (!isCtrl && key === '/') {
        e.preventDefault()
        e.stopPropagation()
        triggerShortcutAction('doc.find')
        return
      }

      // 7. 文本复制 (y)
      if (!isCtrl && key === 'y') {
        const sel = window.getSelection()?.toString()
        if (sel) {
          e.preventDefault()
          e.stopPropagation()
          void navigator.clipboard.writeText(sel)
          onToast?.('[已复制]')
          return
        }
      }

      // 8. 只读模式防呆与编辑提示（i, a, o, c, s, r, x, p）
      const editKeys = ['i', 'a', 'o', 'c', 's', 'r', 'x', 'p']
      if (!isCtrl && editKeys.includes(key)) {
        e.preventDefault()
        e.stopPropagation()
        if (now - lastToastTime.current > 1500) {
          lastToastTime.current = now
          onToast?.('当前处于浏览模式（只读），可输入 :edit 切换至编辑模式')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [getLatest, onToast, nextTab, prevTab])
}
