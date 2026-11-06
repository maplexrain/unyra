/**
 * 视频超链接协议与解析系统：
 * - 协议：`moji:video` 或 `moji:video/<videoId>?p=<page>&t=<time>`
 * - 用于在文档、笔记或交互组件中点击直接跳转到视频的特定选集（分 P）与时间坐标。
 *
 * 语法支持格式：
 * 1. `moji:video?p=2&t=01:23`（当前视频第 2 选集，01:23 时间点）
 * 2. `moji:video?t=01:23`（当前视频 01:23 时间点）
 * 3. `moji:video/<videoId>?p=2&t=01:23`（指定视频资源第 2 选集，01:23 时间点）
 * 4. 时间格式支持：`01:23`（分:秒）、`01:23:45`（时:分:秒）、`83` 或 `83s`（秒数）、`83000ms`（毫秒数）。
 */

import { formatClock } from '../video/transcript'

export const VIDEO_LINK_SCHEME = 'moji:video'

export interface VideoJumpTarget {
  /** 视频资源 id 或 视频节点 id（可选，缺省表示当前视频） */
  videoId?: string
  /** 视频节点 id（可选） */
  videoNodeId?: string
  /** 选集编号（1-based 序号，例如 1 表示 P1，2 表示 P2） */
  page?: number
  /** 时间坐标（毫秒数） */
  timeMs?: number
  /** 原始时间字符串（如 "01:23"） */
  rawTime?: string
}

/**
 * 将时间字符串解析为毫秒数
 * - "01:23" -> 83000
 * - "01:23:45" -> 5025000
 * - "83" / "83s" -> 83000
 * - "83000ms" -> 83000
 */
export function parseTimeStringToMs(raw: string): number | null {
  const str = raw.trim().toLowerCase()
  if (!str) return null

  // 1. 毫秒格式：83000ms
  if (str.endsWith('ms')) {
    const num = Number(str.slice(0, -2))
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : null
  }

  // 2. 秒格式：83s
  if (str.endsWith('s')) {
    const num = Number(str.slice(0, -1))
    return Number.isFinite(num) && num >= 0 ? Math.round(num * 1000) : null
  }

  // 3. 时钟冒号格式：MM:SS 或 HH:MM:SS
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => Number(p.trim()))
    if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null
    if (parts.length === 2) {
      const [m, s] = parts
      return Math.round((m * 60 + s) * 1000)
    }
    if (parts.length === 3) {
      const [h, m, s] = parts
      return Math.round((h * 3600 + m * 60 + s) * 1000)
    }
    return null
  }

  // 4. 纯数字（若小于 10000 默认为秒，否则直接作为毫秒）
  const num = Number(str)
  if (Number.isFinite(num) && num >= 0) {
    return num < 10000 ? Math.round(num * 1000) : Math.round(num)
  }

  return null
}

/**
 * 判断 href 是否是 moji:video 协议链接
 */
export function isVideoHref(href: string | null | undefined): boolean {
  if (!href) return false
  const h = href.trim().toLowerCase()
  return h === VIDEO_LINK_SCHEME || h.startsWith(`${VIDEO_LINK_SCHEME}?`) || h.startsWith(`${VIDEO_LINK_SCHEME}/`) || h.startsWith(`${VIDEO_LINK_SCHEME}#`)
}

/**
 * 解析 moji:video 协议的 href
 */
