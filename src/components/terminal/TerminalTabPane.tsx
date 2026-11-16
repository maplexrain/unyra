/**
 * TerminalTabPane: VS Code / IntelliJ IDEA 级原生集成终端工作台。
 *
 * 核心特性：
 * 1. 真实系统工作路径：接入真实物理 CWD，支持 cd 智能跳转、相对路径与 Windows 盘符切换（D:、E:）；
 * 2. 真实 Tab 目录与文件补全：按下 Tab 动态扫描当前物理工作目录并就地完成文件名补全与循环轮转；
 * 3. 彻底清洗控制字符：剔除 OSC 标题、光标定位等魔法字符，完美渲染 ANSI 256/TrueColor 终端流；
 * 4. 真实原生交互契约：Ctrl+C 中断/选区复制、Ctrl+L 清屏、Up/Down 历史翻滚、行内光标精准联动；
 * 5. 毫秒级双工流式输出：弃绝阻塞死等，实现逐块实时流式打印（Streaming Output），实时追踪 PID 与 Ctrl+C 任务树级中断。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderAnsiText } from './ansi'
import {
  formatCdError,
  isWindowsPlatform,
  normalizeTerminalPath,
  resolveCdTarget,
} from './terminalPath'
import { TerminalHeader, type ShellKind } from './TerminalHeader'
import {
  appendTerminalOutput,
  getNativeFiles,
  getNativeProcess,
  startStreamingCommand,
  type StreamingExecutionHandle,
} from './terminalRunner'
import { useTerminalKeyNav } from './useTerminalKeyNav'

export interface TerminalTabPaneProps {
  onToast?: (msg: string) => void
}

export interface TerminalSession {
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
  const handlesRef = useRef<Map<string, StreamingExecutionHandle>>(new Map())

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

  // 组件卸载时释放所有未完成的执行句柄
  useEffect(() => {
    return () => {
      for (const h of handlesRef.current.values()) {
        void h.abort()
      }
      handlesRef.current.clear()
    }
  }, [])

  // 自动滚至最新输出
  const scrollToBottom = useCallback(() => {
    if (outputScrollRef.current) {
      outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [activeSession?.lines, activeSession?.inputVal, activeSession?.runningPid, scrollToBottom])

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
    const handle = handlesRef.current.get(id)
    if (handle) {
      void handle.abort()
      handlesRef.current.delete(id)
    }
    if (sessions.length <= 1) {
      // 最后一个终端：清屏重置
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, lines: [], inputVal: '', cursorPos: 0, runningPid: null } : s,
        ),
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
    keyNav.resetTabCycle()
    const targetSessionId = activeSession.id
    const handle = handlesRef.current.get(targetSessionId)

    if (handle) {
      handlesRef.current.delete(targetSessionId)
      await handle.abort()
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                runningPid: null,
                lines: appendTerminalOutput(s.lines, '^C\n'),
                inputVal: '',
                cursorPos: 0,
              }
            : s,
        ),
      )
    } else if (activeSession.runningPid) {
      const np = getNativeProcess()
      try {
        await np?.stop(activeSession.runningPid, { force: true })
      } catch {}
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                runningPid: null,
                lines: appendTerminalOutput(s.lines, '^C\n'),
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
          s.id === targetSessionId
            ? {
                ...s,
                lines: [...s.lines, `${getPromptString(s)}${s.inputVal}^C\n`],
                inputVal: '',
                cursorPos: 0,
              }
            : s,
        ),
      )
    }
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  // 执行命令
  const executeCommand = async (rawCmd: string) => {
    if (!activeSession) return
    keyNav.resetTabCycle()
    const cmd = rawCmd
    const trimmed = cmd.trim()
    const prompt = getPromptString(activeSession)
    const targetSessionId = activeSession.id

    // 内置命令支持：clear / cls
    if (trimmed === 'clear' || trimmed === 'cls') {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
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
          s.id === targetSessionId
            ? {
                ...s,
                lines: [...s.lines, `${prompt}\n`],
                inputVal: '',
                cursorPos: 0,
              }
            : s,
        ),
      )
      return
    }

    // 记录 Prompt 行与更新命令历史
    const commandLine = `${prompt}${cmd}\n`
    setSessions((prev) =>
      prev.map((s) =>
        s.id === targetSessionId
          ? {
              ...s,
              lines: [...s.lines, commandLine],
              inputVal: '',
              cursorPos: 0,
              history: [...s.history, trimmed],
              historyIdx: -1,
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
            s.id === targetSessionId
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
            s.id === targetSessionId
              ? {
                  ...s,
                  lines: [...s.lines, `${errText}\n`],
                  runningPid: null,
                }
              : s,
          ),
        )
      }
      return
    }

    // 启动原生流式执行
    const handle = await startStreamingCommand({
      shell: activeSession.shell,
      cmd: trimmed,
      cwd: activeSession.cwd,
      onData: (chunk) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSessionId
              ? {
                  ...s,
                  lines: appendTerminalOutput(s.lines, chunk),
                }
              : s,
          ),
        )
      },
      onExit: (_code, _signal) => {
        handlesRef.current.delete(targetSessionId)
        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSessionId
              ? {
                  ...s,
                  runningPid: null,
                }
              : s,
          ),
        )
        setTimeout(() => inputRef.current?.focus(), 10)
      },
      onError: (errMsg) => {
        handlesRef.current.delete(targetSessionId)
        setSessions((prev) =>
          prev.map((s) =>
            s.id === targetSessionId
              ? {
                  ...s,
                  runningPid: null,
                  lines: appendTerminalOutput(s.lines, `\n[Error] ${errMsg}\n`),
                }
              : s,
          ),
        )
        setTimeout(() => inputRef.current?.focus(), 10)
      },
    })

    if (handle) {
      handlesRef.current.set(targetSessionId, handle)
      setSessions((prev) =>
        prev.map((s) =>
          s.id === targetSessionId
            ? {
                ...s,
                runningPid: handle.processId,
              }
            : s,
        ),
      )
    }
  }

  // 键盘与输入联动 Hook
  const keyNav = useTerminalKeyNav({
    activeSession,
    setSessions,
    isWindows,
    onExecute: (cmd) => void executeCommand(cmd),
    onInterrupt: () => void handleInterrupt(),
    onClearScreen: () =>
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, lines: [] } : s)),
      ),
  })

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

        {/* 屏幕活动状态：运行中显示原生终端光标；空闲时显示 Prompt 与虚拟输入 */}
        {activeSession.runningPid ? (
          <div className="flex items-center text-zinc-400 font-mono mt-1 select-none">
            <span className="inline-block w-2 h-4.5 bg-[#aeafad] text-[#181818] animate-pulse mr-2" />
            <span className="text-xs text-zinc-500">
              {activeSession.title} 正在运行 · 按 Ctrl+C 中断
            </span>
          </div>
        ) : (
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
        )}
      </div>

      {/* 隐藏的透明按键捕获区 */}
      <textarea
        ref={inputRef}
        value={activeSession.inputVal}
        onChange={keyNav.handleInputChange}
        onKeyDown={keyNav.handleKeyDown}
        onSelect={keyNav.handleSelect}
        className="absolute -top-[9999px] -left-[9999px] opacity-0 h-0 w-0 pointer-events-none"
        autoFocus
        spellCheck={false}
      />
    </div>
  )
}
