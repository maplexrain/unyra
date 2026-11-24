/**
 * Agent 列表侧栏：团队角色阵容的名册（导师 / 调度员 / 出卷师 / 设计师 / 调研员 / 维修员）。
 * 两种形态（variant）：
 * - side（默认）：左侧竖栏，垂直分成两块（高度权重 2:1，各自溢出滚动）——
 *   上块是 role 名册，下块是**当前选中 agent 的 work 上下文**（点击打开 work 页签）；
 *   可整体折叠成 48px 轨（forceCollapsed 时锁定不可展开）；
 * - top：容器宽度 < 800 时由 AgentSlot 切换的顶部横栏——横排 role 按钮、
 *   右侧展示当前 role 的近况摘要，不再有折叠语义（横排本身就是收起形态）。
 *
 * role 的角色标签 / 兜底图标 / 配色在 agentRoster.ts 的注册表里；名字与头像来自
 * 各自的 profile（智能体独立设置）。role 层每个 agent 只有一段会话，所以下块不再列
 * 会话历史；真正被派出去执行、需要被看见的是 work，它们由 work / chat.send 自动建立。
 * 设置入口在名册卡的**头像**上：点头像直接开这位 role 的独立设置（AgentSettingsView）。
 */

import { useMemo, useState } from 'react'
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Settings2,
  Users,
} from 'lucide-react'
import type { WorkSession } from '../../../agent/types'
import { DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import type { LearningGoal } from '../../../learn/types'
import { t, useLocale } from '../../../i18n'
import { AgentAvatarGlyph } from './AgentAvatarGlyph'
import { AgentContextMenu } from './AgentContextMenu'
import {
  isPinLocked,
  loadPinnedAgents,
  sortAgentsByPinAndTime,
  toggleAgentPin,
} from './agentPinning'
import { AGENT_ROSTER_META, AGENT_ROSTER_ORDER, voiceTags, type AgentVoiceStats } from './agentRoster'
import {
  formatConversationTime,
  type AgentTeamMode,
} from './conversationList'

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
  /** 各声部的近况（运行点 / 表单 / 预览 / 时间 / 未读数），键 = 声部 id */
  voiceStats: Partial<Record<AgentTeamMode, AgentVoiceStats>>
  /** 容器宽度 < 800 时强制收起且禁用展开按钮（不写入全局持久化） */
  forceCollapsed?: boolean
  /** 是否把手动折叠状态持久化到 localStorage；:side / :fixside 传送栏中置为 false，避免影响原页签 */
  persistCollapsed?: boolean
  /** 形态：side=左侧竖栏（默认）；top=窄宽度（容器 <800）下的顶部横栏 */
  variant?: 'side' | 'top'
  /* ---------- 下块：当前选中 agent 的 work 上下文（点击打开 work 页签） ---------- */
  /** 每个 agent 名下的 work 会话（按 lastActiveAt 降序）；下块只展示当前选中的那一份 */
  worksByAgent?: Partial<Record<AgentTeamMode, WorkSession[]>>
  /** 打开某个 work 页签（AgentSlot 已按 roleConversationId 接好页签） */
  onOpenWork?: (agentId: AgentTeamMode, workId: string) => void
  /** 导师声部的作用域目标：work 列表跟着当前目标走 */
  activeGoalId?: string | null
  /** 固定目标的页签（:fixside）里目标不可切换 */
  goalLocked?: boolean
  goals?: LearningGoal[]
  goalTitleOf?: (goalId: string) => string
  onSelectGoal?: (goalId: string) => void
  /** 打开某位声部的独立设置（名册卡头像的点击入口，见 AgentSettingsView） */
  onOpenSettings?: (agentId: AgentTeamMode) => void
  /** 各声部的自定义显示名（智能体独立设置的身份）；空串 = 用默认名 */
  agentNames?: Partial<Record<AgentTeamMode, string>>
  /** 各声部的头像 id（AGENT_AVATARS 目录）；缺省 = 默认声部图标 */
  agentAvatars?: Partial<Record<AgentTeamMode, string>>
  /** 名册里固定多出来的「群聊」入口：群聊只有对话列表，通道为 group */
  groupActive?: boolean
  onOpenGroup?: () => void
}

