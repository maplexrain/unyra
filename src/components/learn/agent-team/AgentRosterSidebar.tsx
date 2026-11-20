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
import { formatConversationTime, type AgentTeamMode } from './conversationList'

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
  freePreview?: string
  freeLastTime?: number
  freeCount?: number
  tutorPreview?: string
  tutorLastTime?: number
  tutorCount?: number
  /** 容器宽度 < 800 时强制收起且禁用展开按钮（不写入全局持久化） */
  forceCollapsed?: boolean
  /** 是否把手动折叠状态持久化到 localStorage；:side / :fixside 传送栏中置为 false，避免影响原页签 */
  persistCollapsed?: boolean
}

export function AgentRosterSidebar({
  mode,
  onSelectMode,
  activeGoalTitle,
  freeRunning,
  tutorRunning,
  tutorHasAsk,
  freePreview,
  freeLastTime,
  freeCount,
  tutorPreview,
  tutorLastTime,
  tutorCount,
  forceCollapsed = false,
  persistCollapsed = true,
}: AgentRosterSidebarProps) {
  useLocale()
  const [collapsed, setCollapsed] = useState<boolean>(() => (persistCollapsed ? readCollapsed() : false))

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next)
    if (!persistCollapsed) return
    try {
      localStorage.setItem(LEFT_COLLAPSED_KEY, next ? 'true' : 'false')
    } catch {
      // ignore storage errors
    }
  }

  const agents: Array<{
    id: AgentTeamMode
    label: string
    roleTag: string
    subtitle: string
    timeLabel: string
    count?: number
    icon: typeof MessageSquare
    avatarClass: string
    ringClass: string
    running: boolean
    hasAsk: boolean
  }> = [
    {
      id: 'free',
      label: t('仅聊天'),
      roleTag: t('跨目标'),
      subtitle: freeRunning
        ? t('回答中…')
        : freePreview || t('纯对话 · 联网与日程'),
      timeLabel: formatConversationTime(freeLastTime ?? 0),
      count: freeCount,
      icon: MessageSquare,
      avatarClass: 'bg-line/75 text-ink-strong border-line-strong/40',
      ringClass: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
      running: freeRunning,
      hasAsk: false,
    },
    {
      id: 'tutor',
      label: t('导师'),
      roleTag: t('学习导师'),
      subtitle: tutorHasAsk
        ? t('等待你的确认')
        : tutorRunning
          ? t('正在执行…')
          : tutorPreview || activeGoalTitle || t('未选择学习目标'),
      timeLabel: formatConversationTime(tutorLastTime ?? 0),
      count: tutorCount,
      icon: GraduationCap,
      avatarClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25',
      ringClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
      running: tutorRunning,
      hasAsk: tutorHasAsk,
    },
  ]

  const effectiveCollapsed = Boolean(forceCollapsed || collapsed)

  return (
    <aside
      aria-label={t('智能体列表')}
      data-roster-collapsed={effectiveCollapsed ? 'true' : undefined}
      data-roster-locked={effectiveCollapsed && forceCollapsed ? 'true' : undefined}
      className={
        'flex h-full shrink-0 flex-col overflow-hidden border-r border-line/70 bg-paper/65 transition-[width] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ' +
        (effectiveCollapsed ? 'w-12 items-center py-2.5 gap-2' : 'w-[300px]')
      }
    >
      {effectiveCollapsed ? (
        <>
          <button
            type="button"
            disabled={forceCollapsed}
            onClick={() => {
              if (!forceCollapsed) toggleCollapsed(false)
            }}
            title={forceCollapsed ? t('当前页面宽度小于 800，智能体列表已收起且暂不可展开') : t('展开智能体列表')}
            aria-label={t('展开智能体列表')}
            className={
              'flex h-8 w-8 items-center justify-center rounded-lg transition ' +
              (forceCollapsed
                ? 'cursor-not-allowed text-ink-faint/45 opacity-45'
                : 'text-ink-soft hover:bg-line/50 hover:text-ink')
            }
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
        </>
      ) : (
        <div className="flex h-full w-[300px] flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-line/50 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold tracking-wide text-ink-soft">
            {t('智能体')}
          </span>
          <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ink-faint">
            {agents.length}
          </span>
        </div>
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
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5"
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
                'group relative flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition ' +
                (active
                  ? 'border-line-strong/85 bg-card text-ink-strong shadow-xs'
                  : 'border-transparent text-ink-soft hover:border-line/60 hover:bg-card/55 hover:text-ink')
              }
            >
              {/* 联系人头像 + 在线/运行状态点 */}
              <span
                className={
                  'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border transition ' +
                  (active ? item.avatarClass : 'border-line/60 bg-line/35 text-ink-soft group-hover:text-ink')
                }
              >
                <Icon size={17} />
                <span
                  aria-hidden="true"
                  className={
                    'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-paper transition ' +
                    (item.hasAsk
                      ? 'animate-pulse bg-amber-500'
                      : item.running
                        ? 'animate-pulse bg-seal'
                        : 'bg-emerald-500')
                  }
                />
              </span>

              {/* 联系人信息：名称、角色标签、最近时间与消息预览 */}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-ink-strong">
                      {item.label}
                    </span>
                    <span
                      className={
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium leading-none ' +
                        (active
                          ? item.ringClass
                          : 'bg-line/55 text-ink-faint')
                      }
                    >
                      {item.roleTag}
                    </span>
                  </span>
                  {item.timeLabel && (
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                      {item.timeLabel}
                    </span>
                  )}
                </span>

                <span className="mt-1 flex items-center justify-between gap-1.5">
                  <span
                    title={item.subtitle}
                    className={
                      'min-w-0 truncate text-[11px] leading-snug ' +
                      (item.hasAsk
                        ? 'font-medium text-amber-500'
                        : item.running
                          ? 'font-medium text-seal'
                          : 'text-ink-faint')
                    }
                  >
                    {item.subtitle}
                  </span>
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className="shrink-0 rounded-full bg-line/65 px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums leading-none text-ink-faint">
                      {item.count}
                    </span>
                  )}
                </span>
              </span>
            </button>
          )
        })}
      </div>
        </div>
      )}
    </aside>
  )
}
