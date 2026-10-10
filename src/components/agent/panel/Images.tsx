/**
 * 图片附件：从「还没发出去的缩略图」到「气泡里那张」再到「点开看大图」。
 *
 * 两条来源在这里合流——已经转存进资源库的按引用去读磁盘缓存（useImageUrl），
 * 还在内存里的直接用贴进来时建的 object URL；两者的遮罩、Esc、点击关闭
 * 都走同一个 LightboxFrame，只写一遍。
 */

import { useEffect, useState } from 'react'
import { ExternalLink, FileText, X } from 'lucide-react'
import type { MessageFile, MessageImage, PendingFile, PendingImage } from '../../../agent/types'
import {
  cachedImageUrl,
  formatBytes,
  loadImageData,
  subscribeImages,
} from '../../../learn/images'
import { t } from '../../../i18n'

/* ---------- 图片附件 ---------- */

/**
 * 把一张附件的 data URL 取出来。
 *
 * 图片字节在磁盘上，读是异步的；这里先给缓存里的（多数情况第一帧就有——
 * 刚贴进来的图存盘时就顺手进了缓存），没有就去读，读完由 subscribeImages
 * 通知所有在等这张图的组件重画。
 */
function useImageUrl(image: MessageImage): string | null {
  const [url, setUrl] = useState(() => cachedImageUrl(image))
  useEffect(() => {
    const sync = () => {
      const hit = cachedImageUrl(image)
      if (hit) setUrl(hit)
    }
    sync()
    const off = subscribeImages(sync)
    void loadImageData(image).then(sync)
    return off
  }, [image])
  return url
}

/** 等图读回来时占位：一块磨砂的方块，与内容骨架同一套观感 */
export function ThumbPlaceholder({ className = '' }: { className?: string }) {
  return <div className={`moji-skeleton ${className}`} aria-hidden="true" />
}

/**
 * 输入框上方那一列里的缩略图。
 *
 * 点一下看大图（图小的时候想确认里面写了什么，只能点开看），
 * 右上角那颗 × 是移除——它就是「对附件做管理」的全部动作。
 */
