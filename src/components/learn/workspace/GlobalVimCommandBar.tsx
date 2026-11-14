import { useState, useEffect, useRef, useMemo } from 'react'
import { executeVimCommand } from '../../../lib/vimCommands'
import { setGlobalCommandBarOpener } from '../../../lib/commandBarFocus'
import { matchVimCommands, type VimCommandInfo } from '../../../lib/vimCommandCatalog'
import { t } from '../../../i18n'

/**
 * 全局 Vim 冒号命令输入栏——**唯一的命令输入框**，编辑页与非编辑页同一组件：
 *
 * 1. 非编辑页面按 Shift+: 唤起；编辑器里的 `:` 也被接管到这（见 lib/commandBarFocus 的桥，
 *    '/' 搜索提示仍走 CodeMirror 原生面板）；
 * 2. 前缀联想：候选（命令 + 一句话描述）列在下方，方向键选择，输入框里用**幽灵文字**
 *    预览补全后的样子，Tab 一次补全；
 * 3. 按 Enter 执行（提示符模式下把文本交回编辑器的 vim 命令行）；Esc / 空输入按回格 /
 *    点遮罩 / 焦点溜出弹层都收口——提示符模式下收口一律**取消**，把 vim 的命令行状态
 *    还回去（不然编辑器卡在「命令行开着」，按键全部落空，正是「忘切输入框」的冲突）；
 * 4. 位置定于 top: 120px 居中微光卡片，与编辑器视觉统一。
 */
