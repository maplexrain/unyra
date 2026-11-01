/**
 * 公告配图磁盘缓存（主进程侧）。
 *
 * 为什么要缓存公告图片：
 * 公告里的图片来自外部图床或 GitHub Pages（如 https://maplexrain.github.io/unyra-notice/images/...），
 * 国内或弱网环境下直接通过网络每次加载极易发生超时、裂图甚至长期加载不出来。
 *
 * 缓存策略：
 * 1. 落在用户数据目录的 notice-image-cache/ 子目录中（与 global.yaml 同源，跟机器走，跨用户共享）；
 * 2. 文件名为 URL 的 SHA-256 哈希值；
 * 3. 存储内容为 JSON { url, dataUrl, at }；
 * 4. 自动保留最近的 60 个缓存条目，超出时按最近修改时间修剪，保证磁盘开销可控。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { getUserDataDir } from './userData'

const CACHE_DIR_NAME = 'notice-image-cache'
const MAX_CACHED_FILES = 60

export function getNoticeImageCacheDir(): string {
  return path.join(getUserDataDir(), CACHE_DIR_NAME)
}

export function hashNoticeImageUrl(url: string): string {
  return crypto.createHash('sha256').update(url.trim()).digest('hex')
}

export async function getCachedNoticeImage(rawUrl: unknown): Promise<string | null> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null
  const url = rawUrl.trim()
  const hash = hashNoticeImageUrl(url)
  const filePath = path.join(getNoticeImageCacheDir(), `${hash}.json`)
  try {
    const text = await fsp.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(text) as { url?: string; dataUrl?: string }
    if (parsed && typeof parsed.dataUrl === 'string' && parsed.dataUrl.startsWith('data:')) {
      return parsed.dataUrl
    }
  } catch {
    // 文件不存在或已损坏
  }
  return null
}

export async function saveCachedNoticeImage(rawUrl: unknown, rawDataUrl: unknown): Promise<boolean> {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false
  if (typeof rawDataUrl !== 'string' || !rawDataUrl.startsWith('data:')) return false
  const url = rawUrl.trim()
  const dataUrl = rawDataUrl.trim()
  const hash = hashNoticeImageUrl(url)
  const dir = getNoticeImageCacheDir()
  const filePath = path.join(dir, `${hash}.json`)

  try {
    await fsp.mkdir(dir, { recursive: true })
    const payload = JSON.stringify({ url, dataUrl, at: Date.now() })
    await fsp.writeFile(filePath, payload, 'utf-8')
    void pruneNoticeCacheDir(dir).catch(() => {})
    return true
  } catch (err) {
    console.warn('[notice-cache] 写入公告图片缓存失败：', err)
    return false
  }
}

export async function clearNoticeImageCache(): Promise<boolean> {
  const dir = getNoticeImageCacheDir()
  try {
    await fsp.rm(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

async function pruneNoticeCacheDir(dir: string): Promise<void> {
  try {
    const files = await fsp.readdir(dir)
    if (files.length <= MAX_CACHED_FILES) return
    const fileStats = await Promise.all(
      files
        .filter((f) => f.endsWith('.json'))
        .map(async (f) => {
          const full = path.join(dir, f)
          const stat = await fsp.stat(full).catch(() => null)
          return { full, mtime: stat?.mtimeMs ?? 0 }
        }),
    )
    fileStats.sort((a, b) => a.mtime - b.mtime)
    const toRemove = fileStats.slice(0, fileStats.length - MAX_CACHED_FILES)
    for (const item of toRemove) {
      await fsp.unlink(item.full).catch(() => {})
    }
  } catch {
    // 忽略清理故障
  }
}
