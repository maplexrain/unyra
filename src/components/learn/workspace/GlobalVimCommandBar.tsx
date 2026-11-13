import { useState, useEffect, useRef } from 'react'
import { executeVimCommand } from '../../../lib/vimCommands'
import { t } from '../../../i18n'

/**
 * 全局 Vim 冒号命令输入栏（用于非编辑页面或非普通模式下的全键盘调度）：
 *
 * 核心特性：
 * 1. 任意非编辑页面或非打字状态下，按 Shift+: (:) 立即呼出居中悬浮卡片；
 * 2. 位置定于 top: 120px 居中微光卡片，与编辑器内 Vim 命令栏视觉完全统一；
 * 3. 支持 :w (保存)、:q/:q! (关闭)、:wq/:x (保存并关闭)、:preview (切换预览)、
 *    :tabnew (新建)、:tabo (关其他)、:sp/:vs (分屏)、:tutor 等常用指令；
 * 4. 按 Enter 瞬间执行，按 Esc 迅速撤回，免去鼠标操作。
 */
export default function GlobalVimCommandBar() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  // 全局键盘监听 Shift+: 唤起
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 忽略正在打字的原生可编辑元素
      const target = e.target as HTMLElement | null
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)

      if (isInput) return

      // 如果当前界面已经有 CodeMirror 原生的 vim 命令面板正在展示，交由 CodeMirror 原生处理
      if (document.querySelector('.cm-vim-panel input')) {
        return
      }

      const isColon = e.key === ':' || (e.shiftKey && (e.code === 'Semicolon' || e.key === ';'))
      if (isColon && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        setValue('')
        setFeedback(null)
        setOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // 弹窗打开后自动聚焦
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return () => cancelAnimationFrame(id)
    }
  }, [open])

  const close = () => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    setOpen(false)
    setValue('')
    setFeedback(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const cmd = value.trim()
      if (!cmd) {
        close()
        return
      }

      const result = executeVimCommand(cmd)
      if (result.message) {
        setFeedback(result.message)
        timerRef.current = window.setTimeout(() => {
          close()
        }, 1200)
      } else {
        close()
      }
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('全局 Vim 命令行')}
      className="fixed inset-0 z-[99999] pointer-events-auto"
      onClick={close}
    >
      <div
        className="fixed top-[120px] left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-64px))] flex items-center gap-2 px-4 py-2 rounded-lg bg-[color-mix(in_srgb,var(--color-card,#181825)_92%,transparent)] backdrop-blur-md border border-[color-mix(in_srgb,var(--color-seal,#38bdf8)_50%,var(--color-line,rgba(255,255,255,0.15)))] shadow-[0_20px_48px_-4px_rgba(0,0,0,0.65),0_0_20px_color-mix(in_srgb,var(--color-seal,#38bdf8)_30%,transparent)] text-ink font-mono text-[13.5px]"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="shrink-0 text-seal font-semibold select-none">:</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('输入命令 (例如 w, q, wq, preview, tabnew, sp, vs, tutor, help)...')}
          className="flex-1 min-w-0 bg-transparent text-ink placeholder:text-ink-faint outline-none font-mono text-[13.5px] border-none p-0 focus:ring-0"
        />
        {feedback && (
          <span className="shrink-0 text-[12px] font-sans text-seal bg-seal/10 px-2 py-0.5 rounded border border-seal/30 animate-pulse">
            {feedback}
          </span>
        )}
      </div>
    </div>
  )
}
