import { useEffect, useState } from 'react'

type VimTutorListener = (isOpen: boolean) => void

let tutorOpen = false
const listeners = new Set<VimTutorListener>()

/**
 * 唤起 Vim 交互式游戏化教学面板
 */
export function openVimTutor(): void {
  if (tutorOpen) return
  tutorOpen = true
  listeners.forEach((fn) => {
    try {
      fn(true)
    } catch {
      // 安全容错
    }
  })
}

/**
 * 关闭 Vim 游戏化教学面板
 */
export function closeVimTutor(): void {
  if (!tutorOpen) return
  tutorOpen = false
  listeners.forEach((fn) => {
    try {
      fn(false)
    } catch {
      // 安全容错
    }
  })
}

/**
 * 切换 Vim 教学面板打开状态
 */
export function toggleVimTutor(): void {
  if (tutorOpen) closeVimTutor()
  else openVimTutor()
}

/**
 * 查询 Vim 教学面板是否正在展示
 */
export function isVimTutorOpen(): boolean {
  return tutorOpen
}

/**
 * 订阅 Vim 教学面板开关状态变化
 */
export function subscribeVimTutor(listener: VimTutorListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * React Hook：获取并响应 Vim 教学面板状态
 */
export function useVimTutor(): {
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
} {
  const [open, setOpen] = useState(() => tutorOpen)

  useEffect(() => {
    return subscribeVimTutor((val) => {
      setOpen(val)
    })
  }, [])

  return {
    isOpen: open,
    open: openVimTutor,
    close: closeVimTutor,
    toggle: toggleVimTutor,
  }
}
