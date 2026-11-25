/**
 * 群聊抬头的身份块：卡牌式多 agent 头像 + 可改的群名 + 空闲成员头像。
 * 从 GroupChatPanel 拆出，改名状态只在这里维护，面板只管消息流。
 */
import { useState } from 'react'
import { MessageSquare, Pencil } from 'lucide-react'
import { t } from '../../../i18n'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import { GroupAvatarStack } from '../../learn/agent-team/GroupAvatarStack'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import type { GroupChatAgent } from './GroupChatPanel'
import { WorkingAgentStack } from './WorkingAgentStack'

export function GroupChatTitle({
  agents,
  groupName,
  onRenameGroup,
  workingAgents,
}: {
  agents: GroupChatAgent[]
  groupName?: string
  onRenameGroup?: (name: string) => void
  workingAgents: GroupChatAgent[]
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const displayName = groupName?.trim() || t('群聊')

  const start = () => {
    if (!onRenameGroup) return
    setDraft(groupName?.trim() || '')
    setRenaming(true)
  }
  const commit = (name: string) => {
    onRenameGroup?.(name)
    setRenaming(false)
  }

  return (
    <>
      <GroupAvatarStack agents={agents} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              maxLength={40}
              aria-label={t('群聊名称')}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commit(draft)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  commit(groupName?.trim() || '')
                }
              }}
              className="min-w-0 flex-1 rounded-md border border-seal/40 bg-card px-1.5 py-0.5 text-[14px] font-semibold text-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={start}
              onDoubleClick={start}
              title={onRenameGroup ? t('点击重命名群聊') : undefined}
              className="min-w-0 truncate text-left text-[14px] font-semibold text-ink"
            >
              {displayName}
            </button>
          )}
          {onRenameGroup && !renaming ? (
            <button
              type="button"
              aria-label={t('重命名群聊')}
              title={t('重命名群聊')}
              onClick={start}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-faint transition hover:bg-line/40 hover:text-ink"
            >
              <Pencil size={12} />
            </button>
          ) : null}
        </div>
      </div>
      {workingAgents.length ? (
        <WorkingAgentStack agents={workingAgents} />
      ) : (
        <div className="flex -space-x-2">
          {agents.slice(0, 5).map((agent) => {
            const meta = AGENT_ROSTER_META[agent.id]
            return (
              <span
                key={agent.id}
                title={agent.name}
                className={
                  'flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border ' +
                  (meta?.avatarClass ?? 'border-line/70 bg-line/45 text-ink-soft')
                }
              >
                <AgentAvatarGlyph
                  avatarId={agent.avatarId}
                  fallback={meta?.fallbackIcon ?? MessageSquare}
                  size={15}
                  imgSize={28}
                  imgClassName="h-7 w-7 rounded-full"
                />
              </span>
            )
          })}
        </div>
      )}
    </>
  )
}
