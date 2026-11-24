/**
 * 群聊消息卡片（附件一的结构）：
 *
 *   顶部窄条：作者头像 + 名字 + 角色/原消息/静默标记
 *   正文区：文字 / ask 表单 / 附件 / 折叠的额外数据
 *   底栏：右侧 可见人数 · 复制 · 时间
 *   卡片下方独立一行：评论者头像叠放 + 「N 条评论」+ 右箭头（点进评论串）
 *
 * 为什么单独一个文件：GroupChatPanel 已经承担输入框、@ 选择器、评论串路由与滚动窗口，
 * 再把卡片外观堆回去会突破 700 行的拆分线。这里只做纯展示，数据与动作全由面板传入。
 */
import { useState } from 'react'
import { Check, ChevronRight, Copy, Eye, MessageSquare } from 'lucide-react'
import type { AskAnswers } from '../../../agent/tools'
import type { ChannelMessage, ChannelPeer } from '../../../agent/types'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import UserAvatar from '../../user/UserAvatar'
import { activeUser } from '../../../user/store'
import { t } from '../../../i18n'
import { BubbleRichText } from './BubbleRichText'
import { AskBubble } from './AskBubble'
import { ChannelAttachments, ChannelExtraBlock } from './ChannelExtras'
import type { GroupChatAgent } from './GroupChatPanel'

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function uniquePeers(peers: ChannelPeer[]): ChannelPeer[] {
  const seen = new Set<string>()
  return peers.filter((p) => {
    const key = p.kind + ':' + p.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 一位发言者的小头像（用户走真实 profile，agent 走名册头像） */
function PeerAvatar({ peer, agents, size }: { peer: ChannelPeer; agents: GroupChatAgent[]; size: number }) {
  const user = activeUser()
  if (peer.kind === 'user') {
    return user ? (
      <UserAvatar profile={user.profile} size={size} seed={user.id} className="ring-1 ring-line/60" />
    ) : (
      <span
        className="flex items-center justify-center rounded-full bg-line/70 text-ink-faint"
        style={{ width: size, height: size }}
      >
        <MessageSquare size={Math.round(size * 0.45)} />
      </span>
    )
  }
  const roleId = peer.kind === 'role' ? peer.id : undefined
  const meta = roleId ? AGENT_ROSTER_META[roleId as keyof typeof AGENT_ROSTER_META] : undefined
  const avatarId = roleId ? agents.find((a) => a.id === roleId)?.avatarId : undefined
  return (
    <span
      className={
        'flex items-center justify-center overflow-hidden rounded-full border ' +
        (meta?.avatarClass ?? 'border-line/70 bg-line/45 text-ink-soft')
      }
      style={{ width: size, height: size }}
    >
      <AgentAvatarGlyph
        avatarId={avatarId}
        fallback={meta?.fallbackIcon ?? MessageSquare}
        size={Math.round(size * 0.46)}
        imgSize={size}
        imgClassName="rounded-full"
      />
    </span>
  )
}

export function GroupMessageCard({
  message,
  agents,
  userName,
  mentionNames,
  comments,
  isThreadRoot = false,
  canComment = false,
  onOpenThread,
  onAskSubmit,
  onAskCancel,
  onAskExpire,
  onAskHover,
}: {
  message: ChannelMessage
  agents: GroupChatAgent[]
  userName: string
  mentionNames: string[]
  /** 这条主楼下的评论（一级列表 / 评论串根消息都可传） */
  comments: ChannelMessage[]
  isThreadRoot?: boolean
  canComment?: boolean
  onOpenThread?: () => void
  onAskSubmit?: (askId: string, answers: AskAnswers) => void
  onAskCancel?: (askId: string) => void
  onAskExpire?: (askId: string) => void
  onAskHover?: (askId: string, hovering: boolean) => void
}) {
  const [copied, setCopied] = useState(false)
  const m = message
  const fromUser = m.from.kind === 'user'
  const roleId = m.from.kind === 'role' ? m.from.id : undefined
  const meta = roleId ? AGENT_ROSTER_META[roleId as keyof typeof AGENT_ROSTER_META] : undefined
  const name = fromUser ? (m.from.name?.trim() || userName) : m.from.name?.trim() || roleId || t('群聊')
  const mentions = (m.mentions ?? [])
    .map((p) => agents.find((a) => a.id === p.id)?.name || p.name)
    .filter(Boolean)
  const visibleCount = Math.max(1, agents.length + 1)
  const stack = uniquePeers(
    comments.length ? comments.map((c) => c.from) : [m.from, ...(m.mentions ?? [])],
  ).slice(0, 4)

  const copy = async (): Promise<void> => {
    if (!m.text) return
    try {
      await navigator.clipboard.writeText(m.text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch (err) {
      console.warn('[GroupMessageCard] 复制失败：', err)
    }
  }

  return (
    <div className="group/msg flex w-full flex-col items-start" data-group-message-card={m.id}>
      <article
        className={
          'w-full max-w-[760px] overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_rgba(255,255,255,0.04),0_14px_36px_rgba(0,0,0,0.10)] transition ' +
          (isThreadRoot ? 'border-seal/35 ring-1 ring-seal/10' : 'border-line/70')
        }
      >
        {/* 顶部窄条：像 Telegram 频道卡片那样把作者放在卡内，不再在气泡外侧挂头像 */}
        <header className="flex items-center gap-2 border-b border-line/50 bg-line/15 px-3.5 py-2">
          <PeerAvatar peer={m.from} agents={agents} size={26} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={'truncate text-[12px] font-semibold ' + (fromUser ? 'text-ink-strong' : (meta?.nameClass ?? 'text-ink-strong'))}>
                {name}
              </span>
              {fromUser ? (
                <span className="rounded-full bg-line/40 px-1.5 py-0.5 text-[9px] text-ink-faint">{t('用户')}</span>
              ) : (
                <span className="rounded-full bg-line/40 px-1.5 py-0.5 text-[9px] text-ink-faint">{t('角色')}</span>
              )}
              {isThreadRoot ? (
                <span className="rounded-full bg-seal/12 px-1.5 py-0.5 text-[9px] font-medium text-seal">{t('原消息')}</span>
              ) : null}
              {m.silent ? (
                <span className="rounded-full bg-line/40 px-1.5 py-0.5 text-[9px] text-ink-faint">{t('静默')}</span>
              ) : null}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-ink-faint">
              {mentions.length ? '@ ' + mentions.join('、') : t('群聊')}
            </div>
          </div>
        </header>

        <div className="px-4 py-3">
          {m.ask ? (
            <AskBubble
              ask={m.ask}
              actorName={name}
              onSubmit={onAskSubmit ? (answers) => onAskSubmit(m.ask!.id, answers) : undefined}
              onCancel={onAskCancel ? () => onAskCancel(m.ask!.id) : undefined}
              onExpire={onAskExpire ? () => onAskExpire(m.ask!.id) : undefined}
              onHover={onAskHover ? (hovering) => onAskHover(m.ask!.id, hovering) : undefined}
            />
          ) : (
            <div className="break-words text-[13px] leading-relaxed text-ink">
              <BubbleRichText text={m.text} names={mentionNames} tone={fromUser ? 'user' : 'agent'} />
            </div>
          )}
          <ChannelAttachments message={m} />
          <ChannelExtraBlock extra={m.extra} names={mentionNames} />
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-line/40 px-3.5 py-1.5 text-[10.5px] text-ink-faint">
          <span className="inline-flex items-center gap-1" title={t('群内可见人数')}>
            <Eye size={12} />
            {visibleCount}
          </span>
          <button
            type="button"
            onClick={copy}
            title={copied ? t('已复制') : t('复制内容')}
            className={
              'inline-flex h-5 items-center gap-1 rounded px-1 transition hover:bg-line/25 hover:text-ink-soft ' +
              (copied ? 'text-ok' : '')
            }
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <time className="tabular-nums" dateTime={new Date(m.ts).toISOString()}>
            {timeOf(m.ts)}
          </time>
        </footer>
      </article>

      {canComment ? (
        <button
          type="button"
          onClick={onOpenThread}
          title={m.goalId ? 'group:' + m.goalId + '>' + m.id : undefined}
          className="mt-1.5 flex w-full max-w-[760px] items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-line/15"
        >
          <span className="flex -space-x-1.5">
            {stack.map((p, i) => (
              <span key={p.kind + ':' + p.id + ':' + i} className="rounded-full ring-2 ring-card">
                <PeerAvatar peer={p} agents={agents} size={20} />
              </span>
            ))}
          </span>
          <span className={'text-[11px] font-medium ' + (comments.length ? 'text-teal-600 dark:text-teal-400' : 'text-ink-faint')}>
            {comments.length ? t('{0} 条评论', comments.length) : t('暂无评论')}
          </span>
          <ChevronRight size={14} className="ml-auto text-ink-faint" />
        </button>
      ) : null}
    </div>
  )
}
