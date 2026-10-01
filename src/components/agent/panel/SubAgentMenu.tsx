/**
 * 子代理会话的入口按钮与弹出列表。
 *
 * 按钮**没有任何底色与边框**（与右下角那排安静的工具图标同一档气质）：当前对话
 * 存在子代理会话时才出现——机器人图标 + 数量；跑着的时候不添任何装饰，
 * 只是图标变成主题色。点击在**输入框上方**弹出会话列表——与「+」菜单同一块地皮
 * （锚定输入卡、等宽、绝对定位不占位；面板要跨出按钮的定位，靠输入卡外面那层 relative）。
 * 点列表项切进该子会话的视图。
 */
import { useState } from 'react'
import { Bot } from 'lucide-react'
import type { SubAgentDef, SubAgentSession } from '../../../agent/subagent/types'
import { useLocale, t } from '../../../i18n'

export interface SubAgentMenuProps {
  sessions: SubAgentSession[]
  /** 定义（内置 + 本对话自定义的）：会话项按 defKey 认名字与内置标记 */
  defs: SubAgentDef[]
  /** 正在跑的子代理（全对话至多一场）：入口按钮与列表项只靠颜色区分，不另加装饰 */
  runningSessionId: string | null
  onOpen: (id: string) => void
}

export function SubAgentMenu({ sessions, defs, runningSessionId, onOpen }: SubAgentMenuProps) {
  const [open, setOpen] = useState(false)
  useLocale()
  if (!sessions.length) return null
  const defOf = (key: string): SubAgentDef | undefined => defs.find((d) => d.key === key)
  const statusOf = (s: SubAgentSession): { label: string; live: boolean } =>
    s.id === runningSessionId || s.status === 'running'
      ? { label: t('任务进行中'), live: true }
      : s.status === 'interrupted'
        ? { label: t('上次被中断'), live: false }
        : s.status === 'error'
          ? { label: t('上次出错'), live: false }
          : { label: t('空闲'), live: false }

  return (
    <div className="shrink-0">
      {/*
        点外面收起：一块透明的全屏垫在列表下面接住点击。列表 z-30 在垫之上，
        垫 z-20 在页面之上——点列表项是正常点击，点列表外就是收起。
      */}
      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setOpen(false)}
        />
      )}
      <button
        type="button"
        title={t('子代理会话')}
        onClick={() => setOpen((v) => !v)}
        className={
          'flex h-8 items-center gap-1 rounded-lg px-1.5 transition ' +
          (runningSessionId ? 'text-seal hover:text-seal-deep' : open ? 'text-ink' : 'text-ink-faint hover:text-ink')
        }
      >
        <Bot size={14} />
        <span className="text-[11.5px] font-medium tabular-nums">{sessions.length}</span>
      </button>

      {open && (
        <div className="moji-bloom-up-in absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border border-line-strong bg-card shadow-[0_12px_36px_rgba(31,27,23,0.22)]">
          <div className="flex items-center gap-1.5 border-b border-line bg-paper-deep/60 px-3 py-1.5 text-[11px] font-medium text-ink-strong">
            <Bot size={12} className="text-seal" />
            {t('子代理会话')}
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1">
            {sessions.map((s) => {
              const def = defOf(s.defKey)
              const status = statusOf(s)
              return (
                <button
                  key={s.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    onOpen(s.id)
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-line/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] text-ink">{def?.name ?? s.defKey}</span>
                      <span
                        className={
                          'shrink-0 rounded px-1 py-px text-[9.5px] ' +
                          (def?.builtin ? 'bg-seal/10 text-seal-deep' : 'bg-line/70 text-ink-soft')
                        }
                      >
                        {def?.builtin ? t('内置') : t('自定义')}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                      <span className={status.live ? 'shrink-0 text-seal' : 'shrink-0'}>{status.label}</span>
                      {s.lastDelivery && <span className="truncate">· {s.lastDelivery}</span>}
                      {s.lastIssue && !s.lastDelivery && <span className="truncate">· {s.lastIssue}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                    {t('{0} 次', s.runs)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
