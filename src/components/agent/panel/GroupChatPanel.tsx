/**
 * 群聊面板：只有对话列表，没有思维层、没有单个 work 的过程。
 *
 * 群聊流水存在 groupChat 里（users/{uid}/group-chat.json）；正文显式 @ 某个 agent
 * 时投给被点名的 role；没有 @ 时交给幕后的群消息调度 agent 判断，不再默认投给调度龟。
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { ArrowLeft, AtSign, Copy, MessageSquare, Paperclip, Send, UserRound, Users } from 'lucide-react'
import type { ChannelMessage, PendingFile, PendingImage } from '../../../agent/types'
import type { AskAnswers } from '../../../agent/tools'
import type { VoiceSink } from '../../../lib/voice/session'
import { AGENT_ROLE_IDS, DEFAULT_AGENT_NAME } from '../../../agent/agentProfile'
import { t } from '../../../i18n'
import { displayName } from '../../../user/profile'
import { activeUser } from '../../../user/store'
import UserAvatar from '../../user/UserAvatar'
import { AgentAvatarGlyph } from '../../learn/agent-team/AgentAvatarGlyph'
import type { AgentTeamMode } from '../../learn/agent-team/conversationList'
import { AGENT_ROSTER_META } from '../../learn/agent-team/agentRoster'
import { groupThreadIdOf } from '../../../learn/groupChat'
import { fadeMask, useScrollEdges } from '../../../lib/scrollFade'
import { BubbleBody } from './BubbleBody'
import { AskBubble } from './AskBubble'
import { ChannelAttachments, ChannelExtraBlock } from './ChannelExtras'
import { DeliveryBlock } from './DeliveryBlock'
import { FollowLatestButton } from './MessageBubble'
import { MessageContextMenu, type MessageMenuItem } from './MessageContextMenu'
import { MessageMediaGrid } from './MessageMedia'
import { isVideoFile } from './messageMediaLayout'
import { PendingLightbox } from './Images'
import { GroupComposerAttachments } from './GroupComposerAttachments'
import { GroupComposerTools } from './GroupComposerTools'
import { useGroupAttachments } from './useGroupAttachments'
import { useRecentWindow } from './useRecentWindow'
import { useChatReadIndex } from './messageReadIndex'
import { useScrollFollow } from './useScrollFollow'
import { mentionedAgentsOf } from './groupMentions'
import { WorkingAgentStack } from './WorkingAgentStack'
import { GroupTriageFallbackDialog } from './GroupTriageFallbackDialog'

export interface GroupChatAgent {
  id: AgentTeamMode
  name: string
  /** 群消息调度 agent 判断时看到的职责一句话 */
  duty?: string
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

/** 群聊没有消息定位条：useScrollFollow 的高亮回调给一个稳定的空实现 */
const noopSetRailActive = (_id: string | null): void => undefined

