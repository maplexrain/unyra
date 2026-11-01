/**
 * videos 围栏：解析文档中的 ```videos 代码块为链路视频选集的展示组件。
 *
 * 语法格式：
 * ```videos
 * {{videoNodeUUID}}
 * {{ range }}
 * ```
 * 第一行：视频节点的 UUID。
 * 第二行：选集范围，例如 `1-20, 23, 29-30` 或 `all`。
 */
import { t } from '../i18n'
import type { PluginRenderContext } from './renderPlugins'

export interface VideoEpisodeItem {
  page: number
  title: string
  source?: string
  durationMs?: number
}

export interface VideoBlockData {
  videoTitle: string
  pluginName?: string
  episodes: VideoEpisodeItem[]
}

export interface VideoBlockHost {
  getVideoData: (videoNodeUuid: string) => Promise<VideoBlockData | null> | VideoBlockData | null
  onOpenEpisode: (videoNodeUuid: string, episode: VideoEpisodeItem) => void
}

let currentHost: VideoBlockHost | null = null
const hostListeners = new Set<() => void>()

export function setVideoBlockHost(host: VideoBlockHost | null): void {
  if (currentHost === host) return
  currentHost = host
  for (const cb of hostListeners) {
    try {
      cb()
    } catch (err) {
      console.warn('[videosBlock] host listener error', err)
    }
  }
}

export function videoBlockHost(): VideoBlockHost | null {
  return currentHost
}

export function subscribeVideoBlockHost(cb: () => void): () => void {
  hostListeners.add(cb)
  return () => {
    hostListeners.delete(cb)
  }
}

/**
 * 清洗模型或手写的视频节点 UUID，去除模板包裹 {{ }}、前缀（uuid:、videoNodeUUID:）及引号
 */
export function cleanVideoNodeUuid(raw: string): string {
  let s = (raw ?? '').trim()
  s = s.replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^\{\s*|\s*\}$/g, '')
  s = s.replace(/^(?:uuid|videoNodeUUID|videoNodeId|videoId|nodeId|video)\s*[:：]\s*/i, '')
  s = s.replace(/^["'`]|["'`]$/g, '').trim()
  if (s.toLowerCase() === 'videonodeuuid') return ''
  return s
}

/**
 * 清洗选集范围字符串，去除模板包裹 {{ }}、前缀（range:、选集:）等
 */
export function cleanRangeText(raw: string): string {
  let s = (raw ?? '').trim()
  s = s.replace(/^\{\{\s*|\s*\}\}$/g, '').replace(/^\{\s*|\s*\}$/g, '')
  s = s.replace(/^(?:range|ranges|episodes|选集|范围)\s*[:：]\s*/i, '')
  return s.trim()
}

function isRangeOnly(str: string): boolean {
  const s = cleanRangeText(str).toLowerCase()
  if (!s || s === 'all' || s === '*') return true
  return /^[pp\d\s,~至到\-;；，]+$/i.test(s)
}

/**
 * 解析选集范围字符串：例如 `1-20, 23, 29-30` 或 `1~5, 8` 或 `all`
 */
export function parseEpisodeRange(rangeText: string): number[] | 'all' {
  const raw = cleanRangeText(rangeText)
  if (!raw || raw.toLowerCase() === 'all' || raw === '*') return 'all'

  // 按逗号、分号或空白分隔
  const tokens = raw.split(/[,，;；\s]+/).map((s) => s.trim()).filter(Boolean)
  const numbers = new Set<number>()

  for (const token of tokens) {
    // 匹配范围表达式如 1-20, 1~20, 1至20, 1到20, P1-P20
    const rangeMatch = token.match(/^[Pp]?(\d+)\s*[-~至到]\s*[Pp]?(\d+)$/)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      const min = Math.max(1, Math.min(start, end))
      const max = Math.max(start, end)
      for (let i = min; i <= max; i++) {
        numbers.add(i)
      }
      continue
    }

    // 匹配单个数字（支持 P1, p2）
    const singleMatch = token.match(/^[Pp]?(\d+)$/)
    if (singleMatch) {
      const n = parseInt(singleMatch[1], 10)
      if (n > 0) numbers.add(n)
    }
  }

  if (numbers.size === 0) return 'all'
  return Array.from(numbers).sort((a, b) => a - b)
}

