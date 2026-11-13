import { useEffect, useState } from 'react'

type VimTutorListener = (isOpen: boolean) => void

type VimPageOpener = (section?: 'tutor' | 'commands') => void

let tutorOpen = false
let vimPageOpener: VimPageOpener | null = null
const listeners = new Set<VimTutorListener>()

/**
 * 登记 Vim 学习页面页签打开器（由工作区 LearnWorkspace 注入）
 */
export function setVimPageOpener(fn: VimPageOpener | null): void {
  vimPageOpener = fn
}

/**
 * 打开 Vim 学习与命令大全页签（默认可指定跳转到闯关道场或命令大全）
 */
export function openVimPage(section: 'tutor' | 'commands' = 'commands'): void {
  if (vimPageOpener) {
    vimPageOpener(section)
    return
  }
  // 兜底（如果工作区尚未就绪）
  tutorOpen = true
  listeners.forEach((fn) => {
    try {
      fn(true)
    } catch {}
  })
}

/**
 * 唤起 Vim 交互式游戏化教学（打开闯关道场页）
 */
export function openVimTutor(): void {
  openVimPage('tutor')
}

/**
 * 唤起 Vim 常用与高阶命令大全速查文档
 */
export function openVimCommands(): void {
  openVimPage('commands')
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
