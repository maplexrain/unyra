/**
 * 通道消息的「正文之外」部分：附加数据与附件。
 *
 * 大段日志 / JSON 不展开在正文里，默认只露出一行摘要；用户点开才看。
 * 这正是消息字段「正文 / 额外数据 / 附件」三分中的后两项。
 */
import { ChevronDown, Database, FileText, Paperclip } from 'lucide-react'
import type { ChannelExtra, ChannelMessage } from '../../../agent/types'
import { BubbleRichText } from './BubbleRichText'
import { isVideoFile } from './messageMediaLayout'

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

/**
 * 气泡外底侧的文件附件：图片与视频已经在气泡内的宫格里（见 MessageMedia），
 * 这里只列「没有画面」的文件（文本 / PDF / 压缩包 / 二进制…）。
 */
export function ChannelAttachments({
  message,
  onOpenFile,
}: {
  message: ChannelMessage
  onOpenFile?: (pathOrRel: string, title?: string) => void
}) {
  const files = (message.attachments?.files ?? []).filter((f) => !isVideoFile(f))
  if (!files.length) return null
  return (
    <div className="mt-1 flex max-w-[450px] flex-wrap gap-1">
      {files.map((f) => {
        const target = f.rel || f.path
        return (
          <button
            key={f.rel || f.name}
            type="button"
            disabled={!target}
            onClick={() => {
              if (target) onOpenFile?.(target, f.name)
            }}
            title={f.path || f.rel || f.name}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-line/70 bg-card/70 px-1.5 py-0.5 text-[10.5px] text-ink-faint transition enabled:hover:border-seal/40 enabled:hover:text-ink-soft disabled:cursor-default"
          >
            {f.binary ? <Paperclip size={10} className="shrink-0" /> : <FileText size={10} className="shrink-0" />}
            <span className="max-w-[220px] truncate">{f.name}</span>
          </button>
        )
      })}
    </div>
  )
}
