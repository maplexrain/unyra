/**
 * TerminalTabPane: VS Code / IntelliJ IDEA 级原生集成终端工作台。
 *
 * 核心特性：
 * 1. 单终端独占页签：彻底移除终端内部子 Tab，一个终端一枚顶层页签，与工作区完全融为一体；
 * 2. 颜色全量跟随系统主题：背景、文字、提示符与 ANSI 语法高亮无缝适配浅色/深色模式；
 * 3. 动态标题与实时运行状态：空闲时显示序号与 Shell 类型（如 1: pwsh），运行中实时展示命令与状态；
 * 4. 真实系统工作路径：接入真实物理 CWD，支持 cd 智能跳转、相对路径与 Windows 盘符切换（D:、E:）；
 * 5. 真实 Tab 目录与文件补全：按下 Tab 动态扫描当前物理工作目录并就地完成文件名补全与循环轮转；
 * 6. 真实原生交互契约：Ctrl+C 中断/选区复制、Ctrl+L 清屏、Up/Down 历史翻滚、行内光标精准联动；
 * 7. 毫秒级双工流式输出：逐块实时流式打印（Streaming Output），实时追踪 PID 与 Ctrl+C 任务树级中断；
 * 8. 中文编码保护：彻底杜绝中文乱码。
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
import { renderHighlightedInput } from './terminalHighlight'
import { setTerminalMeta, unregisterTerminalMeta } from './terminalRegistry'

export interface TerminalTabPaneProps {
  tabId?: string
  termId?: string
  shell?: ShellKind
  active?: boolean
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

export default function TerminalTabPane({
  tabId: _tabId,
  termId,
  shell: propShell,
  active = true,
  onToast: _onToast,
}: TerminalTabPaneProps) {
  const isWindows = isWindowsPlatform()
  const effectiveTermId = termId || '1'
  const targetShell: ShellKind = propShell || (isWindows ? 'powershell' : 'bash')
  const shortShell = targetShell === 'powershell' ? 'pwsh' : targetShell

  const homeDirRef = useRef<string>('')
  const handleRef = useRef<StreamingExecutionHandle | null>(null)

  // 终端会话状态（单终端实例）
  const [session, setSession] = useState<TerminalSession>(() => {
    const startupBanner =
      targetShell === 'powershell' && isWindows
        ? 'Windows PowerShell\n版权所有 (C) Microsoft Corporation。保留所有权利。\n'
        : targetShell === 'cmd' && isWindows
        ? 'Microsoft Windows [版本 10.0]\n(c) Microsoft Corporation。保留所有权利。\n'
        : 'Unyra Integrated Terminal (x86_64-pc-none)\n'

    return {
      id: effectiveTermId,
      title: `${effectiveTermId}: ${shortShell}`,
      shell: targetShell,
      cwd: '',
      lines: [startupBanner],
      inputVal: '',
      cursorPos: 0,
      history: [],
      historyIdx: -1,
      runningPid: null,
    }
  })

  const outputScrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // 初始化获取宿主真实系统工作目录与注册元信息
  useEffect(() => {
    let unmounted = false

    setTerminalMeta(effectiveTermId, {
      termId: effectiveTermId,
      shell: session.shell,
      title: session.title,
      runningPid: session.runningPid,
      currentCommand: null,
    })

    // 销毁并清除可能残留的浏览模式虚拟光标
    document
      .querySelectorAll('.moji-browse-virtual-cursor, .moji-browse-cursor-trail')
      .forEach((el) => el.remove())

    async function initSystemContext() {
      try {
        const win = window as unknown as { unyraNative?: { storage?: { info: () => Promise<any> } } }
        const info = await win?.unyraNative?.storage?.info?.()
        if (unmounted || !info) return
        homeDirRef.current = info.homedir || ''
        const realCwd = normalizeTerminalPath(info.cwd || info.root || info.homedir || '', isWindows)
        if (realCwd) {
          setSession((s) => (!s.cwd ? { ...s, cwd: realCwd } : s))
        }
      } catch {}
    }
    void initSystemContext()

    return () => {
      unmounted = true
      unregisterTerminalMeta(effectiveTermId)
    }
  }, [effectiveTermId, isWindows])

  // 组件卸载时释放所有未完成的执行句柄
  useEffect(() => {
    return () => {
      if (handleRef.current) {
        void handleRef.current.abort()
        handleRef.current = null
      }
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
  }, [session.lines, session.inputVal, session.runningPid, scrollToBottom])

  // 终端全屏任意点击即聚焦虚拟输入框
  const focusTerminal = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      inputRef.current?.focus()
    }
  }

  useEffect(() => {
    if (active) {
      inputRef.current?.focus()
      scrollToBottom()
      document
        .querySelectorAll('.moji-browse-virtual-cursor, .moji-browse-cursor-trail')
        .forEach((el) => el.remove())
    } else {
      inputRef.current?.blur()
    }
  }, [active, scrollToBottom])

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
    keyNav.resetTabCycle()

    if (handleRef.current) {
      const h = handleRef.current
      handleRef.current = null
      await h.abort()
      setSession((s) => ({
        ...s,
        runningPid: null,
        lines: appendTerminalOutput(s.lines, '^C\n'),
        inputVal: '',
        cursorPos: 0,
      }))
      setTerminalMeta(effectiveTermId, {
        runningPid: null,
        currentCommand: null,
        title: `${effectiveTermId}: ${shortShell}`,
      })
    } else if (session.runningPid) {
      const np = getNativeProcess()
      try {
        await np?.stop(session.runningPid, { force: true })
      } catch {}
      setSession((s) => ({
        ...s,
        runningPid: null,
        lines: appendTerminalOutput(s.lines, '^C\n'),
        inputVal: '',
        cursorPos: 0,
      }))
      setTerminalMeta(effectiveTermId, {
        runningPid: null,
        currentCommand: null,
        title: `${effectiveTermId}: ${shortShell}`,
      })
    } else {
      // 原生终端直觉：无活动任务时按 Ctrl+C，打印 ^C 并换新行给出新 Prompt
      setSession((s) => ({
        ...s,
        lines: [...s.lines, `${getPromptString(s)}${s.inputVal}^C\n`],
        inputVal: '',
        cursorPos: 0,
      }))
    }
    setTimeout(() => inputRef.current?.focus(), 10)
  }

  // 执行命令
  const executeCommand = async (rawCmd: string) => {
    keyNav.resetTabCycle()
    const cmd = rawCmd
    const trimmed = cmd.trim()
    const prompt = getPromptString(session)

    // 内置命令支持：clear / cls
    if (trimmed === 'clear' || trimmed === 'cls') {
      setSession((s) => ({
        ...s,
        lines: [],
        inputVal: '',
        cursorPos: 0,
        history: trimmed ? [...s.history, trimmed] : s.history,
        historyIdx: -1,
      }))
      return
    }

    if (!trimmed) {
      setSession((s) => ({
        ...s,
        lines: [...s.lines, `${prompt}\n`],
        inputVal: '',
        cursorPos: 0,
      }))
      return
    }

    // 记录 Prompt 行与更新命令历史
    const commandLine = `${prompt}${cmd}\n`
    setSession((s) => ({
      ...s,
      lines: [...s.lines, commandLine],
      inputVal: '',
      cursorPos: 0,
      history: [...s.history, trimmed],
      historyIdx: -1,
    }))

    // 目录变更 cd 或 Windows 盘符切换（如 D:）原生跟踪
    const isDriveSwitch = isWindows && /^[a-zA-Z]:$/i.test(trimmed)
    const isCd = /^\s*cd(\s+.*)?$/i.test(trimmed) || isDriveSwitch

    if (isCd) {
      const targetParam = isDriveSwitch ? trimmed : trimmed.replace(/^\s*cd\s*/i, '').trim()
      const targetPath = resolveCdTarget(
        session.cwd,
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
        setSession((s) => ({
          ...s,
          cwd: targetPath,
          runningPid: null,
        }))
      } else {
        const errText = formatCdError(targetParam, session.shell)
        setSession((s) => ({
          ...s,
          lines: [...s.lines, `${errText}\n`],
          runningPid: null,
        }))
      }
      return
    }

    // 更新页签状态为运行中，标题展示命令
    const curCmdName = trimmed.slice(0, 24)
    setTerminalMeta(effectiveTermId, {
      title: `${effectiveTermId}: ${curCmdName}`,
      currentCommand: curCmdName,
    })

    // 启动原生流式执行
    const handle = await startStreamingCommand({
      shell: session.shell,
      cmd: trimmed,
      cwd: session.cwd,
      onData: (chunk) => {
        setSession((s) => ({
          ...s,
          lines: appendTerminalOutput(s.lines, chunk),
        }))
      },
      onExit: (_code, _signal) => {
        handleRef.current = null
        setSession((s) => ({
          ...s,
          runningPid: null,
        }))
        setTerminalMeta(effectiveTermId, {
          runningPid: null,
          currentCommand: null,
          title: `${effectiveTermId}: ${shortShell}`,
        })
        setTimeout(() => inputRef.current?.focus(), 10)
      },
      onError: (errMsg) => {
        handleRef.current = null
        setSession((s) => ({
          ...s,
          runningPid: null,
          lines: appendTerminalOutput(s.lines, `\n[Error] ${errMsg}\n`),
        }))
        setTerminalMeta(effectiveTermId, {
          runningPid: null,
          currentCommand: null,
          title: `${effectiveTermId}: ${shortShell}`,
        })
        setTimeout(() => inputRef.current?.focus(), 10)
      },
    })

    if (handle) {
      handleRef.current = handle
      setSession((s) => ({
        ...s,
        runningPid: handle.processId,
      }))
      setTerminalMeta(effectiveTermId, {
        runningPid: handle.processId,
        currentCommand: curCmdName,
        title: `${effectiveTermId}: ${curCmdName}`,
      })
    }
  }

  // 包装单 session 与 useTerminalKeyNav 兼容
  const setSessionsWrapper: Dispatch<SetStateAction<TerminalSession[]>> = useCallback((updater) => {
    setSession((prev) => {
      const arr = typeof updater === 'function' ? updater([prev]) : updater
      return arr[0] || prev
    })
  }, [])

  // 键盘与输入联动 Hook
  const keyNav = useTerminalKeyNav({
    activeSession: session,
    setSessions: setSessionsWrapper,
    isWindows,
    onExecute: (cmd) => void executeCommand(cmd),
    onInterrupt: () => void handleInterrupt(),
    onClearScreen: () => setSession((s) => ({ ...s, lines: [] })),
    onBlur: () => {
      inputRef.current?.blur()
      window.focus()
    },
  })

  return (
    <div
      data-terminal-pane="true"
      data-no-browse-vim="true"
      onClick={focusTerminal}
      className="flex h-full w-full flex-col bg-paper-deep text-ink font-mono text-[13px] leading-[1.35] select-text overflow-hidden"
    >
      {/* 集成终端顶部工具条（无嵌套子 Tab，直接与工作区融合） */}
      <TerminalHeader
        title={session.title}
        cwd={session.cwd}
        activeShell={session.shell}
        runningPid={session.runningPid}
        onSelectShell={(shell) => {
          setSession((s) => ({ ...s, shell }))
          const shName = shell === 'powershell' ? 'pwsh' : shell
          setTerminalMeta(effectiveTermId, { shell, title: `${effectiveTermId}: ${shName}` })
        }}
        onClearScreen={() => setSession((s) => ({ ...s, lines: [] }))}
      />

      {/* 终端屏幕输出流 */}
      <div
        ref={outputScrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 leading-[1.4] selection:bg-seal/20 dark:selection:bg-sky-500/30 selection:text-ink-strong scrollbar-thin"
      >
        {session.lines.map((chunk, idx) => (
          <div key={idx} className="whitespace-pre-wrap break-all font-mono">
            {renderAnsiText(chunk)}
          </div>
        ))}

        {/* 屏幕活动状态：运行中显示原生终端光标；空闲时显示 Prompt 与彩色高亮输入 */}
        {session.runningPid ? (
          <div className="flex items-center text-ink-soft font-mono mt-1 select-none">
            <span className="inline-block w-2 h-4.5 bg-ink text-paper animate-pulse mr-2" />
            <span className="text-xs text-ink-faint">
              {session.title} 正在运行 · 按 Ctrl+C 中断
            </span>
          </div>
        ) : (
          <div className="flex items-start whitespace-pre-wrap break-all font-mono">
            <span className="text-seal dark:text-sky-400 font-semibold shrink-0">
              {getPromptString(session)}
            </span>
            <span className="relative flex-1 min-w-[20px]">
              {renderHighlightedInput(session.inputVal, session.cursorPos)}
            </span>
          </div>
        )}
      </div>

      {/* 隐藏的透明按键捕获区 */}
      <textarea
        ref={inputRef}
        data-terminal-input="true"
        value={session.inputVal}
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
