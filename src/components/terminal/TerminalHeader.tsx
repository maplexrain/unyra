import { useState } from 'react'
import { ChevronDown, Loader2, Terminal, Trash2 } from 'lucide-react'
import type { ShellKind } from '../../learn/types/tabs'
import { t } from '../../i18n'

export type { ShellKind }

export const DEFAULT_SHELLS: { key: ShellKind; label: string }[] = [
  { key: 'powershell', label: 'PowerShell' },
  { key: 'cmd', label: 'Command Prompt (CMD)' },
  { key: 'bash', label: 'Git Bash / Bash' },
]

export interface TerminalHeaderProps {
  title: string
  cwd: string
  activeShell: ShellKind
  runningPid: string | null
  onSelectShell: (shell: ShellKind) => void
  onClearScreen: () => void
}

export function TerminalHeader({
  title,
  cwd,
  activeShell,
  runningPid,
  onSelectShell,
  onClearScreen,
}: TerminalHeaderProps) {
  const [shellMenuOpen, setShellMenuOpen] = useState(false)

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-line bg-paper px-3 py-0 h-8 select-none text-[12px] text-ink-soft">
      {/* 左侧：当前终端会话信息 */}
      <div className="flex items-center gap-2 min-w-0">
        <Terminal size={13} className="text-seal shrink-0" />
        <span className="font-mono font-medium text-ink truncate text-[12px]">{title}</span>
        {runningPid && <Loader2 size={11} className="animate-spin text-amber-500 shrink-0" />}
        {cwd && (
          <span
            className="text-[11px] text-ink-faint truncate max-w-[320px] font-mono hidden sm:inline"
            title={cwd}
          >
            {cwd}
          </span>
        )}
      </div>

      {/* 右侧：Shell 切换与清屏 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Shell 切换下拉 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShellMenuOpen(!shellMenuOpen)}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-ink-soft hover:bg-line/40 hover:text-ink transition cursor-pointer"
          >
            <span className="font-mono">{DEFAULT_SHELLS.find((x) => x.key === activeShell)?.label}</span>
            <ChevronDown size={11} />
          </button>

          {shellMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded-lg border border-line-strong bg-card py-1 shadow-xl">
              {DEFAULT_SHELLS.map((sh) => (
                <button
                  key={sh.key}
                  type="button"
                  onClick={() => {
                    onSelectShell(sh.key)
                    setShellMenuOpen(false)
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11.5px] transition hover:bg-seal/10 hover:text-seal ${
                    activeShell === sh.key ? 'text-seal font-semibold' : 'text-ink'
                  }`}
                >
                  <span className="font-mono">{sh.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 清屏图标 */}
        <button
          type="button"
          onClick={onClearScreen}
          title={t('清空终端缓冲区 (Ctrl+L)')}
          className="rounded p-1 text-ink-soft hover:bg-line/40 hover:text-ink transition cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </header>
  )
}