/**
 * 解析 videos 围栏源码
 */
export function parseVideosBlock(source: string): {
  videoNodeUuid: string
  rangeText: string
  episodesRange: number[] | 'all'
} {
  const lines = source
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'))

  let line0 = lines[0] ?? ''
  let line1 = lines.slice(1).join(', ')

  // 容错：如果只有 1 行且这行是选集范围（如 1-20）
  if (lines.length === 1 && isRangeOnly(line0)) {
    line1 = line0
    line0 = ''
  } else if (lines.length >= 2 && isRangeOnly(line0) && !isRangeOnly(line1)) {
    // 容错：两行写反时互换
    const tmp = line0
    line0 = line1
    line1 = tmp
  }

  const videoNodeUuid = cleanVideoNodeUuid(line0)
  const rangeText = cleanRangeText(line1)
  const episodesRange = parseEpisodeRange(rangeText)

  return { videoNodeUuid, rangeText, episodesRange }
}

/**
 * 同步产出占位容器
 */
export function videosBlock(source: string, ctx: PluginRenderContext): string {
  const { videoNodeUuid, rangeText } = parseVideosBlock(source)

  return (
    `<div class="moji-videos-block my-3 rounded-xl border border-line/70 bg-surface/50 dark:bg-surface/30 p-3 shadow-xs" ` +
    `data-video-node="${ctx.attr(videoNodeUuid)}" data-range="${ctx.attr(rangeText)}">` +
    `<div class="moji-videos-placeholder flex items-center gap-2 text-xs text-ink-soft animate-pulse">` +
    `<svg class="w-4 h-4 animate-spin text-seal" fill="none" viewBox="0 0 24 24">` +
    `<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>` +
    `<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>` +
    `</svg>` +
    `<span>${ctx.escape(t('正在加载视频选集链路…'))}</span>` +
    `</div>` +
    `</div>`
  )
}

/** 内存缓存，避免频繁切页签或重渲染时重复解析 */
const videoDataCache = new Map<string, { data: VideoBlockData | null; at: number }>()
const inFlightRequests = new Map<string, Promise<VideoBlockData | null>>()
const CACHE_TTL_MS = 60_000
const CACHE_ERROR_TTL_MS = 3_000

/**
 * DOM 提交后异步挂载可交互的选集链路组件
 */
