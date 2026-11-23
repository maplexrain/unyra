/**
 * role 的 **chat 层**：只画 user / agent 两个通道的对外消息。
 *
 * 视角是**当前用户**，不是 role：用户自己说的话在右侧，agent / 其它角色在左侧。
 * 名字与头像都来自应用的真实身份模块——用户走 user/profile，agent 走 agent profile；
 * 这里不写死“用户”“我”这类称呼。
 *
 * 工具、思考、work 的内部过程与 Work 通道交付都不进这里——它们在 mind 层；
 * 这一层永远不把「它是怎么做的」暴露给外部对话者。
 */
import { useMemo } from 'react'
import { MessageSquare, UserRound } from 'lucide-react'
import type { ChannelMessage } from '../../../agent/types'
import { t } from '../../../i18n'
import { displayName } from '../../../user/profile'
import { activeUser } from '../../../user/store'
import UserAvatar from '../../user/UserAvatar'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'

function avatarOf(mine: boolean) {
  if (mine) {
    const user = activeUser()
    if (user) {
      return (
        <UserAvatar
          profile={user.profile}
          size={28}
          seed={user.id}
          className="ring-1 ring-line/70"
        />
      )
    }
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-line/70 text-ink-faint">
        <UserRound size={15} />
      </span>
    )
  }
  return null
}

export function RoleChatView({
  channels,
  agentName,
  agentAvatarId,
  agentVoice = 'free',
}: {
  channels: ChannelMessage[]
  /** 当前 role 的显示名（agent profile 覆盖后的真名） */
  agentName: string
  /** 当前 role 的头像 id（AGENT_AVATARS 目录） */
  agentAvatarId?: string
  /** 兜底头像要跟 role 走 */
  agentVoice?: string
}) {
  const user = activeUser()
  const userName = user ? displayName(user.profile, t('未命名用户')) : t('未命名用户')
  const fallbackIcon = AGENT_ROSTER_META[agentVoice as AgentTeamMode]?.fallbackIcon ?? MessageSquare
  const visible = useMemo(
    () => channels.filter((m) => m.kind === 'user' || m.kind === 'agent').slice(-200),
    [channels],
  )

  const labelOf = (m: ChannelMessage): string => {
    // 用户自己发的：永远显示用户模块里的昵称，不认历史信封里写死的“用户”
    if (m.kind === 'user' && m.direction === 'in') return userName
    const from = m.from.name?.trim()
    if (from && from !== '我' && from !== '用户') return from
    return agentName
  }

  if (!visible.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
        <div className="text-[13px]">{t('这里只有对外说的话')}</div>
        <div className="max-w-[320px] text-[11.5px] leading-relaxed">
          {t('工具调用、思考过程与 work 的内部日志都在「思维」层；这一层以你的视角显示你与其它角色的消息。')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      {visible.map((m) => {
        // 用户视角：只有「用户通道的入站」是自己说的话；agent 的回复与跨角色消息都在左边
        const mine = m.kind === 'user' && m.direction === 'in'
        return (
          <div key={m.id} className={'flex items-start gap-2 ' + (mine ? 'flex-row-reverse' : '')}>
            {mine ? (
              avatarOf(true)
            ) : (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line/70 bg-line/45 text-ink-soft">
                <AgentAvatarGlyph
                  avatarId={agentAvatarId}
                  fallback={fallbackIcon}
                  size={15}
                  imgSize={28}
                  imgClassName="h-7 w-7 rounded-full"
                />
              </span>
            )}
            <div className={'min-w-0 max-w-[86%] ' + (mine ? 'flex flex-col items-end' : 'flex flex-col items-start')}>
              <div className="mb-0.5 flex items-center gap-1.5 px-1 text-[10.5px] text-ink-faint">
                <span>{labelOf(m)}</span>
                <span>{new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                {m.auto ? <span className="text-amber-600">{t('自动')}</span> : null}
              </div>
              <div
                className={
                  'max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                  (mine
                    ? 'bg-ink-strong text-paper'
                    : m.kind === 'agent'
                      ? 'border border-seal/25 bg-seal/8 text-ink'
                      : 'border border-line bg-card text-ink')
                }
              >
                {m.text}
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
