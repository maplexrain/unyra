/**
 * 群聊输入框上方的「正在工作」头像组。
 *
 * 只露头像，不写名字：它是一枚状态浮层，不是第二份成员名单。多个 agent 同时跑时
 * 头像按卡牌叠放（后一枚压住前一枚的一半），鼠标移进来才整体展开；移开恢复叠放，
 * 不占输入区的固定高度。
 */
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'
import { t } from '../../../i18n'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'

export interface WorkingAgent {
  id: AgentTeamMode
  name: string
  avatarId?: string
}

export function WorkingAgentStack({ agents }: { agents: WorkingAgent[] }) {
  if (!agents.length) return null
  return (
    <div
      data-working-agents
      aria-label={t('{0} 位 agent 正在工作', agents.length)}
      className="group/working pointer-events-auto flex items-center gap-2 rounded-full border border-line/70 bg-card/92 py-1 pl-1.5 pr-2.5 shadow-[0_10px_30px_rgba(31,27,23,0.16)] backdrop-blur-md"
    >
      <div className="flex items-center">
        {agents.map((agent, i) => {
          const meta = AGENT_ROSTER_META[agent.id]
          return (
            <div
              key={agent.id}
              title={agent.name}
              className={
                'relative transition-[margin] duration-300 ease-out ' +
                (i > 0 ? '-ml-[18px] group-hover/working:ml-0' : '')
              }
            >
              <span className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-line-strong bg-paper shadow-sm">
                <AgentAvatarGlyph
                  avatarId={agent.avatarId}
                  fallback={meta?.fallbackIcon}
                  size={18}
                  imgSize={32}
                  imgClassName="h-8 w-8 rounded-[10px]"
                />
                <span
                  aria-hidden="true"
                  className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full border border-card bg-seal"
                />
              </span>
            </div>
          )
        })}
      </div>
      <span className="whitespace-nowrap text-[10.5px] font-medium text-ink-soft">
        {t('{0} 位工作中', agents.length)}
      </span>
    </div>
  )
}
