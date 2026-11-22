/**
 * Agent 列表侧栏：智能体团队的名册（仅聊天 / 导师 / 出卷师 / 设计师 / 调研员 / 维修员）。
 * 两种形态（variant）：
 * - side（默认）：左侧竖栏，可折叠成 48px 轨（forceCollapsed 时锁定不可展开）；
 * - top：容器宽度 < 800 时由 AgentSlot 切换的顶部横栏——横排声部按钮、
 *   右侧展示当前声部的近况摘要，不再有折叠语义（横排本身就是收起形态）。
 *
 * 声部的角色标签 / 兜底图标 / 配色在 agentRoster.ts 的注册表里；名字与头像来自
 * 各自的 profile（智能体独立设置）。承接声部（出卷师 / 设计师 / 调研员 / 维修员）的工作会话
 * 由委托与系统侧分诊自动落进来，没有「新建对话」——它们按目标各有一段工作会话。
 */

import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Trash2,
} from 'lucide-react'
import type { Conversation } from '../../../agent/types'
import { DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import type { LearningGoal } from '../../../learn/types'
import { t, useLocale } from '../../../i18n'
import { agentAvatarIcon } from './agentAvatars'
import { AGENT_ROSTER_META, AGENT_ROSTER_ORDER, voiceTags, type AgentVoiceStats } from './agentRoster'
import {
  conversationTimeOf,
  displayConversationTitle,
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
  /* ---------- 子对话列表（历史能力从右栏搬进声部项，AgentSlot 总是传） ---------- */
  /** 每个声部名下的对话列表（已按对话时间降序）；不传则不渲染子列表，top 形态也暂不展开 */
  conversationsByAgent?: Partial<Record<AgentTeamMode, Conversation[]>>
  /** 各声部当前激活的对话 id */
  activeConversationByAgent?: Partial<Record<AgentTeamMode, string | null>>
  runningByConversation?: Record<string, boolean>
  pendingAskByConv?: Record<string, unknown>
  /** 导师声部的作用域目标：子列表、新建按钮与目标切换都跟着它走 */
  activeGoalId?: string | null
  /** 固定目标的页签（:fixside）里目标不可切换 */
  goalLocked?: boolean
  goals?: LearningGoal[]
  goalTitleOf?: (goalId: string) => string
  onSelectGoal?: (goalId: string) => void
  onSelectConversation?: (agentId: AgentTeamMode, conversationId: string) => void
  onNewConversation?: (agentId: AgentTeamMode) => void
  onDeleteConversation?: (agentId: AgentTeamMode, conversationId: string) => void
  /** 打开这位声部的独立设置（中央区切到设置页，见 AgentSettingsView） */
  onOpenSettings?: (agentId: AgentTeamMode) => void
  /** 各声部的自定义显示名（智能体独立设置的身份）；空串 = 用默认名 */
  agentNames?: Partial<Record<AgentTeamMode, string>>
  /** 各声部的头像 id（AGENT_AVATARS 目录）；缺省 = 默认声部图标 */
  agentAvatars?: Partial<Record<AgentTeamMode, string>>
}

export function AgentRosterSidebar({
  mode,
  onSelectMode,
  activeGoalTitle,
  voiceStats,
  forceCollapsed = false,
  persistCollapsed = true,
  variant = 'side',
  conversationsByAgent,
  activeConversationByAgent,
  runningByConversation,
  pendingAskByConv,
  activeGoalId,
  goalLocked,
  goals,
  goalTitleOf,
  onSelectGoal,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onOpenSettings,
  agentNames,
  agentAvatars,
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

  /** 子对话列表的展开状态：默认跟随当前声部（切到哪个声部就展开哪个），手动收展后按声部记忆 */
  const [manualOpen, setManualOpen] = useState<Partial<Record<AgentTeamMode, boolean>>>({})
  const sectionOpen = (id: AgentTeamMode): boolean => manualOpen[id] ?? id === mode
  const toggleSection = (id: AgentTeamMode): void =>
    setManualOpen((prev) => ({ ...prev, [id]: !sectionOpen(id) }))

  const statsOf = (id: AgentTeamMode): AgentVoiceStats => voiceStats[id] ?? { running: false, hasAsk: false }

  const agents = AGENT_ROSTER_ORDER.map((id) => {
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
      icon: agentAvatarIcon(agentAvatars?.[id], meta.fallbackIcon),
      avatarClass: meta.avatarClass,
      ringClass: meta.ringClass,
      running: st.running,
      hasAsk: st.hasAsk,
      tags: voiceTags(id),
    }
  })

  /**
   * 一个声部的子对话列表（缩进在声部项下）：目标切换（导师多目标）、新建、选择与删除。
   * 删除保护沿用右栏的口径：唯一且空的导师对话不可删（那是「清空对话记录」的语义）、
   * 运行中的先停止再删。承接声部没有「新建对话」——它们按目标各有一段工作会话。
   */
  const convSection = (agentId: AgentTeamMode) => {
    const convs = conversationsByAgent?.[agentId] ?? []
    const activeConvId = activeConversationByAgent?.[agentId] ?? null
    const canCreate = agentId === 'free' || (agentId === 'tutor' && Boolean(activeGoalId))
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
        {canCreate && onNewConversation && (
          <button
            type="button"
            onClick={() => onNewConversation(agentId)}
            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] text-ink-soft transition hover:bg-line/45 hover:text-ink"
          >
            <MessageSquarePlus size={12} className="shrink-0 text-seal" />
            <span>{t('新建对话')}</span>
          </button>
        )}
        {convs.length === 0 ? (
          <p className="px-1.5 py-1 text-[10.5px] leading-relaxed text-ink-faint">
            {agentId === 'tutor' && !activeGoalId
              ? t('请先选择一个学习目标')
              : t(AGENT_ROSTER_META[agentId].emptyHint)}
          </p>
        ) : (
          convs.map((conv) => {
            const active = conv.id === activeConvId
            const running = Boolean(runningByConversation?.[conv.id])
            const hasAsk = Boolean(pendingAskByConv?.[conv.id])
            const title = displayConversationTitle(conv)
            const timeLabel = formatConversationTime(conversationTimeOf(conv))
            const soleEmpty =
              agentId === 'tutor' && convs.length <= 1 && conv.messages.length === 0 && !conv.title && !conv.summary
            const deleteTitle = running
              ? t('这一段正在运行，先停止再删除')
              : soleEmpty
                ? t('清空对话记录')
                : t('删除对话')
            return (
              <div
                key={conv.id}
                data-conversation-id={conv.id}
                className={
                  'group/cv relative flex items-center rounded-lg pr-0.5 transition ' +
                  (active ? 'bg-card' : 'hover:bg-line/40')
                }
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation?.(agentId, conv.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left"
                >
                  {hasAsk ? (
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500" />
                  ) : running ? (
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-seal" />
                  ) : null}
                  <span
                    title={title}
                    className={
                      'min-w-0 flex-1 truncate text-[11.5px] leading-snug ' +
                      (active ? 'font-medium text-ink-strong' : 'text-ink-soft')
                    }
                  >
                    {title}
                  </span>
                  {conv.id.startsWith('dv:') && (
                    <span
                      title={t('委托会话：只承接这位委托者的委托，不接受直接输入')}
                      className="shrink-0 rounded bg-seal/10 px-1 py-px text-[9px] leading-none text-seal-deep dark:text-seal-2"
                    >
                      {t('委托')}
                    </span>
                  )}
                  {timeLabel && <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">{timeLabel}</span>}
                </button>
                {onDeleteConversation && (
                  <button
                    type="button"
                    disabled={soleEmpty}
                    title={deleteTitle}
                    aria-label={deleteTitle}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteConversation(agentId, conv.id)
                    }}
                    className={
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition ' +
                      (soleEmpty
                        ? 'cursor-not-allowed opacity-20'
                        : 'text-ink-faint opacity-0 hover:bg-seal/15 hover:text-seal-deep group-hover/cv:opacity-100 focus-visible:opacity-100 ' +
                          (active ? 'opacity-65' : ''))
                    }
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
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
        <div role="tablist" className="flex shrink-0 items-center gap-1">
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
                  'relative flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11.5px] transition ' +
                  (active
                    ? 'border-line-strong bg-card text-ink-strong shadow-xs'
                    : 'border-transparent text-ink-soft hover:bg-line/45 hover:text-ink')
                }
              >
                <Icon size={13} />
                <span className="font-medium">{item.label}</span>
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
            title={activeAgent.subtitle}
            className={
              'min-w-0 truncate text-[11px] ' +
              (activeAgent.hasAsk
                ? 'font-medium text-amber-500'
                : activeAgent.running
                  ? 'font-medium text-seal'
                  : 'text-ink-faint')
            }
          >
            {activeAgent.subtitle}
          </span>
          {typeof activeAgent.count === 'number' && activeAgent.count > 0 && (
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
            <div key={item.id} className="shrink-0">
              <div
                className={
                  'group relative flex w-full items-center gap-1 rounded-2xl border px-3 py-2.5 transition ' +
                  (active
                    ? 'border-line-strong/85 bg-card text-ink-strong shadow-xs'
                    : 'border-transparent text-ink-soft hover:border-line/60 hover:bg-card/55 hover:text-ink')
                }
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectMode(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
                {onOpenSettings && (
                  <button
                    type="button"
                    data-agent-settings={item.id}
                    aria-label={t('智能体设置')}
                    title={t('智能体设置')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenSettings(item.id)
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/45 hover:text-ink"
                  >
                    <Settings2 size={14} />
                  </button>
                )}
                {conversationsByAgent && (
                  <button
                    type="button"
                    aria-expanded={sectionOpen(item.id)}
                    aria-label={sectionOpen(item.id) ? t('收起对话列表') : t('展开对话列表')}
                    title={sectionOpen(item.id) ? t('收起对话列表') : t('展开对话列表')}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSection(item.id)
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/45 hover:text-ink"
                  >
                    {sectionOpen(item.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
              </div>
              {conversationsByAgent && sectionOpen(item.id) && (
                <div
                  data-roster-conv-list={item.id}
                  className="ml-1.5 flex flex-col gap-px border-l border-line/50 pb-1 pl-2"
                >
                  {convSection(item.id)}
                </div>
              )}
            </div>
          )
        })}
      </div>
        </div>
      )}
    </aside>
  )
}
