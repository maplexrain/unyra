/**
 * 左侧垂直 Agent 列表侧栏：
 * 提供两位垂直切换的智能体：「仅聊天」（自由对话）与「导师」（当前学习目标专属导师）。
 */

import { useState } from 'react'
import {
  GraduationCap,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { t, useLocale } from '../../../i18n'
import type { AgentTeamMode } from './conversationList'

const LEFT_COLLAPSED_KEY = 'moji:agent-team:left-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(LEFT_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export interface AgentRosterSidebarProps {
  mode: AgentTeamMode
  onSelectMode: (mode: AgentTeamMode) => void
  activeGoalTitle: string | null
  freeRunning: boolean
  tutorRunning: boolean
  tutorHasAsk: boolean
}

export function AgentRosterSidebar({
  mode,
  onSelectMode,
  activeGoalTitle,
  freeRunning,
  tutorRunning,
  tutorHasAsk,
}: AgentRosterSidebarProps) {
  useLocale()
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next)
    try {
      localStorage.setItem(LEFT_COLLAPSED_KEY, next ? 'true' : 'false')
    } catch {
      // ignore storage errors
    }
  }

  const agents: Array<{
    id: AgentTeamMode
    label: string
    subtitle: string
    icon: typeof MessageSquare
    accentClass: string
    running: boolean
    hasAsk: boolean
  }> = [
    {
      id: 'free',
      label: t('仅聊天'),
      subtitle: freeRunning ? t('回答中…') : t('纯对话 · 联网与日程'),
      icon: MessageSquare,
      accentClass: 'bg-line/70 text-ink-strong',
      running: freeRunning,
      hasAsk: false,
    },
    {
      id: 'tutor',
      label: t('导师'),
      subtitle: tutorHasAsk
        ? t('等待你的确认')
        : tutorRunning
          ? t('正在执行…')
          : activeGoalTitle || t('未选择学习目标'),
      icon: GraduationCap,
      accentClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
      running: tutorRunning,
      hasAsk: tutorHasAsk,
    },
  ]

  if (collapsed) {
    return (
      <aside
        aria-label={t('智能体列表')}
        className="flex h-full w-12 shrink-0 flex-col items-center border-r border-line/70 bg-paper/60 py-2.5 gap-2"
      >
        <button
          type="button"
          onClick={() => toggleCollapsed(false)}
          title={t('展开智能体列表')}
          aria-label={t('展开智能体列表')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/50 hover:text-ink"
        >
          <PanelLeftOpen size={15} />
        </button>

        <span aria-hidden="true" className="w-6 border-t border-line/60" />

        <div className="flex flex-col items-center gap-1.5" role="tablist" aria-orientation="vertical">
          {agents.map((item) => {
            const Icon = item.icon
            const active = mode === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={`${item.label} · ${item.subtitle}`}
                onClick={() => onSelectMode(item.id)}
                className={
                  'relative flex h-9 w-9 items-center justify-center rounded-xl border transition ' +
                  (active
                    ? 'border-line-strong bg-card text-ink-strong shadow-xs'
                    : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
                }
              >
                <Icon size={16} />
                {item.hasAsk ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
                  />
                ) : item.running ? (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-seal"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <aside
      aria-label={t('智能体列表')}
      className="flex h-full w-[184px] shrink-0 flex-col border-r border-line/70 bg-paper/60"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line/50 px-3 py-2.5">
        <span className="text-[11.5px] font-semibold tracking-wide text-ink-soft">
          {t('智能体')}
        </span>
        <button
          type="button"
          onClick={() => toggleCollapsed(true)}
          title={t('收起智能体列表')}
          aria-label={t('收起智能体列表')}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/50 hover:text-ink"
        >
          <PanelLeftClose size={14} />
        </button>
      </header>

      <div
        role="tablist"
        aria-orientation="vertical"
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
      >
        {agents.map((item) => {
          const Icon = item.icon
          const active = mode === item.id
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectMode(item.id)}
              className={
                'group flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ' +
                (active
                  ? 'border-line-strong/80 bg-card text-ink-strong shadow-xs'
                  : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
              }
            >
              <span
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ' +
                  (active ? item.accentClass : 'bg-line/40 text-ink-soft group-hover:text-ink')
                }
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-medium text-ink-strong">
                    {item.label}
                  </span>
                  {item.hasAsk ? (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
                    />
                  ) : item.running ? (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-seal"
                    />
                  ) : null}
                </span>
                <span
                  title={item.subtitle}
                  className={
                    'mt-0.5 block truncate text-[10.5px] ' +
                    (item.hasAsk
                      ? 'text-amber-500'
                      : item.running
                        ? 'text-seal'
                        : 'text-ink-faint')
                  }
                >
                  {item.subtitle}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
