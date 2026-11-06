/**
 * 「赞助者名单」页签打开器与动态名单数据拉取。
 *
 * 核心目标：
 * 1. 供顶栏赞助按钮、设置页等处在应用内直接打开致谢名单页签。
 * 2. 动态拉取项目仓库 docs/sponsors.md 最新内容，更新名单无需重新打包客户端；
 * 3. 包含本地缓存与内置兜底，断网或无网络环境下依然秒开。
 */

import defaultSponsorsMarkdown from '../../docs/sponsors.md?raw'
import { native } from './native'

/** 远程仓库中赞助者名单的权威抓取地址（主地址 + 镜像源） */
export const SPONSORS_REPO_URLS = [
  'https://raw.githubusercontent.com/maplexrain/unyra/main/docs/sponsors.md',
  'https://ghproxy.net/https://raw.githubusercontent.com/maplexrain/unyra/main/docs/sponsors.md',
  'https://cdn.jsdelivr.net/gh/maplexrain/unyra@main/docs/sponsors.md',
]

export const SPONSORS_CACHE_KEY = 'unyra_sponsors_md_cache'

let opener: (() => void) | null = null

export function setSponsorsOpener(fn: (() => void) | null): void {
  opener = fn
}

/** 打开赞助者名单页签（若未挂载则静默） */
export function openSponsorsTab(): void {
  opener?.()
}

/** 校验是否为合法的赞助者名单 Markdown 文本 */
export function isValidSponsorMarkdown(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  return (
    trimmed.length > 20 &&
    (trimmed.includes('赞助者名单') || trimmed.includes('赞助者') || trimmed.includes('特别致谢'))
  )
}

/** 获取初始渲染用的 Markdown（优先本地缓存，若无则使用内置构建兜底） */
export function getInitialSponsorsMarkdown(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const cached = localStorage.getItem(SPONSORS_CACHE_KEY)
      if (cached && isValidSponsorMarkdown(cached)) {
        return cached
      }
    }
  } catch {}
  return defaultSponsorsMarkdown
}

/** 尝试通过指定单一 URL 拉取名单（含超时熔断） */
async function fetchOneUrl(url: string, timeoutMs = 4000): Promise<string | null> {
  const cacheBuster = `${url.includes('?') ? '&' : '?'}_t=${Date.now()}`
  const targetUrl = `${url}${cacheBuster}`

  // 1. 优先通过主进程 web.fetch（在 Electron 桌面端原生绕过 CORS 并附带浏览器 UA）
  try {
    const res = await Promise.race([
      native().web.fetch(targetUrl),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    if (res && res.ok && typeof res.text === 'string' && isValidSponsorMarkdown(res.text)) {
      return res.text
    }
  } catch {}

  // 2. 兜底通过环境原生的 fetch（Web 浏览器模式或单元测试环境）
  try {
    if (typeof fetch === 'function') {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
      try {
        const resp = await fetch(targetUrl, {
          signal: controller?.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        })
        if (resp.ok) {
          const text = await resp.text()
          if (isValidSponsorMarkdown(text)) {
            return text
          }
        }
      } finally {
        if (timer) clearTimeout(timer)
      }
    }
  } catch {}

  return null
}

export interface FetchSponsorsResult {
  ok: boolean
  content: string
  fromRemote: boolean
  error?: string
}

/**
 * 从远程项目仓库拉取最新的 docs/sponsors.md。
 * 成功拉取后会自动持久化至本地 localStorage 缓存。
 */
export async function fetchLatestSponsorsMarkdown(customUrls?: string[]): Promise<FetchSponsorsResult> {
  const urls = customUrls || SPONSORS_REPO_URLS

  for (const url of urls) {
    try {
      const text = await fetchOneUrl(url)
      if (text) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SPONSORS_CACHE_KEY, text)
          }
        } catch {}
        return { ok: true, content: text, fromRemote: true }
      }
    } catch {}
  }

  // 远程拉取全部失败，回退到本地缓存或内置包
  const fallback = getInitialSponsorsMarkdown()
  return {
    ok: false,
    content: fallback,
    fromRemote: false,
    error: '远程拉取失败，已使用本地缓存',
  }
}

export interface SponsorItem {
  name: string
  channel: string
  date: string
}

/**
 * 解析 docs/sponsors.md 中的赞助者表格行，返回结构化列表。
 * 自适应识别表头列名，并对 Markdown 格式（如 **加粗**、链接）做清洗。
 */
export function parseSponsorsMarkdown(md: string): SponsorItem[] {
  if (typeof md !== 'string') return []
  const lines = md.split(/\r?\n/)
  const items: SponsorItem[] = []
  let tableStarted = false
  let nameCol = 0
  let channelCol = 1
  let dateCol = 2

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 遇到下一个章节标题时结束表格扫描
    if (tableStarted && trimmed.startsWith('#')) {
      tableStarted = false
      continue
    }

    if (trimmed.includes('|')) {
      const rawCells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      if (rawCells.length >= 2) {
        // 检查是否为表头
        if (rawCells.some((c) => c.includes('赞助') || c.includes('特别致谢') || c.includes('姓名'))) {
          tableStarted = true
          const idxName = rawCells.findIndex((c) => c.includes('赞助') || c.includes('名') || c.includes('称呼'))
          const idxChan = rawCells.findIndex((c) => c.includes('渠道') || c.includes('平台') || c.includes('方式'))
          const idxDate = rawCells.findIndex((c) => c.includes('日') || c.includes('时间'))
          if (idxName !== -1) nameCol = idxName
          if (idxChan !== -1) channelCol = idxChan
          if (idxDate !== -1) dateCol = idxDate
          continue
        }
        // 分割线 | :--- | :--- |
        if (rawCells.every((c) => /^:?-+:?$/.test(c))) {
          tableStarted = true
          continue
        }
        // 数据行
        if (tableStarted) {
          const clean = (val: string | undefined) =>
            (val || '').replace(/^\*+|\*+$/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').trim()
          const name = clean(rawCells[nameCol])
          if (!name) continue
          const channel = clean(rawCells[channelCol]) || '微信赞赏'
          const date = clean(rawCells[dateCol]) || ''
          items.push({ name, channel, date })
        }
      }
    }
  }
  return items
}
