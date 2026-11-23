/**
 * role-work 通道流水：入站 / 出站消息的落账、来源戳与聊天层过滤。
 *
 * 这里只有纯函数，不碰 store / React：
 * - role 的 `Conversation.channels` 是外部收发的唯一流水；
 * - 聊天层只读它（user / agent），所以永远不会把工具与思考露给外部；
 * - 思维层读 `Conversation.messages`，两者互不污染。
 */
import type { ChannelKind, ChannelMessage, ChannelPeer, ChannelStamp, Conversation, ConversationMessage } from '../../agent/types'
import { displayName } from '../../user/profile'
import { activeUser } from '../../user/store'

const CHANNEL_CAP = 200

/**
 * 当前用户的正式显示名：用户模块是唯一的身份来源，通道信封不再写死“用户”。
 * 用户尚未加载（启动早期 / 无用户作用域）时给一个中性兜底，而不是每次渲染都空着。
 */
export function currentUserName(): string {
  const user = activeUser()
  return user ? displayName(user.profile, '未命名用户') : '未命名用户'
}

/** 当前用户作为通道对端（id 也取用户模块，不再固定为字面量 'user'） */
export function userPeer(): ChannelPeer {
  const user = activeUser()
  return {
    kind: 'user',
    id: user?.id ?? 'user',
    name: user ? displayName(user.profile, '未命名用户') : '未命名用户',
  }
}

export function peerNameOf(kind: ChannelKind, id: string, fallback: string): string {
  if (kind === 'user') return fallback || currentUserName()
  return fallback || id
}

export function stampLineOf(stamp: ChannelStamp): string {
  const label = stamp.channel === 'user' ? '用户通道' : stamp.channel === 'agent' ? 'Agent 通道' : 'Work 通道'
  return '【' + label + ' · ' + stamp.from.name + ' · ' + formatTs(stamp.ts) + '】'
}

export function formatTs(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  )
}

/** 模型历史里的通道正文：与 runtime 注入必须逐字节一致 */
export function channelTextOf(stamp: ChannelStamp, text: string): string {
  return stampLineOf(stamp) + '\n' + text
}

/** 给一条 role 会话追加通道流水；超过上限只保留最近的（旧消息仍在 messages 里） */
export function withChannel(conv: Conversation, message: ChannelMessage): Conversation {
  const channels = [...(conv.channels ?? []), message].slice(-CHANNEL_CAP)
  return { ...conv, channels, updatedAt: Date.now() }
}

/** 一条入站通道消息对应的角色上下文消息（正文保持纯文本，来源戳由 history 补） */
export function inboundMessage(
  text: string,
  stamp: ChannelStamp,
  extra?: Pick<ConversationMessage, 'images' | 'files' | 'hidden' | 'mark'>,
): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }],
    ts: stamp.ts,
    channel: stamp,
    ...(extra?.images ? { images: extra.images } : {}),
    ...(extra?.files ? { files: extra.files } : {}),
    ...(extra?.hidden ? { hidden: true } : {}),
    ...(extra?.mark ? { mark: extra.mark } : {}),
  }
}

/** 聊天层只展示用户通道与 Agent 通道；Work 通道属于内部协作，放在思维层 */
export function chatChannelsOf(conv: Conversation): ChannelMessage[] {
  return (conv.channels ?? []).filter((m) => m.kind === 'user' || m.kind === 'agent')
}

export function peerOf(kind: ChannelKind, id: string, name: string): ChannelPeer {
  return { kind: kind === 'user' ? 'user' : kind === 'agent' ? 'role' : 'work', id, name }
}

/** 构造一条出站通道消息（宿主写时间戳与来源，模型不能改） */
export function outboundEnvelope(input: {
  channel: ChannelKind
  from: ChannelPeer
  to: ChannelPeer
  text: string
  ts?: number
  attachments?: ChannelMessage['attachments']
  quoteMessageId?: string
  auto?: boolean
}): ChannelMessage {
  return {
    id: crypto.randomUUID(),
    kind: input.channel,
    direction: 'out',
    from: input.from,
    to: input.to,
    text: input.text,
    ts: input.ts ?? Date.now(),
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.quoteMessageId ? { quoteMessageId: input.quoteMessageId } : {}),
    ...(input.auto ? { auto: true } : {}),
  }
}

/** 构造一条入站通道消息（用户 / Agent / Work 发进来） */
export function inboundEnvelope(input: {
  channel: ChannelKind
  from: ChannelPeer
  to: ChannelPeer
  text: string
  ts?: number
  attachments?: ChannelMessage['attachments']
}): ChannelMessage {
  return {
    id: crypto.randomUUID(),
    kind: input.channel,
    direction: 'in',
    from: input.from,
    to: input.to,
    text: input.text,
    ts: input.ts ?? Date.now(),
    ...(input.attachments ? { attachments: input.attachments } : {}),
  }
}
