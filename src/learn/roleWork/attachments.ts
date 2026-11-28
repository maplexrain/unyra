/**
 * chat.send 的附件解析：把模型给的「图片/文件地址」变成会话里的 MessageImage / MessageFile。
 *
 * 只接受三种来源（与 api 文档一致）：
 * - `moji:static/<rel>` 或裸相对路径：已经落在资源库里的图 / 文件；
 * - 工作区绝对路径：按图片扩展名收成图片引用（不复制字节，仍指向原文件）；
 * - http(s)：现取字节再按普通图片转存（有大小上限，见 learn/agent/transfer）。
 */
import type { MessageFile, MessageImage, PendingImage } from '../../agent/types'
import { transferFreePendingImages, transferPendingImages } from '../agent/transfer'
import type { LearnStore } from '../types'
import type { ChatAttachmentInput } from '../../agent/roleWork/types'
import { resolveStaticResource } from '../static/resolveRef'
import { mimeOfExt } from '../static'

const IMAGE_EXT = /\.(png|jpg|jpeg|webp|gif|bmp|avif)$/i

function nameOf(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path
  const seg = clean.split(/[/\\]/).pop() ?? clean
  return decodeURIComponent(seg)
}

function relOf(item: ChatAttachmentInput): string | null {
  const raw = (item.image ?? item.file ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('moji:static/')) return raw.slice('moji:static/'.length)
  return null
}

function mimeOfName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return mimeOfExt(ext)
}

export async function resolveChatAttachments(
  items: readonly (ChatAttachmentInput | string)[],
  io: { getLatest: () => LearnStore; set: (s: LearnStore) => void; goalId?: string },
): Promise<{ images?: MessageImage[]; files?: MessageFile[] } | { error: string }> {
  const images: MessageImage[] = []
  const files: MessageFile[] = []

  for (const rawItem of items) {
    const item: ChatAttachmentInput =
      typeof rawItem === 'string'
        ? /^(?:https?:|moji:static\/)/i.test(rawItem) || IMAGE_EXT.test(rawItem)
          ? { image: rawItem }
          : { file: rawItem }
        : rawItem
    const raw = (item.image ?? item.file ?? '').trim()
    if (!raw) continue
    const isImage = Boolean(item.image) || IMAGE_EXT.test(raw)
    // 外链图可能没有扩展名（CDN 签名 URL 很常见）：先放过，下载后看 Content-Type。
    if (isImage && !IMAGE_EXT.test(raw) && !raw.startsWith('moji:static/') && !/^https?:/i.test(raw)) {
      return { error: 'chat.send 的图片附件需要可识别的图片扩展名：' + raw }
    }
    const name = item.name?.trim() || nameOf(raw)

    if (/^https?:/i.test(raw)) {
      if (!isImage) {
        return { error: 'chat.send 的外链附件目前只收图片：' + raw }
      }
      try {
        const res = await fetch(raw)
        if (!res.ok) return { error: '附件下载失败（HTTP ' + res.status + '）：' + raw }
        const blob = await res.blob()
        const type = blob.type || mimeOfName(name)
        if (!type.startsWith('image/')) {
          return { error: 'chat.send 的外链附件不是图片：' + raw }
        }
        const file = new File([blob], name, { type })
        const pending: PendingImage = {
          id: crypto.randomUUID(),
          name,
          bytes: blob.size,
          file,
          previewUrl: '',
        }
        // 自由聊天没有目标目录：外链图落到用户级 free/static；挂目标的 role 走目标资源库。
        const saved = io.goalId
          ? await transferPendingImages(io.getLatest, io.set, io.goalId, [pending])
          : await transferFreePendingImages([pending])
        if (saved.error) return { error: saved.error }
        images.push(...saved.images)
      } catch (err) {
        return { error: '附件下载失败：' + (err instanceof Error ? err.message : raw) }
      }
      continue
    }

    if (raw.startsWith('moji:static/')) {
      const found = resolveStaticResource(io.getLatest(), raw, io.goalId)
      if (!found) return { error: 'chat.send 引用的静态资源不在资源库里：' + raw }
      const res = found.resource
      if (isImage) {
        images.push({
          id: res.uuid,
          rel: found.rel,
          name: item.name?.trim() || res.name,
          mime: item.mime ?? mimeOfExt(res.ext),
          bytes: item.bytes ?? res.bytes,
        })
      } else {
        files.push({ name: item.name?.trim() || res.name, bytes: item.bytes ?? res.bytes, uuid: res.uuid, rel: found.rel })
      }
      continue
    }

    if (!isImage) {
      files.push({ name, bytes: item.bytes ?? 0, path: raw })
      continue
    }

    const rel = relOf(item) ?? raw.replace(/^[A-Za-z]:[/\\]/, '').replace(/\\/g, '/')
    const id = rel.split('/').pop()?.replace(/\.[^.]+$/, '') || crypto.randomUUID()
    images.push({
      id,
      rel,
      name,
      mime: item.mime ?? mimeOfName(name),
      bytes: item.bytes ?? 0,
    })
  }

  return {
    ...(images.length ? { images } : {}),
    ...(files.length ? { files } : {}),
  }
}
