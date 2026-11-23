/**
 * 群聊面板：只有对话列表，没有思维层、没有单个 work 的过程。
 *
 * 用户与 agent 的群聊流水存在 groupChat 里（users/{uid}/group-chat.json）；
 * 群聊消息只有在正文 **显式 @ 某个 agent 的名字** 时才会投给该 agent 的 role mind。
 * 只有 @ 到的人收到入站消息，群聊层本身对所有人可见。
 */
import { useMemo, useRef, useState } from 'react'
import { AtSign, MessageSquare, Send, UserRound, Users } from 'lucide-react'
import type { ChannelMessage } from '../../../agent/types'
import { t } from '../../../i18n'
import { displayName } from '../../../user/profile'
import { activeUser } from '../../../user/store'
import UserAvatar from '../../user/UserAvatar'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { mentionedAgentsOf } from './groupMentions'

export interface GroupChatAgent {
  id: AgentTeamMode
  name: string
  avatarId?: string
  running?: boolean
}

function nameOfPeer(m: ChannelMessage): string {
  if (m.from.kind === 'role') return m.from.name?.trim() || m.from.id
  if (m.from.kind === 'user') return m.from.name?.trim() || t('用户')
  return m.from.name?.trim() || t('群聊')
}

export function GroupChatPanel({
  messages,
  agents,
  disabledReason,
  onSend,
}: {
  messages: ChannelMessage[]
  agents: GroupChatAgent[]
  /** 没有目标时群聊不可发送；显示在输入区上方 */
  disabledReason?: string
  /** 返回 false 表示发送失败（输入区保留内容） */
  onSend: (text: string, targetIds: AgentTeamMode[]) => boolean
}) {
  const [text, setText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const user = activeUser()
  const userName = user ? displayName(user.profile, t('未命名用户')) : t('未命名用户')

  const mentioned = useMemo(() => mentionedAgentsOf(text, agents), [text, agents])
  const canSend = Boolean(text.trim()) && mentioned.length > 0 && !disabledReason

  const insertMention = (agent: GroupChatAgent): void => {
    const token = '@' + agent.name + ' '
    setText((prev) => {
      const trimmedEnd = prev.replace(/\s+$/, '')
      return (trimmedEnd ? trimmedEnd + ' ' : '') + token
    })
    setPickerOpen(false)
    setError('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const submit = (): void => {
    const body = text.trim()
    if (!body || disabledReason) return
    if (!mentioned.length) {
      setError(t('群聊消息必须 @ 至少一位 agent，消息才会进入对方通道'))
      return
    }
    const ok = onSend(body, mentioned.map((a) => a.id))
    if (!ok) {
      setError(t('发送失败，请稍后再试'))
      return
    }
    setText('')
    setError('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line/60 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500/10 text-teal-600">
          <Users size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">{t('群聊')}</div>
          <div className="truncate text-[11px] text-ink-faint">
            {t('群通道 · 只有对话列表 · @ 指定 agent 才会进入对方')}
          </div>
        </div>
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length ? (
          <div className="flex flex-col gap-3">
            {messages.map((m) => {
              const fromRole = m.from.kind === 'role'
              const roleId = fromRole ? (m.from.id as AgentTeamMode) : undefined
              const meta = roleId ? AGENT_ROSTER_META[roleId] : undefined
              const avatarId = roleId ? agents.find((a) => a.id === roleId)?.avatarId : undefined
              const mine = m.from.kind === 'user'
              const mentions =
                m.mentions?.map((p) => agents.find((a) => a.id === p.id)?.name || p.name).filter(Boolean) ?? []
              return (
                <div key={m.id} className={'flex items-start gap-2.5 ' + (mine ? 'flex-row-reverse' : '')}>
                  {mine ? (
                    user ? (
                      <UserAvatar profile={user.profile} size={36} seed={user.id} className="ring-1 ring-line/70" />
                    ) : (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-line/70 text-ink-faint">
                        <UserRound size={18} />
                      </span>
                    )
                  ) : (
                    <span
                      className={
                        'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border ' +
                        (meta?.avatarClass ?? 'border-line/70 bg-line/45 text-ink-soft')
                      }
                    >
                      <AgentAvatarGlyph
                        avatarId={avatarId}
                        fallback={meta?.fallbackIcon ?? MessageSquare}
                        size={19}
                        imgSize={36}
                        imgClassName="h-9 w-9 rounded-full"
                      />
                    </span>
                  )}
                  <div className={'min-w-0 max-w-[82%] ' + (mine ? 'flex flex-col items-end' : 'flex flex-col items-start')}>
                    <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10.5px]">
                      <span className={'font-semibold ' + (mine ? 'text-ink-strong' : (meta?.nameClass ?? 'text-ink-strong'))}>
                        {mine ? userName : nameOfPeer(m)}
                      </span>
                      <span className="text-ink-faint">
                        {new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-ink-faint/80">
                        {mentions.length ? '@ ' + mentions.join('、') : t('群聊')}
                      </span>
                    </div>
                    <div
                      className={
                        'relative max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                        (mine
                          ? 'bg-ink-strong text-paper rounded-tr-sm'
                          : 'bg-line/35 text-ink rounded-tl-sm')
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={
                          'absolute top-2.5 h-2.5 w-2.5 rotate-45 ' +
                          (mine ? 'bg-ink-strong -right-1' : 'bg-line/35 -left-1')
                        }
                      />
                      <span className="relative">{m.text}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-line/30">
              <Users size={22} />
            </div>
            <div className="text-[13px]">{t('还没有群消息')}</div>
            <div className="max-w-[320px] text-[11.5px] leading-relaxed">
              {t('在下方输入 @名字 指定要对话的 agent；被 @ 的 agent 会在自己的思维里收到群通道消息。')}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line/60 px-3 py-3">
        {disabledReason ? (
          <div className="mb-2 rounded-lg bg-line/25 px-2.5 py-1.5 text-[11px] text-ink-faint">{disabledReason}</div>
        ) : null}
        {pickerOpen ? (
          <div className="mb-2 max-h-[180px] overflow-y-auto rounded-xl border border-line bg-card p-1 shadow-lg">
            {agents.map((agent) => {
              const meta = AGENT_ROSTER_META[agent.id]
              const active = mentioned.some((a) => a.id === agent.id)
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => insertMention(agent)}
                  className={
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-line/25 ' +
                    (active ? 'bg-line/20' : '')
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
            })}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <div className="relative min-w-0 flex-1 rounded-xl border border-line bg-card px-2 py-1.5 focus-within:border-seal/50">
            <div className="flex flex-wrap items-center gap-1 px-1 pb-1">
              {mentioned.map((agent) => {
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
              {!mentioned.length ? <span className="text-[10.5px] text-ink-faint">{t('必须 @ 至少一位 agent')}</span> : null}
            </div>
            <textarea
              ref={inputRef}
              value={text}
              rows={2}
              onChange={(e) => {
                setText(e.target.value)
                setError('')
                // 只输到 `@` 时就把名单弹出来，减少手动点按钮
                if (e.target.value.endsWith('@')) setPickerOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder={disabledReason ? t('先选择学习目标后再群聊') : t('输入消息，@ 指定 agent…')}
              disabled={Boolean(disabledReason)}
              className="max-h-[120px] w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
            />
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={Boolean(disabledReason)}
            title={t('@ 指定 agent')}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-faint hover:bg-line/25 disabled:opacity-40"
          >
            <AtSign size={16} />
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-seal text-white disabled:bg-line disabled:text-ink-faint"
            title={t('发送')}
          >
            <Send size={16} />
          </button>
        </div>
        {error ? <div className="mt-1.5 text-[11px] text-rose-600">{error}</div> : null}
      </div>
    </div>
  )
}
