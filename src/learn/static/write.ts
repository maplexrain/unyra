/** 这个文件负责什么：落盘与清理——附件转存成资源（图片 / 文本）、写正文、删文件、在资源管理器里定位。 */

import type { MessageFile, MessageImage } from '../../agent/types'
import type { LearnStore } from '../types'
import { removeUserPath, revealUserPath, writeUserImage, writeUserText } from '../../lib/storage'
import {
  blobToDataUrl,
  formatBytes,
  loadedImage,
  MIME_EXT,
  MAX_SOURCE_BYTES,
  normalizeImage,
  rememberImage,
} from '../images'
import { baseNameOf, extOf } from './ext'
import { findByHash, hashBytes } from './hash'
import { goalStaticDir, resourceRel } from './location'
import { makeResource } from './ops'
import type { StaticResource } from './types'
import { t } from '../../i18n'

export { formatBytes }

/* ---------- 写文件 ---------- */

export type SaveResourceResult =
  | {
      ok: true
      resource: StaticResource
      image: MessageImage
      /** 内容与库里已有的一份相同，直接复用了那条资源（没有再写一个文件） */
      reused?: boolean
    }
  | { ok: false; error: string }

/** 上限与 electron 侧的二进制通道一致；超了当场拒绝，别等 IPC 报错 */
export const MAX_RESOURCE_BYTES = 32 * 1024 * 1024

/**
 * 把一张图片**转存**成资源：写进 {目标}/static/{uuid}.{ext}，同时返回给消息用的引用（image）。
 *
 * **调用时机是「这条消息真的要发出去」的那一刻**（见 learn/useAgent 的 transferPendingImages），
 * 不是贴进输入框的时候——资源库只该收进过上下文的东西：贴了又删、或者没配 Key 发不出去的
 * 那些图不该在目标里留下没人引用的孤儿文件。
 *
 * 归一化沿用聊天图片那一套（长边超 1568 或体积偏大就缩放重编码，见 images.ts）：
 * 转存后的原件既是资源、也是这一轮要发给模型的那张图，两处对分辨率的要求是一致的。
 */
export async function saveStaticImage(
  store: LearnStore,
  goalId: string,
  file: File,
  index: number,
): Promise<SaveResourceResult> {
  if (!file.type.startsWith('image/')) return { ok: false, error: t('只能添加图片文件') }
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: t('图片超过 12MB，请先压小一点') }
  const dir = goalStaticDir(store, goalId)
  if (!dir) return { ok: false, error: t('找不到这个目标的目录') }
  const normalized = await normalizeImage(file)
  if ('error' in normalized) return { ok: false, error: normalized.error }
  const ext = MIME_EXT[normalized.mime] ?? 'png'
  let url: string
  try {
    url = await blobToDataUrl(normalized.blob)
  } catch {
    return { ok: false, error: t('读取图片失败') }
  }
  // 内容指纹：同一张图再贴一次不该在库里存第二份
  const bytes = new Uint8Array(await normalized.blob.arrayBuffer())
  const hash = await hashBytes(bytes)
  const existing = findByHash(store, goalId, hash)
  if (existing) {
    const rel = resourceRel(store, goalId, existing)
    // 已经在缓存里就顺手把这条路径也认下（同一份字节，两个 rel 指向同一文件时不该重复读盘）
    if (rel && !loadedImage(rel)) {
      const comma = url.indexOf(',')
      rememberImage(rel, { mime: normalized.mime, data: url.slice(comma + 1), url })
    }
    return {
      ok: true,
      resource: existing,
      reused: true,
      image: {
        id: existing.uuid,
        rel: rel ?? '',
        name: existing.name,
        mime: normalized.mime,
        bytes: existing.bytes,
        width: normalized.width,
        height: normalized.height,
      },
    }
  }
  const uuid = crypto.randomUUID()
  const rel = dir + '/' + uuid + '.' + ext
  if (!(await writeUserImage(rel, url))) return { ok: false, error: t('图片存盘失败') }

  const name = baseNameOf(file.name) || '粘贴的图片 ' + (index + 1)
  const resource = makeResource({
    uuid,
    name,
    ext,
    bytes: normalized.blob.size,
    hash,
    type: 'binary',
  })
  const image: MessageImage = {
    id: uuid,
    rel,
    name,
    mime: normalized.mime,
    bytes: normalized.blob.size,
    width: normalized.width,
    height: normalized.height,
  }
  // 刚存下来的这张已经在手上：进缓存，缩略图与本轮请求都不必再读盘
  const comma = url.indexOf(',')
  rememberImage(rel, { mime: normalized.mime, data: url.slice(comma + 1), url })
  return { ok: true, resource, image }
}

/**
 * 把一份**文本**附件存成资源（用户发给导师的文件走这里，见 learn/attachments）。
 *
 * 与 saveStaticImage 是一对：那个存字节（图片），这个存正文（源码、csv、日志…）。
 * 同样按内容指纹去重——同一份文件发两次，资源库里只留一份，两条消息指向同一个 uuid。
 * 存进资源库而不是塞进 chat.json 有两个好处：会话文件不会被附件撑大（每次改动都要整份重写），
 * 而且导师之后还能用 res.read 把这份附件再读一遍。
 */
export async function saveStaticText(
  store: LearnStore,
  goalId: string,
  name: string,
  text: string,
): Promise<{ ok: true; resource: StaticResource; rel: string; file: MessageFile; reused?: boolean } | { ok: false; error: string }> {
  const dir = goalStaticDir(store, goalId)
  if (!dir) return { ok: false, error: t('找不到这个目标的目录') }
  const ext = extOf(name) || 'txt'
  const bytes = new TextEncoder().encode(text)
  const hash = await hashBytes(bytes)
  const existing = findByHash(store, goalId, hash)
  if (existing) {
    const rel = resourceRel(store, goalId, existing)
    if (rel) return { ok: true, resource: existing, rel, reused: true, file: messageFileOf(existing, rel, name, text) }
  }
  const uuid = crypto.randomUUID()
  const rel = dir + '/' + uuid + '.' + ext
  if (!(await writeUserText(rel, text))) return { ok: false, error: t('附件存盘失败') }
  const resource = makeResource({ uuid, name: baseNameOf(name) || '附件', ext, bytes: bytes.length, hash, type: 'text' })
  return { ok: true, resource, rel, file: messageFileOf(resource, rel, name, text) }
}

/** 附件在消息里的那份引用：名字、体积、字数与读写用的路径 */
export function messageFileOf(resource: StaticResource, rel: string, name: string, text: string): MessageFile {
  return { name, bytes: resource.bytes, uuid: resource.uuid, rel, chars: text.length }
}

/** 写一份新的文本资源（Agent 用 res.new 时走这里） */
export async function writeResourceText(
  store: LearnStore,
  goalId: string,
  res: StaticResource,
  content: string,
): Promise<boolean> {
  const rel = resourceRel(store, goalId, res)
  return rel ? writeUserText(rel, content) : false
}

/** 删掉资源文件本身（清单项的移除由 store 层负责） */
export async function removeResourceFile(
  store: LearnStore,
  goalId: string,
  res: StaticResource,
): Promise<boolean> {
  const rel = resourceRel(store, goalId, res)
  return rel ? removeUserPath(rel) : false
}

/** 在系统文件管理器里定位这条资源（路径前缀在这一层补，调用方只给 uuid） */
export async function revealResource(
  store: LearnStore,
  goalId: string,
  res: StaticResource,
): Promise<boolean> {
  const rel = resourceRel(store, goalId, res)
  return rel ? revealUserPath(rel) : false
}