export function ImageThumb({
  image,
  onOpen,
  onRemove,
}: {
  image: PendingImage
  onOpen: () => void
  onRemove: () => void
}) {
  // 还没落盘，没有磁盘缓存可查：直接用贴进来时建的那个 object URL
  const url = image.previewUrl
  return (
    <div className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-line bg-paper">
      <button
        type="button"
        onClick={onOpen}
        title={`${image.name} · ${formatBytes(image.bytes)}`}
        className="block h-full w-full"
      >
        {url ? (
          <img src={url} alt={image.name} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <ThumbPlaceholder className="h-full w-full" />
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        title={t('移除这张图')}
        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink/70 text-paper opacity-0 transition group-hover:opacity-100 hover:bg-seal"
      >
        <X size={10} />
      </button>
    </div>
  )
}

/** 气泡里的附件：比输入框里的大一点，点开同样能看大图 */
/**
 * 待发送的文件附件：一个名字 + 体积 + 移除键。
 *
 * 不做缩略图（文本没有可看的图），也不显示路径——文件名是用户认得的那个东西，
 * 路径太长，说出来只是噪声（完整路径在 title 里，想看的时候能看到）。
 */
export function FileChip({ file, onRemove }: { file: PendingFile; onRemove: () => void }) {
  const note = file.binary
    ? t('{0} · 二进制', formatBytes(file.bytes))
    : file.truncated
      ? t('已截断 · 约 {0} 字节', file.bytes.toLocaleString())
      : formatBytes(file.bytes)
  return (
    <div
      title={file.path ?? file.name}
      className="group flex h-[52px] w-[168px] shrink-0 items-center gap-1.5 rounded-lg border border-line bg-paper px-2"
    >
      <FileText size={15} className="shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11.5px] text-ink">{file.name}</span>
        <span className="block truncate text-[10px] text-ink-faint">{note}</span>
      </span>
      <button
        type="button"
        title={t('移除')}
        onClick={onRemove}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition hover:bg-line/70 hover:text-ink group-hover:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  )
}

export function BubbleImage({ image, onOpen }: { image: MessageImage; onOpen: () => void }) {
  const url = useImageUrl(image)
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${image.name} · ${formatBytes(image.bytes)}`}
      className="h-24 w-24 overflow-hidden rounded-xl border border-line bg-paper transition hover:border-seal/50"
    >
      {url ? (
        <img src={url} alt={image.name} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <ThumbPlaceholder className="h-full w-full" />
      )}
    </button>
  )
}

/**
 * 气泡里的外部文件附件回显：展示文件名、体积/字数，点击在标签页打开。
 */
export function BubbleFile({ file, onOpen }: { file: MessageFile; onOpen: () => void }) {
  const note = file.binary
    ? t('{0} · 二进制', formatBytes(file.bytes))
    : file.chars
      ? `${formatBytes(file.bytes)} · ${t('共 {0} 字', file.chars.toLocaleString())}`
      : formatBytes(file.bytes)

  return (
    <button
      type="button"
      onClick={onOpen}
      title={
        file.path
          ? t('点击在标签页中打开本地文件：\n{0}', file.path)
          : t('点击在标签页中打开「{0}」', file.name)
      }
      className="group/file flex max-w-[280px] items-center gap-2.5 rounded-xl border border-line bg-card/85 px-3 py-2 text-left shadow-2xs transition-all hover:border-seal/45 hover:bg-card hover:shadow-xs active:scale-[0.98]"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-seal/10 text-seal transition group-hover/file:bg-seal/15">
        <FileText size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-ink transition group-hover/file:text-seal-deep">
          {file.name}
        </div>
        <div className="truncate text-[10.5px] text-ink-faint">
          {note}
          {file.truncated ? t('（已截断）') : ''}
        </div>
      </div>
      <ExternalLink
        size={13}
        className="shrink-0 text-ink-faint opacity-50 transition group-hover/file:text-seal group-hover/file:opacity-100"
      />
    </button>
  )
}

/**
 * 看大图。
 *
 * 自己画而不是丢给系统看图程序：贴进来的图常常只是要「看清上面写了什么」，
 * 跳出去看一眼再回来会把输入框里没发出去的草稿晾在那儿，容易出事。
 * 背景用遮罩而不是纯黑——它是盖在应用上的一层，不是另一个应用。
 */
/**
 * 看大图的本体：只认「一张已经拿得到 url 的图」。
 *
 * 单独分出来是因为图有两个来源——已经转存进资源库的（按引用去读磁盘缓存）与
 * 还没发出去的（输入框里的 object URL）。遮罩、Esc、点任意处关闭这些只该写一遍。
 */
function LightboxFrame({
  url,
  name,
  bytes,
  width,
  height,
  onClose,
}: {
  url: string | null
  name: string
  bytes: number
  width?: number
  height?: number
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="no-print moji-fade-in fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-mask/75 p-8 backdrop-blur-[2px]"
      onClick={onClose}
    >
      {url ? (
        <img
          src={url}
          alt={name}
          className="max-h-[80vh] max-w-[90vw] rounded-xl border border-line bg-card object-contain shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
          draggable={false}
        />
      ) : (
        <ThumbPlaceholder className="h-[40vh] w-[60vw] rounded-xl" />
      )}
      <div className="flex items-center gap-2 rounded-full bg-card/95 px-3 py-1 text-[11px] text-ink-soft">
        <span className="max-w-[46vw] truncate">{name}</span>
        <span className="text-ink-faint">
          {width && height ? `${width}×${height} · ` : ''}
          {formatBytes(bytes)}
        </span>
        <span className="text-ink-faint">{t('点击任意处关闭')}</span>
      </div>
    </div>
  )
}

/** 已经进资源库的附件（消息气泡里那张）：按引用取字节 */
export function ImageLightbox({ image, onClose }: { image: MessageImage; onClose: () => void }) {
  const url = useImageUrl(image)
  return (
    <LightboxFrame
      url={url}
      name={image.name}
      bytes={image.bytes}
      width={image.width}
      height={image.height}
      onClose={onClose}
    />
  )
}

/** 还没发出去的附件（输入框里那张）：直接用内存里的 object URL */
export function PendingLightbox({ image, onClose }: { image: PendingImage; onClose: () => void }) {
  return <LightboxFrame url={image.previewUrl} name={image.name} bytes={image.bytes} onClose={onClose} />
}

/* 建图与放图那两个配套动作住在 imagePending.ts（本文件只导出「看得见的东西」：组件） */
