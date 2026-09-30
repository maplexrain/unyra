/**
 * 图片字节的取用与清理。**写入不在这里**——附件转存走 learn/static 的 saveStaticImage，
 * 它把图写进 `{目标}/static/{uuid}.{ext}` 的资源库（见 learn/static 的文件头说明）。
 *
 * 三件事在这个模块里：
 * 1. **取**：发请求前把历史里引用到的图读回来，拼成中立的 content 片段（见 ai/content）。
 *    读回来的 base64 进缓存——同一张图每一轮都要重放，不缓存就每轮读一次盘；
 * 2. **共用**：这份缓存是全应用**唯一**的一份图字节，键是 rel。聊天气泡、文档里的
 *    `moji:static` 引用、Agent 读图（res.read）都走它（见 learn/static 的 loadImageByRel）；
 * 3. **清**：删消息 / 删对话之后，把 `{目标}/images/` 里没人再引用的图删掉（pruneImages）。
 *    那已经是**旧目录**：新附件一律转存进 static/ 的资源库，成为目标的资产，
 *    不跟着消息的增删走。这里的清理只为迁移前的老数据保留。
 *
 * 缓存按 `rel` 做键。图片一旦落盘就不再改写（id 唯一、不覆盖），所以缓存
 * 不会读到旧内容——这也是「换个模型重发一次，前缀仍然逐字节相同」的前提。
 */

import type { ConversationMessage, MessageImage } from '../agent/types'
import type { LearnStore } from './types'
import { DOCS_DIR, IMAGES_DIR, nodeLayout } from './layout'
import { listUserDir, readUserImage, removeUserPath } from '../lib/storage'
import { t } from '../i18n'

/** 一条消息最多带几张图：再多模型也看不过来，token 更吃不消 */
export const MAX_IMAGES = 6

/** 单张原图上限。超过就拒绝，而不是硬压——几千万像素的图压起来也要几秒 */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024

/**
 * 长边上限。1568 是 Anthropic 的推荐上限，OpenAI 那一路也在同一量级：
 * 比这更大的图不会带来更多信息，只会按分辨率多收钱。
 */
const MAX_EDGE = 1568

/** 小于这个体积的小图原样保存：重新编码一次反而可能更大 */
const KEEP_ORIGINAL_BYTES = 900 * 1024

/** 后缀表：转存资源时要用它把 mime 折回一个后缀（见 learn/static 的 saveStaticImage） */
export const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

/** 重新编码统一用 webp：同画质下比 jpeg 小、比 png 小得多，三家协议都收 */
const REENCODE_MIME = 'image/webp'

/** 一个目标里的图片目录；目标目录就是根节点的目录（见 files.ts 的 nodeLayout） */
export function goalImagesDir(store: LearnStore, goalId: string): string | null {
  const rootId = store.goals.find((g) => g.id === goalId)?.rootNodeId
  if (!rootId) return null
  const layout = nodeLayout(store).get(rootId)
  if (!layout) return null
  return `${DOCS_DIR}/${layout.dir.join('/')}/${IMAGES_DIR}`
}

export interface Loaded {
  mime: string
  /** 不含 data: 前缀的 base64 */
  data: string
  /** 完整的 data URL，界面里直接当 src 用 */
  url: string
}

/**
 * 读回来的图片缓存。上限 16 张：一张图几百 KB，留太多会白占几十 MB 内存；
 * 超了按插入顺序丢最老的（历史里最老的那些图，通常也已经滚出上下文了）。
 */
const CACHE_MAX = 16
const cache = new Map<string, Loaded>()
const inflight = new Map<string, Promise<Loaded | null>>()
const listeners = new Set<() => void>()

