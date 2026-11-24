/**
 * 群聊面板：只有对话列表，没有思维层、没有单个 work 的过程。
 *
 * 群聊流水存在 groupChat 里（users/{uid}/group-chat.json）；正文显式 @ 某个 agent
 * 时投给被点名的 role，没有 @ 时按产品口径默认由调度龟接收。群聊层本身对所有人可见。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, MessageSquare, Send, UserRound, Users } from 'lucide-react'
import type { ChannelMessage } from '../../../agent/types'
import type { AskAnswers } from '../../../agent/tools'
import { AGENT_ROLE_IDS, DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import { t } from '../../../i18n'
import { displayName } from '../../../user/profile'
import { activeUser } from '../../../user/store'
import UserAvatar from '../../user/UserAvatar'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { BubbleRichText } from './BubbleRichText'
import { AskBubble } from './AskBubble'
import { ChannelAttachments, ChannelExtraBlock } from './ChannelExtras'
import { useRecentWindow } from './useRecentWindow'
import { mentionedAgentsOf } from './groupMentions'

export interface GroupChatAgent {
  id: AgentTeamMode
  name: string
  /** 默认角色名等别名：用户仍可用默认名 @ 到已改名的 agent */
  aliases?: string[]
  avatarId?: string
  running?: boolean
}

/**
 * 当前光标是否处在一个**还没结束的 @ 片段**里。
 *
 * 不是「正文里出现过 @」也不是「文本以 @ 结尾」：删掉 @ 后不能继续弹，
 * 在 @ 后面打了一个空格（名字已经选定 / 放弃）也立刻收起。
 */
