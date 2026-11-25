/**
 * 群聊顶部栏右侧的「正在工作」头像组。
 *
 * 只露头像，不写名字：它是一枚状态标识，不是第二份成员名单。多个 agent 同时跑时
 * 头像按卡牌叠放（后一枚压住前一枚的一半），鼠标移进来才整体展开；移开恢复叠放。
 * 无边框、无阴影，和顶部栏里原本的成员头像同一层，不再像一枚浮在输入框上的按钮。
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
      className="group/working pointer-events-auto flex items-center gap-1.5 rounded-full bg-line/20 py-0.5 pl-1 pr-2"
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
              <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg border border-line-strong bg-paper">
                <AgentAvatarGlyph
                  avatarId={agent.avatarId}
                  fallback={meta?.fallbackIcon}
                  size={14}
                  imgSize={24}
                  imgClassName="h-6 w-6 rounded-md"
                />
                <span
                  aria-hidden="true"
                  className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full border border-card bg-seal"
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