/** 订阅「有图读回来了」，界面据此重画缩略图；返回取消订阅函数 */
export function subscribeImages(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 缓存里已有的 data URL；没有就返回 null（界面显示占位，等 subscribeImages 通知） */
export function cachedImageUrl(image: MessageImage): string | null {
  return cache.get(image.rel)?.url ?? null
}

export function rememberImage(rel: string, loaded: Loaded): void {
  cache.delete(rel)
  cache.set(rel, loaded)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  for (const cb of listeners) cb()
}

/** 缓存里已有的那张图（同步取，渲染时用）；没有就返回 null */
export function loadedImage(rel: string): Loaded | null {
  return cache.get(rel) ?? null
}

/** 读一张图（带缓存与并发去重）。文件不在了返回 null——消息照发，只是没有这张图 */
export function loadImageData(image: MessageImage): Promise<Loaded | null> {
  const hit = cache.get(image.rel)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(image.rel)
  if (pending) return pending
  const task = (async (): Promise<Loaded | null> => {
    // image.rel 是「相对当前用户」的路径（docs/…），前缀由 storage 那一层补
    const url = await readUserImage(image.rel)
    if (!url) return null
    const comma = url.indexOf(',')
    const header = url.slice(5, comma)
    const loaded: Loaded = {
      mime: header.replace(/;base64$/, '') || image.mime,
      data: url.slice(comma + 1),
      url,
    }
    rememberImage(image.rel, loaded)
    return loaded
  })()
  inflight.set(image.rel, task)
  void task.finally(() => inflight.delete(image.rel))
  return task
}

/**
 * 把一段历史里引用到的图全部读进缓存，返回 id → 片段数据的表。
 * 送模型前调用（见 learn/useAgent 的 runTurn）：只有整段历史都带图，
 * 模型才看得见前几轮聊的那张图。
 */
export async function loadImagesFor(
  messages: ConversationMessage[],
): Promise<Map<string, { mime: string; data: string }>> {
  const all: MessageImage[] = []
  for (const m of messages) {
    for (const img of m.images ?? []) all.push(img)
    /**
     * 工具附带回的图（Agent 用 res.read 看的那张）也要读回来：
     * 历史还原时它们同样是「工具结果之后那一条 user 消息」里的图片片段。
     */
    for (const p of m.parts) {
      if (p.type === 'tool' && p.images) all.push(...p.images)
    }
  }
  return loadImagesById(all)
}

/** 按引用把字节读回来（带缓存与并发去重）；读不到的条目不出现在结果里 */
export async function loadImagesById(
  images: MessageImage[],
): Promise<Map<string, { mime: string; data: string }>> {
  const wanted = new Map<string, MessageImage>()
  for (const img of images) wanted.set(img.id, img)
  const out = new Map<string, { mime: string; data: string }>()
  await Promise.all(
    [...wanted.values()].map(async (img) => {
      const loaded = await loadImageData(img)
      if (loaded) out.set(img.id, { mime: loaded.mime, data: loaded.data })
    }),
  )
  return out
}

/* ---------- 归一化（转存时由 learn/static 调用） ---------- */

/**
 * 把一张图规范化：长边超过 MAX_EDGE 或体积偏大就缩放重编码，否则原样保留。
 *
 * 保留原样这一条不是省事：截图里的文字被重新编码一次就会发糊，
 * 而截图往往本来就压得很好。
 */
export async function normalizeImage(
  file: Blob,
): Promise<{ blob: Blob; mime: string; width: number; height: number } | { error: string }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { error: t('这个文件不是能识别的图片') }
  }
  const width = bitmap.width
  const height = bitmap.height
  const mime = file.type || 'image/png'
  const longest = Math.max(width, height)
  if (longest <= MAX_EDGE && file.size <= KEEP_ORIGINAL_BYTES) {
    bitmap.close()
    return { blob: file, mime, width, height }
  }
  const scale = Math.min(1, MAX_EDGE / longest)
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return { error: t('当前环境无法缩放图片') }
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, REENCODE_MIME, 0.92),
  )
  // 重编码反而更大（本来就压得很好的小图）：用原来的
  if (!blob || blob.size >= file.size) return { blob: file, mime, width, height }
  return { blob, mime: REENCODE_MIME, width: w, height: h }
}

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(t('读取图片失败')))
    reader.readAsDataURL(blob)
  })

/* ---------- 清 ---------- */

/**
 * 删掉这个目标里没人再引用的图片。
 *
 * 删除消息 / 删除对话之后调用：图片是独立文件，跟着消息走的只有一条引用，
 * 引用没了文件不会自己消失。判据是「全store 的所有对话里还有没有这条 rel」，
 * 而不是「这条消息还有没有图」——同一张图若被复制到别处，不能误删。
 */
export async function pruneImages(store: LearnStore, goalId: string): Promise<number> {
  const dir = goalImagesDir(store, goalId)
  if (!dir) return 0
  const alive = new Set<string>()
  for (const conv of store.conversations) {
    for (const m of conv.messages) for (const img of m.images ?? []) alive.add(img.rel)
  }
  const entries = await listUserDir(dir)
  let removed = 0
  for (const entry of entries) {
    if (entry.dir) continue
    const rel = `${dir}/${entry.name}`
    if (alive.has(rel)) continue
    if (await removeUserPath(rel)) removed++
  }
  // 目录空了就一并收掉：数据目录里不该留下一个空壳
  if (removed && (await listUserDir(dir)).length === 0) await removeUserPath(dir)
  return removed
}

/** 图片的体积说明，气泡与附件列表上都用（KB / MB） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}


