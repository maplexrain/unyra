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
  // 用户的名字只认用户模块：调用方即使还带着历史的字面量「用户」，也不能盖回真名
  if (kind === 'user') return currentUserName() || fallback
  if (kind === 'group') return fallback || '群聊'
  return fallback || id
}

export function stampLineOf(stamp: ChannelStamp): string {
  const label =
    stamp.channel === 'user'
      ? '用户通道'
      : stamp.channel === 'agent'
        ? 'Agent 通道'
        : stamp.channel === 'group'
          ? '群聊通道'
          : 'Work 通道'
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

/**
 * 通道元信息里的时间：模型上下文要求 `yyyy/MM/dd HH:mm:ss`（与 UI 的 `-` 格式分开）。
 * 单独一个函数是为了不把「人看的格式」与「模型读的协议」混在一处改。
 */
export function formatMetaTs(ts: number): string {
  return formatTs(ts).replace(/-/g, '/')
}

/**
 * role / work 上下文里每条 user 侧外部消息的**元信息抬头**。
 *
 * 形如：
 * `[{time:2026/11/23 20:45:00, channel:agent, id:e1, roleId:dispatcher, roleName:调度龟}]`
 *
 * 字段是约定好的协议，不是给人看的装饰：`roleId` / `roleName` 是**发信人**，
 * `channel` 是它从哪条通道来。大模型靠这一行分清「这句话是谁说的」，用户消息、
 * 跨 role 转交、work 交付都走同一套抬头。
 */
export function channelMetaLineOf(stamp: ChannelStamp): string {
  const id = stamp.from.id || '-'
  const name = stamp.from.name || '-'
  const envelopeId = stamp.envelopeId || '-'
  return (
    '[{time:' + formatMetaTs(stamp.ts) +
    ', channel:' + stamp.channel +
    ', id:' + envelopeId +
    ', roleId:' + id +
    ', roleName:' + name +
    (stamp.mention ? ', mention:self' : '') +
    '}]'
  )
}

/** 模型历史里的通道正文：与 runtime 注入必须逐字节一致 */
export function channelTextOf(stamp: ChannelStamp, text: string): string {
  return channelMetaLineOf(stamp) + '\n' + text
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
  extra?: Pick<ConversationMessage, 'images' | 'files' | 'hidden' | 'mark' | 'delivery'>,
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
    ...(extra?.delivery ?? stamp.delivery ? { delivery: extra?.delivery ?? stamp.delivery } : {}),
  }
}

/** 私聊层只展示用户通道；Agent 通道属于内部协作，群聊另开一层，Work 通道放在思维层 */
export function chatChannelsOf(conv: Conversation): ChannelMessage[] {
  return (conv.channels ?? []).filter((m) => m.kind === 'user')
}

/** 群聊的固定对端：`to` 用它表示「这条消息进群」，收件人另看 mentions */
export const GROUP_PEER_ID = 'group'

export function groupPeer(): ChannelPeer {
  return { kind: 'group', id: GROUP_PEER_ID, name: '群聊' }
}

export function peerOf(kind: ChannelKind, id: string, name: string): ChannelPeer {
  const peerKind: ChannelPeer['kind'] =
    kind === 'user' ? 'user' : kind === 'agent' ? 'role' : kind === 'group' ? 'group' : 'work'
  return { kind: peerKind, id, name }
}

/** 构造一条出站通道消息（宿主写时间戳与来源，模型不能改） */
export function outboundEnvelope(input: {
  channel: ChannelKind
  from: ChannelPeer
  to: ChannelPeer
  text: string
  /** 内层详细汇报；气泡默认显示 text，可展开查看 */
  detail?: string
  /** 宿主指定 id（群聊评论串需要先知道根消息 id）；缺省随机 */
  id?: string
  ts?: number
  attachments?: ChannelMessage['attachments']
  quoteMessageId?: string
  auto?: boolean
  mentions?: ChannelPeer[]
  /** 唯一被激活的 mention */
  mention?: ChannelPeer
  /** 交付账（work 交付经 role 转发到通道） */
  delivery?: ChannelMessage['delivery']
  goalId?: string
  threadId?: string
  threadRootId?: string
  extra?: ChannelMessage['extra']
  ask?: ChannelMessage['ask']
  /** 静默汇报：只入上下文与流水，不启动目标 role 一轮 */
  silent?: boolean
}): ChannelMessage {
  return {
    id: input.id ?? crypto.randomUUID(),
    kind: input.channel,
    direction: 'out',
    from: input.from,
    to: input.to,
    text: input.text,
    ...(input.detail ? { detail: input.detail } : {}),
    ts: input.ts ?? Date.now(),
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.extra ? { extra: input.extra } : {}),
    ...(input.ask ? { ask: input.ask } : {}),
    ...(input.quoteMessageId ? { quoteMessageId: input.quoteMessageId } : {}),
    ...(input.auto ? { auto: true } : {}),
    ...(input.mentions?.length ? { mentions: input.mentions } : {}),
    ...(input.mention ? { mention: input.mention } : {}),
    ...(input.delivery ? { delivery: input.delivery } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
    ...(input.silent ? { silent: true } : {}),
  }
}

/** 构造一条入站通道消息（用户 / Agent / Work / 群聊发进来） */
export function inboundEnvelope(input: {
  channel: ChannelKind
  from: ChannelPeer
  to: ChannelPeer
  text: string
  /** 内层详细汇报；气泡默认显示 text，可展开查看 */
  detail?: string
  ts?: number
  id?: string
  attachments?: ChannelMessage['attachments']
  mentions?: ChannelPeer[]
  /** 唯一被激活的 mention */
  mention?: ChannelPeer
  /** 交付账（work 交付经 role 转发到通道） */
  delivery?: ChannelMessage['delivery']
  goalId?: string
  threadId?: string
  threadRootId?: string
  extra?: ChannelMessage['extra']
  /** 静默汇报：只入上下文与流水，不启动目标 role 一轮 */
  silent?: boolean
}): ChannelMessage {
  return {
    id: input.id ?? crypto.randomUUID(),
    kind: input.channel,
    direction: 'in',
    from: input.from,
    to: input.to,
    text: input.text,
    ...(input.detail ? { detail: input.detail } : {}),
    ts: input.ts ?? Date.now(),
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.extra ? { extra: input.extra } : {}),
    ...(input.mentions?.length ? { mentions: input.mentions } : {}),
    ...(input.mention ? { mention: input.mention } : {}),
    ...(input.delivery ? { delivery: input.delivery } : {}),
    ...(input.goalId ? { goalId: input.goalId } : {}),
    ...(input.threadId ? { threadId: input.threadId } : {}),
    ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
    ...(input.silent ? { silent: true } : {}),
  }
}
