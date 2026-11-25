/**
 * 群聊输入框上方的待发送附件列：图片缩略图 + 文件 chip。
 *
 * 与私聊 Composer 的附件列同观感（同一套 ImageThumb / FileChip），
 * 只是状态在 useGroupAttachments 里——群聊没有私聊那套草稿与会话历史。
 */
import type { PendingFile, PendingImage } from '../../../agent/types'
import { FileChip, ImageThumb } from './Images'

export function GroupComposerAttachments({
  images,
  files,
  onOpenImage,
  onRemoveImage,
  onRemoveFile,
}: {
  images: PendingImage[]
  files: PendingFile[]
  onOpenImage: (image: PendingImage) => void
  onRemoveImage: (id: string) => void
  onRemoveFile: (id: string) => void
}) {
  if (!images.length && !files.length) return null
  return (
    <div data-group-composer-attachments className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
      {images.map((img) => (
        <ImageThumb key={img.id} image={img} onOpen={() => onOpenImage(img)} onRemove={() => onRemoveImage(img.id)} />
      ))}
      {files.map((file) => (
        <FileChip key={file.id} file={file} onRemove={() => onRemoveFile(file.id)} />
      ))}
    </div>
  )
}
