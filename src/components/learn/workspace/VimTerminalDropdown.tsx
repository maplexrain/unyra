/**
 * VimTerminalDropdown: :terminal / :term 命令参数下拉候选组件。
 * 当用户在命令行输入 :terminal 时，呈现可选的终端类型（PowerShell、CMD、Bash），
 * 支持键盘上下方向键 / Ctrl+J / Ctrl+K 切换选取与鼠标点击执行。
 */

import { useEffect, useRef } from 'react'
import { Terminal } from 'lucide-react'
import type { ShellKind } from '../../../learn/types/tabs'
import { t } from '../../../i18n'

export interface TerminalOption {
  kind: ShellKind
  label: string
  cmd: string
  aliases?: string[]
  desc: string
}

export const TERMINAL_SHELL_OPTIONS: TerminalOption[] = [
  {
    kind: 'powershell',
    label: 'PowerShell',
    cmd: 'powershell',
    aliases: ['pwsh', 'ps'],
    desc: t('Windows PowerShell / PowerShell 命令行环境'),
  },
  {
    kind: 'cmd',
    label: 'Command Prompt (CMD)',
    cmd: 'cmd',
    aliases: ['prompt'],
    desc: t('经典 Windows 命令提示符 (cmd.exe)'),
  },
  {
    kind: 'bash',
    label: 'Git Bash / Bash',
    cmd: 'bash',
    aliases: ['sh', 'git-bash', 'wsl'],
    desc: t('Git Bash / Linux 兼容终端'),
  },
]

interface Props {
  filter: string
  selectedIndex: number
  onSelect: (option: TerminalOption) => void
}

export function filterTerminalOptions(filter: string): TerminalOption[] {
  const q = filter.trim().toLowerCase()
  if (!q) return TERMINAL_SHELL_OPTIONS
  return TERMINAL_SHELL_OPTIONS.filter(
    (opt) =>
      opt.cmd.toLowerCase().includes(q) ||
      opt.label.toLowerCase().includes(q) ||
      opt.desc.toLowerCase().includes(q) ||
      opt.aliases?.some((a) => a.toLowerCase().includes(q)),
  )
}

export default function VimTerminalDropdown({ filter, selectedIndex, onSelect }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const options = filterTerminalOptions(filter)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (options.length === 0) {
    return (
      <div className="p-4 text-center text-[12.5px] text-ink-faint">
        {t('未找到匹配的终端类型（支持 powershell、cmd、bash）')}
      </div>
    )
  }

  return (
    <div
      className="max-h-[320px] overflow-y-auto p-1.5 flex flex-col gap-0.5"
      role="listbox"
      aria-label={t('可选终端类型列表')}
    >
      {options.map((item, idx) => {
        const active = idx === selectedIndex
        return (
          <button
            key={item.kind}
            ref={active ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={active}
            className={
              'flex w-full items-center gap-3 px-3 py-2 text-left rounded-lg text-[13px] transition cursor-pointer ' +
              (active ? 'bg-seal/15 text-seal-light' : 'hover:bg-line/40 text-ink')
            }
            onClick={() => onSelect(item)}
          >
            <div
              className={
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border shadow-xs ' +
                (active ? 'bg-seal/20 border-seal/30 text-seal' : 'bg-paper border-line text-emerald-500')
              }
            >
              <Terminal size={14} />
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[13px] truncate">{item.label}</span>
                <span className="font-mono text-[11px] text-ink-faint px-1.5 py-0.5 bg-paper rounded border border-line/50">
                  {item.cmd}
                </span>
                {item.aliases && (
                  <span className="font-mono text-[10.5px] text-ink-faint/70 truncate">
                    {item.aliases.join(', ')}
                  </span>
                )}
              </div>
              <span className="text-[11.5px] text-ink-faint truncate">{item.desc}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