export function hydrateVideos(root: HTMLElement): () => void {
  let unsub: (() => void) | null = null

  const run = () => {
    const blocks = root.querySelectorAll<HTMLElement>('.moji-videos-block[data-video-node]')
    if (!blocks.length) return

    const host = videoBlockHost()
    if (!host) {
      if (!unsub) {
        unsub = subscribeVideoBlockHost(() => {
          run()
        })
      }
      return
    }

    if (unsub) {
      unsub()
      unsub = null
    }

    for (const block of blocks) {
      if (block.dataset.hydrated === 'true') continue

      const videoNodeUuid = block.dataset.videoNode ?? ''
      const rangeText = block.dataset.range ?? ''
      const episodesRange = parseEpisodeRange(rangeText)

      const renderData = (data: VideoBlockData | null) => {
        block.dataset.hydrated = 'true'
        if (!data) {
          block.innerHTML =
            `<div class="flex items-center gap-2 text-xs text-ink-faint">` +
            `<svg class="w-4 h-4 text-ink-faint shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="1.5"/><path stroke-width="1.5" d="m15 9-6 6m0-6 6 6"/></svg>` +
            `<span>${t('未找到绑定的视频资源或该视频暂无选集（节点：{0}）', (videoNodeUuid || '自动匹配').slice(0, 8))}</span>` +
            `</div>`
          return
        }

        const allEpisodes = data.episodes ?? []
        const matched =
          episodesRange === 'all'
            ? allEpisodes
            : allEpisodes.filter((ep) => episodesRange.includes(ep.page))

        if (!matched.length) {
          block.innerHTML =
            `<div class="flex flex-col gap-1 text-xs text-ink-soft">` +
            `<div class="font-medium text-ink">${t('视频：{0}', data.videoTitle)}</div>` +
            `<div class="text-[11px] text-ink-faint">${t('范围「{0}」未匹配到有效选集（该视频共 {1} 集）', rangeText || '全部', allEpisodes.length)}</div>` +
            `</div>`
          return
        }

        // 渲染卡片头部
        const headerHtml =
          `<div class="flex items-center justify-between gap-2 border-b border-line/50 pb-2 mb-2">` +
          `<div class="flex items-center gap-2 min-w-0">` +
          `<span class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-seal/15 text-seal-deep">` +
          `<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>` +
          `</span>` +
          `<span class="truncate text-xs font-semibold text-ink" title="${data.videoTitle}">${data.videoTitle}</span>` +
          `</div>` +
          `<span class="shrink-0 rounded bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">` +
          `${t('包含 {0} 讲', matched.length)}` +
          `</span>` +
          `</div>`

        // 渲染选集网格
        const grid = document.createElement('div')
        grid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-1.5'

        for (const ep of matched) {
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className =
            'group flex items-center gap-2 rounded-lg border border-line/60 bg-surface/80 px-2.5 py-1.5 text-left text-xs text-ink transition hover:border-seal/50 hover:bg-seal/[0.07] hover:text-seal-deep cursor-pointer'
          btn.title = t('点击播放：{0}', ep.title)

          const badge = document.createElement('span')
          badge.className =
            'flex h-4 min-w-5 px-1 items-center justify-center rounded bg-line/80 text-[10px] font-bold text-ink-soft group-hover:bg-seal/20 group-hover:text-seal-deep shrink-0'
          badge.textContent = `P${ep.page}`

          const titleSpan = document.createElement('span')
          titleSpan.className = 'truncate min-w-0 flex-1 font-medium'
          titleSpan.textContent = ep.title

          const playIcon = document.createElement('span')
          playIcon.className = 'opacity-0 group-hover:opacity-100 transition shrink-0 text-seal'
          playIcon.innerHTML = `<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>`

          btn.appendChild(badge)
          btn.appendChild(titleSpan)
          btn.appendChild(playIcon)

          btn.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            const liveHost = videoBlockHost()
            if (liveHost) {
              liveHost.onOpenEpisode(videoNodeUuid, ep)
            }
          })

          grid.appendChild(btn)
        }

        block.innerHTML = headerHtml
        block.appendChild(grid)
      }

      const cached = videoDataCache.get(videoNodeUuid)
      if (cached && Date.now() - cached.at < (cached.data ? CACHE_TTL_MS : CACHE_ERROR_TTL_MS)) {
        renderData(cached.data)
        continue
      }

      let p = inFlightRequests.get(videoNodeUuid)
      if (!p) {
        p = Promise.resolve(host.getVideoData(videoNodeUuid))
          .then((res) => {
            videoDataCache.set(videoNodeUuid, { data: res, at: Date.now() })
            return res
          })
          .catch((err) => {
            console.warn('[videosBlock] 加载选集失败', err)
            videoDataCache.set(videoNodeUuid, { data: null, at: Date.now() })
            return null
          })
          .finally(() => {
            inFlightRequests.delete(videoNodeUuid)
          })
        inFlightRequests.set(videoNodeUuid, p)
      }

      p.then((res) => {
        renderData(res)
      })
    }
  }

  run()

  return () => {
    if (unsub) {
      unsub()
      unsub = null
    }
  }
}

/**
 * 教学 Agent 的 videos 语法指引（用于系统提示词与指引）。
 */
export const VIDEOS_SYNTAX_GUIDE = `视频选集链路：用三个反引号 + videos 插入绑定视频节点的选集导航组件。
语法格式：
\`\`\`videos
{{videoNodeUUID}}
{{ range }}
\`\`\`
- 第一行必须是视频节点的 UUID（直接写目标视频节点实际的 uuid 字符串，即 target 参数）。
- 第二行是展示视频的选集范围，例如：1-20, 23, 29-30 或 all（单集写数字，区间用横杠连接，多个区间用逗号隔开）。`;
