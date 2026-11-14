import { historyField } from '@codemirror/commands'
import { EditorState, type Extension } from '@codemirror/state'

/**
 * CodeMirror 6 编辑器撤销栈持久化与防抖存储模块
 *
 * 核心设计：
 * 1. 深度持久化：使用 CodeMirror 官方规范的 historyField 序列化与反序列化，保留完整的 undo / redo 步数；
 * 2. 毫秒级防抖（Debounced Save）：在用户连续打字输入时重置防抖计时器，输入停顿 400ms 后静默落盘；
 * 3. 即时刷新（Flush）：在组件卸载或失焦时立即刷新未决数据，确保零丢步；
 * 4. 容错与容量保护：限制最多保留 150 步历史，并设有 LRU 自动淘汰机制，防止 localStorage 膨胀。
 */

const STORAGE_PREFIX = 'unyra:cm-hist:'
const LRU_KEY = 'unyra:cm-hist-lru'
const MAX_SAVED_ENTRIES = 50
const MAX_HISTORY_ITEMS = 150

interface SerializedHistoryPayload {
  version: number
  updatedAt: number
  history: any
  selection?: any
}

const pendingTimers = new Map<string, { timer: any; state: EditorState }>()

function safeGetLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage
    }
  } catch {
    // 忽略安全沙箱或无权限环境
  }
  return null
}

/** 更新 LRU 索引键 */
function updateLruIndex(key: string) {
  const storage = safeGetLocalStorage()
  if (!storage) return
  try {
    const raw = storage.getItem(LRU_KEY)
    let list: string[] = raw ? JSON.parse(raw) : []
    list = [key, ...list.filter((k) => k !== key)]
    if (list.length > MAX_SAVED_ENTRIES) {
      const evicted = list.slice(MAX_SAVED_ENTRIES)
      for (const k of evicted) {
        storage.removeItem(STORAGE_PREFIX + k)
      }
      list = list.slice(0, MAX_SAVED_ENTRIES)
    }
    storage.setItem(LRU_KEY, JSON.stringify(list))
  } catch {
    // 忽略异常
  }
}

/**
 * 直接保存编辑器的撤销栈状态
 */
export function saveEditorHistory(key: string, state: EditorState): void {
  if (!key) return
  const storage = safeGetLocalStorage()
  if (!storage) return

  try {
    const serialized = state.toJSON({ history: historyField })
    if (!serialized || !serialized.history) return

    const hist = serialized.history
    // 容量保护：截断过多的历史记录，仅保留最近 MAX_HISTORY_ITEMS 步
    if (Array.isArray(hist.done) && hist.done.length > MAX_HISTORY_ITEMS) {
      hist.done = hist.done.slice(hist.done.length - MAX_HISTORY_ITEMS)
    }
    if (Array.isArray(hist.undone) && hist.undone.length > MAX_HISTORY_ITEMS) {
      hist.undone = hist.undone.slice(hist.undone.length - MAX_HISTORY_ITEMS)
    }

    const payload: SerializedHistoryPayload = {
      version: 1,
      updatedAt: Date.now(),
      history: hist,
      selection: serialized.selection,
    }

    storage.setItem(STORAGE_PREFIX + key, JSON.stringify(payload))
    updateLruIndex(key)
  } catch {
    // 容错忽略（如超出 Quota 时）
  }
}

/**
 * 依据持久化历史恢复并创建 EditorState（若无有效历史则标准降级创建）
 */
export function createRestoredEditorState(
  doc: string,
  extensions: Extension[],
  historyData: any,
): EditorState {
  if (historyData) {
    try {
      const selection =
        historyData.selection || { ranges: [{ anchor: 0, head: 0 }], main: 0 }
      return EditorState.fromJSON(
        {
          doc,
          selection,
          history: historyData.history || historyData,
        },
        { extensions },
        { history: historyField },
      )
    } catch {
      // 容错降级
    }
  }
  return EditorState.create({ doc, extensions })
}

/**
 * 防抖保存撤销状态（默认 400ms）
 */
export function debouncedSaveEditorHistory(key: string, state: EditorState, delayMs = 400): void {
  if (!key) return
  const existing = pendingTimers.get(key)
  if (existing) {
    clearTimeout(existing.timer)
  }

  const timer = setTimeout(() => {
    pendingTimers.delete(key)
    saveEditorHistory(key, state)
  }, delayMs)

  pendingTimers.set(key, { timer, state })
}

/**
 * 立即刷新并落盘指定的（或全部）待写入撤销状态
 */
export function flushEditorHistory(key?: string): void {
  if (key) {
    const entry = pendingTimers.get(key)
    if (entry) {
      clearTimeout(entry.timer)
      pendingTimers.delete(key)
      saveEditorHistory(key, entry.state)
    }
  } else {
    for (const [k, entry] of pendingTimers.entries()) {
      clearTimeout(entry.timer)
      saveEditorHistory(k, entry.state)
    }
    pendingTimers.clear()
  }
}

/**
 * 读取已持久化的撤销栈历史数据
 */
export function loadEditorHistory(key: string): SerializedHistoryPayload | null {
  if (!key) return null
  const storage = safeGetLocalStorage()
  if (!storage) return null

  try {
    const raw = storage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const payload: SerializedHistoryPayload = JSON.parse(raw)
    if (payload && payload.history) {
      return payload
    }
  } catch {
    // 损坏数据容错
  }
  return null
}

/**
 * 清除指定文件的撤销栈缓存
 */
export function clearEditorHistory(key: string): void {
  if (!key) return
  const existing = pendingTimers.get(key)
  if (existing) {
    clearTimeout(existing.timer)
    pendingTimers.delete(key)
  }
  const storage = safeGetLocalStorage()
  if (storage) {
    storage.removeItem(STORAGE_PREFIX + key)
  }
}