export function parseVideoHref(href: string | null | undefined): VideoJumpTarget | null {
  if (!isVideoHref(href)) return null
  const raw = href!.trim()
  const pathAndQuery = raw.slice(VIDEO_LINK_SCHEME.length)

  let pathPart = ''
  let queryPart = ''
  let hashPart = ''

  // 提取 hash 与 query
  const hashIdx = pathAndQuery.indexOf('#')
  let beforeHash = pathAndQuery
  if (hashIdx >= 0) {
    beforeHash = pathAndQuery.slice(0, hashIdx)
    hashPart = pathAndQuery.slice(hashIdx + 1)
  }

  const queryIdx = beforeHash.indexOf('?')
  if (queryIdx >= 0) {
    pathPart = beforeHash.slice(0, queryIdx)
    queryPart = beforeHash.slice(queryIdx + 1)
  } else {
    pathPart = beforeHash
  }

  // 清洗 pathPart：例如 /v123 或 /p2
  pathPart = pathPart.replace(/^\/+/, '').trim()

  const target: VideoJumpTarget = {}

  // 1. 从 path 中分析 videoId / videoNodeId 或 p<N>
  if (pathPart) {
    const pMatch = pathPart.match(/^p(\d+)$/i)
    if (pMatch) {
      target.page = Number(pMatch[1])
    } else {
      target.videoId = decodeURIComponent(pathPart)
    }
  }

  // 2. 从 query 参数中提取 p, page, t, time
  if (queryPart) {
    try {
      const params = new URLSearchParams(queryPart)
      const pVal = params.get('p') || params.get('page')
      if (pVal) {
        const pNum = Number(pVal.replace(/^p/i, ''))
        if (Number.isFinite(pNum) && pNum > 0) target.page = pNum
      }

      const tVal = params.get('t') || params.get('time')
      if (tVal) {
        target.rawTime = tVal
        const ms = parseTimeStringToMs(tVal)
        if (ms !== null) target.timeMs = ms
      }

      const idVal = params.get('id') || params.get('videoId')
      if (idVal && !target.videoId) {
        target.videoId = idVal
      }
    } catch {}
  }

  // 3. 从 hash 中补充时间或选集（例如 #01:23 或 #t=01:23 或 #p2）
  if (hashPart) {
    const cleanHash = decodeURIComponent(hashPart).trim()
    const pMatch = cleanHash.match(/^p(\d+)$/i)
    if (pMatch && !target.page) {
      target.page = Number(pMatch[1])
    } else {
      const tMatch = cleanHash.match(/^(?:t=)?([0-9:]+[a-z]*)$/i)
      if (tMatch && target.timeMs === undefined) {
        target.rawTime = tMatch[1]
        const ms = parseTimeStringToMs(tMatch[1])
        if (ms !== null) target.timeMs = ms
      }
    }
  }

  return target
}

/**
 * 构造标准 moji:video 协议 href
 */
export function videoLinkHref(opts: {
  videoId?: string
  videoNodeId?: string
  page?: number
  timeMs?: number
}): string {
  const base = opts.videoNodeId
    ? `${VIDEO_LINK_SCHEME}/${encodeURIComponent(opts.videoNodeId)}`
    : opts.videoId
      ? `${VIDEO_LINK_SCHEME}/${encodeURIComponent(opts.videoId)}`
      : VIDEO_LINK_SCHEME

  const params = new URLSearchParams()
  if (opts.page !== undefined && opts.page > 0) {
    params.set('p', String(opts.page))
  }
  if (opts.timeMs !== undefined && opts.timeMs >= 0) {
    params.set('t', formatClock(opts.timeMs))
  }

  const query = params.toString().replace(/%3A/gi, ':')
  return query ? `${base}?${query}` : base
}

/**
 * 构造用于插入 Markdown 笔记的超链接文本
 * 例如：`[P2 01:23](moji:video?p=2&t=01:23)` 或 `[01:23](moji:video?t=01:23)`
 */
export function videoLinkMarkdown(opts: {
  label?: string
  page?: number
  timeMs: number
  videoId?: string
  videoNodeId?: string
}): string {
  const clock = formatClock(opts.timeMs)
  const defaultLabel = opts.page !== undefined && opts.page > 0 ? `P${opts.page} ${clock}` : clock
  const text = opts.label || defaultLabel
  const href = videoLinkHref({
    page: opts.page,
    timeMs: opts.timeMs,
    videoId: opts.videoId,
    videoNodeId: opts.videoNodeId,
  })
  return `[${text}](${href})`
}

/** 视频链接点击跳转处理注册表 */
let videoHandler: ((target: VideoJumpTarget) => void) | null = null

export function setVideoLinkHandler(fn: ((target: VideoJumpTarget) => void) | null): () => void {
  videoHandler = fn
  return () => {
    if (videoHandler === fn) {
      videoHandler = null
    }
  }
}

export function handleVideoLink(input: VideoJumpTarget | string): boolean {
  const target = typeof input === 'string' ? parseVideoHref(input) : input
  if (!target) return false
  if (videoHandler) {
    videoHandler(target)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('moji:video:jump', { detail: target }))
  }
  return true
}

/** 从一次点击事件里解析 moji:video 链接并触发跳转；返回是否命中 */
export function tryVideoLinkFromEvent(event: { target: EventTarget | null }): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  const anchor = target.closest('a[href^="moji:video"], a[href^="MOJI:VIDEO"]')
  if (!anchor) return false
  const href = anchor.getAttribute('href')
  const parsed = parseVideoHref(href)
  if (!parsed) return false
  handleVideoLink(parsed)
  return true
}