export default function GlobalVimCommandBar() {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  /**
   * 编辑器 Vim 命令行的**交回通道**：有它 = 这一次输入是编辑器里的 `:` 唤起的（提示符模式）。
   * Enter 时把最终文本交回 vim 执行（processCommand → 注册的 Ex 命令），命令栏不重复执行；
   * 取消时交回 undefined（桥那头借 vim 自己的 Esc 分支清状态）。
   */
  const finishRef = useRef<((input?: string) => void) | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  /** open 的镜像（窗口键盘监听里要用）：开着就不再响应 Shift+:，别把挂着的 vim 提示符冲掉 */
  const openRef = useRef(false)
  useEffect(() => {
    openRef.current = open
  }, [open])

  /* ---------- 前缀联想：候选与幽灵补全 ---------- */
  const matches = useMemo(() => matchVimCommands(value), [value])
  const [selected, setSelected] = useState(-1)
  /** 幽灵预览的目标项：方向键选中的那一个；没选过就看第一个候选 */
  const ghostIdx = selected >= 0 && selected < matches.length ? selected : matches.length ? 0 : -1
  const ghostItem: VimCommandInfo | null = ghostIdx >= 0 ? (matches[ghostIdx] ?? null) : null
  /**
   * 幽灵文字：只补第一个 token（命令名），参数是自由文本不猜。
   * 输入框里以「透明的已输前缀 + 淡色剩余」画在真实文字之上——对齐靠同一份字体。
   */
  const ghostText = (() => {
    if (!ghostItem || value.includes(' ') || value.length === 0) return null
    if (!ghostItem.cmd.toLowerCase().startsWith(value.toLowerCase())) return null
    if (ghostItem.cmd.length <= value.length) return null
    return ghostItem.cmd.slice(value.length)
  })()

  // 全局键盘监听 Shift+: 唤起（编辑器内的 : 走 commandBarFocus 的桥，不经这里）
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
        // 已经开着就不重开：重开会把 finishRef 清掉，编辑器 vim 还挂着等待的命令行
        // 却再也等不到交回（焦点与 vim 状态从此打架）。开着时 : 不做事。
        if (openRef.current) return
        setValue('')
        setFeedback(null)
        finishRef.current = null
        setSelected(-1)
        setOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // 登记唤起通道（编辑器 : 桥、以及将来任何想唤起命令栏的调用方都走它）
  useEffect(() => {
    setGlobalCommandBarOpener((opts) => {
      setValue(opts?.prefill ?? '')
      setFeedback(null)
      finishRef.current = opts?.onFinish ?? null
      setSelected(-1)
      setOpen(true)
    })
    return () => setGlobalCommandBarOpener(null)
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

  /**
   * 收口：无论从哪条路退出（Esc、空回格、点遮罩、焦点溜走、提示条计时），都走这一份。
   * **提示符模式下收口 = 取消**：把 undefined 交回桥，桥借 vim 自己的 Esc 分支清掉
   * 命令行状态、把焦点还给编辑器——少了这一步，用户点一下别处，vim 就卡在
   * 「命令行开着」的状态里，后续按键全部落空（这正是「忘了切输入框」的冲突来源）。
   */
  const close = () => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    const finish = finishRef.current
    finishRef.current = null
    try {
      finish?.(undefined)
    } catch {
      // 取消路径不抛：vim 那头自己兜底
    }
    setOpen(false)
    setValue('')
    setFeedback(null)
    setSelected(-1)
  }

  /**
   * 焦点逃逸护栏：输入框的焦点溜出了这层弹窗（Shift+Tab、程序性失焦……）而弹层还开着，
   * 后续按键就会落到别处、和 vim 打架。按「忘了切换输入框」兜底处理——当作放弃输入，
   * 取消挂着的提示符并收口（点候选按钮不算：relatedTarget 还在弹层里）。
   */
  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const dialog = e.currentTarget.closest('[role="dialog"]')
    if (dialog && e.relatedTarget instanceof Node && dialog.contains(e.relatedTarget)) return
    close()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const isPrompt = !!finishRef.current

    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }

    /*
     * 空输入按回格 = 不想打命令了：顺手退出（与 Vim 命令行空输入按 Backspace 中止同一直觉）。
     * 输入法组字中的回格是在删组字内容，不算退出（isComposing 放行）。
     */
    if (e.key === 'Backspace' && !e.nativeEvent.isComposing && value.length === 0) {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }

    // 方向键在候选里走（幽灵预览跟着换）；有候选时拦住，别让光标跳到输入的头尾
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length > 0) {
      e.preventDefault()
      e.stopPropagation()
      const down = e.key === 'ArrowDown'
      const n = matches.length
      setSelected((s) => (s < 0 ? (down ? 0 : n - 1) : (down ? s + 1 : s - 1 + n) % n))
      return
    }

    // Tab：把幽灵预览的那份补全落进输入框（补完命令名，留一个空格好接参数）
    if (e.key === 'Tab' && ghostItem && ghostText !== null) {
      e.preventDefault()
      e.stopPropagation()
      setValue(ghostItem.cmd + ' ')
      setSelected(-1)
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      // 方向键选中的候选 ≠ 已输文本时，Enter 提交的就是幽灵预览的那份（看到的即所得）
      const picked =
        selected >= 0 && ghostItem && ghostItem.cmd.toLowerCase() !== value.trim().toLowerCase()
          ? ghostItem.cmd + ' '
          : value
      const cmd = picked.trim()
      if (!cmd) {
        close()
        return
      }
      if (isPrompt) {
        // 编辑器的 : ：交回 vim 执行（执行与通知都在编辑器那一侧）。先摘掉通道再交回，
        // 随后的 close() 才不会把它当成「待取消的提示符」再交一次 undefined。
        const finish = finishRef.current
        finishRef.current = null
        try {
          finish?.(cmd)
        } catch {
          // vim 对坏输入自己兜底
        }
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
        className="fixed top-[120px] left-1/2 -translate-x-1/2 flex w-[min(720px,calc(100vw-64px))] flex-col gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-[color-mix(in_srgb,var(--color-card,#181825)_92%,transparent)] backdrop-blur-md border border-[color-mix(in_srgb,var(--color-seal,#38bdf8)_50%,var(--color-line,rgba(255,255,255,0.15)))] shadow-[0_20px_48px_-4px_rgba(0,0,0,0.65),0_0_20px_color-mix(in_srgb,var(--color-seal,#38bdf8)_30%,transparent)] text-ink font-mono text-[14.5px]">
          <span className="shrink-0 text-seal font-semibold select-none">:</span>
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setSelected(-1)
              }}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              placeholder={t('输入命令 (例如 w, q, wq, preview, tabnew, sp, vs, help)...')}
              className="w-full bg-transparent text-ink placeholder:text-ink-faint outline-none font-mono text-[14.5px] border-none p-0 focus:ring-0"
            />
            {/*
              幽灵补全：透明的已输前缀占住位子，淡色剩余画在真实文字之后——
              与输入框同一份字体字号才对得齐（见上面的 ghostText）。
            */}
            {ghostText !== null && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-hidden whitespace-pre font-mono text-[14.5px] text-ink-faint/75"
              >
                <span className="invisible">{value}</span>
                {ghostText}
              </span>
            )}
          </div>
          {feedback && (
            <span className="shrink-0 text-[12px] font-sans text-seal bg-seal/10 px-2 py-0.5 rounded border border-seal/30 animate-pulse">
              {feedback}
            </span>
          )}
        </div>

        {/*
          前缀联想候选：命令 + 别名 + 一句话描述。在卡片之下同一列里排布（不另算坐标）。
        */}
        {value.trim().length > 0 && matches.length > 0 && (
          <div className="max-h-[320px] overflow-y-auto rounded-lg bg-[color-mix(in_srgb,var(--color-card,#181825)_92%,transparent)] backdrop-blur-md border border-[color-mix(in_srgb,var(--color-line,rgba(255,255,255,0.15)))] shadow-[0_20px_48px_-4px_rgba(0,0,0,0.65)]">
            {matches.slice(0, 8).map((m, i) => {
              const active = i === ghostIdx
              return (
                <button
                  key={m.cmd}
                  type="button"
                  className={
                    'flex w-full items-center gap-3 px-5 py-2 text-left text-[13px] transition ' +
                    (active ? 'bg-seal/10' : 'hover:bg-line/40')
                  }
                  onClick={() => {
                    setValue(m.cmd + ' ')
                    setSelected(-1)
                    inputRef.current?.focus()
                  }}
                >
                  <span
                    className={
                      'shrink-0 font-mono text-[13px] ' +
                      (active ? 'font-semibold text-seal' : 'text-ink')
                    }
                  >
                    :{m.cmd}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-soft">{m.desc}</span>
                  {m.aliases && m.aliases.length > 0 && (
                    <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">
                      {m.aliases.map((a) => ':' + a).join(' ')}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