export function AgentRosterSidebar({
  mode,
  onSelectMode,
  activeGoalTitle,
  voiceStats,
  forceCollapsed = false,
  persistCollapsed = true,
  variant = 'side',
  worksByAgent,
  onOpenWork,
  activeGoalId,
  goalLocked,
  goals,
  goalTitleOf,
  onSelectGoal,
  onOpenSettings,
  agentNames,
  agentAvatars,
  groupActive = false,
  onOpenGroup,
}: AgentRosterSidebarProps) {
  useLocale()
  const [collapsed, setCollapsed] = useState<boolean>(() => (persistCollapsed ? readCollapsed() : false))
  const [pinnedAgents, setPinnedAgents] = useState<Set<AgentTeamMode>>(() => loadPinnedAgents())
  const [contextMenu, setContextMenu] = useState<{ agentId: AgentTeamMode; x: number; y: number } | null>(null)

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next)
    if (!persistCollapsed) return
    try {
      localStorage.setItem(LEFT_COLLAPSED_KEY, next ? 'true' : 'false')
    } catch {
      // ignore storage errors
    }
  }

  const statsOf = (id: AgentTeamMode): AgentVoiceStats => voiceStats[id] ?? { running: false, hasAsk: false }

  const agents = useMemo(() => {
    const raw = AGENT_ROSTER_ORDER.map((id) => {
      const meta = AGENT_ROSTER_META[id]
      const st = statsOf(id)
      // 导师的兜底副标题是当前目标（它 scoped 到目标上）；其余声部用注册表的职责一句话
      const idleSubtitle = id === 'tutor' ? activeGoalTitle || t(meta.blurb) : t(meta.blurb)
      return {
        id,
        label: agentNames?.[id]?.trim() || t(DEFAULT_AGENT_NAME[id]),
        roleTag: t(meta.roleTag),
        subtitle: st.hasAsk
          ? t('等待你的确认')
          : st.running
            ? t(id === 'free' ? '回答中…' : '正在执行…')
            : st.preview || idleSubtitle,
        timeLabel: formatConversationTime(st.lastTime ?? 0),
        count: st.count,
        avatarId: agentAvatars?.[id],
        fallbackIcon: meta.fallbackIcon,
        avatarClass: meta.avatarClass,
        ringClass: meta.ringClass,
        nameClass: meta.nameClass,
        running: st.running,
        hasAsk: st.hasAsk,
        tags: voiceTags(id),
      }
    })
    return sortAgentsByPinAndTime(raw, pinnedAgents, (id) => statsOf(id).lastTime ?? 0)
  }, [activeGoalTitle, agentAvatars, agentNames, pinnedAgents, voiceStats])

  /**
   * 工作上下文块（下块）的主体：当前 agent 名下的 work 会话。
   *
   * role 层每个 agent 只有一段会话，再把它列在下块没有意义；真正需要被看见、被点开的是
   * work——role 派出的任务和执行过程都住在那里。列表只回答「有哪些 work、各自到哪一步」，
   * 点一下就把对应的 work 页签置前（见 AgentSlot 的 onOpenWork）。
   */
  const workSection = (agentId: AgentTeamMode) => {
    const works = worksByAgent?.[agentId] ?? []
    return (
      <>
        {agentId === 'tutor' && !goalLocked && (goals?.length ?? 0) > 1 && onSelectGoal && (
          <select
            aria-label={t('选择学习目标')}
            value={activeGoalId ?? ''}
            onChange={(e) => {
              if (e.target.value) onSelectGoal(e.target.value)
            }}
            className="w-full truncate rounded-lg border border-line/70 bg-card/60 px-1.5 py-1 text-[11px] text-ink-soft outline-none transition hover:border-line-strong focus:border-seal/60"
          >
            {!activeGoalId && <option value="">{t('请选择学习目标')}</option>}
            {(goals ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {goalTitleOf?.(g.id) ?? g.id}
              </option>
            ))}
          </select>
        )}
        {works.length === 0 ? (
          <p className="px-1.5 py-1 text-[10.5px] leading-relaxed text-ink-faint">
            {agentId === 'tutor' && !activeGoalId
              ? t('请先选择一个学习目标')
              : t('还没有 work 上下文；role 派出任务后会自动出现。')}
          </p>
        ) : (
          works.map((work) => {
            const running = work.status === 'running'
            const failed = work.status === 'error'
            const stopped = work.status === 'stopped' || work.status === 'interrupted'
            const statusText = running
              ? t('运行中')
              : failed
                ? t('出错')
                : stopped
                  ? t('已停止')
                  : t('空闲')
            const preview = (work.lastDelivery || work.lastIssue || '').replace(/\s+/g, ' ').trim()
            return (
              <button
                key={work.id}
                type="button"
                data-work-id={work.id}
                onClick={() => onOpenWork?.(agentId, work.id)}
                title={t('点击查看 work')}
                className={
                  'group/wk flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-1 text-left transition hover:bg-line/40 ' +
                  (running ? 'moji-agent-live ' : '')
                }
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={
                      'h-1.5 w-1.5 shrink-0 rounded-full ' +
                      (running
                        ? 'animate-pulse bg-seal'
                        : failed
                          ? 'bg-seal'
                          : stopped
                            ? 'bg-amber-500'
                            : 'bg-ink-faint/45')
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] leading-snug text-ink-soft group-hover/wk:text-ink">
                    {work.name}
                  </span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
                    {formatConversationTime(work.lastActiveAt)}
                  </span>
                  <ChevronRight
                    size={11}
                    className="shrink-0 opacity-0 transition group-hover/wk:opacity-50"
                    aria-hidden="true"
                  />
                </span>
                <span className="flex min-w-0 items-center gap-1.5 pl-3 text-[10.5px] text-ink-faint">
                  <span className={running ? 'text-seal-deep' : undefined}>{statusText}</span>
                  <span>·</span>
                  <span>{t('{0} 次任务', work.runs)}</span>
                  {preview && (
                    <>
                      <span>·</span>
                      <span className="min-w-0 flex-1 truncate" title={preview}>
                        {preview}
                      </span>
                    </>
                  )}
                </span>
              </button>
            )
          })
        )}
      </>
    )
  }

  const effectiveCollapsed = Boolean(forceCollapsed || collapsed)

  // 顶部栏形态（容器宽度 < 800 时切换）：横排声部按钮 + 当前声部的近况。
  // 没有折叠语义——横排本身就是收起形态（data-roster-top 供样式与测试识别）。
  if (variant === 'top') {
    const activeAgent = agents.find((item) => item.id === mode) ?? agents[0]!
    return (
      <aside
        aria-label={t('智能体列表')}
        data-roster-top="true"
        className="flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line/70 bg-paper/65 px-2"
      >
        <span className="shrink-0 pr-0.5 text-[11px] font-semibold tracking-wide text-ink-soft">
          {t('智能体')}
        </span>
        {onOpenGroup ? (
          <button
            type="button"
            data-agent-group-top="true"
            aria-pressed={groupActive}
            title={t('群聊：只有对话列表，@ 指定 agent')}
            onClick={onOpenGroup}
            className={
              'flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] transition ' +
              (groupActive
                ? 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300'
                : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
            }
          >
            <Users size={13} />
            <span className="font-medium">{t('群聊')}</span>
          </button>
        ) : null}
        <div role="tablist" className="flex shrink-0 items-center gap-1">
          {agents.map((item) => {
            const active = !groupActive && mode === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={`${item.label} · ${item.subtitle}`}
                onClick={() => onSelectMode(item.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setContextMenu({ agentId: item.id, x: e.clientX, y: e.clientY })
                }}
                className={
                  'relative flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] transition ' +
                  (active
                    ? 'border-line-strong bg-card text-ink-strong shadow-xs'
                    : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
                }
              >
                <AgentAvatarGlyph
                  avatarId={item.avatarId}
                  fallback={item.fallbackIcon}
                  size={13}
                  imgSize={18}
                  imgClassName="h-[18px] w-[18px] rounded-md"
                />
                <span className={'font-medium ' + item.nameClass}>{item.label}</span>
                {item.hasAsk ? (
                  <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                ) : item.running ? (
                  <span aria-hidden="true" className="absolute right-0.5 top-0.5 h-1.5 w-1.5 animate-pulse rounded-full bg-seal" />
                ) : null}
              </button>
            )
          })}
        </div>
        {onOpenSettings && (
          <button
            type="button"
            data-agent-settings={mode}
            aria-label={t('智能体设置')}
            title={t('智能体设置')}
            onClick={() => onOpenSettings(mode)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/45 hover:text-ink"
          >
            <Settings2 size={14} />
          </button>
        )}
        {/* 当前声部的近况：预览与未读数，行内截断（窄宽度下的信息位） */}
        <span className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5">
          <span
            title={groupActive ? t('群聊：只有对话列表，@ 指定 agent') : activeAgent.subtitle}
            className={
              'min-w-0 truncate text-[11px] ' +
              (groupActive
                ? 'font-medium text-teal-700 dark:text-teal-300'
                : activeAgent.hasAsk
                  ? 'font-medium text-amber-500'
                  : activeAgent.running
                    ? 'font-medium text-seal'
                    : 'text-ink-faint')
            }
          >
            {groupActive ? t('群通道 · 只有对话列表 · @ 指定 agent') : activeAgent.subtitle}
          </span>
          {!groupActive && typeof activeAgent.count === 'number' && activeAgent.count > 0 && (
            <span className="shrink-0 rounded-full bg-line/65 px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums leading-none text-ink-faint">
              {activeAgent.count}
            </span>
          )}
        </span>
      </aside>
    )
  }

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
            {onOpenGroup ? (
              <button
                type="button"
                data-agent-group-collapsed="true"
                aria-pressed={groupActive}
                title={t('群聊：只有对话列表，@ 指定 agent')}
                onClick={onOpenGroup}
                className={
                  'flex h-10 w-10 items-center justify-center rounded-full border transition ' +
                  (groupActive
                    ? 'border-teal-500/50 bg-teal-500/15 text-teal-700 dark:text-teal-300'
                    : 'border-transparent bg-teal-500/10 text-teal-600 hover:bg-teal-500/15')
                }
              >
                <Users size={18} />
              </button>
            ) : null}
            {agents.map((item) => {
              const active = !groupActive && mode === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={`${item.label} · ${item.subtitle}`}
                  onClick={() => onSelectMode(item.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setContextMenu({ agentId: item.id, x: e.clientX, y: e.clientY })
                  }}
                  className={
                    'relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border transition ' +
                    (active
                      ? 'border-line-strong bg-card text-ink-strong shadow-xs'
                      : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
                  }
                >
                  <AgentAvatarGlyph
                    avatarId={item.avatarId}
                    fallback={item.fallbackIcon}
                    size={18}
                    imgSize={40}
                    imgClassName="h-10 w-10 rounded-full"
                  />
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

      {/* 上块（高度权重 2）：声部名册——只放名册卡；各声部的对话历史统一挪去下块 */}
      <div
        role="tablist"
        aria-orientation="vertical"
        className="flex min-h-0 flex-[2] flex-col gap-2 overflow-y-auto p-2.5 pb-1"
      >
        {onOpenGroup ? (
          <button
            type="button"
            data-agent-group="true"
            aria-pressed={groupActive}
            onClick={onOpenGroup}
            className={
              'group flex w-full shrink-0 items-center gap-2.5 rounded-2xl border px-2 py-2.5 text-left transition ' +
              (groupActive
                ? 'border-teal-500/40 bg-teal-500/10 text-ink-strong shadow-xs'
                : 'border-transparent text-ink-soft hover:border-line/60 hover:bg-card/55 hover:text-ink')
            }
          >
            <span className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full border border-teal-500/30 bg-teal-500/10 text-teal-600">
              <Users size={25} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-1.5">
                <span className="truncate text-[13px] font-semibold text-ink-strong">{t('群聊')}</span>
                <span className="shrink-0 rounded-md bg-teal-500/10 px-1.5 py-0.5 text-[9.5px] font-medium leading-none text-teal-700 dark:text-teal-300">
                  {t('群通道')}
                </span>
              </span>
              <span className="mt-1 block truncate text-[11px] text-ink-faint">
                {t('只有对话列表；@ 指定 agent 才会进对方通道')}
              </span>
            </span>
          </button>
        ) : null}
        {agents.map((item) => {
          const active = !groupActive && mode === item.id
          return (
            <div
              key={item.id}
              className="shrink-0"
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ agentId: item.id, x: e.clientX, y: e.clientY })
              }}
            >
              <div
                className={
                  'group relative flex w-full items-center gap-2.5 rounded-2xl border px-2 py-2.5 transition ' +
                  (item.running ? 'moji-agent-live ' : '') +
                  (active
                    ? 'border-line-strong/85 bg-card text-ink-strong shadow-xs'
                    : 'border-transparent text-ink-soft hover:border-line/60 hover:bg-card/55 hover:text-ink')
                }
              >
                {/* 头像即设置入口：点它直接开这位声部的设置（AgentSlot.openAgentSettings 会顺手把声部切过去） */}
                {onOpenSettings ? (
                  <button
                    type="button"
                    data-agent-avatar={item.id}
                    aria-label={t('智能体设置')}
                    title={t('智能体设置')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenSettings(item.id)
                    }}
                    className={
                      'relative flex h-[60px] w-[60px] shrink-0 items-center justify-center overflow-hidden rounded-full border transition hover:ring-2 hover:ring-seal/35 ' +
                      item.avatarClass
                    }
                  >
                    <AgentAvatarGlyph
                      avatarId={item.avatarId}
                      fallback={item.fallbackIcon}
                      size={24}
                      imgSize={60}
                      imgClassName="h-[60px] w-[60px] rounded-full"
                    />
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
                  </button>
                ) : (
                  <span
                    className={
                      'relative flex h-[60px] w-[60px] shrink-0 items-center justify-center overflow-hidden rounded-full border ' +
                      item.avatarClass
                    }
                  >
                    <AgentAvatarGlyph
                      avatarId={item.avatarId}
                      fallback={item.fallbackIcon}
                      size={24}
                      imgSize={60}
                      imgClassName="h-[60px] w-[60px] rounded-full"
                    />
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
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectMode(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
              {/* 联系人信息：名称、角色标签、最近时间与消息预览 */}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={'truncate text-[13px] font-semibold ' + item.nameClass}>
                      {item.label}
                    </span>
                    <span
                      className={
                        'shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium leading-none ' + item.ringClass
                      }
                    >
                      {item.roleTag}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    {pinnedAgents.has(item.id) && (
                      <span
                        title={isPinLocked(item.id) ? t('默认置顶') : t('已置顶')}
                        className="text-seal/80 shrink-0"
                      >
                        <Pin size={10} className="fill-seal/20 -rotate-45" />
                      </span>
                    )}
                    {item.timeLabel && (
                      <span className="text-[10px] tabular-nums text-ink-faint">
                        {item.timeLabel}
                      </span>
                    )}
                  </span>
                </span>

                <span className="mt-0.5 flex items-center gap-1">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className={
                        'rounded px-1 py-px text-[9px] leading-none ' +
                        (tag === '工作流触发'
                          ? 'bg-line/55 text-ink-faint'
                          : 'bg-seal/10 text-seal-deep dark:text-seal-2')
                      }
                    >
                      {t(tag)}
                    </span>
                  ))}
                </span>

                <span className="mt-0.5 flex items-center justify-between gap-1.5">
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
              </div>
            </div>
          )
        })}
      </div>

      {/* 下块（高度权重 1）：当前选中 agent 的 work 上下文。role 层每个 agent 只有一段会话，不再重复列出 */}
      <div data-roster-work={groupActive ? 'group' : mode} className="flex min-h-0 flex-[1] flex-col border-t border-line/50">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line/50 px-3.5 py-1.5">
          <span className="truncate text-[11.5px] font-semibold text-ink-soft">
            {groupActive
              ? t('群聊')
              : (agents.find((item) => item.id === mode)?.label ?? t(DEFAULT_AGENT_NAME[mode]))}
          </span>
          <span className="ml-auto shrink-0 text-[10.5px] text-ink-faint">
            {groupActive ? t('只有对话列表') : t('工作上下文')}
          </span>
        </div>
        <div
          data-roster-work-list={groupActive ? 'group' : mode}
          className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2.5 pt-1.5"
        >
          {groupActive ? (
            <p className="px-1.5 py-1 text-[10.5px] leading-relaxed text-ink-faint">
              {t('群聊只有对话列表；@ 指定 agent 后，消息会进入对方自己的思维层。')}
            </p>
          ) : (
            workSection(mode)
          )}
        </div>
      </div>
        </div>
      )}
      {/* 智能体卡片右键菜单 */}
      <AgentContextMenu
        menu={contextMenu}
        isPinned={contextMenu ? pinnedAgents.has(contextMenu.agentId) : false}
        isLocked={contextMenu ? isPinLocked(contextMenu.agentId) : false}
        onTogglePin={(agentId) => setPinnedAgents((prev) => toggleAgentPin(prev, agentId))}
        onOpenSettings={onOpenSettings}
        onClose={() => setContextMenu(null)}
      />
    </aside>
  )
}