/** 右键菜单当前指向的那条消息：开菜单时就把当时可不可评论定下来 */
interface MessageMenuState {
  x: number
  y: number
  message: ChannelMessage
  allowComment: boolean
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
  onOpenFile,
  triageFallback,
  onAssignTriageFallback,
  onDismissTriageFallback,
  onOpenAgentSettings,
  onToast,
  composerActive = true,
  focusMessageId,
  onFocusMessageHandled,
}: {
  messages: ChannelMessage[]
  agents: GroupChatAgent[]
  /** 没有目标上下文 / 可调度成员时群聊不可发送；显示在输入区上方 */
  disabledReason?: string
  /** 返回 false 表示发送失败（输入区保留内容）；threadId 非空时发到对应评论串；带附件时异步转存后返回 */
  onSend: (
    text: string,
    targetIds: AgentTeamMode[],
    threadId?: string,
    attachments?: { images?: PendingImage[]; files?: PendingFile[] },
  ) => boolean | Promise<boolean>
  /** 切换目标 / 群聊时重置最近窗口 */
  resetKey?: string
  onAskSubmit?: (askId: string, answers: AskAnswers) => void
  onAskCancel?: (askId: string) => void
  onAskExpire?: (askId: string) => void
  onAskHover?: (askId: string, hovering: boolean) => void
  /** 交付组件里点开本地文件；不传时只处理节点 / 工作区路径 */
  onOpenFile?: (pathOrRel: string, title?: string) => void
  /** 无 @ 调度自动重试仍失败：弹出候选让用户指定接手人 */
  triageFallback?: { message: ChannelMessage; agents: GroupChatAgent[] } | null
  onAssignTriageFallback?: (agentId: AgentTeamMode) => void
  onDismissTriageFallback?: () => void
  /** 输入框写作策略菜单里的「智能体设置」入口 */
  onOpenAgentSettings?: () => void
  /** 写作策略切换后的轻提示（与私聊输入框同口径） */
  onToast?: (message: string) => void
  /** 当前面板是否可见：语音转录只登记可见面板的落字器 */
  composerActive?: boolean
  /** 全局 @ 推送带过来的消息 id：打开后滚到它、闪一下 */
  focusMessageId?: string | null
  /** 定位完成的通知（宿主据此清掉待定位 id，避免下次重开又滚一遍） */
  onFocusMessageHandled?: () => void
}) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [forcePicker, setForcePicker] = useState(false)
  const [suppressPicker, setSuppressPicker] = useState(false)
  const [activePick, setActivePick] = useState(0)
  const [error, setError] = useState('')
  /** 气泡右键菜单：坐标 + 那一条消息（portal 渲染，见 MessageContextMenu） */
  const [menu, setMenu] = useState<MessageMenuState | null>(null)
  /** 正在发送（带附件时先转存再落账）：挡住重复点击 */
  const [sending, setSending] = useState(false)
  /** 点开待发送图片看大图 */
  const [previewImage, setPreviewImage] = useState<PendingImage | null>(null)
  /** 深链定位的那条气泡闪一下 */
  const [flashId, setFlashId] = useState<string | null>(null)
  const attach = useGroupAttachments({ onNotice: (msg) => onToast?.(msg) })
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  /** 语音落字的替换区间：一段话整段替换，而不是一个字一个字追加 */
  const voiceSpanRef = useRef<{ start: number; end: number } | null>(null)
  const textRef = useRef('')
  const caretRef = useRef(0)
  const user = activeUser()
  const userName = user ? displayName(user.profile, t('未命名用户')) : t('未命名用户')
  const [threadRootId, setThreadRootId] = useState<string | null>(null)
  const workingAgents = useMemo(() => agents.filter((a) => a.running), [agents])
  /** 一级群聊：评论串里的回复（有 threadRootId）不重复出现在主列表 */
  const topMessages = useMemo(() => messages.filter((m) => !m.threadRootId), [messages])
  const threadRoot = useMemo(
    () => (threadRootId ? messages.find((m) => m.id === threadRootId) ?? null : null),
    [messages, threadRootId],
  )
  /** 当前评论串里的回复；根消息单独渲染，永远在主楼位置 */
  const threadComments = useMemo(
    () => (threadRoot ? messages.filter((m) => m.threadRootId === threadRoot.id) : []),
    [messages, threadRoot],
  )
  const threadId = threadRoot?.goalId ? groupThreadIdOf(threadRoot.goalId, threadRoot.id) : null
  useEffect(() => {
    setThreadRootId(null)
    setMenu(null)
  }, [resetKey])

  // 评论串根消息被容量裁掉时退回一级列表，避免停在一个空壳页面。
  useEffect(() => {
    if (threadRootId && !threadRoot) {
      setThreadRootId(null)
      setMenu(null)
    }
  }, [threadRoot, threadRootId])

  const listMessages = threadRoot ? threadComments : topMessages
  const viewKey = resetKey + (threadRootId ? '|' + threadRootId : '')
  /** 要定位的那条在当前列表里的位置：负值 = 不在这一层（可能在评论串里，等切换后再算） */
  const focusIndex = useMemo(
    () => (focusMessageId ? listMessages.findIndex((m) => m.id === focusMessageId) : -1),
    [focusMessageId, listMessages],
  )
  const { start, hasOlder, sentinelRef } = useRecentWindow(listMessages.length, viewKey, focusIndex)
  const visible = listMessages.slice(start)
  /** 评论串视图里根消息永远单独占第一条；它不计入评论窗口 */
  const rendered = threadRoot ? [threadRoot, ...visible] : visible
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 滚动容器里的内容层：高度自己长高时（Markdown / 交付块渲染完）也要继续贴底 */
  const contentRef = useRef<HTMLDivElement | null>(null)
  const edges = useScrollEdges(scrollRef)
  /*
    群聊没有消息定位条，也没有 Ctrl + 滚轮调字号：只借 useScrollFollow 的
    「贴底 / 脱离 / 回到底部」这套判据，锚点与根节点给空 ref（它们的监听不会挂上）。
  */
  const scrollWheelScopeRef = useRef<HTMLDivElement | null>(null)
  const scrollMsgRefs = useRef(new Map<string, HTMLDivElement>())
  const scrollRailRef = useRef<{ id: string; top: number }[]>([])
  const { pinned, onWheel, onScroll, restoreFollow, resetFollow, stickToBottom } = useScrollFollow(
    listMessages,
    {
      scrollRef,
      rootRef: scrollWheelScopeRef,
      msgRefs: scrollMsgRefs,
      railAnchorsRef: scrollRailRef,
      contentRef,
    },
    noopSetRailActive,
  )

  /** 浏览记录按通道分开：主群聊与每条评论串各记各的 */
  const channelKey = `group:${resetKey}${threadRootId ? ':thread:' + threadRootId : ''}`
  const unread = useChatReadIndex(channelKey, listMessages, pinned)

  // 换目标 / 进评论串：立刻落到底并恢复跟随（不走平滑动画）
  const resetFollowRef = useRef(resetFollow)
  useLayoutEffect(() => {
    resetFollowRef.current = resetFollow
  })
  useLayoutEffect(() => {
    resetFollowRef.current()
  }, [viewKey])

  // 跟随状态下，新消息 / 内容长高就继续贴底；脱离之后一律不动
  useEffect(() => {
    stickToBottom()
  }, [stickToBottom, listMessages])

  /**
   * 全局 @ 推送的深链：先保证那条消息在眼前这一层。
   * 它如果是评论串里的回复，就切进对应评论串；是一级主楼则退回主列表。
   */
  useEffect(() => {
    if (!focusMessageId) return
    const target = messages.find((m) => m.id === focusMessageId)
    if (!target) return
    if (target.threadRootId) {
      if (threadRootId !== target.threadRootId) setThreadRootId(target.threadRootId)
    } else if (threadRootId) {
      setThreadRootId(null)
    }
  }, [focusMessageId, messages, threadRootId])

  /** 定位完成一次：居中滚过去、闪一下，然后让宿主清掉待定位 id */
  const focusDoneRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusMessageId) focusDoneRef.current = null
  }, [focusMessageId])
  useLayoutEffect(() => {
    if (!focusMessageId || focusDoneRef.current === focusMessageId) return
    const el = scrollMsgRefs.current.get(focusMessageId)
    if (!el) return
    focusDoneRef.current = focusMessageId
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView?.({ block: 'center' })
      setFlashId(focusMessageId)
      window.setTimeout(() => setFlashId(null), 1400)
      onFocusMessageHandled?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [focusMessageId, listMessages.length, start, threadRootId, onFocusMessageHandled])

  const mentioned = useMemo(() => mentionedAgentsOf(text, agents), [text, agents])
  const mention = mentionContextAt(text, caret)
  const pickerOpen = (Boolean(mention) || forcePicker) && !suppressPicker
  const mentionQuery = mention?.query.trim().toLowerCase() ?? ''
  const filteredAgents = useMemo(
    () => agents.filter((a) => !mentionQuery || a.name.toLowerCase().includes(mentionQuery) || (a.aliases ?? []).some((x) => x.toLowerCase().includes(mentionQuery))),
    [agents, mentionQuery],
  )
  const pickIndex = Math.min(activePick, Math.max(0, filteredAgents.length - 1))
  const canSend = (Boolean(text.trim()) || attach.hasAttachments) && !disabledReason

  /** 气泡里 @ 的解析名单：成员真名 + 所有 role 的默认名，改名前后都能认 */
  const mentionNames = useMemo(() => {
    const names = ['用户', userName, ...agents.flatMap((a) => [a.name.trim(), ...(a.aliases ?? []).map((x) => x.trim())])]
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
    textRef.current = next
    caretRef.current = nextCaret
    voiceSpanRef.current = null
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

  const submit = async (): Promise<void> => {
    if (sending) return
    const trimmed = text.trim()
    const hasAttachments = attach.hasAttachments
    if ((!trimmed && !hasAttachments) || disabledReason) return
    // @ 的语法要求名字后保留一个空格；不能在这里把末尾空格 trim 掉，否则
    // `@导师龟 ` 会被自己吃掉分隔符，变成一次失败的艾特。
    const body = /[ \u3000]$/.test(text) ? trimmed + ' ' : trimmed
    // 没有 @ 时不指定任何目标：交给幕后的群消息调度 agent 判断；评论串也一样。
    const targets: AgentTeamMode[] = mentioned.length ? mentioned.map((a) => a.id) : []
    if (!targets.length && !agents.length) {
      setError(t('当前群聊里没有可调度的 agent'))
      return
    }
    if (body.includes('@') && !mentioned.length) {
      setError(t('@ 没有匹配到成员：请写完整名字，并在 `@名字 ` 后留一个空格'))
      return
    }
    setSending(true)
    try {
      // 没有附件时保持三参调用；有附件时桥会先转存再落账。
      const ok = hasAttachments
        ? await onSend(body, targets, threadId ?? undefined, {
            ...(attach.images.length ? { images: attach.images } : {}),
            ...(attach.files.length ? { files: attach.files } : {}),
          })
        : await onSend(body, targets, threadId ?? undefined)
      if (!ok) {
        setError(t('发送失败，请稍后再试'))
        return
      }
      setText('')
      setCaret(0)
      textRef.current = ''
      caretRef.current = 0
      voiceSpanRef.current = null
      setForcePicker(false)
      setSuppressPicker(false)
      setError('')
      attach.clearAttachments()
      // 发出去的消息一定落在最底下：人往上翻着时也把人带回最新，并恢复自动跟随
      restoreFollow()
    } catch (err) {
      // 附件转存失败时桥会带着真实原因拒绝发送；不要再盖成一句无信息量的「稍后再试」
      setError(err instanceof Error && err.message ? err.message : t('发送失败，请稍后再试'))
    } finally {
      setSending(false)
    }
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
      textRef.current = next
      caretRef.current = nextCaret
      voiceSpanRef.current = null
      setForcePicker(true)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCaret, nextCaret)
      })
    }
  }

  /** 群聊输入框同样支持语音：一段话整段替换上一次落进输入框的同一段 */
  const makeVoiceSink = useCallback((): VoiceSink | null => {
    if (!inputRef.current) return null
    return {
      update(next) {
        const prev = textRef.current
        const span = voiceSpanRef.current
        const start = span ? span.start : Math.min(caretRef.current, prev.length)
        const end = span ? Math.min(span.end, prev.length) : start
        const updated = prev.slice(0, start) + next + prev.slice(end)
        const nextCaret = start + next.length
        textRef.current = updated
        caretRef.current = nextCaret
        voiceSpanRef.current = { start, end: nextCaret }
        setText(updated)
        setCaret(nextCaret)
        requestAnimationFrame(() => {
          const el = inputRef.current
          if (!el) return
          el.focus()
          el.setSelectionRange(nextCaret, nextCaret)
        })
      },
      commit() {
        voiceSpanRef.current = null
      },
    }
  }, [])

  const listMask = fadeMask(edges)
  const maskStyle = listMask
    ? ({ maskImage: listMask, WebkitMaskImage: listMask } as CSSProperties)
    : undefined

  /**
   * 这条消息能不能开评论串。ask 可能继承任务串（threadId 指向别的根）：它仍在一级，
   * 但不在这里开新串；已经在评论串视图里时也不再对评论开串。
   */
  const canCommentOf = (m: ChannelMessage): boolean => {
    if (threadRoot || m.threadRootId) return false
    if (!m.goalId) return false
    const ownThreadId = groupThreadIdOf(m.goalId, m.id)
    return !m.threadId || m.threadId === ownThreadId
  }

  const openMessageMenu = (e: ReactMouseEvent<HTMLElement>, m: ChannelMessage): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, message: m, allowComment: canCommentOf(m) })
  }

  /** 复制正文与详细层：两者都带上，粘出去才是完整的一条消息 */
  const copyMessage = async (m: ChannelMessage): Promise<void> => {
    const body = [m.text, m.detail].filter((x) => x && x.trim()).join('\n\n')
    if (!body) return
    try {
      await navigator.clipboard.writeText(body)
      onToast?.(t('已复制消息'))
    } catch {
      onToast?.(t('复制失败，请手动选中后复制'))
    }
  }

  const menuItems: MessageMenuItem[] = menu
    ? [
        {
          key: 'copy',
          label: t('复制'),
          icon: <Copy size={13} />,
          onSelect: () => {
            void copyMessage(menu.message)
          },
        },
        ...(menu.allowComment
          ? [
              {
                key: 'comment',
                label: t('评论'),
                icon: <MessageSquare size={13} />,
                onSelect: () => {
                  setThreadRootId(menu.message.id)
                  setError('')
                },
              },
            ]
          : []),
      ]
    : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-group-chat-header
        className="flex shrink-0 items-center gap-2 border-b border-line/60 px-4 py-3"
      >
        {threadRoot ? (
          <>
            <button
              type="button"
              onClick={() => {
                setThreadRootId(null)
                setError('')
              }}
              title={t('返回群聊')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-line/30 hover:text-ink"
            >
              <ArrowLeft size={17} />
            </button>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-seal/10 text-seal">
              <MessageSquare size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink">{t('评论串')}</div>
              <div className="truncate text-[11px] text-ink-faint" title={threadId ?? undefined}>
                {t('{0} 条评论 · 原消息来自 {1}', threadComments.length, nameOfPeer(threadRoot))}
              </div>
            </div>
            <span className="hidden max-w-[180px] truncate rounded-full bg-line/30 px-2 py-0.5 text-[9.5px] text-ink-faint sm:inline" title={threadId ?? undefined}>
              {threadId ?? ''}
            </span>
            {workingAgents.length ? (
              <div className="ml-auto shrink-0">
                <WorkingAgentStack agents={workingAgents} />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-500/10 text-teal-600">
              <Users size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink">{t('群聊')}</div>
              <div className="truncate text-[11px] text-ink-faint">
                {t('群通道 · 只有对话列表 · @ 指定 agent，无 @ 时由群消息调度 agent 判断')}
              </div>
            </div>
            {workingAgents.length ? (
              <WorkingAgentStack agents={workingAgents} />
            ) : (
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
            )}
          </>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="h-full" style={maskStyle}>
        <div
          ref={scrollRef}
          data-message-scroll
          onWheel={onWheel}
          onScroll={onScroll}
          className="h-full overflow-y-auto"
        >
        <div ref={contentRef} className="flex min-h-full flex-col px-4 py-4">
        {rendered.length ? (
          <div className="flex flex-col gap-3">
            {hasOlder ? (
              <div className="flex items-center justify-center py-1 text-[10.5px] text-ink-faint">
                向上滚动加载更早的消息…
              </div>
            ) : null}
            <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
            {rendered.map((m) => {
              const fromRole = m.from.kind === 'role'
              const roleId = fromRole ? (m.from.id as AgentTeamMode) : undefined
              const meta = roleId ? AGENT_ROSTER_META[roleId] : undefined
              const senderAgent = roleId ? agents.find((a) => a.id === roleId) : undefined
              const avatarId = senderAgent?.avatarId
              const mine = m.from.kind === 'user'
              const isThreadRoot = threadRoot?.id === m.id
              const commentCount = messages.filter((x) => x.threadRootId === m.id).length
              const canComment = canCommentOf(m)
              // 没有评论就不显示入口：开新串走右键菜单的「评论」，不占气泡底部一行
              const commentEntry = canComment && commentCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setThreadRootId(m.id)
                    setError('')
                  }}
                  title={m.goalId ? groupThreadIdOf(m.goalId, m.id) : undefined}
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[10.5px] text-ink-faint transition-colors hover:bg-line/25 hover:text-ink-soft"
                >
                  <MessageSquare size={11} />
                  {t('评论 {0}', commentCount)}
                </button>
              ) : null
              /** 纯文件消息不画空气泡：文件 chip 本身就挂在气泡外底侧 */
              const hasMedia = Boolean(
                m.attachments?.images?.length || (m.attachments?.files ?? []).some((f) => isVideoFile(f)),
              )
              const bubbleVisible = Boolean(m.text.trim() || m.detail || hasMedia || m.delivery || commentEntry)
              const mentions = Array.from(
                new Set([
                  ...(m.mentions?.map((p) => agents.find((a) => a.id === p.id)?.name || p.name) ?? []),
                  ...(m.mention ? [agents.find((a) => a.id === m.mention?.id)?.name || m.mention.name] : []),
                ]),
              ).filter(Boolean)
              return (
                <div
                  key={m.id}
                  data-message-id={m.id}
                  ref={(el) => {
                    if (el) scrollMsgRefs.current.set(m.id, el)
                    else scrollMsgRefs.current.delete(m.id)
                  }}
                  className={'flex items-start gap-2.5 ' + (mine ? 'flex-row-reverse' : '')}
                >
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
                  <div className={'min-w-0 max-w-[450px] ' + (mine ? 'flex flex-col items-end' : 'flex flex-col items-start')}>
                    <div
                      data-message-meta="true"
                      onContextMenu={(e) => openMessageMenu(e, m)}
                      className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[10.5px]"
                    >
                      <span className={'font-semibold ' + (mine ? 'text-ink-strong' : (meta?.nameClass ?? 'text-ink-strong'))}>
                        {mine ? userName : nameOfPeer(m)}
                      </span>
                      {!mine && senderAgent ? (
                        <span
                          data-agent-status={senderAgent.running ? 'running' : 'idle'}
                          className={
                            'inline-flex items-center gap-1 ' +
                            (senderAgent.running ? 'text-seal' : 'text-ink-faint')
                          }
                        >
                          <span
                            aria-hidden="true"
                            className={
                              'h-1.5 w-1.5 rounded-full ' +
                              (senderAgent.running ? 'animate-pulse bg-seal' : 'bg-ink-faint/45')
                            }
                          />
                          {senderAgent.running ? t('工作中') : t('空闲')}
                        </span>
                      ) : null}
                      <span className="text-ink-faint">
                        {new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-ink-faint/80">
                        {mentions.length ? mentions.map((name) => '@' + name).join('、') : t('群聊')}
                      </span>
                      {isThreadRoot ? (
                        <span className="rounded-full bg-seal/12 px-1.5 py-0.5 text-[9.5px] font-medium text-seal">
                          {t('原消息')}
                        </span>
                      ) : null}
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
                    ) : bubbleVisible ? (
                      <div
                        onContextMenu={(e) => openMessageMenu(e, m)}
                        className={
                          'relative max-w-full break-words rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                          (mine
                            ? 'bg-bubble-user text-ink-strong rounded-tr-sm'
                            : 'bg-bubble-agent text-ink rounded-tl-sm ring-1 ring-line/50') +
                          (flashId === m.id ? ' moji-msg-flash' : '')
                        }
                      >
                        <span
                          aria-hidden="true"
                          className={
                            'absolute top-2.5 h-2.5 w-2.5 rotate-45 ' +
                            (mine ? 'bg-bubble-user -right-1' : 'bg-bubble-agent -left-1')
                          }
                        />
                        <BubbleBody
                          text={m.text}
                          detail={m.detail}
                          names={mentionNames}
                          labels={{ 用户: userName }}
                          tone={mine ? 'user' : 'agent'}
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
                        {commentEntry ? (
                          <div className="mt-2 border-t border-line/40 pt-1.5">{commentEntry}</div>
                        ) : null}
                      </div>
                    ) : null}
                    <ChannelAttachments message={m} onOpenFile={onOpenFile} />
                    <ChannelExtraBlock extra={m.extra} names={mentionNames} />
                    {m.ask && commentEntry ? <div className="mt-1.5 w-fit">{commentEntry}</div> : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-faint">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-line/30">
              <Users size={22} />
            </div>
            <div className="text-[13px]">{t('还没有群消息')}</div>
            <div className="max-w-[320px] text-[11.5px] leading-relaxed">
              {t('直接输入即可交给群消息调度 agent 判断；@ 名字会抄送上下文，首个 @ 会激活那位 agent。')}
            </div>
          </div>
        )}
        </div>
        </div>
        </div>

        {!pinned ? (
          <FollowLatestButton
            onClick={restoreFollow}
            unread={unread}
            className="bottom-4 right-4"
          />
        ) : null}
      </div>

      <div className="shrink-0 px-3 pb-3">
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
            <GroupComposerAttachments
              images={attach.images}
              files={attach.files}
              onOpenImage={setPreviewImage}
              onRemoveImage={attach.removeImage}
              onRemoveFile={attach.removeFile}
            />
            {mentioned.length ? (
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
              </div>
            ) : null}
            <textarea
              ref={inputRef}
              value={text}
              rows={2}
              onChange={(e) => {
                const next = e.target.value
                const at = e.target.selectionStart ?? next.length
                setText(next)
                setCaret(at)
                textRef.current = next
                caretRef.current = at
                voiceSpanRef.current = null
                setActivePick(0)
                setForcePicker(false)
                setSuppressPicker(false)
                setError('')
              }}
              onFocus={() => setSuppressPicker(false)}
              onPaste={attach.pasteImages}
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
                  void submit()
                }
              }}
              onSelect={(e) => {
                const at = e.currentTarget.selectionStart ?? text.length
                setCaret(at)
                caretRef.current = at
                setForcePicker(false)
                setSuppressPicker(false)
              }}
              placeholder={
                disabledReason
                  ? t('先选择学习目标后再群聊')
                  : threadRoot
                    ? t('回复这条评论串，可不 @ 直接发…')
                    : t('输入消息，可不 @ 直接发；@ 可点名指定成员…')
              }
              disabled={Boolean(disabledReason)}
              className="max-h-[160px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pb-1.5 pt-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-faint/70 disabled:opacity-60"
            />
            <div className="flex items-center gap-1 px-2.5 pb-2">
              <button
                type="button"
                onClick={() => void attach.pickAttachment()}
                disabled={Boolean(disabledReason)}
                title={t('添加附件')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-line/25 hover:text-ink disabled:opacity-40"
              >
                <Paperclip size={15} />
              </button>
              <div className="ml-auto flex min-w-0 shrink items-center gap-1">
                <GroupComposerTools
                  active={composerActive}
                  makeSink={makeVoiceSink}
                  onOpenSettings={onOpenAgentSettings}
                  onToast={onToast}
                />
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
                  onClick={() => void submit()}
                  disabled={!canSend || sending}
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
      {previewImage ? (
        <PendingLightbox image={previewImage} onClose={() => setPreviewImage(null)} />
      ) : null}
      {menu ? (
        <MessageContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}
      {triageFallback && triageFallback.agents.length && onAssignTriageFallback ? (
        <GroupTriageFallbackDialog
          message={triageFallback.message.text}
          agents={triageFallback.agents}
          onPick={onAssignTriageFallback}
          onClose={onDismissTriageFallback ?? (() => undefined)}
        />
      ) : null}
    </div>
  )
}
