import { useState, useEffect, useRef, useMemo } from 'react'
import { executeVimCommand } from '../../../lib/vimCommands'
import { setGlobalCommandBarOpener } from '../../../lib/commandBarFocus'
import { matchVimCommands, type VimCommandInfo } from '../../../lib/vimCommandCatalog'
import { getOpenTargets, type VimOpenTarget } from '../../../lib/vimOpenTargets'
import { getSideTargets, type VimSideTarget } from '../../../lib/vimSideTargets'
import { browseVimSearch, dispatchBrowseSearch } from '../../../lib/browseVimSearch'
import VimOpenDropdown from './VimOpenDropdown'
import VimSideDropdown from './VimSideDropdown'
import VimTerminalDropdown, { filterTerminalOptions } from './VimTerminalDropdown'
import VimCalcDropdown, { filterCalcOptions } from './VimCalcDropdown'
import { preserveCurrentSelection, restoreOrClearPreservedSelection } from './vimSelectionPreserve'
import { initDoubleShiftListener } from '../../../lib/doubleShiftListener'
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
  const [mode, setMode] = useState<':' | '/' | '?'>(':')
  const [value, setValue] = useState('')
  /**
   * 编辑器 Vim 命令行的**交回通道**：有它 = 这一次输入是编辑器里的 `:` 或 `/`、`?` 唤起的（提示符模式）。
   * Enter 时把最终文本交回 vim 执行（processCommand → 注册的 Ex 命令或搜索），命令栏不重复执行；
   * 取消时交回 undefined（桥那头借 vim 自己的 Esc 分支清状态）。
   */
  const finishRef = useRef<((input?: string) => void) | null>(null)
  /** 实时输入同步通道：搜索模式下输入时实时通知 Vim/浏览模式高亮与定位 */
  const queryChangeRef = useRef<((input: string) => void) | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** 正在关闭标记：提交或关闭过程中防止 handleInputBlur 触发无实参的 close(false) 清空搜索状态 */
  const closingRef = useRef(false)
  /** open 的镜像（窗口键盘监听里要用）：开着就不再响应 Shift+:，别把挂着的 vim 提示符冲掉 */
  const openRef = useRef(false)
  useEffect(() => {
    openRef.current = open
    if (open) {
      closingRef.current = false
    }
  }, [open])

  // 全局双击 Shift 键检测唤起 :open 模式
  useEffect(() => {
    return initDoubleShiftListener()
  }, [])

  /* ---------- 搜索模式（/ 与 ?）、:open 目标、:terminal 类型与 :calc 类型判断 ---------- */
  const isSearchMode = mode === '/' || mode === '?'
  const openMatch = !isSearchMode && value.match(/^:?\s*(?:open\b\s*(.*)|o\s+(.*))$/i)
  const isOpenMode = !isSearchMode && Boolean(openMatch)
  const openQuery = openMatch ? (openMatch[1] ?? openMatch[2] ?? '') : ''
  const openTargets = useMemo(() => {
    if (!isOpenMode) return []
    return getOpenTargets(openQuery)
  }, [isOpenMode, openQuery])

  const termMatch = !isSearchMode && value.match(/^:?\s*(?:terminal\b\s*(.*)|term\b\s+(.*))$/i)
  const isTerminalMode = !isSearchMode && Boolean(termMatch)
  const termArg = termMatch ? (termMatch[1] ?? termMatch[2] ?? '') : ''
  const termOptions = useMemo(() => {
    if (!isTerminalMode) return []
    return filterTerminalOptions(termArg)
  }, [isTerminalMode, termArg])

  const calcMatch = !isSearchMode && value.match(/^:?\s*(?:calc\b\s+(.*)|calculator\b\s+(.*))$/i)
  const isCalcMode = !isSearchMode && Boolean(calcMatch)
  const calcArg = calcMatch ? (calcMatch[1] ?? calcMatch[2] ?? '') : ''
  const calcOptions = useMemo(() => {
    if (!isCalcMode) return []
    return filterCalcOptions(calcArg)
  }, [isCalcMode, calcArg])

  // `:side ` / `:sd ` 弹出除当前页签外的其他打开页签候选
  const sideMatch = !isSearchMode && value.match(/^:?\s*(?:side|sd)\s+(.*)$/i)
  const isSideMode = !isSearchMode && Boolean(sideMatch)
  const sideQuery = sideMatch ? (sideMatch[1] ?? '') : ''
  const sideTargets = useMemo(() => {
    if (!isSideMode) return []
    return getSideTargets(sideQuery)
  }, [isSideMode, sideQuery])

  /* ---------- 前缀联想：候选与幽灵补全 ---------- */
  const matches = useMemo(
    () => (isOpenMode || isSideMode || isTerminalMode || isCalcMode || isSearchMode ? [] : matchVimCommands(value)),
    [isOpenMode, isSideMode, isTerminalMode, isCalcMode, isSearchMode, value]
  )
  const [selected, setSelected] = useState(-1)
  /** 幽灵预览的目标项：方向键选中的那一个；没选过就看第一个候选 */
  const ghostIdx = selected >= 0 && selected < matches.length ? selected : matches.length ? 0 : -1
  const ghostItem: VimCommandInfo | null = ghostIdx >= 0 ? (matches[ghostIdx] ?? null) : null
  /**
   * 幽灵文字：只补第一个 token（命令名），参数是自由文本不猜。
   * 支持前缀带冒号 `:` 的情形对齐补全。
   */
  const ghostText = (() => {
    if (isOpenMode || isSideMode || isTerminalMode || isCalcMode || isSearchMode) return null
    if (!ghostItem || value.includes(' ') || value.length === 0) return null
    const typed = value.replace(/^:+/, '')
    if (!typed) return null
    if (!ghostItem.cmd.toLowerCase().startsWith(typed.toLowerCase())) return null
    if (ghostItem.cmd.length <= typed.length) return null
    return ghostItem.cmd.slice(typed.length)
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
        setMode(':')
        setValue('')
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
      let m: ':' | '/' | '?' = opts?.mode ?? ':'
      let raw = opts?.prefill ?? ''
      if (raw.startsWith(':')) {
        m = ':'
        raw = raw.replace(/^:+/, '')
      } else if (raw.startsWith('/')) {
        m = '/'
        raw = raw.replace(/^\/+/, '')
      } else if (raw.startsWith('?')) {
        m = '?'
        raw = raw.replace(/^\?+/, '')
      }
      setMode(m)
      setValue(raw)
      finishRef.current = opts?.onFinish ?? null
      queryChangeRef.current = opts?.onQueryChange ?? null
      setSelected(-1)
      setOpen(true)
    })
    return () => setGlobalCommandBarOpener(null)
  }, [])

  // 弹窗打开后自动聚焦并保持背景正文选区样式
  useEffect(() => {
    if (open) {
      preserveCurrentSelection()
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return () => cancelAnimationFrame(id)
    } else {
      restoreOrClearPreservedSelection()
    }
  }, [open])

  // 实时匹配 (Incremental Search)：输入改变时实时高亮与滚动定位
  useEffect(() => {
    if (!open) return
    if (mode === '/' || mode === '?') {
      const q = value.trim()
      if (queryChangeRef.current) {
        queryChangeRef.current(q)
      } else if (q) {
        dispatchBrowseSearch(q, mode === '?', true /* silent */)
      } else {
        browseVimSearch.clear()
      }
      // 保持输入框聚焦，防止在增量搜索期间因 DOM 变更丢失输入焦点
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus({ preventScroll: true })
      }
    }
  }, [open, mode, value])

  /**
   * 收口：无论从哪条路退出（Esc、空回格、点遮罩、焦点溜走），都走这一份。
   * **提示符模式下收口 = 取消**：把 undefined 交回桥，桥借 vim 自己的 Esc 分支清掉
   * 命令行状态、把焦点还给编辑器——少了这一步，用户点一下别处，vim 就卡在
   * 「命令行开着」的状态里，后续按键全部落空（这正是「忘了切输入框」的冲突来源）。
   */
  const close = (committed = false) => {
    closingRef.current = true
    const finish = finishRef.current
    finishRef.current = null
    queryChangeRef.current = null
    try {
      if (!committed) {
        finish?.(undefined)
      }
    } catch {
      // 取消路径不抛：vim 那头自己兜底
    }
    // 未确认提交的取消关闭时，清除浏览模式实时搜索高亮
    if (!committed) {
      browseVimSearch.clear()
    }
    restoreOrClearPreservedSelection()
    setOpen(false)
    setValue('')
    setSelected(-1)
  }

  /**
   * 焦点逃逸护栏：
   * 外部点击由 handleOutsidePointer 负责安全收口，Esc 键由 handleKeyDown 负责退出；
   * 这里不主动强制 close()，避免在输入增量匹配或 DOM 联动时因微小焦点抖动误关面板。
   */
  const handleInputBlur = (_e: React.FocusEvent<HTMLInputElement>) => {
    if (closingRef.current) return
  }

  const activeMatchRef = useRef<HTMLButtonElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  // 点击外部收起命令框（无全屏背景遮罩时，保证点击任意外部区域均自然收起并允许交互）
  useEffect(() => {
    if (!open) return
    const handleOutsidePointer = (e: MouseEvent | TouchEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        close()
      }
    }
    window.addEventListener('mousedown', handleOutsidePointer)
    window.addEventListener('touchstart', handleOutsidePointer)
    return () => {
      window.removeEventListener('mousedown', handleOutsidePointer)
      window.removeEventListener('touchstart', handleOutsidePointer)
    }
  }, [open])

  useEffect(() => {
    activeMatchRef.current?.scrollIntoView({ block: 'nearest' })
  }, [ghostIdx])

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

    // 方向键与 Ctrl+Vim 导航键（Ctrl+J 向下、Ctrl+K 向上）在候选里切换，选中的选项自动滚入可视区
    const isDown = e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'j' || e.key === 'J'))
    const isUp = e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'k' || e.key === 'K'))

    if (isDown || isUp) {
      if (isOpenMode && openTargets.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        const n = Math.min(openTargets.length, 40)
        setSelected((s) => (s < 0 ? (isDown ? 0 : n - 1) : (isDown ? s + 1 : s - 1 + n) % n))
        return
      }
      if (isSideMode && sideTargets.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        const n = Math.min(sideTargets.length, 40)
        setSelected((s) => (s < 0 ? (isDown ? 0 : n - 1) : (isDown ? s + 1 : s - 1 + n) % n))
        return
      }
      if (isTerminalMode && termOptions.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        const n = termOptions.length
        setSelected((s) => (s < 0 ? (isDown ? 0 : n - 1) : (isDown ? s + 1 : s - 1 + n) % n))
        return
      }
      if (isCalcMode && calcOptions.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        const n = calcOptions.length
        setSelected((s) => (s < 0 ? (isDown ? 0 : n - 1) : (isDown ? s + 1 : s - 1 + n) % n))
        return
      }
      if (!isOpenMode && !isSideMode && !isTerminalMode && !isCalcMode && matches.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        const n = matches.length
        setSelected((s) => (s < 0 ? (isDown ? 0 : n - 1) : (isDown ? s + 1 : s - 1 + n) % n))
        return
      }
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

      // 搜索模式（/ 与 ?）：直接调用浏览模式搜索或交回编辑器
      if (isSearchMode) {
        const query = value.trim()
        if (isPrompt) {
          const finish = finishRef.current
          finishRef.current = null
          queryChangeRef.current = null
          try {
            finish?.(query)
          } catch {}
          close(true)
          return
        }
        if (query) {
          dispatchBrowseSearch(query, mode === '?', false /* not silent */)
        }
        close(true)
        return
      }

      // :open / :o 模式直接执行选中的目标（执行后立刻关闭）
      if (isOpenMode) {
        if (openTargets.length > 0) {
          const idx = selected >= 0 && selected < openTargets.length ? selected : 0
          executeTarget(openTargets[idx])
        } else {
          close(false)
        }
        return
      }

      // :side / :sd 模式直接将选中的其他页签切为当前页签内并排对照
      if (isSideMode) {
        if (sideTargets.length > 0) {
          const idx = selected >= 0 && selected < sideTargets.length ? selected : 0
          executeSideTarget(sideTargets[idx])
        } else {
          close(false)
        }
        return
      }

      // :terminal 模式直接执行选中的终端类型
      if (isTerminalMode) {
        const option = termOptions[selected >= 0 && selected < termOptions.length ? selected : 0]
        const shellArg = option ? option.kind : termArg.trim()
        close(true)
        executeVimCommand('terminal ' + shellArg)
        return
      }

      // :calc 模式直接执行选中的计算器类型
      if (isCalcMode) {
        const option = calcOptions[selected >= 0 && selected < calcOptions.length ? selected : 0]
        const modeArg = option ? option.kind : calcArg.trim()
        close(true)
        executeVimCommand('calc ' + modeArg)
        return
      }

      // 方向键选中的候选 ≠ 已输文本时，Enter 提交的就是幽灵预览的那份（看到的即所得）
      const typedCmd = value.replace(/^:+/, '').trim()
      const picked =
        selected >= 0 && ghostItem && ghostItem.cmd.toLowerCase() !== typedCmd.toLowerCase()
          ? ghostItem.cmd + ' '
          : value.replace(/^:+/, '')
      const cmd = picked.trim()
      if (!cmd) {
        close(false)
        return
      }
      if (isPrompt) {
        // 编辑器的 : ：交回 vim 执行。立刻关闭
        const finish = finishRef.current
        finishRef.current = null
        queryChangeRef.current = null
        try {
          finish?.(cmd)
        } catch {
          // vim 对坏输入自己兜底
        }
        close(true)
        return
      }

      // 非编辑器模式下提交 bare `:side` 直接展开候选空格列表，零闪烁切换
      if (!isPrompt && (cmd === 'side' || cmd === 'sd')) {
        setValue('side ')
        setSelected(-1)
        return
      }

      // 非编辑器模式：立即关闭弹层并执行命令
      close(true)
      executeVimCommand(cmd)
    }
  }

  const executeTarget = (target: VimOpenTarget) => {
    const finish = finishRef.current
    finishRef.current = null
    queryChangeRef.current = null
    try {
      finish?.(undefined)
    } catch {}
    close(true)
    try {
      target.action()
    } catch {
      // 容错
    }
  }

  const executeSideTarget = (target: VimSideTarget) => {
    const finish = finishRef.current
    finishRef.current = null
    queryChangeRef.current = null
    try {
      finish?.(undefined)
    } catch {}
    close(true)
    try {
      target.action()
    } catch {
      // 容错
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label={t('全局 Vim 命令行')}
      data-command-bar="true"
      className="fixed inset-0 z-[99999] pointer-events-none flex flex-col items-center pt-[14vh]"
    >
      <div
        ref={barRef}
        className="pointer-events-auto flex w-[min(680px,calc(100vw-48px))] flex-col rounded-2xl bg-[color-mix(in_srgb,var(--color-card,#161722)_96%,transparent)] backdrop-blur-2xl border border-line-strong/60 dark:border-white/15 shadow-[0_24px_64px_-8px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.06)] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onMouseDown={(e) => {
          // 点击候选按钮或内联空白时，阻止输入框产生非预期失焦
          if (
            e.target !== inputRef.current &&
            (e.target as HTMLElement).tagName !== 'BUTTON' &&
            !(e.target as HTMLElement).closest('button')
          ) {
            e.preventDefault()
          }
        }}
      >
        <div className="flex items-center gap-3 px-4.5 py-3 border-b border-line/35">
          <div
            className={
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[13px] font-bold select-none border shadow-xs ' +
              (isSearchMode
                ? 'bg-amber-500/15 text-amber-500 border-amber-500/25'
                : 'bg-seal/15 text-seal border-seal/25')
            }
          >
            {mode}
          </div>
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => {
                let val = e.target.value
                if (mode === ':') {
                  if (val.startsWith(':')) {
                    val = val.replace(/^:+/, '')
                  } else if (val.startsWith('/') && !value) {
                    setMode('/')
                    val = val.replace(/^\/+/, '')
                  } else if (val.startsWith('?') && !value) {
                    setMode('?')
                    val = val.replace(/^\?+/, '')
                  }
                } else {
                  if (val.startsWith(mode)) {
                    val = val.slice(1)
                  } else if (val.startsWith(':') && !value) {
                    setMode(':')
                    val = val.replace(/^:+/, '')
                  }
                }
                setValue(val)
                setSelected(-1)
              }}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              placeholder={
                isSearchMode
                  ? t('输入搜索内容或正则表达式 (支持拼音匹配，按 Enter 查找)...')
                  : isOpenMode
                  ? t('搜索打开目标：支持拼音缩写、全拼或中文名称...')
                  : isSideMode
                  ? t('选择要在当前页旁并排对照的页签（支持拼音或关键词，输入 off 关闭 / swap 对调）...')
                  : isTerminalMode
                  ? t('选择终端类型 (powershell, cmd, bash)...')
                  : isCalcMode
                  ? t('选择计算器类型 (standard, scientific, programmer)...')
                  : t('输入命令 (例如 w, q, edit, view, browser, fullscreen, wrap, open, calc)...')
              }
              className="w-full bg-transparent text-ink placeholder:text-ink-faint/70 outline-none font-mono text-[14px] border-none p-0 focus:ring-0 leading-normal"
            />
            {/* 幽灵补全预览 */}
            {ghostText !== null && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-hidden whitespace-pre font-mono text-[14px] text-ink-faint/60"
              >
                <span className="invisible">{value}</span>
                {ghostText}
              </span>
            )}
          </div>
        </div>

        {/*
          下拉内容：:open / :o 下拉候选列表 vs :terminal 下拉候选 vs 普通 Vim 命令补全列表
        */}
        {isOpenMode ? (
          <VimOpenDropdown
            targets={openTargets}
            selectedIndex={selected >= 0 ? selected : 0}
            onSelect={executeTarget}
          />
        ) : isSideMode ? (
          <VimSideDropdown
            targets={sideTargets}
            selectedIndex={selected >= 0 ? selected : 0}
            onSelect={executeSideTarget}
          />
        ) : isTerminalMode ? (
          <VimTerminalDropdown
            filter={termArg}
            selectedIndex={selected >= 0 ? selected : 0}
            onSelect={(opt) => {
              close(true)
              executeVimCommand('terminal ' + opt.kind)
            }}
          />
        ) : isCalcMode ? (
          <VimCalcDropdown
            filter={calcArg}
            selectedIndex={selected >= 0 ? selected : 0}
            onSelect={(opt) => {
              close(true)
              executeVimCommand('calc ' + opt.kind)
            }}
          />
        ) : (
          !isSearchMode && matches.length > 0 && (
            <div className="max-h-[320px] overflow-y-auto p-1.5 flex flex-col gap-0.5">
              {matches.slice(0, 15).map((m, i) => {
                const active = i === ghostIdx
                return (
                  <button
                    key={m.cmd}
                    ref={active ? activeMatchRef : undefined}
                    type="button"
                    className={
                      'flex w-full items-center gap-3 px-3.5 py-2 text-left rounded-lg text-[13px] transition cursor-pointer ' +
                      (active ? 'bg-seal/15 text-seal-light' : 'hover:bg-line/40 text-ink')
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
                        (active ? 'font-semibold text-seal' : 'text-ink font-medium')
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
          )
        )}

        {/* 底部快捷键操作指引 */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-line/30 bg-card/35 text-[11px] text-ink-faint select-none">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono bg-paper/60 px-1 py-0.5 rounded border border-line/50">↑</kbd>{' '}
              <kbd className="font-mono bg-paper/60 px-1 py-0.5 rounded border border-line/50">↓</kbd>{' '}
              <span className="opacity-60">或</span>{' '}
              <kbd className="font-mono bg-paper/60 px-1 py-0.5 rounded border border-line/50">Ctrl+J</kbd>{' '}
              <kbd className="font-mono bg-paper/60 px-1 py-0.5 rounded border border-line/50">K</kbd> 切换
            </span>
            <span><kbd className="font-mono bg-paper/60 px-1 py-0.5 rounded border border-line/50">Tab</kbd> 补全</span>
            <span><kbd className="font-mono bg-paper/60 px-1 py-0.5 rounded border border-line/50">↵</kbd> 执行</span>
          </div>
          <span><kbd className="font-mono bg-paper/60 px-1 py-0.5 rounded border border-line/50">Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}
