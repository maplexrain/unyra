/**
 * TerminalTabPane: VS Code / IntelliJ IDEA 级原生集成终端工作台。
 *
 * 核心特性：
 * 1. 真实系统工作路径：接入真实物理 CWD，支持 cd 智能跳转、相对路径与 Windows 盘符切换（D:、E:）；
 * 2. 真实 Tab 目录与文件补全：按下 Tab 动态扫描当前物理工作目录并就地完成文件名补全与循环轮转；
 * 3. 彻底清洗控制字符：剔除 OSC 标题、光标定位等魔法字符，完美渲染 ANSI 256/TrueColor 终端流；
 * 4. 真实原生交互契约：Ctrl+C 中断/选区复制、Ctrl+L 清屏、Up/Down 历史翻滚、行内光标精准联动。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanTerminalText, renderAnsiText } from './ansi'
import {
  computeTabCompletions,
  formatCdError,
  isWindowsPlatform,
  normalizeTerminalPath,
  resolveCdTarget,
} from './terminalPath'
import { TerminalHeader, type ShellKind } from './TerminalHeader'

export interface TerminalTabPaneProps {
  onToast?: (msg: string) => void
}

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

export default function TerminalTabPane({ onToast: _onToast }: TerminalTabPaneProps) {
  const isWindows = isWindowsPlatform()
  const homeDirRef = useRef<string>('')

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

  // Tab 补全循环状态跟踪
  const tabCycleRef = useRef<{
    tokenStart: number
    tokenEnd: number
    candidates: string[]
    candidateIdx: number
    originalInput: string
  } | null>(null)

  const outputScrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0]

  // 初始化获取宿主真实系统工作目录与用户信息
  useEffect(() => {
    let unmounted = false
    async function initSystemContext() {
      try {
        const win = window as unknown as { unyraNative?: { storage?: { info: () => Promise<any> } } }
        const info = await win?.unyraNative?.storage?.info?.()
        if (unmounted || !info) return
        homeDirRef.current = info.homedir || ''
        const realCwd = normalizeTerminalPath(info.cwd || info.root || info.homedir || '', isWindows)
        if (realCwd) {
          setSessions((prev) =>
            prev.map((s, idx) => (idx === 0 && !s.cwd ? { ...s, cwd: realCwd } : s)),
          )
        }
      } catch {}
    }
    void initSystemContext()
    return () => {
      unmounted = true
    }
  }, [isWindows])

  // 获取原生进程能力桥
  const getNativeProcess = useCallback(() => {
    if (typeof window === 'undefined') return null
    const win = window as unknown as {
      unyraNative?: { process?: any }
      mojiNative?: { process?: any }
    }
    return win.unyraNative?.process ?? win.mojiNative?.process ?? null
  }, [])

  // 获取原生文件系统能力桥
  const getNativeFiles = useCallback(() => {
    if (typeof window === 'undefined') return null
    const win = window as unknown as {
      unyraNative?: { files?: any; base?: { files?: any } }
      mojiNative?: { files?: any }
    }
    return win.unyraNative?.files ?? win.unyraNative?.base?.files ?? win.mojiNative?.files ?? null
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
  }

  // 关闭指定终端实例
  const closeSession = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (sessions.length <= 1) {
      // 最后一个终端：清屏重置
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, lines: [], inputVal: '', cursorPos: 0 } : s)),
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
    const pathStr = s.cwd || (isWindows ? 'C:\\' : '~')
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
    tabCycleRef.current = null
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
            : s,
        ),
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
            : s,
        ),
      )
    }
  }

  // 执行命令
  const executeCommand = async (rawCmd: string) => {
    if (!activeSession) return
    tabCycleRef.current = null
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
            : s,
        ),
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
            : s,
        ),
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
          : s,
      ),
    )

    // 目录变更 cd 或 Windows 盘符切换（如 D:）原生跟踪
    const isDriveSwitch = isWindows && /^[a-zA-Z]:$/i.test(trimmed)
    const isCd = /^\s*cd(\s+.*)?$/i.test(trimmed) || isDriveSwitch

    if (isCd) {
      const targetParam = isDriveSwitch ? trimmed : trimmed.replace(/^\s*cd\s*/i, '').trim()
      const targetPath = resolveCdTarget(
        activeSession.cwd,
        targetParam,
        homeDirRef.current,
        isWindows,
      )

      // 验证目标物理目录是否存在且为目录
      const files = getNativeFiles()
      let isValidDir = false
      if (files?.stat) {
        try {
          const st = await files.stat(targetPath, { trusted: true })
          isValidDir = Boolean(st?.ok && st?.exists && st?.stat?.isDirectory)
        } catch {
          isValidDir = false
        }
      } else {
        isValidDir = true
      }

      if (isValidDir) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? {
                  ...s,
                  cwd: targetPath,
                  runningPid: null,
                }
              : s,
          ),
        )
      } else {
        const errText = formatCdError(targetParam, activeSession.shell)
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? {
                  ...s,
                  lines: [...s.lines, errText],
                  runningPid: null,
                }
              : s,
          ),
        )
      }
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
            : s,
        ),
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
        trusted: true,
      })

      const rawStdout = cleanTerminalText(res.stdout || '')
      const rawStderr = cleanTerminalText(res.stderr || '')
      const outText = [rawStdout, rawStderr, res.error ? `[Error] ${res.error}` : '']
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
            : s,
        ),
      )
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                runningPid: null,
                lines: [
                  ...s.lines,
                  `[Process error]: ${err instanceof Error ? err.message : String(err)}`,
                ],
              }
            : s,
        ),
      )
    }
  }

  // 键盘与输入管理（含原生 Tab 补全与箭头光标跟随）
  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab: 原生文件名与目录自动补全
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()

      // 若处于轮换补全状态中，继续向后/向前轮换候选
      if (tabCycleRef.current && tabCycleRef.current.candidates.length > 1) {
        const state = tabCycleRef.current
        const delta = e.shiftKey ? -1 : 1
        const nextIdx = (state.candidateIdx + delta + state.candidates.length) % state.candidates.length
        const cand = state.candidates[nextIdx]
        const newInput = state.originalInput.slice(0, state.tokenStart) + cand + state.originalInput.slice(state.tokenEnd)
        const nextCursor = state.tokenStart + cand.length
        state.candidateIdx = nextIdx
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id ? { ...s, inputVal: newInput, cursorPos: nextCursor } : s,
          ),
        )
        return
      }

      // 首次触发 Tab 补全
      const comp = await computeTabCompletions(
        activeSession.inputVal,
        activeSession.cursorPos,
        activeSession.cwd,
        isWindows,
      )

      if (comp && comp.candidates.length > 0) {
        const firstCand = comp.candidates[0]
        const newInput =
          activeSession.inputVal.slice(0, comp.tokenStart) +
          firstCand +
          activeSession.inputVal.slice(comp.tokenEnd)
        const nextCursor = comp.tokenStart + firstCand.length
        tabCycleRef.current = {
          tokenStart: comp.tokenStart,
          tokenEnd: comp.tokenEnd,
          candidates: comp.candidates,
          candidateIdx: 0,
          originalInput: activeSession.inputVal,
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id ? { ...s, inputVal: newInput, cursorPos: nextCursor } : s,
          ),
        )
      }
      return
    }

    // 非 Tab 键清空当前补全轮换状态
    tabCycleRef.current = null

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
        prev.map((s) => (s.id === activeSession.id ? { ...s, lines: [] } : s)),
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
            : s,
        ),
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
              : s,
          ),
        )
      } else {
        const val = activeSession.history[nextIdx] || ''
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, historyIdx: nextIdx, inputVal: val, cursorPos: val.length }
              : s,
          ),
        )
      }
      return
    }

    // 左右键与 Home/End 实时同步行内光标
    if (e.key === 'ArrowLeft') {
      const nextPos = Math.max(0, activeSession.cursorPos - 1)
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, cursorPos: nextPos } : s)),
      )
      return
    }

    if (e.key === 'ArrowRight') {
      const nextPos = Math.min(activeSession.inputVal.length, activeSession.cursorPos + 1)
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, cursorPos: nextPos } : s)),
      )
      return
    }

    if (e.key === 'Home') {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, cursorPos: 0 } : s)),
      )
      return
    }

    if (e.key === 'End') {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id ? { ...s, cursorPos: s.inputVal.length } : s,
        ),
      )
      return
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    tabCycleRef.current = null
    const val = e.target.value
    const pos = e.target.selectionStart
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, inputVal: val, cursorPos: pos } : s,
      ),
    )
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, cursorPos: target.selectionStart } : s,
      ),
    )
  }

  return (
    <div
      onClick={focusTerminal}
      className="flex h-full w-full flex-col bg-[#181818] text-[#cccccc] font-mono text-[13px] leading-[1.35] select-text overflow-hidden"
    >
      {/* VS Code 风格集成终端顶部控制栏 */}
      <TerminalHeader
        sessions={sessions.map((s) => ({ id: s.id, title: s.title, runningPid: s.runningPid }))}
        activeSessionId={activeSession.id}
        activeShell={activeSession.shell}
        onSelectSession={(id) => setActiveSessionId(id)}
        onCloseSession={closeSession}
        onNewSession={createNewSession}
        onSelectShell={(shell) =>
          setSessions((prev) =>
            prev.map((s) => (s.id === activeSession.id ? { ...s, shell } : s)),
          )
        }
        onClearScreen={() =>
          setSessions((prev) =>
            prev.map((s) => (s.id === activeSession.id ? { ...s, lines: [] } : s)),
          )
        }
      />

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
        onSelect={handleSelect}
        className="absolute -top-[9999px] -left-[9999px] opacity-0 h-0 w-0 pointer-events-none"
        autoFocus
        spellCheck={false}
      />
    </div>
  )
}
