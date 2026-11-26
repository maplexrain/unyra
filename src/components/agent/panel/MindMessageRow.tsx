/**
 * 思维层的一行：**先回答「谁从哪条通道说了什么」，再决定过程要不要铺开**。
 *
 * 页面重构后的口径：
 * - 头部固定暴露渠道、发信人、收信人、时间与这一跳的上下文占用；raw 信封元信息
 *   只在无障碍层里保留（排查时可读，但不占视觉噪声）；
 * - 正文（回复文本 / 交付 / 提示 / 附件）永远直接铺开；
 * - **一条消息内部的思考 / 工具 / 正文都拆成独立行**，与同一条消息的其它 part 平级；
 *   每条消息只有首行带发信人抬头，避免每个工具行重复一遍「调研龟 00:13」。
 *
 * 历史消息与 work 视图共用：work 的消息就是 role 派给它的任务 + 它的执行过程。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { InjectBlock, MessageRow, type MessageRowProps } from './MessageBubble'
import { flattenParts, type InjectItem, type PartItem } from './partGroups'
import { t, useLocale } from '../../../i18n'
import type { AgentPart, ConversationMessage, MessageUsage } from '../../../agent/types'

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

type ChannelKey = 'user' | 'agent' | 'group' | 'work' | 'reply'

const CHANNEL_STYLE: Record<
  ChannelKey,
  { label: string; className: string; icon: typeof UserRound }
> = {
  user: { label: '用户', className: 'bg-sky-500/10 text-sky-700', icon: UserRound },
  agent: { label: 'Agent', className: 'bg-violet-500/10 text-violet-700', icon: Bot },
  group: { label: '群聊', className: 'bg-teal-500/10 text-teal-700', icon: Users },
  work: { label: 'Work', className: 'bg-amber-500/10 text-amber-700', icon: Wrench },
  reply: { label: '回复', className: 'bg-seal/10 text-seal-deep', icon: MessagesSquare },
}

/** 思维列表里这条消息属于哪只 work；只用于显示标识，不参与上下文 */
export interface MindWorkMessageMeta {
  id: string
  name: string
}

const COLLAPSED_MAX_HEIGHT = 400

function fromNameOf(m: ConversationMessage, agentName: string, work?: MindWorkMessageMeta): string {
  return work
    ? work.name
    : m.channel?.from.name?.trim() ||
      (m.role === 'user' ? currentUserName() : agentName || t('智能体'))
}

function toNameOf(m: ConversationMessage, agentName: string, work?: MindWorkMessageMeta): string {
  return work ? agentName : m.channel?.to.name?.trim() || ''
}

function channelKeyOf(m: ConversationMessage, work?: MindWorkMessageMeta): ChannelKey {
  return work ? 'work' : m.channel?.channel ?? (m.role === 'user' ? 'user' : 'reply')
}

function isExternal(m: ConversationMessage, work?: MindWorkMessageMeta): boolean {
  return Boolean(work) || Boolean(m.channel && m.channel.from.kind !== 'user')
}

/** 一条消息拆出来的最小展示单位；`null` 用于只有附件 / 交付、没有 part 的消息 */
type MindUnit = PartItem | null

function unitsOf(m: ConversationMessage, prelude: InjectItem[] | undefined): MindUnit[] {
  const items = flattenParts(m.parts, prelude)
  return items.length ? items : [null]
}

function MindUnitHeader({
  m,
  agentName,
  work,
  channelKey,
  meta,
  usage,
  ratio,
  hideTime,
}: {
  m: ConversationMessage
  agentName: string
  work?: MindWorkMessageMeta
  channelKey: ChannelKey
  meta: string
  usage?: MessageUsage
  ratio: number | null
  hideTime?: boolean
}) {
  const style = CHANNEL_STYLE[channelKey]
  const Icon = style.icon
  const fromName = fromNameOf(m, agentName, work)
  const toName = toNameOf(m, agentName, work)
  return (
    <>
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
        {work && <span className="shrink-0 text-[10px] font-medium text-amber-700">work ·</span>}
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
        {!hideTime && <span className="text-[10px] tabular-nums text-ink-faint">{timeOf(m.ts)}</span>}
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
    </>
  )
}

function partOf(item: MindUnit): AgentPart | null {
  return item && item.type !== 'inject' ? item : null
}

function unitMessage(m: ConversationMessage, part: AgentPart | null, first: boolean, last: boolean): ConversationMessage {
  return {
    ...m,
    parts: part ? [part] : [],
    // 附件、引用只在首行出现；交付挂在末行，避免同一条消息的多个 part 重复显示。
    images: first ? m.images : undefined,
    files: first ? m.files : undefined,
    quote: first ? m.quote : undefined,
    delivery: last ? m.delivery : undefined,
    // usage 只进本消息首行的抬头，不交给正文渲染。
    usage: undefined,
  }
}

