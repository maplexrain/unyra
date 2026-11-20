/**
 * 右侧对话历史侧栏：
 * 展示当前选中智能体（仅聊天 / 导师）的全部对话历史，严格按对话时间降序排序，
 * 支持创建新对话与删除对话。
 */

import { useState } from 'react'
import {
  MessageSquarePlus,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Trash2,
} from 'lucide-react'
import type { Conversation } from '../../../agent/types'
import type { LearningGoal } from '../../../learn/types'
import { t, useLocale } from '../../../i18n'
import {
  conversationTimeOf,
  displayConversationTitle,
  formatConversationTime,
  visibleMessageCount,
  type AgentTeamMode,
} from './conversationList'

const RIGHT_COLLAPSED_KEY = 'moji:agent-team:right-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(RIGHT_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

export interface AgentHistorySidebarProps {
  mode: AgentTeamMode
  /** 已按对话时间降序排序的对话列表 */
  conversations: Conversation[]
  activeConversationId: string | null
  runningByConversation: Record<string, boolean>
  pendingAskByConv: Record<string, unknown>
  activeGoalId: string | null
  goalLocked?: boolean
  goals: LearningGoal[]
  goalTitleOf: (goalId: string) => string
  onSelectGoal?: (goalId: string) => void
  onSelectConversation: (conversationId: string) => void
  onNewConversation: () => void
  onDeleteConversation: (conversationId: string) => void
  /** 是否把手动折叠状态持久化到 localStorage；:side / :fixside 传送栏中置为 false */
  persistCollapsed?: boolean
}

