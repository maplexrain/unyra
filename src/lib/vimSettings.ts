import { useState, useEffect, useCallback } from 'react'

const VIM_STORAGE_KEY = 'learn.editor.vim.enabled'
const VIM_CHANGE_EVENT = 'unyra:vim-mode-change'

/**
 * 读取 Vim 模式是否开启（默认不开启）
 */
export function isVimEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(VIM_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * 切换或设置 Vim 模式开启状态，并向当前窗口内所有监听器广播变更
 */
export function setVimEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(VIM_STORAGE_KEY, enabled ? 'true' : 'false')
    }
  } catch {
    // 忽略 localStorage 写入异常
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(VIM_CHANGE_EVENT, { detail: { enabled } }))
  }
}

/**
 * 翻转 Vim 开启状态
 */
export function toggleVimEnabled(): boolean {
  const next = !isVimEnabled()
  setVimEnabled(next)
  return next
}

/**
 * 订阅 Vim 开启状态变更
 */
export function subscribeVimEnabled(onChange: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    const custom = e as CustomEvent<{ enabled: boolean }>
    if (custom?.detail && typeof custom.detail.enabled === 'boolean') {
      onChange(custom.detail.enabled)
    } else {
      onChange(isVimEnabled())
    }
  }
  window.addEventListener(VIM_CHANGE_EVENT, handler)
  return () => window.removeEventListener(VIM_CHANGE_EVENT, handler)
}

/**
 * React Hook：响应式获取与设置 Vim 开启状态
 */
export function useVimEnabled(): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => isVimEnabled())

  useEffect(() => {
    return subscribeVimEnabled((next) => {
      setEnabled(next)
    })
  }, [])

  const update = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setEnabled((prev) => {
      const val = typeof next === 'function' ? next(prev) : next
      setVimEnabled(val)
      return val
    })
  }, [])

  return [enabled, update]
}