function MindUnitRow({
  m,
  item,
  index,
  count,
  agentName,
  work,
  external,
  body,
  msgRefs,
  flash,
  streaming,
  hideTime,
}: {
  m: ConversationMessage
  item: MindUnit
  index: number
  count: number
  agentName: string
  work?: MindWorkMessageMeta
  external: boolean
  body: Omit<MessageRowProps, 'm' | 'msgRefs' | 'flash' | 'streaming'>
  msgRefs?: MessageRowProps['msgRefs']
  flash: boolean
  streaming: boolean
  hideTime?: boolean
}) {
  const first = index === 0
  const last = index === count - 1
  const part = partOf(item)
  const channelKey = channelKeyOf(m, work)
  const meta = first && m.channel ? channelMetaLineOf(m.channel) : ''
  const usage = first ? m.usage : undefined
  const ratio = usage ? contextRatio(usage) : null
  /**
   * 外部消息的正文才需要 400px 折叠；思考 / 工具本身已有自己的折叠壳，
   * 再套一层会让一个工具出现两个「展开」按钮。
   */
  const collapseText = external && (part?.type === 'text' || part?.type === 'notice' || item?.type === 'inject')
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const measureRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = measureRef.current
    if (!el || !collapseText) {
      setOverflowing(false)
      return
    }
    const measure = () => setOverflowing(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [collapseText, m.id, index])

  const unitM = useMemo(() => unitMessage(m, part, first, last), [m, part, first, last])
  return (
    <div
      ref={(el) => {
        if (!first || !msgRefs?.current) return
        if (el) msgRefs.current.set(m.id, el)
        else msgRefs.current.delete(m.id)
      }}
      data-mind-unit-id={`${m.id}:${index}`}
      data-mind-message-id={first ? m.id : undefined}
      data-mind-ts={m.ts}
      data-mind-part-type={item?.type ?? 'empty'}
      data-work-message={work ? work.id : undefined}
      data-mind-collapsible={collapseText ? 'true' : undefined}
      data-mind-expanded={collapseText ? (expanded ? 'true' : 'false') : undefined}
      className={
        'my-1 px-2.5 py-2 ' +
        (work ? 'bg-amber-500/10 ' : 'bg-card/55 ') +
        (body.faded ? 'opacity-55 ' : '')
      }
    >
      {first && (
        <MindUnitHeader
          m={m}
          agentName={agentName}
          work={work}
          channelKey={channelKey}
          meta={meta}
          usage={usage}
          ratio={ratio}
          hideTime={hideTime}
        />
      )}
      <div
        ref={measureRef}
        className={collapseText && !expanded ? 'max-h-[400px] overflow-hidden' : ''}
      >
        {item?.type === 'inject' ? (
          <InjectBlock item={item} />
        ) : (
          <MessageRow
            {...body}
            m={unitM}
            faded={false}
            flash={flash}
            mind
            streaming={streaming && part?.type === 'text'}
            fill={body.fill || external}
          />
        )}
      </div>
      {collapseText && overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1.5 cursor-pointer text-[10.5px] text-ink-faint transition hover:text-seal"
        >
          {expanded ? t('收起') : t('展开全文')}
        </button>
      )}
    </div>
  )
}

export function MindMessageRow({
  m,
  agentName,
  faded,
  flash,
  fill = false,
  streaming = false,
  hideTime = false,
  work,
  ...rest
}: MessageRowProps & {
  /** 当前 role 的显示名；用户消息则显示用户模块的昵称 */
  agentName: string
  /** work 消息：标出所属 work，并用独立背景色与 role 消息区分 */
  work?: MindWorkMessageMeta
  /** 流式中的临时消息没有真实落库时间，抬头不画时间 */
  hideTime?: boolean
}) {
  useLocale()
  const { msgRefs, prelude, ...body } = rest
  const units = useMemo(() => unitsOf(m, prelude), [m, prelude])
  const external = isExternal(m, work)
  return (
    <>
      {units.map((item, index) => (
        <MindUnitRow
          key={`${m.id}:unit:${index}`}
          m={m}
          item={item}
          index={index}
          count={units.length}
          agentName={agentName}
          work={work}
          external={external}
          body={{ ...body, faded, fill }}
          msgRefs={msgRefs}
          flash={flash}
          streaming={streaming}
          hideTime={hideTime}
        />
      ))}
    </>
  )
}
