import React, { useState } from 'react'
import { ChevronDown, Loader2, Plus, Terminal, Trash2 } from 'lucide-react'
import { t } from '../../i18n'

export type ShellKind = 'powershell' | 'cmd' | 'bash'

export interface TerminalHeaderSession {
  id: string
  title: string
  runningPid: string | null
}

export const DEFAULT_SHELLS: { key: ShellKind; label: string }[] = [
  { key: 'powershell', label: 'PowerShell' },
  { key: 'cmd', label: 'Command Prompt (CMD)' },
  { key: 'bash', label: 'Git Bash / Bash' },
]

export interface TerminalHeaderProps {
  sessions: TerminalHeaderSession[]
  activeSessionId: string
  activeShell: ShellKind
  onSelectSession: (id: string) => void
  onCloseSession: (id: string, e: React.MouseEvent) => void
  onNewSession: () => void
  onSelectShell: (shell: ShellKind) => void
  onClearScreen: () => void
}

export function TerminalHeader({
  sessions,
  activeSessionId,
  activeShell,
  onSelectSession,
  onCloseSession,
  onNewSession,
  onSelectShell,
  onClearScreen,
}: TerminalHeaderProps) {
  const [shellMenuOpen, setShellMenuOpen] = useState(false)

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-[#2b2b2b] bg-[#1e1e1e] px-2 py-0 h-9 select-none">
      {/* 左侧：多终端选项卡 */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {sessions.map((s) => {
          const isCur = s.id === activeSessionId
          return (
            <div
              key={s.id}
              onClick={() => onSelectSession(s.id)}
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
                onClick={(e) => onCloseSession(s.id, e)}
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
            onClick={onNewSession}
            title={t('新建集成终端')}
            className="flex items-center gap-0.5 rounded px-2 py-1 text-[12px] text-[#858585] hover:bg-[#2d2d2d] hover:text-white transition cursor-pointer"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* 右侧：Shell 切换与清屏 */}
      <div className="flex items-center gap-2 pr-2">
        {/* Shell 切换下拉 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShellMenuOpen(!shellMenuOpen)}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] text-[#858585] hover:bg-[#2d2d2d] hover:text-[#cccccc] transition"
          >
            <span>{DEFAULT_SHELLS.find((x) => x.key === activeShell)?.label}</span>
            <ChevronDown size={11} />
          </button>

          {shellMenuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-44 rounded border border-[#454545] bg-[#252526] py-1 shadow-2xl">
              {DEFAULT_SHELLS.map((sh) => (
                <button
                  key={sh.key}
                  type="button"
                  onClick={() => {
                    onSelectShell(sh.key)
                    setShellMenuOpen(false)
                  }}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11.5px] transition hover:bg-[#094771] hover:text-white ${
                    activeShell === sh.key ? 'text-[#007acc] font-semibold' : 'text-[#cccccc]'
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
          onClick={onClearScreen}
          title={t('清空终端缓冲区 (Ctrl+L)')}
          className="rounded p-1 text-[#858585] hover:bg-[#2d2d2d] hover:text-white transition cursor-pointer"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </header>
  )
}
