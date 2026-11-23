/**
 * role 的 **chat 层**：只画「用户 ↔ 当前 role」的私聊消息。
 *
 * 视角是**当前用户**，不是 role：用户自己说的话在右侧，agent 的回复在左侧。
 * 名字与头像都来自应用的真实身份模块——用户走 user/profile，agent 走 agent profile；
 * 每个消息按 `from.id` 找自己的 role 头像，不能一律拿当前页签的头像硬套。
 *
 * 私聊层不再显示 Agent 通道的内部转交；那属于思维层，群聊则另有群聊页。
 * 工具、思考、work 的内部过程也不进这里。
 */
import { useMemo } from 'react'
import { MessageSquare, UserRound } from 'lucide-react'
import type { ChannelMessage, ChannelPeer } from '../../../agent/types'
import { t } from '../../../i18n'
import { displayName } from '../../../user/profile'
import { activeUser } from '../../../user/store'
import UserAvatar from '../../user/UserAvatar'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'

function peerName(peer: ChannelPeer | undefined, fallback: string): string {
  return peer?.name?.trim() || fallback
}

export function RoleChatView({
  channels,
  agentName,
  agentAvatarId,
  agentVoice = 'free',
  agentNames,
  agentAvatars,
}: {
  channels: ChannelMessage[]
  /** 当前 role 的显示名（agent profile 覆盖后的真名） */
  agentName: string
  /** 当前 role 的头像 id（AGENT_AVATARS 目录） */
  agentAvatarId?: string
  /** 兜底头像要跟 role 走 */
  agentVoice?: string
  /** 全部 role 的显示名：一条私聊里可能出现别的 role 的回复，名字要按 from.id 取 */
  agentNames?: Partial<Record<string, string>>
  /** 全部 role 的头像 id：同理，不能拿当前页签的头像硬套 */
  agentAvatars?: Partial<Record<string, string>>
}) {
  const user = activeUser()
  const userName = user ? displayName(user.profile, t('未命名用户')) : t('未命名用户')

  /** 私聊层只保留 user 通道：Agent 通道的内部转交不在这里出现 */
  const visible = useMemo(() => channels.filter((m) => m.kind === 'user').slice(-200), [channels])

  const roleIdOf = (m: ChannelMessage): AgentTeamMode | null => {
    const id = m.from.kind === 'role' ? m.from.id : ''
    return (id || null) as AgentTeamMode | null
  }

  const metaOf = (m: ChannelMessage) => {
    const id = roleIdOf(m)
    return id ? AGENT_ROSTER_META[id] : undefined
  }

  const nameOf = (m: ChannelMessage): string => {
    if (m.kind === 'user' && m.direction === 'in') return userName
    const id = roleIdOf(m)
    if (id) return agentNames?.[id]?.trim() || peerName(m.from, agentName)
    return agentName
  }

  const nameClassOf = (m: ChannelMessage): string => {
    if (m.kind === 'user' && m.direction === 'in') return 'text-ink-strong'
    return metaOf(m)?.nameClass ?? 'text-ink-strong'
  }

  const avatarOf = (m: ChannelMessage) => {
    if (m.kind === 'user' && m.direction === 'in') {
      if (user) {
        return (
          <UserAvatar
            profile={user.profile}
            size={36}
            seed={user.id}
            className="ring-1 ring-line/70"
          />
        )
      }
      return (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-line/70 text-ink-faint">
          <UserRound size={18} />
        </span>
      )
    }
    const id = roleIdOf(m)
    const meta = metaOf(m)
    const fallback = meta?.fallbackIcon ?? MessageSquare
    return (
      <span
        className={
          'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border ' +
          (meta?.avatarClass ?? 'border-line/70 bg-line/45 text-ink-soft')
        }
      >
        <AgentAvatarGlyph
          avatarId={(id ? agentAvatars?.[id] : undefined) ?? agentAvatarId}
          fallback={fallback}
          size={19}
          imgSize={36}
          imgClassName="h-9 w-9 rounded-full"
        />
      </span>
    )
  }

  /**
   * 气泡上方 `> xxx` 的收件人：用户发给当前 role 的，用 role 真名；
   * agent 发给用户的，用用户昵称；私聊里不再出现内部 Agent 通道的别人。
   */
  const recipientOf = (m: ChannelMessage): string => {
    if (m.to.kind === 'user') return userName
    if (m.to.kind === 'role') {
      if (m.to.id === agentVoice) return agentName
      const id = m.to.id as AgentTeamMode
      return agentNames?.[id]?.trim() || peerName(m.to, t('另一位角色'))
    }
    return peerName(m.to, t('群聊'))
  }

  if (!visible.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
        <div className="text-[13px]">{t('这里只有你和当前 agent 的私聊')}</div>
        <div className="max-w-[320px] text-[11.5px] leading-relaxed">
          {t('内部转交、工具调用与思考过程在「思维」层；群聊在独立的群聊页。')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      {visible.map((m) => {
        const mine = m.kind === 'user' && m.direction === 'in'
        const bubbleBg = mine ? 'bg-ink-strong' : 'bg-line/35'
        return (
          <div key={m.id} className={'flex items-start gap-2.5 ' + (mine ? 'flex-row-reverse' : '')}>
            {avatarOf(m)}
            <div className={'min-w-0 max-w-[84%] ' + (mine ? 'flex flex-col items-end' : 'flex flex-col items-start')}>
              <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10.5px]">
                <span className={'font-semibold ' + nameClassOf(m)}>{nameOf(m)}</span>
                <span className="text-ink-faint">
                  {new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-ink-faint/80" title={t('收件人')}>
                  {'>'} {recipientOf(m)}
                </span>
                {m.auto ? <span className="text-amber-600">{t('自动')}</span> : null}
              </div>
              <div
                className={
                  'relative max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                  bubbleBg +
                  (mine ? ' text-paper rounded-tr-sm' : ' text-ink rounded-tl-sm')
                }
              >
                {/* 朝向头像的小尖尖：消息从哪边来，尖尖就在哪边；与气泡同色、无边框 */}
                <span
                  aria-hidden="true"
                  className={
                    'absolute top-2.5 h-2.5 w-2.5 rotate-45 ' +
                    bubbleBg +
                    (mine ? ' -right-1' : ' -left-1')
                  }
                />
                <span className="relative">{m.text}</span>
              </div>
              {m.attachments?.images?.length ? (
                <div className={'mt-1 flex flex-wrap gap-1 ' + (mine ? 'justify-end' : 'justify-start')}>
                  {m.attachments.images.map((img) => (
                    <span key={img.id} className="rounded-md border border-line px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                      {img.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
