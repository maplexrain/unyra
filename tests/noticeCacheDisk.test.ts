import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  getCachedNoticeImage,
  saveCachedNoticeImage,
  clearNoticeImageCache,
  getNoticeImageCacheDir,
  hashNoticeImageUrl,
} from '../electron/storage/noticeCache'
import { setUserDataDir } from '../electron/storage/userData'

describe('noticeCacheDisk 主进程磁盘缓存', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'unyra-notice-test-'))
    setUserDataDir(tmpDir)
  })

  afterEach(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // 忽略清理临时目录错误
    }
  })

  it('未缓存的 URL 读取返回 null', async () => {
    const res = await getCachedNoticeImage('https://example.com/not-cached.png')
    expect(res).toBeNull()
  })

  it('写入缓存后能正确读取出来', async () => {
    const url = 'https://maplexrain.github.io/unyra-notice/images/banner.png'
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

    const saved = await saveCachedNoticeImage(url, dataUrl)
    expect(saved).toBe(true)

    const readBack = await getCachedNoticeImage(url)
    expect(readBack).toBe(dataUrl)

    // 验证文件实际存在于磁盘上
    const hash = hashNoticeImageUrl(url)
    const fileOnDisk = path.join(getNoticeImageCacheDir(), `${hash}.json`)
    const exists = await fsp.stat(fileOnDisk).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('清空缓存 clearNoticeImageCache 能删除缓存目录', async () => {
    const url = 'https://example.com/test.png'
    const dataUrl = 'data:image/png;base64,abc123'
    await saveCachedNoticeImage(url, dataUrl)

    const cleared = await clearNoticeImageCache()
    expect(cleared).toBe(true)

    const readAfterClear = await getCachedNoticeImage(url)
    expect(readAfterClear).toBeNull()
  })

  it('非法参数输入不抛异常并返回 false / null', async () => {
    expect(await saveCachedNoticeImage('', 'data:image/png;base64,123')).toBe(false)
    expect(await saveCachedNoticeImage('https://example.com/x.png', 'invalid-data')).toBe(false)
    expect(await getCachedNoticeImage('')).toBeNull()
    expect(await getCachedNoticeImage(null)).toBeNull()
  })
})
