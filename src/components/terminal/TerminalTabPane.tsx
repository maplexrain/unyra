/**
 * TerminalTabPane: 受控控制台终端 Tab 页签组件。
 *
 * 核心特性：
 * 1. 独立于任何目标页签组（属于 PUBLIC_OWNER 公共页签，与设置、用户中心同级）；
 * 2. 具备交互式命令历史、快捷操作、Up/Down 历史回滚与 Tab 自动补全；
 * 3. 接入 Electron 宿主受控进程引擎（window.unyraNative.process / window.mojiNative.process），支持任务中断与工作目录切换；
 * 4. 纯净现代暗色终端主题，无厚重卡牌，全屏沉浸式工作台。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Folder,
  Loader2,
  Play,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react'
import { t } from '../../i18n'

export interface TerminalTabPaneProps {
  onToast?: (msg: string) => void
}

interface CommandEntry {
  id: string
  time: string
  command: string
  cwd: string
  status: 'running' | 'success' | 'error'
  exitCode?: number | null
  durationMs?: number
  output: string
  processId?: string
}

const WELCOME_BANNER = `╔════════════════════════════════════════════════════════════════╗
║  Unyra Terminal v1.0.0 — 受控命令行与进程控制台                ║
║  · 支持执行本地 CLI 工具、项目构建脚本与系统命令               ║
║  · 输入 help 查看内置指令，使用 ↑ / ↓ 键自由切换命令历史       ║
╚════════════════════════════════════════════════════════════════╝`

const QUICK_COMMANDS = [
  'git status',
  'git log --oneline -5',
  'node -v',
  'npm -v',
  'dir',
  'help',
  'clear',
]

/** 解析单行命令为可执行程序与参数列表（支持单双引号包裹） */
function parseCommandLine(input: string): { command: string; args: string[] } {
  const trimmed = input.trim()
  if (!trimmed) return { command: '', args: [] }

  const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g
  const parts: string[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(trimmed)) !== null) {
    if (match[1] !== undefined) {
      parts.push(match[1])
    } else if (match[2] !== undefined) {
      parts.push(match[2])
    } else {
      parts.push(match[0])
    }
  }

  const [command, ...args] = parts
  return { command: command || '', args }
}