export function AgentHistorySidebar({
  mode,
  conversations,
  activeConversationId,
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
  persistCollapsed = true,
}: AgentHistorySidebarProps) {
  useLocale()
  const [collapsed, setCollapsed] = useState<boolean>(() => (persistCollapsed ? readCollapsed() : false))

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next)
    if (!persistCollapsed) return
    try {
      localStorage.setItem(RIGHT_COLLAPSED_KEY, next ? 'true' : 'false')
    } catch {
      // ignore storage errors
    }
  }

  const canCreate = mode === 'free' || Boolean(activeGoalId)

  if (collapsed) {
    return (
      <aside
        aria-label={t('对话历史')}
        className="flex h-full w-11 shrink-0 flex-col items-center border-l border-line/70 bg-paper/60 py-2.5 gap-2"
      >
        <button
          type="button"
          onClick={() => toggleCollapsed(false)}
          title={t('展开对话历史')}
          aria-label={t('展开对话历史')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/50 hover:text-ink"
        >
          <PanelRightOpen size={15} />
        </button>

        <button
          type="button"
          disabled={!canCreate}
          onClick={onNewConversation}
          title={t('新建对话')}
          aria-label={t('新建对话')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <MessageSquarePlus size={15} />
        </button>
      </aside>
    )
  }

  return (
    <aside
      aria-label={t('对话历史')}
      className="flex h-full w-[300px] shrink-0 flex-col border-l border-line/70 bg-paper/65"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-line/50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[11.5px] font-semibold tracking-wide text-ink-soft">
            {t('对话历史')}
          </span>
          <span className="rounded-full bg-line/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ink-faint">
            {conversations.length}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={!canCreate}
            onClick={onNewConversation}
            title={t('新建对话')}
            aria-label={t('新建对话')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            onClick={() => toggleCollapsed(true)}
            title={t('收起对话历史')}
            aria-label={t('收起对话历史')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/50 hover:text-ink"
          >
            <PanelRightClose size={14} />
          </button>
        </div>
      </header>

      {/* 当前智能体作用域与目标切换（多目标时便于在历史侧栏直接切换查看） */}
      <div className="shrink-0 border-b border-line/40 px-2.5 py-2 space-y-2">
        {mode === 'tutor' && goals.length > 0 && (
          <div>
            {!goalLocked && goals.length > 1 && onSelectGoal ? (
              <select
                aria-label={t('选择学习目标')}
                value={activeGoalId ?? ''}
                onChange={(e) => {
                  if (e.target.value) onSelectGoal(e.target.value)
                }}
                className="w-full truncate rounded-lg border border-line/70 bg-card/60 px-2 py-1 text-[11.5px] text-ink-soft outline-none transition hover:border-line-strong focus:border-seal/60"
              >
                {!activeGoalId && <option value="">{t('请选择学习目标')}</option>}
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {goalTitleOf(g.id)}
                  </option>
                ))}
              </select>
            ) : activeGoalId ? (
              <div
                title={goalTitleOf(activeGoalId)}
                className="truncate px-0.5 text-[11px] font-medium text-ink-faint"
              >
                {goalTitleOf(activeGoalId)}
              </div>
            ) : null}
          </div>
        )}

        <button
          type="button"
          disabled={!canCreate}
          onClick={onNewConversation}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line/80 bg-card/75 px-3 py-1.5 text-[12px] font-medium text-ink-strong transition hover:border-line-strong hover:bg-card disabled:cursor-not-allowed disabled:opacity-45"
        >
          <MessageSquarePlus size={14} className="shrink-0 text-seal" />
          <span>{t('新建对话')}</span>
        </button>
      </div>

      {/* 按对话时间降序排列的历史列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-3 py-10 text-center text-ink-faint">
            <MessagesSquare size={22} className="mb-2 opacity-50" />
            <p className="text-[12px]">
              {mode === 'tutor' && !activeGoalId
                ? t('请先选择一个学习目标')
                : t('暂无对话历史')}
            </p>
            {canCreate && (
              <p className="mt-1 text-[11px] opacity-75">
                {t('点击上方新建对话，或直接输入开始')}
              </p>
            )}
          </div>
        ) : (
          conversations.map((conv) => {
            const active = conv.id === activeConversationId
            const running = Boolean(runningByConversation[conv.id])
            const hasAsk = Boolean(pendingAskByConv[conv.id])
            const title = displayConversationTitle(conv)
            const msgCount = visibleMessageCount(conv)
            const ts = conversationTimeOf(conv)
            const timeLabel = formatConversationTime(ts)
            const fullTime = ts > 0 ? new Date(ts).toLocaleString() : ''
            const isSoleEmptyTutor =
              mode === 'tutor' &&
              conversations.length <= 1 &&
              conv.messages.length === 0 &&
              !conv.title &&
              !conv.summary
            const deleteTitle = running
              ? t('这一段正在运行，先停止再删除')
              : mode === 'tutor' && conversations.length <= 1
                ? t('清空对话记录')
                : t('删除对话')

            return (
              <div
                key={conv.id}
                data-conversation-id={conv.id}
                className={
                  'group/conv relative flex items-center gap-1 rounded-xl border px-2.5 py-2 transition ' +
                  (active
                    ? 'border-line-strong/80 bg-card text-ink-strong shadow-xs'
                    : 'border-transparent text-ink hover:bg-line/45')
                }
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation(conv.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    {hasAsk ? (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
                      />
                    ) : running ? (
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-seal"
                      />
                    ) : null}
                    <span
                      title={title}
                      className={
                        'truncate text-[12.5px] leading-snug ' +
                        (active ? 'font-medium text-ink-strong' : 'text-ink')
                      }
                    >
                      {title}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                    {timeLabel && (
                      <span title={fullTime} className="shrink-0 tabular-nums">
                        {timeLabel}
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="truncate">
                      {hasAsk
                        ? t('等待确认')
                        : running
                          ? t('回答中…')
                          : msgCount > 0
                            ? t('{0} 条消息', msgCount)
                            : t('还没有消息')}
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isSoleEmptyTutor}
                  title={deleteTitle}
                  aria-label={deleteTitle}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteConversation(conv.id)
                  }}
                  className={
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ' +
                    (isSoleEmptyTutor
                      ? 'cursor-not-allowed opacity-20'
                      : 'text-ink-faint opacity-0 hover:bg-seal/15 hover:text-seal-deep group-hover/conv:opacity-100 focus-visible:opacity-100 ' +
                        (active ? 'opacity-65' : ''))
                  }
                >
                  <Trash2 size={12.5} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
