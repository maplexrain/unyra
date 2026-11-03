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
  'https://cdn.jsdelivr.net/gh/maplexrain/unyra@main/docs/sponsors.md',
  'https://ghproxy.net/https://raw.githubusercontent.com/maplexrain/unyra/main/docs/sponsors.md',
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

/** 尝试通过指定单一 URL 拉取名单 */
async function fetchOneUrl(url: string): Promise<string | null> {
  const cacheBuster = `${url.includes('?') ? '&' : '?'}_t=${Date.now()}`
  const targetUrl = `${url}${cacheBuster}`

  // 1. 优先通过主进程 web.fetch（在 Electron 桌面端原生绕过 CORS 并附带浏览器 UA）
  try {
    const res = await native().web.fetch(targetUrl)
    if (res.ok && typeof res.text === 'string' && isValidSponsorMarkdown(res.text)) {
      return res.text
    }
  } catch {}

  // 2. 兜底通过环境原生的 fetch（Web 浏览器模式或单元测试环境）
  try {
    if (typeof fetch === 'function') {
      const resp = await fetch(targetUrl)
      if (resp.ok) {
        const text = await resp.text()
        if (isValidSponsorMarkdown(text)) {
          return text
        }
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
