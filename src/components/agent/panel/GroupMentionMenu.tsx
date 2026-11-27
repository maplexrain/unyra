/**
 * 群聊输入框上方的 @ 选择器与已选成员 chips。
 *
 * 从 GroupChatPanel 抽出的纯展示件：面板负责 caret / query / 键盘选择，
 * 这里只按 pickIndex 高亮并回调，避免主文件继续膨胀（文件体积门禁）。
 */
import { MessageSquare, Search } from 'lucide-react'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { t } from '../../../i18n'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'

export interface MentionAgent {
  id: AgentTeamMode
  name: string
  running?: boolean
  avatarId?: string
}

/** @ 候选列表：输入框上方浮层，↑↓ 由面板控制 pickIndex */
export function MentionPicker({
  agents,
  mentionedIds,
  pickIndex,
  onPick,
}: {
  agents: MentionAgent[]
  mentionedIds: string[]
  pickIndex: number
  onPick: (agent: MentionAgent) => void
}) {
  return (
    <div className="moji-bloom-up-in absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[240px] overflow-y-auto rounded-2xl border border-line-strong bg-card/95 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      {agents.length ? (
        agents.map((agent, i) => {
          const meta = AGENT_ROSTER_META[agent.id]
          const active = mentionedIds.includes(agent.id)
          return (
            <button
              key={agent.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(agent)}
              className={
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ' +
                (i === pickIndex ? 'bg-seal/10' : active ? 'bg-line/20' : 'hover:bg-line/25')
              }
            >
              <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-line/60">
                <AgentAvatarGlyph
                  avatarId={agent.avatarId}
                  fallback={meta?.fallbackIcon ?? MessageSquare}
                  size={13}
                  imgSize={24}
                  imgClassName="h-6 w-6 rounded-full"
                />
              </span>
              <span className={'text-[12px] font-medium ' + (meta?.nameClass ?? 'text-ink')}>{agent.name}</span>
              {agent.running ? <span className="ml-auto text-[10px] text-amber-600">{t('运行中')}</span> : null}
            </button>
          )
        })
      ) : (
        <div className="flex flex-col items-center gap-1 px-2 py-3 text-center text-[11.5px] text-ink-faint">
          <Search size={13} />
          没有匹配的 agent
        </div>
      )}
    </div>
  )
}

/** 输入框里已 @ 到的成员：小圆片，不占正文 */
export function MentionedAgentChips({ agents }: { agents: MentionAgent[] }) {
  if (!agents.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
      {agents.map((agent) => {
        const meta = AGENT_ROSTER_META[agent.id]
        return (
          <span
            key={agent.id}
            className={
              'inline-flex items-center gap-0.5 rounded-full bg-line/35 px-1.5 py-0.5 text-[10.5px] font-medium ' +
              (meta?.nameClass ?? 'text-ink')
            }
          >
            @{agent.name}
          </span>
        )
      })}
    </div>
  )
}