export default function TerminalTabPane({ onToast }: TerminalTabPaneProps) {
  const [entries, setEntries] = useState<CommandEntry[]>([])
  const [inputVal, setInputVal] = useState('')
  const [cwd, setCwd] = useState<string>('')
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [activeProcessId, setActiveProcessId] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)

  const outputScrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

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
  }, [entries, scrollToBottom])

  // 挂载时初始化焦点
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 点击控制台任意区域时保持输入框聚焦
  const handleConsoleClick = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      inputRef.current?.focus()
    }
  }

  // 终止正在运行的命令 (Ctrl+C 或 终止按钮)
  const handleStopActive = useCallback(async () => {
    if (!activeProcessId) return
    const np = getNativeProcess()
    if (np?.stop) {
      try {
        await np.stop(activeProcessId, { force: true })
        setEntries((prev) =>
          prev.map((e) =>
            e.processId === activeProcessId
              ? {
                  ...e,
                  status: 'error',
                  output: (e.output ? e.output + '\n' : '') + '[进程已由用户手动终止]',
                }
              : e
          )
        )
      } catch (err) {
        onToast?.(t('终止进程失败: {0}', String(err)))
      }
    }
    setActiveProcessId(null)
  }, [activeProcessId, getNativeProcess, onToast])

  // 执行命令
  const executeCommand = async (rawInput: string) => {
    const trimmed = rawInput.trim()
    if (!trimmed) return

    // 记录历史
    setCmdHistory((prev) => [...prev, trimmed])
    setHistoryIndex(-1)
    setInputVal('')

    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    const entryId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    // 内置命令拦截：clear / cls
    if (trimmed === 'clear' || trimmed === 'cls') {
      setEntries([])
      return
    }

    // 内置命令拦截：help
    if (trimmed === 'help') {
      setEntries((prev) => [
        ...prev,
        {
          id: entryId,
          time: timeStr,
          command: trimmed,
          cwd,
          status: 'success',
          exitCode: 0,
          output: `可用命令指引:
  clear / cls     清空终端屏幕历史
  help            显示当前帮助信息
  pwd             打印当前工作目录
  cd <path>       切换当前工作目录
  echo <message>  回显测试文本
  git ...         执行 Git 版本管理命令
  node / npm ...  执行 Node.js / NPM 开发工具链`,
        },
      ])
      return
    }

    // 内置命令拦截：pwd
    if (trimmed === 'pwd') {
      setEntries((prev) => [
        ...prev,
        {
          id: entryId,
          time: timeStr,
          command: trimmed,
          cwd,
          status: 'success',
          exitCode: 0,
          output: cwd || '[默认工作区根目录]',
        },
      ])
      return
    }

    // 内置命令拦截：cd
    if (trimmed.startsWith('cd ') || trimmed === 'cd') {
      const targetPath = trimmed.slice(3).trim()
      let nextCwd = cwd
      if (!targetPath || targetPath === '~') {
        nextCwd = ''
      } else if (targetPath === '..') {
        const parts = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
        parts.pop()
        nextCwd = parts.join('/')
      } else {
        nextCwd = cwd ? `${cwd.replace(/[\\/]+$/, '')}/${targetPath}` : targetPath
      }
      setCwd(nextCwd)
      setEntries((prev) => [
        ...prev,
        {
          id: entryId,
          time: timeStr,
          command: trimmed,
          cwd,
          status: 'success',
          exitCode: 0,
          output: nextCwd ? `工作目录已切换至: ${nextCwd}` : '已返回默认根工作区',
        },
      ])
      return
    }

    // 内置命令拦截：echo
    if (trimmed.startsWith('echo ') || trimmed === 'echo') {
      setEntries((prev) => [
        ...prev,
        {
          id: entryId,
          time: timeStr,
          command: trimmed,
          cwd,
          status: 'success',
          exitCode: 0,
          output: trimmed.slice(4).trim(),
        },
      ])
      return
    }

    // 系统进程执行
    const { command, args } = parseCommandLine(trimmed)
    const newEntry: CommandEntry = {
      id: entryId,
      time: timeStr,
      command: trimmed,
      cwd,
      status: 'running',
      output: '',
    }
    setEntries((prev) => [...prev, newEntry])

    const np = getNativeProcess()
    if (!np || !np.run) {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? {
                ...e,
                status: 'error',
                exitCode: 1,
                output:
                  '[Web 演示模式提示] 本地系统进程执行需要 Electron 原生客户端环境。\n当前 WebUI 模式下可体验内置命令: cd, pwd, clear, help, echo 等。',
              }
            : e
        )
      )
      return
    }

    const startTime = Date.now()
    try {
      // 在 Windows 下，常见命令如 dir / echo 等需经 cmd /c 唤起；其他原生命令直接运行
      const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || '')
      const isCmdBuiltin = isWindows && /^(dir|copy|del|type|move|mkdir|rmdir)$/i.test(command)
      const runOpts = isCmdBuiltin
        ? {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', trimmed],
            cwd: cwd || undefined,
            timeoutMs: 120000,
          }
        : {
            command,
            args,
            cwd: cwd || undefined,
            timeoutMs: 120000,
          }

      const res = await np.run(runOpts)
      const durationMs = Date.now() - startTime

      const fullOutput = [res.stdout, res.stderr, res.error ? `[执行错误] ${res.error}` : '']
        .filter(Boolean)
        .join('\n')
        .trim()

      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? {
                ...e,
                status: res.ok && (res.exitCode === 0 || res.exitCode === null) ? 'success' : 'error',
                exitCode: res.exitCode,
                durationMs,
                output: fullOutput || (res.ok ? '[命令执行完成，无标准输出]' : '[命令未返回有效输出]'),
              }
            : e
        )
      )
    } catch (err) {
      const durationMs = Date.now() - startTime
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? {
                ...e,
                status: 'error',
                exitCode: 1,
                durationMs,
                output: `[系统错误] ${err instanceof Error ? err.message : String(err)}`,
              }
            : e
        )
      )
    } finally {
      setActiveProcessId(null)
    }
  }

  // 键盘快捷响应（Enter 提交，Up/Down 历史翻滚，Ctrl+C 中断，Tab 补全）
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault()
      if (activeProcessId) {
        void handleStopActive()
      } else {
        setInputVal('')
      }
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      void executeCommand(inputVal)
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (cmdHistory.length === 0) return
      const nextIdx = historyIndex < 0 ? cmdHistory.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIdx)
      setInputVal(cmdHistory[nextIdx] || '')
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (cmdHistory.length === 0 || historyIndex < 0) return
      const nextIdx = historyIndex + 1
      if (nextIdx >= cmdHistory.length) {
        setHistoryIndex(-1)
        setInputVal('')
      } else {
        setHistoryIndex(nextIdx)
        setInputVal(cmdHistory[nextIdx] || '')
      }
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const val = inputVal.trim()
      if (!val) return
      const matched = QUICK_COMMANDS.find((cmd) => cmd.startsWith(val))
      if (matched) {
        setInputVal(matched)
      }
    }
  }

  // 复制全部输出
  const handleCopyAll = () => {
    const text = entries
      .map((e) => `[${e.time}] ${e.cwd ? e.cwd + ' ' : ''}$ ${e.command}\n${e.output}`)
      .join('\n\n')
    void navigator.clipboard.writeText(text || WELCOME_BANNER)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
    onToast?.(t('控制台输出已复制到剪贴板'))
  }

  const promptDirectory = cwd ? cwd.split(/[\\/]/).pop() || cwd : 'workspace'

  return (
    <div
      onClick={handleConsoleClick}
      className="flex h-full w-full flex-col bg-[#0d1117] text-[#c9d1d9] font-mono text-[12.5px] select-text"
    >
      {/* 顶部工具栏 */}
      <header className="flex shrink-0 items-center justify-between border-b border-[#30363d] bg-[#161b22] px-4 py-2 select-none">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-400">
            <Terminal size={14} />
          </div>
          <span className="font-semibold text-white tracking-wide text-[13px]">
            {t('终端控制台')}
          </span>
          <div className="flex items-center gap-1.5 rounded-full bg-[#21262d] px-2.5 py-0.5 text-[11px] text-[#8b949e]">
            {activeProcessId ? (
              <>
                <Loader2 size={11} className="animate-spin text-amber-400" />
                <span className="text-amber-300 font-medium">{t('执行中')}</span>
              </>
            ) : (
              <>
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <span>{t('就绪')}</span>
              </>
            )}
          </div>
          {cwd && (
            <div
              title={cwd}
              className="hidden sm:flex items-center gap-1.5 rounded bg-[#21262d] px-2 py-0.5 text-[11px] text-[#8b949e] max-w-[260px] truncate"
            >
              <Folder size={11} className="shrink-0 text-emerald-400/80" />
              <span className="truncate">{cwd}</span>
            </div>
          )}
        </div>

        {/* 快捷操作区 */}
        <div className="flex items-center gap-1.5">
          {activeProcessId && (
            <button
              type="button"
              onClick={handleStopActive}
              className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/30 transition cursor-pointer"
            >
              <Square size={11} />
              <span>{t('终止任务 (Ctrl+C)')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopyAll}
            title={t('复制终端输出')}
            className="flex items-center gap-1 rounded bg-[#21262d] px-2 py-1 text-[11px] text-[#8b949e] hover:bg-[#30363d] hover:text-white transition cursor-pointer"
          >
            {isCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            <span className="hidden sm:inline">{isCopied ? t('已复制') : t('复制')}</span>
          </button>
          <button
            type="button"
            onClick={() => setEntries([])}
            title={t('清空终端屏幕')}
            className="flex items-center gap-1 rounded bg-[#21262d] px-2 py-1 text-[11px] text-[#8b949e] hover:bg-[#30363d] hover:text-white transition cursor-pointer"
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline">{t('清屏')}</span>
          </button>
        </div>
      </header>

      {/* 快捷命令推荐胶囊 */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[#21262d] bg-[#0d1117] px-4 py-1.5 select-none no-scrollbar">
        <span className="shrink-0 text-[10.5px] font-semibold text-[#8b949e] uppercase tracking-wider">
          {t('快捷命令')}:
        </span>
        {QUICK_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => void executeCommand(cmd)}
            className="shrink-0 rounded bg-[#161b22] px-2 py-0.5 text-[11px] text-[#8b949e] hover:bg-[#21262d] hover:text-emerald-400 border border-[#30363d]/60 transition cursor-pointer font-mono"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* 控制台输出流正文 */}
      <div
        ref={outputScrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 leading-relaxed selection:bg-emerald-500/25 selection:text-white space-y-3"
      >
        {/* 欢迎标语 */}
        <pre className="text-[#8b949e] text-[11.5px] leading-snug whitespace-pre font-mono opacity-80 select-none">
          {WELCOME_BANNER}
        </pre>

        {entries.map((item) => (
          <div key={item.id} className="space-y-1">
            {/* 命令行抬头 */}
            <div className="flex items-center gap-2 text-[12px] opacity-90 select-none">
              <span className="text-[#8b949e]">[{item.time}]</span>
              <span className="text-emerald-400 font-semibold">{item.cwd || promptDirectory}</span>
              <span className="text-[#8b949e]">$</span>
              <span className="text-white font-semibold">{item.command}</span>
              {item.status === 'running' && (
                <span className="flex items-center gap-1 text-[10.5px] text-amber-400">
                  <Loader2 size={10} className="animate-spin" />
                  <span>{t('运行中')}</span>
                </span>
              )}
              {item.durationMs !== undefined && (
                <span
                  className={`text-[10px] rounded px-1 py-0.1 font-mono ${
                    item.status === 'success'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-rose-500/10 text-rose-400'
                  }`}
                >
                  {item.durationMs}ms {item.exitCode !== null ? `(code ${item.exitCode})` : ''}
                </span>
              )}
            </div>

            {/* 输出正文 */}
            {item.output && (
              <pre
                className={`whitespace-pre-wrap break-all rounded-md px-2.5 py-1.5 text-[12px] leading-relaxed font-mono ${
                  item.status === 'error'
                    ? 'border-l-2 border-rose-500/70 bg-rose-950/20 text-rose-200'
                    : 'bg-[#161b22]/70 text-[#c9d1d9]'
                }`}
              >
                {item.output}
              </pre>
            )}
          </div>
        ))}
      </div>

      {/* 底部交互输入行 */}
      <div className="shrink-0 border-t border-[#30363d] bg-[#161b22] px-4 py-2.5 flex items-center gap-2 select-none shadow-lg">
        <div className="flex items-center gap-1 text-[12.5px] font-semibold text-emerald-400 shrink-0">
          <span>{promptDirectory}</span>
          <span className="text-[#8b949e]">$</span>
        </div>
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('输入命令执行 (例如: git status, node -v, help)...')}
          className="flex-1 bg-transparent text-white text-[12.5px] font-mono outline-none border-none placeholder:text-[#484f58]"
          spellCheck={false}
          autoComplete="off"
        />
        {inputVal.trim() && (
          <button
            type="button"
            onClick={() => void executeCommand(inputVal)}
            className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 transition cursor-pointer"
          >
            <Play size={11} />
            <span>{t('执行')}</span>
          </button>
        )}
      </div>
    </div>
  )
}
