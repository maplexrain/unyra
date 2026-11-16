/**
 * TerminalTabPane: VS Code / IntelliJ IDEA 风格的原生集成终端工作台。
 *
 * 核心特性：
 * 1. 纯正原生终端控制台体验：无多余新手教学 UI，无多余按键芯片；
 * 2. 连续终端流缓冲：流式标准输出与标准错误、ANSI 彩色高亮；
 * 3. 多终端实例管理（Tab 式多终端并存、新建与销毁）；
 * 4. 原生 Shell 选择（PowerShell / CMD / Git Bash / Bash）；
 * 5. 键盘与交互契约：Ctrl+C 中断/选区复制、Ctrl+L 清屏、Up/Down 历史翻滚、行内光标。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Loader2,
  Plus,
  Terminal,
  Trash2,
} from 'lucide-react'
import { t } from '../../i18n'
import { renderAnsiText } from './ansi'

export interface TerminalTabPaneProps {
  onToast?: (msg: string) => void
}

type ShellKind = 'powershell' | 'cmd' | 'bash'

interface TerminalSession {
  id: string
  title: string
  shell: ShellKind
  cwd: string
  lines: string[]
  inputVal: string
  cursorPos: number
  history: string[]
  historyIdx: number
  runningPid: string | null
}

const DEFAULT_SHELLS: { key: ShellKind; label: string }[] = [
  { key: 'powershell', label: 'PowerShell' },
  { key: 'cmd', label: 'Command Prompt (CMD)' },
  { key: 'bash', label: 'Git Bash / Bash' },
]

export default function TerminalTabPane({ onToast: _onToast }: TerminalTabPaneProps) {
  const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || '')

  // 初始终端会话
  const [sessions, setSessions] = useState<TerminalSession[]>(() => {
    const defaultShell: ShellKind = isWindows ? 'powershell' : 'bash'
    const startupBanner = isWindows
      ? 'Windows PowerShell\n版权所有 (C) Microsoft Corporation。保留所有权利。\n'
      : 'Unyra Integrated Terminal (x86_64-pc-none)\n'
    return [
      {
        id: 'term_1',
        title: isWindows ? '1: pwsh' : '1: bash',
        shell: defaultShell,
        cwd: '',
        lines: [startupBanner],
        inputVal: '',
        cursorPos: 0,
        history: [],
        historyIdx: -1,
        runningPid: null,
      },
    ]
  })

  const [activeSessionId, setActiveSessionId] = useState<string>('term_1')
  const [shellMenuOpen, setShellMenuOpen] = useState(false)

  const outputScrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0]

  // 获取原生进程能力桥
  const getNativeProcess = useCallback(() => {
    if (typeof window === 'undefined') return null
    const win = window as unknown as {
      unyraNative?: { process?: any }
      mojiNative?: { process?: any }
    }
    return win.unyraNative?.process ?? win.mojiNative?.process ?? null
  }, [])

  // 自动滚至最新输出
  const scrollToBottom = useCallback(() => {
    if (outputScrollRef.current) {
      outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [activeSession?.lines, activeSession?.inputVal, scrollToBottom])

  // 终端全屏任意点击即聚焦虚拟输入框
  const focusTerminal = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      inputRef.current?.focus()
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeSessionId])

  // 新建终端实例
  const createNewSession = (shellKind?: ShellKind) => {
    const count = sessions.length + 1
    const targetShell: ShellKind = shellKind || (isWindows ? 'powershell' : 'bash')
    const shortName = targetShell === 'powershell' ? 'pwsh' : targetShell
    const newSession: TerminalSession = {
      id: `term_${Date.now()}`,
      title: `${count}: ${shortName}`,
      shell: targetShell,
      cwd: activeSession?.cwd || '',
      lines: [
        isWindows && targetShell === 'powershell'
          ? 'Windows PowerShell\n版权所有 (C) Microsoft Corporation。保留所有权利。\n'
          : '',
      ].filter(Boolean),
      inputVal: '',
      cursorPos: 0,
      history: [],
      historyIdx: -1,
      runningPid: null,
    }
    setSessions((prev) => [...prev, newSession])
    setActiveSessionId(newSession.id)
    setShellMenuOpen(false)
  }

  // 关闭指定终端实例
  const closeSession = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (sessions.length <= 1) {
      // 最后一个终端：清屏重置
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, lines: [], inputVal: '', cursorPos: 0 } : s))
      )
      return
    }
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id)
      setActiveSessionId(remaining[remaining.length - 1].id)
    }
  }

  // 计算 Prompt 提示符
  const getPromptString = (s: TerminalSession) => {
    const pathStr = s.cwd || (isWindows ? 'C:\\workspace' : '~/workspace')
    if (s.shell === 'powershell') {
      return `PS ${pathStr}> `
    }
    if (s.shell === 'cmd') {
      return `${pathStr}> `
    }
    const base = pathStr.split(/[\\/]/).pop() || pathStr
    return `${base} $ `
  }

  // 终止正在运行的命令或清空当前输入 (Ctrl+C)
  const handleInterrupt = async () => {
    if (!activeSession) return
    const pid = activeSession.runningPid
    if (pid) {
      const np = getNativeProcess()
      if (np?.stop) {
        try {
          await np.stop(pid, { force: true })
        } catch {}
      }
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                runningPid: null,
                lines: [...s.lines, '^C'],
                inputVal: '',
                cursorPos: 0,
              }
            : s
        )
      )
    } else {
      // 原生终端直觉：无活动任务时按 Ctrl+C，打印 ^C 并换新行给出新 Prompt
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                lines: [...s.lines, `${getPromptString(s)}${s.inputVal}^C`],
                inputVal: '',
                cursorPos: 0,
              }
            : s
        )
      )
    }
  }

  // 执行命令
  const executeCommand = async (rawCmd: string) => {
    if (!activeSession) return
    const cmd = rawCmd
    const trimmed = cmd.trim()
    const prompt = getPromptString(activeSession)

    // 追加命令至当前屏幕流
    const commandLine = `${prompt}${cmd}`

    // 内置命令支持：clear / cls / Ctrl+L
    if (trimmed === 'clear' || trimmed === 'cls') {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                lines: [],
                inputVal: '',
                cursorPos: 0,
                history: trimmed ? [...s.history, trimmed] : s.history,
                historyIdx: -1,
              }
            : s
        )
      )
      return
    }

    if (!trimmed) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                lines: [...s.lines, commandLine],
                inputVal: '',
                cursorPos: 0,
              }
            : s
        )
      )
      return
    }

    // 更新命令历史与清空输入
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id
          ? {
              ...s,
              lines: [...s.lines, commandLine],
              inputVal: '',
              cursorPos: 0,
              history: [...s.history, trimmed],
              historyIdx: -1,
              runningPid: 'pending',
            }
          : s
      )
    )

    // 目录变更 cd 跟踪
    if (/^\s*cd(\s+.*)?$/i.test(trimmed)) {
      const target = trimmed.replace(/^\s*cd\s*/i, '').trim()
      let nextCwd = activeSession.cwd
      if (!target || target === '~') {
        nextCwd = ''
      } else if (target === '..') {
        const parts = (activeSession.cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/)
        parts.pop()
        nextCwd = parts.join(isWindows ? '\\' : '/')
      } else {
        const sep = isWindows ? '\\' : '/'
        nextCwd = activeSession.cwd
          ? `${activeSession.cwd.replace(/[\\/]+$/, '')}${sep}${target}`
          : target
      }
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                cwd: nextCwd,
                runningPid: null,
              }
            : s
        )
      )
      return
    }

    // 调用底层原生进程执行
    const np = getNativeProcess()
    if (!np || !np.run) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                runningPid: null,
                lines: [
                  ...s.lines,
                  '[Web 演示模式] 终端原生系统进程执行需要运行在 Electron 桌面环境。',
                ],
              }
            : s
        )
      )
      return
    }

    try {
      let command = 'powershell.exe'
      let args: string[] = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', trimmed]

      if (activeSession.shell === 'cmd') {
        command = 'cmd.exe'
        args = ['/d', '/s', '/c', trimmed]
      } else if (activeSession.shell === 'bash') {
        command = 'bash'
        args = ['-c', trimmed]
      }

      const res = await np.run({
        command,
        args,
        cwd: activeSession.cwd || undefined,
        timeoutMs: 180000,
      })

      const stdout = res.stdout ? res.stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : ''
      const stderr = res.stderr ? res.stderr.replace(/\r\n/g, '\n').replace(/\r/g, '\n') : ''
      const outText = [stdout, stderr, res.error ? `[Error] ${res.error}` : '']
        .filter(Boolean)
        .join('\n')

      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                runningPid: null,
                lines: outText ? [...s.lines, outText] : s.lines,
              }
            : s
        )
      )
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                runningPid: null,
                lines: [...s.lines, `[Process error]: ${err instanceof Error ? err.message : String(err)}`],
              }
            : s
        )
      )
    }
  }

  // 键盘与输入管理
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+C: 如果页面有文字选区则放行复制；否则触发终端中断
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) {
        return
      }
      e.preventDefault()
      void handleInterrupt()
      return
    }

    // Ctrl+L: 清屏
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault()
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, lines: [] } : s))
      )
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void executeCommand(activeSession.inputVal)
      return
    }

    // Up: 历史向前
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (activeSession.history.length === 0) return
      const nextIdx =
        activeSession.historyIdx < 0
          ? activeSession.history.length - 1
          : Math.max(0, activeSession.historyIdx - 1)
      const val = activeSession.history[nextIdx] || ''
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, historyIdx: nextIdx, inputVal: val, cursorPos: val.length }
            : s
        )
      )
      return
    }

    // Down: 历史向后
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (activeSession.history.length === 0 || activeSession.historyIdx < 0) return
      const nextIdx = activeSession.historyIdx + 1
      if (nextIdx >= activeSession.history.length) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, historyIdx: -1, inputVal: '', cursorPos: 0 }
              : s
          )
        )
      } else {
        const val = activeSession.history[nextIdx] || ''
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, historyIdx: nextIdx, inputVal: val, cursorPos: val.length }
              : s
        )
      )
      }
      return
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    const pos = e.target.selectionStart
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, inputVal: val, cursorPos: pos } : s
      )
    )
  }

  return (
    <div
      onClick={focusTerminal}
      className="flex h-full w-full flex-col bg-[#181818] text-[#cccccc] font-mono text-[13px] leading-[1.35] select-text overflow-hidden"
    >
      {/* VS Code 风格集成终端顶部控制栏 */}
      <header className="flex shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#1e1e1e] px-2 py-0 h-9 select-none">
        {/* 左侧：多终端选项卡 */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {sessions.map((s) => {
            const isCur = s.id === activeSession.id
            return (
              <div
                key={s.id}
                onClick={() => setActiveSessionId(s.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 text-[12px] cursor-pointer border-b-2 transition ${
                  isCur
                    ? 'border-[#007acc] text-white bg-[#181818]'
                    : 'border-transparent text-[#858585] hover:text-[#cccccc] hover:bg-[#252526]'
                }`}
              >
                <Terminal size={13} className={isCur ? 'text-[#007acc]' : 'text-[#858585]'} />
                <span className="font-mono">{s.title}</span>
                {s.runningPid && <Loader2 size={11} className="animate-spin text-amber-400" />}
                <button
                  type="button"
                  onClick={(e) => closeSession(s.id, e)}
                  title={t('关闭终端实例')}
                  className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[#333333] hover:text-white transition"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )
          })}

          {/* 新增终端实例 (+) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => createNewSession()}
              title={t('新建集成终端')}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-[12px] text-[#858585] hover:bg-[#2d2d2d] hover:text-white transition cursor-pointer"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* 右侧：Shell 切换与快捷操作 */}
        <div className="flex items-center gap-2">
          {/* Shell 下拉切换 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShellMenuOpen((v) => !v)}
              className="flex items-center gap-1 rounded bg-[#252526] px-2 py-1 text-[11px] text-[#cccccc] hover:bg-[#2d2d2d] border border-[#333333] transition cursor-pointer font-mono"
            >
              <span>{activeSession.shell}</span>
              <ChevronDown size={11} className="text-[#858585]" />
            </button>

            {shellMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded border border-[#454545] bg-[#252526] py-1 shadow-2xl">
                {DEFAULT_SHELLS.map((sh) => (
                  <button
                    key={sh.key}
                    type="button"
                    onClick={() => {
                      setSessions((prev) =>
                        prev.map((s) =>
                          s.id === activeSession.id ? { ...s, shell: sh.key } : s
                        )
                      )
                      setShellMenuOpen(false)
                    }}
                    className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11.5px] transition hover:bg-[#094771] hover:text-white ${
                      activeSession.shell === sh.key ? 'text-[#007acc] font-semibold' : 'text-[#cccccc]'
                    }`}
                  >
                    <span>{sh.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 清屏图标 */}
          <button
            type="button"
            onClick={() =>
              setSessions((prev) =>
                prev.map((s) => (s.id === activeSession.id ? { ...s, lines: [] } : s))
              )
            }
            title={t('清空终端缓冲区 (Ctrl+L)')}
            className="rounded p-1 text-[#858585] hover:bg-[#2d2d2d] hover:text-white transition cursor-pointer"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </header>

      {/* 终端屏幕输出流 */}
      <div
        ref={outputScrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 leading-[1.4] selection:bg-[#264f78] selection:text-white"
      >
        {activeSession.lines.map((chunk, idx) => (
          <div key={idx} className="whitespace-pre-wrap break-all font-mono">
            {renderAnsiText(chunk)}
          </div>
        ))}

        {/* 当前活动输入行（与流输出完全无缝连缀） */}
        <div className="flex items-start whitespace-pre-wrap break-all font-mono">
          <span className="text-[#38bdf8] font-medium shrink-0">
            {getPromptString(activeSession)}
          </span>
          <span className="text-white relative flex-1 min-w-[20px]">
            {activeSession.inputVal.slice(0, activeSession.cursorPos)}
            {/* 原生终端闪烁光标 */}
            <span className="inline-block w-2 h-4.5 bg-[#aeafad] text-[#181818] animate-pulse align-middle" />
            {activeSession.inputVal.slice(activeSession.cursorPos)}
          </span>
        </div>
      </div>

      {/* 隐藏的透明按键捕获区 */}
      <textarea
        ref={inputRef}
        value={activeSession.inputVal}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className="absolute -top-[9999px] -left-[9999px] opacity-0 h-0 w-0 pointer-events-none"
        autoFocus
        spellCheck={false}
      />
    </div>
  )
}