export function mentionContextAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)))
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const query = before.slice(at + 1)
  if (/\s/.test(query)) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  return { start: at, query }
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
  resetKey = '',
  onAskSubmit,
  onAskCancel,
  onAskExpire,
  onAskHover,
}: {
  messages: ChannelMessage[]
  agents: GroupChatAgent[]
  /** 没有目标时群聊不可发送；显示在输入区上方 */
  disabledReason?: string
  /** 返回 false 表示发送失败（输入区保留内容） */
  onSend: (text: string, targetIds: AgentTeamMode[]) => boolean
  /** 切换目标 / 群聊时重置最近窗口 */
  resetKey?: string
  onAskSubmit?: (askId: string, answers: AskAnswers) => void
  onAskCancel?: (askId: string) => void
  onAskExpire?: (askId: string) => void
  onAskHover?: (askId: string, hovering: boolean) => void
}) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [forcePicker, setForcePicker] = useState(false)
  const [suppressPicker, setSuppressPicker] = useState(false)
  const [activePick, setActivePick] = useState(0)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const user = activeUser()
  const userName = user ? displayName(user.profile, t('未命名用户')) : t('未命名用户')
  const { start, hasOlder, sentinelRef } = useRecentWindow(messages.length, resetKey)
  const visible = messages.slice(start)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    atBottomRef.current = true
    if (el) el.scrollTop = el.scrollHeight
  }, [resetKey])

  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const mentioned = useMemo(() => mentionedAgentsOf(text, agents), [text, agents])
  const mention = mentionContextAt(text, caret)
  const pickerOpen = (Boolean(mention) || forcePicker) && !suppressPicker
  const mentionQuery = mention?.query.trim().toLowerCase() ?? ''
  const filteredAgents = useMemo(
    () => agents.filter((a) => !mentionQuery || a.name.toLowerCase().includes(mentionQuery) || (a.aliases ?? []).some((x) => x.toLowerCase().includes(mentionQuery))),
    [agents, mentionQuery],
  )
  const pickIndex = Math.min(activePick, Math.max(0, filteredAgents.length - 1))
  const canSend = Boolean(text.trim()) && !disabledReason

  /** 气泡里 @ 的解析名单：成员真名 + 所有 role 的默认名，改名前后都能认 */
  const mentionNames = useMemo(() => {
    const names = [userName, ...agents.flatMap((a) => [a.name.trim(), ...(a.aliases ?? []).map((x) => x.trim())])]
    for (const id of AGENT_ROLE_IDS) names.push(DEFAULT_AGENT_NAME[id])
    return [...new Set(names.filter(Boolean))]
  }, [agents, userName])

  const insertMention = (agent: GroupChatAgent): void => {
    const token = '@' + agent.name + ' '
    const m = mentionContextAt(text, caret)
    let next = ''
    let nextCaret = 0
    if (m) {
      let tokenEnd = caret
      while (tokenEnd < text.length && !/\s/.test(text[tokenEnd])) tokenEnd += 1
      const before = text.slice(0, m.start)
      const after = text.slice(tokenEnd)
      next = before + token + after.replace(/^\s*/, ' ')
      nextCaret = before.length + token.length
    } else {
      const trimmedEnd = text.replace(/\s+$/, '')
      const before = trimmedEnd ? trimmedEnd + ' ' : ''
      next = before + token
      nextCaret = next.length
    }
    setText(next)
    setCaret(nextCaret)
    setForcePicker(false)
    setSuppressPicker(false)
    setActivePick(0)
    setError('')
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || disabledReason) return
    // @ 的语法要求名字后保留一个空格；不能在这里把末尾空格 trim 掉，否则
    // `@导师龟 ` 会被自己吃掉分隔符，变成一次失败的艾特。
    const body = /[ \u3000]$/.test(text) ? trimmed + ' ' : trimmed
    // 没有 @ 时按产品口径默认由调度龟接；@ 了就按正文点名的成员投递
    const targets: AgentTeamMode[] = mentioned.length
      ? mentioned.map((a) => a.id)
      : agents.some((a) => a.id === 'dispatcher')
        ? ['dispatcher']
        : []
    if (!targets.length) {
      setError(t('当前群聊里没有调度龟，无法接收无 @ 的消息'))
      return
    }
    if (body.includes('@') && !mentioned.length) {
      setError(t('@ 没有匹配到成员：请写完整名字，并在 `@名字 ` 后留一个空格'))
      return
    }
    const ok = onSend(body, targets)
    if (!ok) {
      setError(t('发送失败，请稍后再试'))
      return
    }
    setText('')
    setCaret(0)
    setForcePicker(false)
    setSuppressPicker(false)
    setError('')
  }

  const openMentionPicker = (): void => {
    if (disabledReason) return
    setSuppressPicker(false)
    if (mention) {
      setForcePicker(true)
    } else {
      const at = Math.max(0, Math.min(caret, text.length))
      const insertion = (at > 0 && !/\s/.test(text[at - 1]) ? ' ' : '') + '@'
      const next = text.slice(0, at) + insertion + text.slice(at)
      const nextCaret = at + insertion.length
      setText(next)
      setCaret(nextCaret)
      setForcePicker(true)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      })
    }
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
            {t('群通道 · 只有对话列表 · @ 指定 agent，无 @ 时由调度龟接手')}
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

      <div
        ref={scrollRef}
        data-message-scroll
        onScroll={(e) => {
          const el = e.currentTarget
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {visible.length ? (
          <div className="flex flex-col gap-3">
            {hasOlder ? (
              <div className="flex items-center justify-center py-1 text-[10.5px] text-ink-faint">
                向上滚动加载更早的消息…
              </div>
            ) : null}
            <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
            {visible.map((m) => {
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
                      <UserAvatar
                        profile={user.profile}
                        size={46}
                        seed={user.id}
                        className="mt-1.5 ring-1 ring-line/70"
                      />
                    ) : (
                      <span className="mt-1.5 flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-line/70 text-ink-faint">
                        <UserRound size={20} />
                      </span>
                    )
                  ) : (
                    <span
                      className={
                        'mt-1.5 flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-full border ' +
                        (meta?.avatarClass ?? 'border-line/70 bg-line/45 text-ink-soft')
                      }
                    >
                      <AgentAvatarGlyph
                        avatarId={avatarId}
                        fallback={meta?.fallbackIcon ?? MessageSquare}
                        size={21}
                        imgSize={46}
                        imgClassName="h-[46px] w-[46px] rounded-full"
                      />
                    </span>
                  )}
                  <div className={'min-w-0 max-w-[700px] ' + (mine ? 'flex flex-col items-end' : 'flex flex-col items-start')}>
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
                    {m.ask ? (
                      <AskBubble
                        ask={m.ask}
                        actorName={nameOfPeer(m)}
                        onSubmit={onAskSubmit ? (answers) => onAskSubmit(m.ask!.id, answers) : undefined}
                        onCancel={onAskCancel ? () => onAskCancel(m.ask!.id) : undefined}
                        onExpire={onAskExpire ? () => onAskExpire(m.ask!.id) : undefined}
                        onHover={onAskHover ? (hovering) => onAskHover(m.ask!.id, hovering) : undefined}
                      />
                    ) : (
                      <div
                        className={
                          'relative max-w-full break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                          (mine
                            ? 'bg-bubble-user text-ink-strong rounded-tr-sm'
                            : 'bg-bubble-agent text-ink rounded-tl-sm ring-1 ring-line/50')
                        }
                      >
                        <span
                          aria-hidden="true"
                          className={
                            'absolute top-2.5 h-2.5 w-2.5 rotate-45 ' +
                            (mine ? 'bg-bubble-user -right-1' : 'bg-bubble-agent -left-1')
                          }
                        />
                        <BubbleRichText text={m.text} names={mentionNames} tone={mine ? 'user' : 'agent'} />
                      </div>
                    )}
                    <ChannelAttachments message={m} />
                    <ChannelExtraBlock extra={m.extra} names={mentionNames} />
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
              {t('直接输入即可发给调度龟；输入 @名字 可以点名指定 agent，被点名的 agent 会在群通道里收到消息。')}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line/60 px-3 py-3">
        {disabledReason ? (
          <div className="mb-2 rounded-lg bg-line/25 px-2.5 py-1.5 text-[11px] text-ink-faint">{disabledReason}</div>
        ) : null}
        <div className="relative">
          {pickerOpen ? (
            <div className="moji-bloom-up-in absolute bottom-full left-0 right-0 z-30 mb-2 max-h-[240px] overflow-y-auto rounded-2xl border border-line-strong bg-card/95 p-1.5 shadow-[0_16px_48px_rgba(0,0,0,0.18)] backdrop-blur-xl">
              {filteredAgents.length ? (
                filteredAgents.map((agent, i) => {
                  const meta = AGENT_ROSTER_META[agent.id]
                  const active = mentioned.some((a) => a.id === agent.id)
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertMention(agent)}
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
                <div className="px-2 py-3 text-center text-[11.5px] text-ink-faint">没有匹配的 agent</div>
              )}
            </div>
          ) : null}
          <div className="rounded-2xl border border-line bg-card shadow-sm transition focus-within:border-seal/50 focus-within:ring-2 focus-within:ring-seal/10">
            <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
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
              {!mentioned.length ? (
                <span className="text-[10.5px] text-ink-faint">未 @ 时由调度龟接手；@ 可点名指定成员</span>
              ) : null}
            </div>
            <textarea
              ref={inputRef}
              value={text}
              rows={2}
              onChange={(e) => {
                setText(e.target.value)
                setCaret(e.target.selectionStart ?? e.target.value.length)
                setActivePick(0)
                setForcePicker(false)
                setSuppressPicker(false)
                setError('')
              }}
              onFocus={() => setSuppressPicker(false)}
              onBlur={() => setSuppressPicker(true)}
              onClick={(e) => {
                setCaret(e.currentTarget.selectionStart ?? text.length)
                setSuppressPicker(false)
              }}
              onKeyDown={(e) => {
                if (pickerOpen && mention && filteredAgents.length) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActivePick((i) => Math.min(filteredAgents.length - 1, i + 1))
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActivePick((i) => Math.max(0, i - 1))
                    return
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    insertMention(filteredAgents[pickIndex])
                    return
                  }
                }
                if (e.key === 'Escape') {
                  setForcePicker(false)
                  setSuppressPicker(true)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              onSelect={(e) => {
                setCaret(e.currentTarget.selectionStart ?? text.length)
                setForcePicker(false)
                setSuppressPicker(false)
              }}
              placeholder={disabledReason ? t('先选择学习目标后再群聊') : t('输入消息，可不 @ 直接发；@ 可点名指定成员…')}
              disabled={Boolean(disabledReason)}
              className="max-h-[160px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pb-1.5 pt-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
            />
            <div className="flex items-center gap-1 px-2.5 pb-2">
              <span className="min-w-0 truncate text-[10.5px] text-ink-faint">
                {mentioned.length ? '将投递给点名成员' : '默认投递给调度龟'}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={openMentionPicker}
                  disabled={Boolean(disabledReason)}
                  title={t('@ 指定 agent')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/25 hover:text-ink disabled:opacity-40"
                >
                  <AtSign size={16} />
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-seal text-white transition hover:bg-seal-deep disabled:bg-line disabled:text-ink-faint"
                  title={t('发送')}
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
        {error ? <div className="mt-1.5 text-[11px] text-rose-600">{error}</div> : null}
      </div>
    </div>
  )
}
