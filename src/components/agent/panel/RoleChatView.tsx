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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AskAnswers } from '../../../agent/tools'
import { MessageSquare, UserRound } from 'lucide-react'
import type { ChannelMessage, ChannelPeer } from '../../../agent/types'
import { AGENT_ROLE_IDS, DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import { t } from '../../../i18n'
import { displayName } from '../../../user/profile'
import { activeUser } from '../../../user/store'
import UserAvatar from '../../user/UserAvatar'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import { BubbleBody } from './BubbleBody'
import { AskBubble } from './AskBubble'
import { ChannelAttachments, ChannelExtraBlock } from './ChannelExtras'
import { ChannelQuoteChip, quoteInfoOf, stripChannelQuoteBlock } from './ChannelQuoteChip'
import { DeliveryBlock } from './DeliveryBlock'
import { MessageMediaGrid } from './MessageMedia'
import { isVideoFile } from './messageMediaLayout'
import { useRecentWindow } from './useRecentWindow'
import { latestWorkAnchors, type WorkInlineSource } from '../../../lib/workInline'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'

function peerName(peer: ChannelPeer | undefined, fallback: string): string {
  return peer?.name?.trim() || fallback
}

export function RoleChatView({
  channels,
  agentName,
  agentAvatarId,
  agentVoice = 'free',
  /** 当前 role 是否正在工作；私聊气泡的名字后展示「工作中 / 空闲」 */
  agentRunning,
  agentNames,
  agentAvatars,
  resetKey = '',
  onAskSubmit,
  onAskCancel,
  onAskExpire,
  onAskHover,
  onOpenFile,
  work,
}: {
  channels: ChannelMessage[]
  /** 当前 role 的显示名（agent profile 覆盖后的真名） */
  agentName: string
  /** 当前 role 的头像 id（AGENT_AVATARS 目录） */
  agentAvatarId?: string
  /** 兜底头像要跟 role 走 */
  agentVoice?: string
  /** 当前 role 的工作状态；true = 工作中，false = 空闲，undefined = 不展示 */
  agentRunning?: boolean
  /** 全部 role 的显示名：一条私聊里可能出现别的 role 的回复，名字要按 from.id 取 */
  agentNames?: Partial<Record<string, string>>
  /** 全部 role 的头像 id：同理，不能拿当前页签的头像硬套 */
  agentAvatars?: Partial<Record<string, string>>
  /** 切换会话时重置最近窗口 */
  resetKey?: string
  onAskSubmit?: (askId: string, answers: AskAnswers) => void
  onAskCancel?: (askId: string) => void
  onAskExpire?: (askId: string) => void
  onAskHover?: (askId: string, hovering: boolean) => void
  /** 交付组件里点开本地文件 */
  onOpenFile?: (pathOrRel: string, title?: string) => void
  /** 正文里 `[标题](work: id)` 的实时数据源 */
  work?: WorkInlineSource
}) {
  const user = activeUser()
  const userName = user ? displayName(user.profile, t('未命名用户')) : t('未命名用户')

  /** 气泡里 @ 的解析名单：当前 role 真名 + 所有 role 的 profile / 默认名 */
  const mentionNames = useMemo(() => {
    const names: string[] = ['用户', agentName.trim(), userName.trim()]
    for (const id of AGENT_ROLE_IDS) {
      const custom = agentNames?.[id]?.trim()
      if (custom) names.push(custom)
      names.push(DEFAULT_AGENT_NAME[id])
    }
    return [...new Set(names.filter(Boolean))]
  }, [agentName, agentNames, userName])

  const rootRef = useRef<HTMLDivElement>(null)
  const quoteFlashTimer = useRef<number | null>(null)
  const [quoteFocus, setQuoteFocus] = useState<{ id: string; index: number } | null>(null)
  const [quoteFlashId, setQuoteFlashId] = useState<string | null>(null)

  /** 私聊层只保留 user 通道：Agent 通道的内部转交不在这里出现 */
  const allVisible = useMemo(() => channels.filter((m) => m.kind === 'user'), [channels])
  const { start, hasOlder, sentinelRef } = useRecentWindow(
    allVisible.length,
    resetKey,
    quoteFocus?.index ?? -1,
  )
  const visible = allVisible.slice(start)
  /** 一个 work 只让当前私聊列表里最新的一条消息展示内嵌状态；ask 气泡不算锚点。 */
  const workAnchors = useMemo(
    () => latestWorkAnchors(
      allVisible.filter((m) => !m.ask && m.text.trim()).map((m) => ({ id: m.id, text: m.text })),
      work,
    ),
    [allVisible, work],
  )
  const channelById = useMemo(() => new Map(allVisible.map((m) => [m.id, m])), [allVisible])

  useEffect(() => () => {
    if (quoteFlashTimer.current !== null) window.clearTimeout(quoteFlashTimer.current)
  }, [])

  useEffect(() => {
    setQuoteFocus(null)
    setQuoteFlashId(null)
  }, [resetKey])

  /** 引用的目标可能落在最近窗口外：先把窗口撑到它，再滚动 + 闪一下。 */
  useEffect(() => {
    if (!quoteFocus) return
    const root = rootRef.current
    const target = root?.querySelector<HTMLElement>(`[data-message-id="${quoteFocus.id}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setQuoteFlashId(quoteFocus.id)
    setQuoteFocus(null)
    if (quoteFlashTimer.current !== null) window.clearTimeout(quoteFlashTimer.current)
    quoteFlashTimer.current = window.setTimeout(() => setQuoteFlashId(null), 1200)
  }, [quoteFocus, start])

  const jumpToQuote = (id: string) => {
    const index = allVisible.findIndex((m) => m.id === id)
    if (index < 0) return
    setQuoteFocus({ id, index })
  }

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
            size={46}
            seed={user.id}
            className="mt-1.5 ring-1 ring-line/70"
          />
        )
      }
      return (
        <span className="mt-1.5 flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-line/70 text-ink-faint">
          <UserRound size={20} />
        </span>
      )
    }
    const id = roleIdOf(m)
    const meta = metaOf(m)
    const fallback = meta?.fallbackIcon ?? MessageSquare
    return (
      <span
        className={
          'mt-1.5 flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-full border ' +
          (meta?.avatarClass ?? 'border-line/70 bg-line/45 text-ink-soft')
        }
      >
        <AgentAvatarGlyph
          avatarId={(id ? agentAvatars?.[id] : undefined) ?? agentAvatarId}
          fallback={fallback}
          size={21}
          imgSize={46}
          imgClassName="h-[46px] w-[46px] rounded-full"
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
    <div ref={rootRef} className="flex min-h-full flex-col gap-3 pb-2">
      {visible.length ? (
        <>
          {hasOlder ? (
            <div className="flex items-center justify-center py-2 text-[10.5px] text-ink-faint">
              向上滚动加载更早的消息…
            </div>
          ) : null}
          <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
          {visible.map((m) => {
            const mine = m.kind === 'user' && m.direction === 'in'
            const bubbleBg = mine ? 'bg-bubble-user text-ink-strong' : 'bg-bubble-agent text-ink ring-1 ring-line/50'
            const hasMedia = Boolean(
              m.attachments?.images?.length || (m.attachments?.files ?? []).some((f) => isVideoFile(f)),
            )
            const bubbleVisible = Boolean(m.text.trim() || hasMedia || m.delivery || m.quoteMessageId)
            return (
              <div
                key={m.id}
                data-message-id={m.id}
                className={'flex items-start gap-2.5 ' + (mine ? 'flex-row-reverse' : '')}
              >
                {avatarOf(m)}
                <div className={'min-w-0 max-w-[450px] ' + (mine ? 'flex flex-col items-end' : 'flex flex-col items-start')}>
                  <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10.5px]">
                    <span className={'font-semibold ' + nameClassOf(m)}>{nameOf(m)}</span>
                    {!mine && typeof agentRunning === 'boolean' ? (
                      <span
                        data-agent-status={agentRunning ? 'running' : 'idle'}
                        className={'inline-flex items-center gap-1 ' + (agentRunning ? 'text-seal' : 'text-ink-faint')}
                      >
                        <span
                          aria-hidden="true"
                          className={
                            'h-1.5 w-1.5 rounded-full ' + (agentRunning ? 'animate-pulse bg-seal' : 'bg-ink-faint/45')
                          }
                        />
                        {agentRunning ? t('工作中') : t('空闲')}
                      </span>
                    ) : null}
                    <span className="text-ink-faint">
                      {new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-ink-faint/80" title={t('收件人')}>
                      {'>'} {recipientOf(m)}
                    </span>
                    {m.auto ? <span className="text-amber-600">{t('自动')}</span> : null}
                  </div>
                  {m.ask ? (
                    <AskBubble
                      ask={m.ask}
                      actorName={nameOf(m)}
                      onSubmit={onAskSubmit ? (answers) => onAskSubmit(m.ask!.id, answers) : undefined}
                      onCancel={onAskCancel ? () => onAskCancel(m.ask!.id) : undefined}
                      onExpire={onAskExpire ? () => onAskExpire(m.ask!.id) : undefined}
                      onHover={onAskHover ? (hovering) => onAskHover(m.ask!.id, hovering) : undefined}
                    />
                  ) : bubbleVisible ? (
                    <div
                      data-role-bubble
                      className={
                        'relative max-w-full break-words rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                        bubbleBg +
                        (mine ? ' rounded-tr-sm' : ' rounded-tl-sm') +
                        (quoteFlashId === m.id ? ' moji-msg-flash' : '')
                      }
                    >
                      <span
                        aria-hidden="true"
                        className={
                          'absolute top-2.5 h-2.5 w-2.5 rotate-45 ' +
                          (mine ? 'bg-bubble-user -right-1' : 'bg-bubble-agent -left-1')
                        }
                      />
                      {m.quoteMessageId ? (
                        <ChannelQuoteChip
                          quoteId={m.quoteMessageId}
                          info={(() => {
                            const quoted = channelById.get(m.quoteMessageId!)
                            return quoted ? quoteInfoOf(quoted) : undefined
                          })()}
                          onJump={jumpToQuote}
                        />
                      ) : null}
                      <BubbleBody
                        text={m.quoteMessageId ? stripChannelQuoteBlock(m.text) : m.text}
                        names={mentionNames}
                        labels={{ 用户: userName }}
                        tone={mine ? 'user' : 'agent'}
                        work={work}
                        messageId={m.id}
                        workAnchorByKey={workAnchors}
                      />
                      {/* 图片 / 视频嵌在气泡内侧底部；其余文件挂在气泡外底侧 */}
                      <MessageMediaGrid
                        images={m.attachments?.images}
                        files={m.attachments?.files}
                      />
                      {/* 交付账嵌在气泡内侧底部，不再单独长成一个“交付气泡” */}
                      {m.delivery ? (
                        <DeliveryBlock delivery={m.delivery} onOpenFile={onOpenFile} goalId={m.goalId} />
                      ) : null}
                    </div>
                  ) : null}
                  <ChannelAttachments message={m} onOpenFile={onOpenFile} />
                  <ChannelExtraBlock extra={m.extra} names={mentionNames} />
                </div>
              </div>
            )
          })}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-faint">
          <div className="text-[13px]">{t('这里只有你和当前 agent 的私聊')}</div>
          <div className="max-w-[320px] text-[11.5px] leading-relaxed">
            {t('内部转交、工具调用与思考过程在「思维」层；群聊在独立的群聊页。')}
          </div>
        </div>
      )}
    </div>
  )
}
