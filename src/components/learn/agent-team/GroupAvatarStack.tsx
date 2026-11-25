/**
 * 群聊头像：多张 agent 头像卡牌叠在一起，而不是一个通用的「群」图标。
 *
 * 卡牌数目最多三张，左中右轻微旋转、互相压住；这样群聊在名册里和单聊一样有
 * 「这里面有谁」的具体感，同时不会为了展示全员把 60px 的入口塞满。
 */
import { Users } from 'lucide-react'
import type { AgentTeamMode } from './conversationList'
import { AgentAvatarGlyph } from './AgentAvatarGlyph'
import { AGENT_ROSTER_META } from './agentRoster'

export interface GroupAvatarAgent {
  id: AgentTeamMode
  name?: string
  avatarId?: string
}

export function GroupAvatarStack({
  agents,
  size = 60,
  className = '',
}: {
  agents: readonly GroupAvatarAgent[]
  /** 整个头像占位的边长；卡牌按比例缩放 */
  size?: number
  className?: string
}) {
  const picked = agents.slice(0, 3)
  if (!picked.length) {
    return (
      <span
        className={
          'flex shrink-0 items-center justify-center rounded-2xl border border-line/70 bg-card/70 text-ink-soft ' +
          className
        }
        style={{ width: size, height: size }}
      >
        <Users size={Math.round(size * 0.36)} />
      </span>
    )
  }
  const cardW = Math.round(size * 0.62)
  const cardH = Math.round(size * 0.82)
  const gap = picked.length > 1 ? (size - cardW) / (picked.length - 1) : 0
  return (
    <span
      className={'relative inline-flex shrink-0 items-center justify-center ' + className}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {picked.map((agent, i) => {
        const meta = AGENT_ROSTER_META[agent.id]
        const rotate = (i - (picked.length - 1) / 2) * 9
        return (
          <span
            key={agent.id}
            title={agent.name}
            className={
              'absolute top-1/2 flex items-center justify-center overflow-hidden rounded-xl border border-line/80 bg-card shadow-[0_4px_14px_rgba(31,27,23,0.14)] ' +
              (meta?.avatarClass ?? 'text-ink-soft')
            }
            style={{
              width: cardW,
              height: cardH,
              left: picked.length === 1 ? (size - cardW) / 2 : i * gap,
              transform: `translateY(-50%) rotate(${rotate}deg)`,
              zIndex: i + 1,
            }}
          >
            <AgentAvatarGlyph
              avatarId={agent.avatarId}
              fallback={meta?.fallbackIcon ?? Users}
              size={Math.round(cardW * 0.5)}
              imgSize={cardW}
              imgClassName="h-full w-full rounded-lg"
            />
          </span>
        )
      })}
    </span>
  )
}
