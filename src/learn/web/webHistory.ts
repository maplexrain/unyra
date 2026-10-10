/**
 * 内置浏览器历史记录管理：存储在 localStorage，供地址栏实时搜索与自动补全。
 */

export interface WebHistoryEntry {
  url: string
  title: string
  favicon?: string
  lastVisited: number
  visitCount: number
}

const STORAGE_KEY = 'moji:web:history'
const MAX_HISTORY_ENTRIES = 500

function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage
    }
  } catch {
    // ignore
  }
  return null
}

/** 读取全部历史记录（按最近访问倒序） */
export function loadWebHistory(): WebHistoryEntry[] {
  try {
    const storage = getStorage()
    if (!storage) return []
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is WebHistoryEntry => {
      return (
        item &&
        typeof item === 'object' &&
        typeof item.url === 'string' &&
        typeof item.title === 'string' &&
        typeof item.lastVisited === 'number'
      )
    })
  } catch {
    return []
  }
}

/** 保存历史记录到 localStorage */
function saveWebHistory(entries: WebHistoryEntry[]): void {
  try {
    const storage = getStorage()
    if (!storage) return
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)))
  } catch {
    // 忽略存储超额异常
  }
}

/** 记录一次访问或更新标题/图标 */
export function recordWebHistory(url: string, title?: string, favicon?: string): void {
  const trimmedUrl = url.trim()
  if (!trimmedUrl || !/^https?:\/\//i.test(trimmedUrl)) return

  const list = loadWebHistory()
  const existingIndex = list.findIndex((x) => x.url === trimmedUrl)
  const now = Date.now()

  if (existingIndex >= 0) {
    const existing = list[existingIndex]
    const updated: WebHistoryEntry = {
      ...existing,
      title: title?.trim() || existing.title || trimmedUrl,
      favicon: favicon || existing.favicon,
      lastVisited: now,
      visitCount: (existing.visitCount || 1) + 1,
    }
    // 移到最前
    list.splice(existingIndex, 1)
    list.unshift(updated)
  } else {
    const newEntry: WebHistoryEntry = {
      url: trimmedUrl,
      title: title?.trim() || trimmedUrl,
      favicon,
      lastVisited: now,
      visitCount: 1,
    }
    list.unshift(newEntry)
  }

  saveWebHistory(list)
}

/** 仅更新某个已存在网页的标题或图标（不重复累加 visitCount） */
export function updateWebHistoryMeta(url: string, meta: { title?: string; favicon?: string }): void {
  const trimmedUrl = url.trim()
  if (!trimmedUrl) return

  const list = loadWebHistory()
  const target = list.find((x) => x.url === trimmedUrl)
  if (!target) return

  let changed = false
  if (meta.title && meta.title.trim() && target.title !== meta.title.trim()) {
    target.title = meta.title.trim()
    changed = true
  }
  if (meta.favicon && target.favicon !== meta.favicon) {
    target.favicon = meta.favicon
    changed = true
  }

  if (changed) {
    saveWebHistory(list)
  }
}

/** 根据输入关键词匹配历史记录 */
export function searchWebHistory(query: string, maxResults = 8): WebHistoryEntry[] {
  const q = query.trim().toLowerCase()
  const list = loadWebHistory()
  if (!q) return list.slice(0, maxResults)

  return list
    .filter((item) => {
      const urlMatch = item.url.toLowerCase().includes(q)
      const titleMatch = item.title.toLowerCase().includes(q)
      return urlMatch || titleMatch
    })
    .sort((a, b) => {
      // 优先前缀命中
      const aUrlStarts = a.url.toLowerCase().startsWith(q) || a.url.toLowerCase().replace(/^https?:\/\//, '').startsWith(q)
      const bUrlStarts = b.url.toLowerCase().startsWith(q) || b.url.toLowerCase().replace(/^https?:\/\//, '').startsWith(q)
      if (aUrlStarts && !bUrlStarts) return -1
      if (!aUrlStarts && bUrlStarts) return 1

      // 其次访问次数
      if ((b.visitCount || 1) !== (a.visitCount || 1)) {
        return (b.visitCount || 1) - (a.visitCount || 1)
      }
      return b.lastVisited - a.lastVisited
    })
    .slice(0, maxResults)
}

/** 删除单条历史记录 */
export function removeWebHistoryEntry(url: string): void {
  const list = loadWebHistory().filter((x) => x.url !== url)
  saveWebHistory(list)
}

/** 清空全部历史记录 */
export function clearAllWebHistory(): void {
  try {
    const storage = getStorage()
    if (!storage) return
    storage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略异常
  }
}
