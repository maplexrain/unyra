/**
 * 思维层的一行：**先回答「谁从哪条通道说了什么」，再决定过程要不要铺开**。
 *
 * 页面重构后的口径：
 * - 头部固定暴露渠道、发信人、收信人、时间与这一跳的上下文占用；raw 信封元信息
 *   只在无障碍层里保留（排查时可读，但不占视觉噪声）；
 * - 正文（回复文本 / 交付 / 提示 / 附件）永远直接铺开；
 * - 思考 / 工具 / 提示词注入由 MessageBubble 逐项平铺，各自折叠；
 *   不再合并成一层「思考与工具 · N 步」的组容器。
 *
 * 历史消息与 work 视图共用：work 的消息就是 role 派给它的任务 + 它的执行过程。
 */
import {
  ArrowRight,
  Bot,
  MessagesSquare,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react'
import { channelMetaLineOf, currentUserName } from '../../../learn/roleWork/channels'
import { contextRatio, formatTokens } from '../../../lib/usage'
import { MessageRow, type MessageRowProps } from './MessageBubble'
import { t, useLocale } from '../../../i18n'

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

type ChannelKey = 'user' | 'agent' | 'group' | 'work' | 'reply'

const CHANNEL_STYLE: Record<
  ChannelKey,
  { label: string; className: string; accent: string; icon: typeof UserRound }
> = {
  user: { label: '用户', className: 'bg-sky-500/10 text-sky-700', accent: 'border-l-sky-400/55', icon: UserRound },
  agent: { label: 'Agent', className: 'bg-violet-500/10 text-violet-700', accent: 'border-l-violet-400/55', icon: Bot },
  group: { label: '群聊', className: 'bg-teal-500/10 text-teal-700', accent: 'border-l-teal-400/55', icon: Users },
  work: { label: 'Work', className: 'bg-amber-500/10 text-amber-700', accent: 'border-l-amber-400/55', icon: Wrench },
  reply: { label: '回复', className: 'bg-seal/10 text-seal-deep', accent: '', icon: MessagesSquare },
}

export function MindMessageRow({
  m,
  agentName,
  faded,
  flash,
  ...rest
}: MessageRowProps & {
  /** 当前 role 的显示名；用户消息则显示用户模块的昵称 */
  agentName: string
}) {
  useLocale()
  const { msgRefs, ...body } = rest
  const channelKey: ChannelKey = m.channel?.channel ?? (m.role === 'user' ? 'user' : 'reply')
  const style = CHANNEL_STYLE[channelKey]
  const Icon = style.icon
  const fromName =
    m.channel?.from.name?.trim() ||
    (m.role === 'user' ? currentUserName() : agentName || t('智能体'))
  const toName = m.channel?.to.name?.trim() || ''
  const meta = m.channel ? channelMetaLineOf(m.channel) : ''
  const usage = m.usage
  const ratio = usage ? contextRatio(usage) : null
  const channelAccent = m.channel ? 'border-l-2 pl-2 ' + style.accent : ''

  return (
    <div
      ref={(el) => {
        if (!msgRefs?.current) return
        if (el) msgRefs.current.set(m.id, el)
        else msgRefs.current.delete(m.id)
      }}
      data-mind-message-id={m.id}
      className={'my-1 rounded-lg border border-line/50 bg-card/55 px-2.5 py-2 ' + channelAccent + (faded ? 'opacity-55 ' : '')}
    >
      {meta && (
        <span data-mind-raw className="sr-only">
          {meta}
        </span>
      )}
      <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span
          data-mind-channel={channelKey}
          className={
            'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
            style.className
          }
        >
          <Icon size={10} className="shrink-0" />
          {t(style.label)}
        </span>
        <span className="min-w-0 max-w-[42%] truncate font-medium text-ink-strong" title={fromName}>
          {fromName}
        </span>
        {toName && (
          <span className="inline-flex min-w-0 items-center gap-1 text-[10.5px] text-ink-faint">
            <ArrowRight size={10} className="shrink-0" />
            <span className="max-w-[160px] truncate" title={toName}>
              {toName}
            </span>
          </span>
        )}
        <span className="text-[10px] tabular-nums text-ink-faint">{timeOf(m.ts)}</span>
        {usage && (
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-line/40 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-soft"
            title={t('这一跳的上下文占用 {0} / {1} token；输出 {2} token', formatTokens(usage.contextTokens), usage.contextWindow ? formatTokens(usage.contextWindow) : '—', formatTokens(usage.outputTokens))}
          >
            ↑{formatTokens(usage.contextTokens)}
            {ratio !== null && <span className="text-ink-faint">· {Math.round(ratio * 100)}%</span>}
            <span className="text-ink-faint">↓{formatTokens(usage.outputTokens)}</span>
          </span>
        )}
      </div>
      <MessageRow {...body} m={m} faded={false} flash={flash} mind />
    </div>
  )
}
