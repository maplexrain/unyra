/**
 * 公告配图缓存系统。
 *
 * 核心目的：
 * 公告内的图片通常托管在 GitHub Pages 或外部 CDN 上（如 https://maplexrain.github.io/unyra-notice/images/...），
 * 在国内或网络不稳定环境下极易遇到超时、裂图或长期加载不出的问题。
 *
 * 方案设计：
 * 1. 【内存 + 磁盘二级缓存】：
 *    - 内存中用 Map 维护已加载的 base64 data URL，极速秒开；
 *    - 磁盘利用主进程 notice-image-cache/ 持久化存储（与 global.yaml 同源，重启与离线依然可用）；
 * 2. 【静默后台预加载】：
 *    - 启动时拉取到 notice 列表后，自动对所有公告内容中的图片发起静默预加载并缓存到本地；
 * 3. 【渲染时无缝代换】：
 *    - NoticeDialog 渲染 Markdown 前，将已命中的远程图片地址直接替换为本地 data URL；
 *    - 若尚未缓存完成，边以原地址降级渲染，边由主进程 fetchBinary（自带反爬与重试）拉取并落盘，
 *      一旦拿到即通过响应式总线自动无缝刷新为高质量本地缓存。
 */
import { useEffect, useState } from 'react'
import { isElectron, native } from './native'
import type { RemoteNotice } from './notice'

/* ---------- 纯函数：提取与替换图片地址 ---------- */

/** 判定是否为远程 HTTP/HTTPS 地址 */
export function isRemoteHttpUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  return /^https?:\/\//i.test(url.trim())
}

/**
 * 从 Markdown 文本中提取所有远程配图地址（去重）。
 * 覆盖 Markdown 语法 `![alt](url)`、带标题的 `![alt](url "title")` 以及 HTML `<img src="url">`。
 */
export function extractNoticeImageUrls(markdown: string): string[] {
  if (!markdown || typeof markdown !== 'string') return []
  const urls: string[] = []

  // 1. Markdown 图片语法：![alt](url "title")
  const mdImgRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  let match: RegExpExecArray | null
  while ((match = mdImgRegex.exec(markdown)) !== null) {
    const raw = match[1]?.trim()
    if (raw && isRemoteHttpUrl(raw)) {
      urls.push(raw)
    }
  }

  // 2. HTML <img> 标签语法
  const htmlImgRegex = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi
  while ((match = htmlImgRegex.exec(markdown)) !== null) {
    const raw = match[1]?.trim()
    if (raw && isRemoteHttpUrl(raw)) {
      urls.push(raw)
    }
  }

  return Array.from(new Set(urls))
}

/**
 * 将 Markdown 内容中已缓存的远程图片地址替换为本地 data URL。
 * 未缓存的地址保持原状，确保不影响初次或网络良好时的正常显示。
 */
export function injectCachedNoticeImages(
  markdown: string,
  cacheMap: Map<string, string> | Record<string, string>,
): string {
  if (!markdown || typeof markdown !== 'string') return ''
  const getCache = (url: string): string | undefined => {
    if (cacheMap instanceof Map) return cacheMap.get(url)
    return cacheMap[url]
  }

  // 1. 替换 Markdown 里的图片语法
  let res = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+["'][^"']*["'])?\)/g,
    (full, alt, rawUrl, title) => {
      const u = (rawUrl as string).trim()
      const cached = getCache(u)
      if (cached) {
        return `![${alt}](${cached}${title || ''})`
      }
      return full
    },
  )

  // 2. 替换 HTML <img> 的 src
  res = res.replace(
    /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi,
    (full, prefix, rawUrl, suffix) => {
      const u = (rawUrl as string).trim()
      const cached = getCache(u)
      if (cached) {
        return `${prefix}${cached}${suffix}`
      }
      return full
    },
  )

  return res
}

/* ---------- 缓存管理与网络拉取 ---------- */

const memoryCache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()
type CacheListener = (url: string, dataUrl: string) => void
const listeners = new Set<CacheListener>()

export function subscribeNoticeImageCache(listener: CacheListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifySubscribers(url: string, dataUrl: string): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn(url, dataUrl)
    } catch {
      // 订阅者内部错误不扩散
    }
  }
}

/** 供测试与调试用的内存缓存操作 */
export function getNoticeImageMemCache(): Map<string, string> {
  return memoryCache
}
export function setNoticeImageMemCache(url: string, dataUrl: string): void {
  memoryCache.set(url.trim(), dataUrl)
  notifySubscribers(url.trim(), dataUrl)
}
export function clearNoticeImageMemCache(): void {
  memoryCache.clear()
}

