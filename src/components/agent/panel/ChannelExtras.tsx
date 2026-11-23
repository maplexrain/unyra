/**
 * 通道消息的「正文之外」部分：附加数据与附件。
 *
 * 大段日志 / JSON 不展开在正文里，默认只露出一行摘要；用户点开才看。
 * 这正是消息字段「正文 / 额外数据 / 附件」三分中的后两项。
 */
import { ChevronDown, Database, FileText, ImageIcon, Paperclip } from 'lucide-react'
import type { ChannelExtra, ChannelMessage } from '../../../agent/types'
import { BubbleRichText } from './BubbleRichText'

export function ChannelExtraBlock({ extra, names }: { extra?: ChannelExtra; names?: string[] }) {
  if (!extra?.text?.trim()) return null
  return (
    <details className="group mt-1.5 rounded-lg border border-line/70 bg-paper/50 text-[11.5px]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-ink-faint transition hover:text-ink">
        <Database size={12} className="shrink-0 text-seal/80" />
        <span className="min-w-0 flex-1 truncate font-medium text-ink-soft">
          {extra.title || '附加数据'}
        </span>
        <span className="shrink-0 text-[10px]">点开查看</span>
        <ChevronDown size={12} className="shrink-0 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="max-h-72 overflow-auto border-t border-line/60 px-2.5 py-2 leading-relaxed">
        {extra.format === 'json' ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-ink-soft">{extra.text}</pre>
        ) : (
          <BubbleRichText text={extra.text} names={names} tone="agent" />
        )}
      </div>
    </details>
  )
}

export function ChannelAttachments({ message }: { message: ChannelMessage }) {
  const images = message.attachments?.images ?? []
  const files = message.attachments?.files ?? []
  if (!images.length && !files.length) return null
  return (
    <div className="mt-1 flex max-w-[700px] flex-wrap gap-1">
      {images.map((img) => (
        <span
          key={img.id}
          className="inline-flex items-center gap-1 rounded-md border border-line/70 bg-card/70 px-1.5 py-0.5 text-[10.5px] text-ink-faint"
          title={img.rel}
        >
          <ImageIcon size={10} className="shrink-0" />
          <span className="max-w-[180px] truncate">{img.name}</span>
        </span>
      ))}
      {files.map((f) => (
        <span
          key={f.rel || f.name}
          className="inline-flex items-center gap-1 rounded-md border border-line/70 bg-card/70 px-1.5 py-0.5 text-[10.5px] text-ink-faint"
          title={f.path || f.rel}
        >
          {f.binary ? <Paperclip size={10} className="shrink-0" /> : <FileText size={10} className="shrink-0" />}
          <span className="max-w-[220px] truncate">{f.name}</span>
        </span>
      ))}
    </div>
  )
}
