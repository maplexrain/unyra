/**
 * 气泡内侧底部的图片 / 视频宫格（Telegram 式排布）。
 *
 * - 图片字节按引用读（useImageUrl，与私聊气泡同一套缓存与骨架）；
 * - 视频只在有本地路径时按需读成 data URL（主进程 readMedia），不在聊天记录里存字节；
 * - 最多 9 张，1/2/3/4 张各有专门排法，5 张以上 3 列等宽（见 messageMedia 的 mediaGridSpec）。
 */
import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import type { MessageFile, MessageImage } from '../../../agent/types'
import { formatBytes } from '../../../learn/images'
import { readLocalMediaFile } from '../../../lib/localFiles'
import { userAbsPath } from '../../../lib/storage'
import { t } from '../../../i18n'
import { ImageLightbox, ThumbPlaceholder, useImageUrl } from './Images'
import { isVideoFile, MAX_MEDIA, mediaGridSpec } from './messageMediaLayout'

export function MessageMediaGrid({
  images = [],
  files = [],
}: {
  images?: MessageImage[]
  files?: MessageFile[]
}) {
  const videos = files.filter((f) => isVideoFile(f)).slice(0, MAX_MEDIA)
  const pics = images.slice(0, Math.max(0, MAX_MEDIA - videos.length))
  const [preview, setPreview] = useState<MessageImage | null>(null)
  if (!pics.length && !videos.length) return null

  const total = pics.length + videos.length
  const spec = mediaGridSpec(total)
  const gridCls = spec.cols === 1 ? 'grid-cols-1' : spec.cols === 2 ? 'grid-cols-2' : 'grid-cols-3'
  const single = total === 1

  return (
    <>
      <div className={'mt-2 grid gap-1 overflow-hidden ' + gridCls}>
        {pics.map((img, i) => (
          <button
            key={img.id || `img-${i}`}
            type="button"
            onClick={() => setPreview(img)}
            title={`${img.name} · ${formatBytes(img.bytes)}`}
            className={
              'group/media relative min-w-0 overflow-hidden rounded-lg border border-line/60 bg-paper transition hover:border-seal/45 ' +
              (single ? 'aspect-[4/3] max-h-[320px]' : spec.firstWide && i === 0 ? 'col-span-2 aspect-[2/1]' : 'aspect-square')
            }
          >
            <MediaImage image={img} />
          </button>
        ))}
        {videos.map((file, i) => (
          <div
            key={file.rel || file.path || file.name + i}
            className={
              'relative min-w-0 overflow-hidden rounded-lg border border-line/60 bg-ink/90 ' +
              (single ? 'aspect-[4/3] max-h-[320px]' : spec.firstWide && i === 0 && !pics.length ? 'col-span-2 aspect-[2/1]' : 'aspect-square')
            }
          >
            <MediaVideo file={file} />
          </div>
        ))}
      </div>
      {preview ? <ImageLightbox image={preview} onClose={() => setPreview(null)} /> : null}
    </>
  )
}

function MediaImage({ image }: { image: MessageImage }) {
  const url = useImageUrl(image)
  if (!url) return <ThumbPlaceholder className="h-full w-full" />
  return (
    <img
      src={url}
      alt={image.name}
      className="h-full w-full object-cover transition duration-200 group-hover/media:scale-[1.02]"
      draggable={false}
    />
  )
}

/**
 * 气泡里的视频：有绝对路径（或能由 rel 还原）才读字节。
 * 读不出来就留一张「视频 · 名字」的暗底占位，不假装能播。
 */
function MediaVideo({ file }: { file: MessageFile }) {
  const path = file.path ?? (file.rel ? userAbsPath(file.rel) : null)
  const [src, setSrc] = useState<string | null>(null)
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const failed = !path || failedFor === path

  useEffect(() => {
    if (!path) return
    let alive = true
    void readLocalMediaFile(path).then((r) => {
      if (!alive) return
      if (r.ok && r.dataUrl) setSrc(r.dataUrl)
      else setFailedFor(path)
    })
    return () => {
      alive = false
    }
  }, [path])

  if (src) {
    return (
      <video
        src={src}
        controls
        playsInline
        preload="auto"
        className="h-full w-full bg-black object-cover"
      />
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center text-paper">
      {failed ? <Play size={18} className="opacity-65" /> : <span className="h-4 w-4 animate-pulse rounded-full bg-paper/35" />}
      <span className="line-clamp-1 max-w-full text-[10.5px] text-paper/75">{file.name}</span>
      <span className="text-[9.5px] text-paper/50">{failed ? t('浏览器里读不到这段视频') : t('载入视频…')}</span>
    </div>
  )
}