/**
 * 获取或抓取单张公告图片：
 * 1. 优先读内存缓存；
 * 2. 其次读磁盘缓存（native.notice.getCachedImage）；
 * 3. 都没有则启动抓取（优先主进程 fetchBinary，回退 web fetch），
 *    抓取成功后同时存入内存与磁盘缓存并通知监听器。
 */
export async function getOrFetchNoticeImage(rawUrl: string): Promise<string | null> {
  const url = rawUrl.trim()
  if (!isRemoteHttpUrl(url)) return null

  // 1. 内存命中
  const mem = memoryCache.get(url)
  if (mem) return mem

  // 2. 并发防重（同一 URL 仅执行一次 IO / 网络流程）
  const ongoing = inflight.get(url)
  if (ongoing) return ongoing

  const p = (async (): Promise<string | null> => {
    // 3. 检查磁盘缓存
    try {
      const diskCached = await native().notice?.getCachedImage?.(url)
      if (diskCached) {
        memoryCache.set(url, diskCached)
        notifySubscribers(url, diskCached)
        return diskCached
      }
    } catch {
      // 忽略磁盘读取异常
    }

    // 4. 网络拉取
    const dataUrl = await fetchImageDataUrl(url)
    if (dataUrl) {
      memoryCache.set(url, dataUrl)
      // 异步写磁盘，不阻塞返回
      void native()
        .notice?.cacheImage?.(url, dataUrl)
        .catch(() => {})
      notifySubscribers(url, dataUrl)
      return dataUrl
    }
    return null
  })().finally(() => {
    inflight.delete(url)
  })

  inflight.set(url, p)
  return p
}

/** 实际抓取图片并转为 data URL */
async function fetchImageDataUrl(url: string): Promise<string | null> {
  // A. Electron 主进程通道（绕过 CORS、带重试与 User-Agent 伪装）
  try {
    if (isElectron() && native().web?.fetchBinary) {
      const res = await native().web.fetchBinary(url)
      if (res.ok && res.dataUrl) {
        return res.dataUrl
      }
    }
  } catch {
    // 忽略并尝试降级
  }

  // B. Web 浏览器 fetch 降级（或纯网页模式）
  if (typeof fetch !== 'undefined') {
    try {
      const resp = await fetch(url)
      if (resp.ok) {
        const blob = await resp.blob()
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            resolve(typeof reader.result === 'string' ? reader.result : null)
          }
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
      }
    } catch {
      // 忽略网络异常
    }
  }

  return null
}

/**
 * 批量预加载多条公告中的所有图片。
 * 当公告列表刷新或应用启动时调用，静默在后台完成缓存。
 */
export async function precacheNoticeImages(notices: RemoteNotice[]): Promise<void> {
  if (!Array.isArray(notices) || !notices.length) return
  const allUrls = new Set<string>()
  for (const n of notices) {
    if (!n.enabled || !n.content) continue
    for (const u of extractNoticeImageUrls(n.content)) {
      allUrls.add(u)
    }
  }

  if (!allUrls.size) return
  await Promise.allSettled(Array.from(allUrls).map((url) => getOrFetchNoticeImage(url)))
}

/* ---------- React Hook：供 NoticeDialog 渲染订阅 ---------- */

export function useNoticeContent(rawContent: string | null | undefined): {
  resolvedContent: string
  cachedMap: Map<string, string>
  loadingImages: boolean
} {
  const content = rawContent ?? ''
  const [, setTick] = useState(0)

  // 提取当前内容中的所有图片 URL
  const urls = extractNoticeImageUrls(content)

  useEffect(() => {
    if (!urls.length) return

    // 检查是否有尚未加载完成的图片，有则在后台逐个请求
    for (const u of urls) {
      if (!memoryCache.has(u)) {
        void getOrFetchNoticeImage(u)
      }
    }

    // 监听缓存到达事件，如果到达的是当前内容的图片，触发重渲染
    const unsub = subscribeNoticeImageCache((url) => {
      if (urls.includes(url)) {
        setTick((t) => t + 1)
      }
    })
    return unsub
  }, [content, urls.join('|')])

  // 构建当前已命中的缓存映射
  const cachedMap = new Map<string, string>()
  let missing = false
  for (const u of urls) {
    const dataUrl = memoryCache.get(u)
    if (dataUrl) {
      cachedMap.set(u, dataUrl)
    } else {
      missing = true
    }
  }

  const resolvedContent = injectCachedNoticeImages(content, cachedMap)

  return {
    resolvedContent,
    cachedMap,
    loadingImages: urls.length > 0 && missing,
  }
}
