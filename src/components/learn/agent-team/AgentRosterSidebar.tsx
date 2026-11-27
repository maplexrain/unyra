/**
 * Agent 列表侧栏：团队角色阵容的名册（导师 / 调度员 / 出卷师 / 设计师 / 调研员 / 维修员）。
 * 两种形态（variant）：
 * - side（默认）：左侧竖栏，上方是 role 名册；工作上下文列表已移到 agent 对话列表底部，
 *   这里只在名册下方保留导师的目标选择器；可整体折叠成 48px 轨（forceCollapsed 时锁定不可展开）；
 * - top：容器宽度 < 800 时由 AgentSlot 切换的顶部横栏——横排 role 按钮、
 *   右侧展示当前 role 的近况摘要，不再有折叠语义（横排本身就是收起形态）。
 *
 * role 的角色标签 / 兜底图标 / 配色在 agentRoster.ts 的注册表里；名字与头像来自
 * 各自的 profile（智能体独立设置）。role 层每个 agent 只有一段会话；真正被派出去
 * 执行、需要被看见的是 work，它们显示在对应 agent 对话列表的最下方。
 * 设置入口在名册卡的**头像**上：点头像直接开这位 role 的独立设置（AgentSettingsView）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Pencil,
  Pin,
  Settings2,
} from 'lucide-react'
import { DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import type { LearningGoal } from '../../../learn/types'
import { t, useLocale } from '../../../i18n'
import { AgentAvatarGlyph } from './AgentAvatarGlyph'
import { GroupAvatarStack, type GroupAvatarAgent } from './GroupAvatarStack'
import { AgentContextMenu } from './AgentContextMenu'
import {
  isPinLocked,
  loadPinnedAgents,
  sortAgentsByPinAndTime,
  toggleAgentPin,
} from './agentPinning'
import { AGENT_ROSTER_META, AGENT_ROSTER_ORDER, type AgentVoiceStats } from './agentRoster'
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
  /* ---------- 名册底部：导师目标选择器（work 列表已移到思维页右侧状态面板） ---------- */
  /** 导师声部的作用域目标 */
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
  /** 各声部的简介（profile.bio）；空 = 用注册表的职责文案 */
  agentBios?: Partial<Record<AgentTeamMode, string>>
  /** 名册里固定多出来的「群聊」入口：群聊只有对话列表，通道为 group */
  groupActive?: boolean
  groupName?: string
  /** 群头像的卡牌成员（取前三位叠放） */
  groupAgents?: readonly GroupAvatarAgent[]
  /** 群聊改名；空串 = 恢复默认「群聊」 */
  onRenameGroup?: (name: string) => void
  groupPreview?: string
  onOpenGroup?: () => void
  /** fixside 正停着这枚智能体页签 */
  fixSideAgentOpen?: boolean
  /** 顶部「固定到 fixside」：开 / 关智能体页的固定外侧栏 */
  onToggleFixSide?: () => void
}

