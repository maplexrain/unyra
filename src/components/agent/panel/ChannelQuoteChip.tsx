/**
 * 消息引用条：`chat.send` 带 `messageId` 时显示在被引用消息上方。
 *
 * 引用条本身可点：先把目标消息滚进视野，再闪一下，让用户知道「引的是哪一句」。
 * 目标不在当前已加载窗口时仍显示占位，点击交给宿主的定位逻辑处理。
 */
import { CornerDownRight, Quote } from 'lucide-react'
import { t } from '../../../i18n'

export interface ChannelQuoteInfo {
  fromName: string
  text: string
}

export function quoteInfoOf(m: {
  text: string
  from: { name: string }
  ask?: unknown
  attachments?: { images?: unknown[]; files?: unknown[] }
}): ChannelQuoteInfo {
  const compact = m.text.replace(/\s+/g, ' ').trim()
  const short = compact.length > 88 ? compact.slice(0, 88) + '…' : compact
  const fallback = m.ask
    ? t('［表单］')
    : m.attachments?.images?.length
      ? t('［图片］')
      : m.attachments?.files?.length
        ? t('［文件］')
        : t('（空消息）')
  return { fromName: m.from.name, text: short || fallback }
}

/**
 * 内部通道（agent / group / work）的正文会在末尾拼一段 `【引用 …】` 给接收方看；
 * 用户界面已经有引用条，气泡正文里这一段必须剪掉，否则会像截图那样出现两份引用。
 * 只剪末尾那一块，正文中间恰好写了「引用」两个字的句子不动。
 */
export function stripChannelQuoteBlock(text: string): string {
  const match = text.match(/(?:\n\n|^)【引用 [^\n]*】\n[\s\S]*$/)
  return match ? text.slice(0, match.index ?? 0).trimEnd() : text
}

export function ChannelQuoteChip({
  quoteId,
  info,
  onJump,
}: {
  quoteId: string
  info?: ChannelQuoteInfo
  onJump?: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onJump?.(quoteId)}
      title={info ? `${info.fromName}：${info.text}` : t('原消息不在当前列表，尝试定位')}
      data-quote-message-id={quoteId}
      className="group mb-1.5 flex w-full max-w-full items-center gap-1.5 rounded-md border-l-2 border-seal/45 bg-line/25 px-2 py-1 text-left text-[11px] text-ink-soft transition hover:bg-line/40 hover:text-ink"
    >
      <Quote size={11} className="shrink-0 text-seal/70" aria-hidden="true" />
      <span className="shrink-0 font-medium text-ink-soft">{info?.fromName ?? t('原消息')}</span>
      <span className="min-w-0 flex-1 truncate text-ink-faint group-hover:text-ink-soft">
        {info?.text ?? t('不在当前列表，点击尝试定位')}
      </span>
      <CornerDownRight size={11} className="shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
    </button>
  )
}
