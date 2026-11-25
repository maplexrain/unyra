/**
 * 群聊输入区的待发送附件：图片走 PendingImage（字节 + 预览地址），
 * 其余文件走 PendingFile（文本 / 二进制），发送时由群聊桥转存进目标资源库。
 *
 * 与私聊 useComposer 的附件段同一条纪律：**只在内存里**，发出去的那一刻才落盘。
 * 这里单独成文件，是因为群聊输入区不是 Composer（没有会话历史、模型菜单那套状态）。
 */
import { useEffect, useRef, useState } from 'react'
import type { PendingFile, PendingImage } from '../../../agent/types'
import { MAX_FILES, pendingFromFile, pendingFromRead } from '../../../learn/attachments'
import { MAX_IMAGES, MAX_SOURCE_BYTES, makePendingImage, releasePending } from '../../../learn/images'
import { native } from '../../../lib/native'
import { t } from '../../../i18n'

export interface GroupAttachmentsApi {
  images: PendingImage[]
  files: PendingFile[]
  /** 从剪贴板粘进来的图（只当附件，不往输入框里塞文件名） */
  pasteImages: (e: React.ClipboardEvent) => void
  /** 从外面拖进来的一批文件 */
  addDropped: (list: File[]) => Promise<void>
  /** 走系统对话框挑文件（图片 / 文本 / 二进制都由 readAttach 判） */
  pickAttachment: () => Promise<void>
  removeImage: (id: string) => void
  removeFile: (id: string) => void
  /** 清空待发送附件，放掉预览 object URL */
  clearAttachments: () => void
  hasAttachments: boolean
}

export function useGroupAttachments({
  onNotice,
}: {
  onNotice: (message: string) => void
}): GroupAttachmentsApi {
  const [images, setImages] = useState<PendingImage[]>([])
  const [files, setFiles] = useState<PendingFile[]>([])

  const addImages = (list: File[]): void => {
    const pics = list.filter((f) => f.type.startsWith('image/'))
    if (!pics.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      onNotice(t('一条消息最多 {0} 张图', MAX_IMAGES))
      return
    }
    if (pics.length > room) onNotice(t('最多 {0} 张图，多出来的没有添加', MAX_IMAGES))
    const added: PendingImage[] = []
    for (const [i, file] of pics.slice(0, room).entries()) {
      if (file.size > MAX_SOURCE_BYTES) {
        onNotice(t('「{0}」超过 12MB，没有添加', file.name || t('粘贴的图片')))
        continue
      }
      added.push(makePendingImage(file, images.length + i))
    }
    if (added.length) setImages((prev) => [...prev, ...added])
  }

  /** 收纳一批刚进来的文件：图片并入图片通道，其余进文件列表 */
  const addPendingFiles = (list: PendingFile[]): void => {
    if (!list.length) return
    const pics = list.filter((p) => p.image).map((p) => p.image as File)
    if (pics.length) addImages(pics)
    const docs = list.filter((p) => !p.image)
    if (!docs.length) return
    const room = MAX_FILES - files.length
    if (room <= 0) {
      onNotice(t('一条消息最多 {0} 个文件附件', MAX_FILES))
      return
    }
    if (docs.length > room) onNotice(t('最多 {0} 个文件附件，多出来的没有添加', MAX_FILES))
    setFiles((prev) => [...prev, ...docs.slice(0, room)])
  }

  const pasteImages = (e: React.ClipboardEvent): void => {
    const data = e.clipboardData
    if (!data) return
    const dropped = [...data.items]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
    if (!dropped.length) return
    e.preventDefault()
    addImages(dropped)
  }

  const addDropped = async (list: File[]): Promise<void> => {
    const pending: PendingFile[] = []
    for (const file of list) pending.push(await pendingFromFile(file))
    addPendingFiles(pending)
  }

  const pickAttachment = async (): Promise<void> => {
    const res = await native().local.pickAttach()
    if (!res.ok || !res.paths?.length) return
    const pending: PendingFile[] = []
    for (const path of res.paths) {
      const read = await native().local.readAttach(path)
      if (!read.ok) {
        onNotice(t('「{0}」{1}', path.split(/[\\/]/).pop() ?? '', read.error ?? t('读取失败')))
        continue
      }
      const item = pendingFromRead(read, path)
      if (item) pending.push(item)
    }
    addPendingFiles(pending)
  }

  const removeImage = (id: string): void => {
    setImages((prev) => {
      releasePending(prev.filter((img) => img.id === id))
      return prev.filter((img) => img.id !== id)
    })
  }

  const removeFile = (id: string): void => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const clearAttachments = (): void => {
    releasePending(images)
    setImages([])
    setFiles([])
  }

  const pendingRef = useRef<PendingImage[]>([])
  useEffect(() => {
    pendingRef.current = images
  })
  useEffect(
    () => () => {
      releasePending(pendingRef.current)
    },
    [],
  )

  return {
    images,
    files,
    pasteImages,
    addDropped,
    pickAttachment,
    removeImage,
    removeFile,
    clearAttachments,
    hasAttachments: images.length > 0 || files.length > 0,
  }
}