export function AgentRosterSidebar({
  mode,
  onSelectMode,
  activeGoalTitle,
  voiceStats,
  forceCollapsed = false,
  persistCollapsed = true,
  variant = 'side',
  activeGoalId,
  goalLocked,
  goals,
  goalTitleOf,
  onSelectGoal,
  onOpenSettings,
  agentNames,
  agentAvatars,
  agentBios,
  groupActive = false,
  groupName,
  groupAgents,
  onRenameGroup,
  groupPreview,
  onOpenGroup,
  fixSideAgentOpen = false,
  onToggleFixSide,
}: AgentRosterSidebarProps) {
  useLocale()
  const [collapsed, setCollapsed] = useState<boolean>(() => (persistCollapsed ? readCollapsed() : false))
  const [pinnedAgents, setPinnedAgents] = useState<Set<AgentTeamMode>>(() => loadPinnedAgents())
  const [contextMenu, setContextMenu] = useState<{ agentId: AgentTeamMode; x: number; y: number } | null>(null)
  const [renamingGroup, setRenamingGroup] = useState(false)
  const [groupDraft, setGroupDraft] = useState('')
  const displayGroupName = groupName?.trim() || t('群聊')
  const startRenameGroup = () => {
    if (!onRenameGroup) return
    setGroupDraft(groupName?.trim() || '')
    setRenamingGroup(true)
  }
  const commitGroupName = (name: string) => {
    onRenameGroup?.(name)
    setRenamingGroup(false)
  }

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next)
    if (!persistCollapsed) return
    try {
      localStorage.setItem(LEFT_COLLAPSED_KEY, next ? 'true' : 'false')
    } catch {
      // ignore storage errors
    }
  }

  const statsOf = useCallback(
    (id: AgentTeamMode): AgentVoiceStats => voiceStats[id] ?? { running: false, hasAsk: false },
    [voiceStats],
  )

  const agents = useMemo(() => {
    const raw = AGENT_ROSTER_ORDER.map((id) => {
      const meta = AGENT_ROSTER_META[id]
      const st = statsOf(id)
      const bio = agentBios?.[id]?.trim()
      // 用户写了简介就优先显示它；导师没写时兜底当前目标，其余声部用注册表的职责一句话
      const idleSubtitle = bio || (id === 'tutor' ? activeGoalTitle || t(meta.blurb) : t(meta.blurb))
      return {
        id,
        label: agentNames?.[id]?.trim() || t(DEFAULT_AGENT_NAME[id]),
        subtitle: st.hasAsk
          ? t('等待你的确认')
          : st.running
            ? t(id === 'free' ? '回答中…' : '正在执行…')
            : st.preview || idleSubtitle,
        timeLabel: formatConversationTime(st.lastTime ?? 0),
        count: st.count,
        unread: Math.max(0, st.unread ?? 0),
        avatarId: agentAvatars?.[id],
        fallbackIcon: meta.fallbackIcon,
        avatarClass: meta.avatarClass,
        ringClass: meta.ringClass,
        nameClass: meta.nameClass,
        running: st.running,
        hasAsk: st.hasAsk,
      }
    })
    return sortAgentsByPinAndTime(raw, pinnedAgents, (id) => statsOf(id).lastTime ?? 0)
  }, [activeGoalTitle, agentAvatars, agentNames, agentBios, pinnedAgents, statsOf])

  /**
   * 顶栏形态下不显示目标切换；侧栏底部保留一个紧凑目标选择器：
   * 工作上下文列表已经挪到 agent 对话列表最下方（见 AgentPanel/useMessageList），
   * 名册下方不再挂 work 列表，但导师的目标作用域仍需要入口。
   */
  const goalPicker =
    mode === 'tutor' && !goalLocked && (goals?.length ?? 0) > 1 && onSelectGoal ? (
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
    ) : null

  const effectiveCollapsed = Boolean(forceCollapsed || collapsed)
  const topBarRef = useRef<HTMLElement | null>(null)

  // 顶部横栏不显示滚动条：竖向滚轮在栏内改为横向滚动，触控板横向手势保持原样。
  // wheel 需要 non-passive 才能 preventDefault，React 的合成事件不保证这一点，所以挂原生监听。
  useEffect(() => {
    if (variant !== 'top') return
    const el = topBarRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      if (ev.ctrlKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return
      ev.preventDefault()
      el.scrollLeft += ev.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [variant])

  // 顶部栏形态（容器宽度 < 800 时切换）：横排声部按钮 + 当前声部的近况。
  // 没有折叠语义——横排本身就是收起形态（data-roster-top 供样式与测试识别）。
  if (variant === 'top') {
    const activeAgent = agents.find((item) => item.id === mode) ?? agents[0]!
    return (
      <aside
        ref={topBarRef}
        aria-label={t('智能体列表')}
        data-roster-top="true"
        className="moji-scroll-x flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto overscroll-x-contain border-b border-line/70 bg-paper/65 px-2"
      >
        <span className="shrink-0 pr-0.5 text-[11px] font-semibold tracking-wide text-ink-soft">
          {t('智能体')}
        </span>
        {onOpenGroup ? (
          <button
            type="button"
            data-agent-group-top="true"
            aria-pressed={groupActive}
            title={displayGroupName}
            onClick={onOpenGroup}
            className={
              'flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] transition ' +
              (groupActive
                ? 'border-line-strong bg-card text-ink-strong shadow-xs'
                : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
            }
          >
            <GroupAvatarStack agents={groupAgents ?? []} size={22} />
            <span className="font-medium">{displayGroupName}</span>
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
                <span className="relative inline-flex shrink-0">
                  <AgentAvatarGlyph
                    avatarId={item.avatarId}
                    fallback={item.fallbackIcon}
                    size={13}
                    imgSize={18}
                    imgClassName="h-[18px] w-[18px] rounded-md"
                  />
                  {item.unread > 0 ? (
                    <span
                      aria-label={t('有未读消息')}
                      data-agent-unread={item.id}
                      className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-rose-500 ring-1 ring-paper"
                    />
                  ) : null}
                </span>
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
            title={groupActive ? groupPreview : activeAgent.subtitle}
            className={
              'min-w-0 truncate text-[11px] ' +
              (groupActive
                ? 'font-medium text-ink-strong'
                : activeAgent.hasAsk
                  ? 'font-medium text-amber-500'
                  : activeAgent.running
                    ? 'font-medium text-seal'
                    : 'text-ink-faint')
            }
          >
            {groupActive ? groupPreview ?? '' : activeAgent.subtitle}
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
                title={displayGroupName}
                onClick={onOpenGroup}
                className={
                  'flex h-10 w-10 items-center justify-center rounded-full border transition ' +
                  (groupActive
                    ? 'border-line-strong bg-card text-ink-strong shadow-xs'
                    : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
                }
              >
                <GroupAvatarStack agents={groupAgents ?? []} size={30} />
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
                  {item.unread > 0 ? (
                    <span
                      aria-label={t('有未读消息')}
                      data-agent-unread={item.id}
                      className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-rose-500 ring-1 ring-paper"
                    />
                  ) : null}
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
        <div className="flex items-center gap-0.5">
          {onToggleFixSide ? (
            <button
              type="button"
              onClick={onToggleFixSide}
              aria-pressed={fixSideAgentOpen}
              title={fixSideAgentOpen ? t('关闭 fixside 智能体页') : t('固定到 fixside')}
              aria-label={fixSideAgentOpen ? t('关闭 fixside 智能体页') : t('固定到 fixside')}
              className={
                'flex h-6 w-6 items-center justify-center rounded-md transition ' +
                (fixSideAgentOpen
                  ? 'bg-seal/12 text-seal-deep hover:bg-seal/20'
                  : 'text-ink-faint hover:bg-line/50 hover:text-ink')
              }
            >
              <PanelRight size={14} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => toggleCollapsed(true)}
            title={t('收起智能体列表')}
            aria-label={t('收起智能体列表')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/50 hover:text-ink"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </header>

      {/* 声部名册：只放名册卡；各声部的工作上下文统一挂在对话列表最下方 */}
      <div
        role="tablist"
        aria-orientation="vertical"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2 pb-1"
      >
        {onOpenGroup ? (
          <div
            data-agent-group="true"
            aria-current={groupActive ? 'true' : undefined}
            role="button"
            tabIndex={0}
            onClick={onOpenGroup}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenGroup()
              }
            }}
            className={
              'group flex w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-2xl border px-2 py-1.5 text-left transition ' +
              (groupActive
                ? 'border-line-strong/85 bg-card text-ink-strong shadow-xs'
                : 'border-transparent text-ink-soft hover:border-line/60 hover:bg-card/55 hover:text-ink')
            }
          >
            <GroupAvatarStack agents={groupAgents ?? []} size={60} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1">
                {renamingGroup ? (
                  <input
                    autoFocus
                    value={groupDraft}
                    maxLength={40}
                    aria-label={t('群聊名称')}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setGroupDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => commitGroupName(groupDraft)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitGroupName(groupDraft)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        commitGroupName(groupName?.trim() || '')
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-seal/40 bg-card px-1.5 py-0.5 text-[13px] font-semibold text-ink-strong outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      startRenameGroup()
                    }}
                    className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-ink-strong"
                    title={t('双击重命名群聊')}
                  >
                    {displayGroupName}
                  </button>
                )}
                {onRenameGroup && !renamingGroup ? (
                  <button
                    type="button"
                    aria-label={t('重命名群聊')}
                    title={t('重命名群聊')}
                    onClick={(e) => {
                      e.stopPropagation()
                      startRenameGroup()
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-line/50 hover:text-ink group-hover:opacity-100"
                  >
                    <Pencil size={11} />
                  </button>
                ) : null}
              </div>
              {groupPreview ? (
                <div className="mt-0.5 truncate text-[11px] text-ink-faint">{groupPreview}</div>
              ) : null}
            </div>
          </div>
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
                  'group relative flex w-full items-center gap-2.5 rounded-2xl border px-2 py-1.5 transition ' +
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
                    {item.unread > 0 ? (
                      <span
                        aria-label={t('有未读消息')}
                        data-agent-unread={item.id}
                        className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-paper"
                      />
                    ) : null}
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
                    {item.unread > 0 ? (
                      <span
                        aria-label={t('有未读消息')}
                        data-agent-unread={item.id}
                        className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-paper"
                      />
                    ) : null}
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
      {goalPicker ? <div className="shrink-0 border-t border-line/50 p-2.5">{goalPicker}</div> : null}
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
