import { useCallback, useEffect } from 'react'
import { allTabs, focusedGroup } from '../../../learn/groups'
import type { LearnStore, LearnTab } from '../../../learn/types'

export interface UseMouseNavTabsParams {
  getLatest: () => LearnStore
  activateTab: (tabId: string) => void
  activeTabId?: string | null
}

/**
 * 鼠标侧键前进 / 后退（Back / Forward 按钮）切换当前显示的页签：
 *
 * 绝大多数五键鼠标带有侧边双键（常见为大拇指侧的前进与后退键）：
 * - 侧键后退（MouseEvent e.button === 3 或系统键盘事件 BrowserBack / AppBack）：向左切换上一个页签；
 * - 侧键前进（MouseEvent e.button === 4 或系统键盘事件 BrowserForward / AppForward）：向右切换下一个页签。
 *
 * 全局捕获并 preventDefault() 阻止 Chromium 默认的网页路由历史跳转，
 * 并在当前分屏组或工作区全部页签内前后循环切换，自然伴随过场滑入动效。
 */
export function useMouseNavTabs({ getLatest, activateTab, activeTabId }: UseMouseNavTabsParams) {
  const stepActiveTab = useCallback(
    (direction: 'back' | 'forward') => {
      const s = getLatest()
      const group = focusedGroup(s.docArea)
      if (!group) return

      // 1. 若当前焦点格有多个页签，在当前格内循环切换
      if (group.tabs.length > 1) {
        const curIdx = group.tabs.findIndex((t: LearnTab) => t.id === group.active)
        const idx = curIdx >= 0 ? curIdx : 0
        const nextIdx =
          direction === 'back'
            ? (idx - 1 + group.tabs.length) % group.tabs.length
            : (idx + 1) % group.tabs.length
        activateTab(group.tabs[nextIdx].id)
        return
      }

      // 2. 兜底：若当前格仅有 1 个页签，但工作区内有多个页签（跨格分屏时）
      const all = allTabs(s.docArea)
      if (all.length > 1) {
        const curIdx = all.findIndex((t: LearnTab) => t.id === activeTabId)
        const idx = curIdx >= 0 ? curIdx : 0
        const nextIdx =
          direction === 'back'
            ? (idx - 1 + all.length) % all.length
            : (idx + 1) % all.length
        activateTab(all[nextIdx].id)
      }
    },
    [getLatest, activateTab, activeTabId],
  )

  useEffect(() => {
    let lastNavTime = 0
    const trigger = (dir: 'back' | 'forward') => {
      const now = Date.now()
      if (now - lastNavTime < 160) return
      lastNavTime = now
      stepActiveTab(dir)
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault()
        e.stopPropagation()
        trigger('back')
      } else if (e.button === 4) {
        e.preventDefault()
        e.stopPropagation()
        trigger('forward')
      }
    }

    const onAuxClick = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'BrowserBack' || e.key === 'AppBack' || e.code === 'BrowserBack') {
        e.preventDefault()
        e.stopPropagation()
        trigger('back')
      } else if (e.key === 'BrowserForward' || e.key === 'AppForward' || e.code === 'BrowserForward') {
        e.preventDefault()
        e.stopPropagation()
        trigger('forward')
      }
    }

    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mouseup', onMouseUp, true)
    window.addEventListener('auxclick', onAuxClick, true)
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      window.removeEventListener('auxclick', onAuxClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [stepActiveTab])
}
