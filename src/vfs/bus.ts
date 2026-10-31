/**
 * 响应式 VFS 总线（Reactive VFS Bus）。
 *
 * 核心机制：
 * 1. 0ms 乐观内存缓存（Read/Write-Through）；
 * 2. 基于 Hash 与时间戳的防回环拦截网（Anti-Echo Filter）；
 * 3. 实体级与路径级细粒度响应式订阅广播。
 */
import type { FileChangeEvent, FileChangeCallback } from './types'
import { matchEntity, normalizeRelativePath } from './registry'

/** 轻量快速字符串 Hash（用于防回环对比） */
export function quickHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(16)
}

interface RecentWrite {
  path: string
  hash: string
  timestamp: number
  txId: string
}

export class ReactiveVfsBus {
  /** 内存数据缓存：normalizedPath -> parsedData (LRU 封顶) */
  private cache = new Map<string, unknown>()

  /** 原始文本缓存：normalizedPath -> rawContent (LRU 封顶) */
  private rawCache = new Map<string, string>()

  /** 内存缓存最大条目上限，防止长时间运行导致老生代内存膨胀 */
  private static readonly MAX_CACHE_ENTRIES = 300

  private setRawCacheEntry(norm: string, rawStr: string): void {
    if (this.rawCache.has(norm)) {
      this.rawCache.delete(norm)
    }
    this.rawCache.set(norm, rawStr)
    while (this.rawCache.size > ReactiveVfsBus.MAX_CACHE_ENTRIES) {
      const oldest = this.rawCache.keys().next().value
      if (oldest === undefined) break
      this.rawCache.delete(oldest)
    }
  }

  private setCacheEntry(norm: string, data: unknown): void {
    if (this.cache.has(norm)) {
      this.cache.delete(norm)
    }
    this.cache.set(norm, data)
    while (this.cache.size > ReactiveVfsBus.MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  /** 获取当前 VFS 缓存指标 */
  public getCacheStats(): { dataCount: number; rawCount: number; maxEntries: number } {
    return {
      dataCount: this.cache.size,
      rawCount: this.rawCache.size,
      maxEntries: ReactiveVfsBus.MAX_CACHE_ENTRIES,
    }
  }

  /** 手动清空所有内存缓存 */
  public clearAllCache(): void {
    this.cache.clear()
    this.rawCache.clear()
  }

  /** 实体级订阅者：entityId -> Set<Callback> */
  private entityListeners = new Map<string, Set<FileChangeCallback>>()

  /** 路径级精确订阅者：normalizedPath -> Set<Callback> */
  private pathListeners = new Map<string, Set<FileChangeCallback>>()

  /** 全局通配订阅者 */
  private globalListeners = new Set<FileChangeCallback>()

  /** 近期自发写入队列（用于防回环拦截） */
  private recentWrites: RecentWrite[] = []

  /** 防回环时间窗口（毫秒） */
  private echoWindowMs = 3500

  constructor() {
    this.setupAutoPrune()
  }

  /**
   * 清理过期的防回环记录
   */
  private setupAutoPrune() {
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => {
        const now = Date.now()
        this.recentWrites = this.recentWrites.filter(
          (w) => now - w.timestamp < this.echoWindowMs,
        )
      }, 5000)
      if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof (timer as any).unref === 'function') {
        (timer as any).unref()
      }
    }
  }

  /**
   * 记录自发写入（打上防回环印记）
   */
  private recordSelfWrite(normPath: string, hash: string, txId: string) {
    this.recentWrites.push({
      path: normPath,
      hash,
      timestamp: Date.now(),
      txId,
    })
    // 保持队列体积紧凑
    if (this.recentWrites.length > 200) {
      this.recentWrites.shift()
    }
  }

  /**
   * 判断某个变动事件是否属于自发写入的回声（Echo）
   */
  public isEcho(rawPath: string, content?: string): boolean {
    const norm = normalizeRelativePath(rawPath)
    if (!content) {
      // 无内容时按近期相同路径放行/拦截判断
      const now = Date.now()
      return this.recentWrites.some(
        (w) => w.path === norm && now - w.timestamp < 1200,
      )
    }
    const hash = quickHash(content)
    const now = Date.now()
    return this.recentWrites.some(
      (w) => w.path === norm && w.hash === hash && now - w.timestamp < this.echoWindowMs,
    )
  }

  /**
   * 订阅指定实体的所有文件变更
   */
  public subscribeEntity<T = unknown>(
    entityId: string,
    callback: FileChangeCallback<T>,
  ): () => void {
    let set = this.entityListeners.get(entityId)
    if (!set) {
      set = new Set()
      this.entityListeners.set(entityId, set)
    }
    set.add(callback as FileChangeCallback)
    return () => {
      set?.delete(callback as FileChangeCallback)
    }
  }

  /**
   * 订阅指定相对路径的精确变更
   */
  public subscribePath<T = unknown>(
    rawPath: string,
    callback: FileChangeCallback<T>,
  ): () => void {
    const norm = normalizeRelativePath(rawPath)
    let set = this.pathListeners.get(norm)
    if (!set) {
      set = new Set()
      this.pathListeners.set(norm, set)
    }
    set.add(callback as FileChangeCallback)
    return () => {
      set?.delete(callback as FileChangeCallback)
    }
  }

  /**
   * 订阅全局文件变更
   */
  public subscribeAll(callback: FileChangeCallback): () => void {
    this.globalListeners.add(callback)
    return () => {
      this.globalListeners.delete(callback)
    }
  }

  /**
   * 获取内存中已缓存的实体数据
   */
  public getCached<T = unknown>(rawPath: string): T | undefined {
    const norm = normalizeRelativePath(rawPath)
    return this.cache.get(norm) as T | undefined
  }

  /**
   * 获取内存中已缓存的原始文本
   */
  public getRawCached(rawPath: string): string | undefined {
    const norm = normalizeRelativePath(rawPath)
    return this.rawCache.get(norm)
  }

  /**
   * 解析文本为结构化数据
   */
  private parseContent<T>(content: string, format?: string, fallback?: () => T): T {
    if (format === 'json') {
      try {
        return JSON.parse(content) as T
      } catch {
        return fallback ? fallback() : (null as unknown as T)
      }
    }
    return content as unknown as T
  }

  /**
   * 写入文件（同时打标自发凭证、更新乐观缓存并派发变更事件）
   */
  public async write<T = unknown>(
    rawPath: string,
    contentOrData: T | string,
    opts?: {
      source?: 'ui' | 'agent' | 'vfs'
      txId?: string
      encoding?: 'utf8' | 'base64'
    },
  ): Promise<{ ok: boolean; path: string; error?: string }> {
    const norm = normalizeRelativePath(rawPath)
    const matched = matchEntity<T>(norm)
    const txId = opts?.txId || `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const source = opts?.source || 'vfs'

    let rawStr = ''
    let parsedData: T

    if (typeof contentOrData === 'string') {
      rawStr = contentOrData
      parsedData = this.parseContent<T>(
        rawStr,
        matched?.entity.format,
        matched?.entity.defaultValue,
      )
    } else {
      parsedData = contentOrData
      rawStr =
        matched?.entity.format === 'json'
          ? JSON.stringify(contentOrData, null, 2)
          : String(contentOrData ?? '')
    }

    const hash = quickHash(rawStr)
    this.recordSelfWrite(norm, hash, txId)

    // 0ms 乐观更新缓存
    this.setCacheEntry(norm, parsedData)
    this.setRawCacheEntry(norm, rawStr)

    // 派发事件给本端订阅者
    const event: FileChangeEvent<T> = {
      path: rawPath,
      relativePath: norm,
      action: 'write',
      content: rawStr,
      data: parsedData,
      entity: matched?.entity,
      params: matched?.params,
      source,
      txId,
    }
    this.emit(event)

    // 真正落盘
    try {
      if (typeof window !== 'undefined' && window.mojiNative?.files?.write) {
        const res = await window.mojiNative.files.write(rawPath, rawStr, {
          encoding: opts?.encoding,
        })
        if (!res.ok) return { ok: false, path: rawPath, error: res.error }
      }
      return { ok: true, path: rawPath }
    } catch (err) {
      return { ok: false, path: rawPath, error: String(err) }
    }
  }

  /**
   * 处理外界（Agent IPC / 磁盘 Watcher）传来的文件变动通知
   */
  public notifyExternalChange(payload: {
    path: string
    action?: 'write' | 'edit' | 'delete' | 'create'
    content?: string
    source?: 'agent' | 'watcher' | 'ui'
  }): void {
    const norm = normalizeRelativePath(payload.path)
    const content = payload.content

    // 防回环拦截：如果是我们刚刚自己写出的同一内容，不进行无效的二次广播
    if (this.isEcho(norm, content)) {
      return
    }

    const matched = matchEntity(norm)
    const action = payload.action || 'write'
    let parsedData: unknown = undefined

    if (action === 'delete') {
      this.cache.delete(norm)
      this.rawCache.delete(norm)
    } else if (content !== undefined) {
      this.setRawCacheEntry(norm, content)
      parsedData = this.parseContent(
        content,
        matched?.entity.format,
        matched?.entity.defaultValue,
      )
      this.setCacheEntry(norm, parsedData)
    }

    const event: FileChangeEvent = {
      path: payload.path,
      relativePath: norm,
      action,
      content,
      data: parsedData,
      entity: matched?.entity,
      params: matched?.params,
      source: payload.source || 'watcher',
    }

    this.emit(event)
  }

  /**
   * 派发变更事件
   */
  private emit(event: FileChangeEvent): void {
    // 1. 实体级监听器
    if (event.entity) {
      const entitySet = this.entityListeners.get(event.entity.id)
      if (entitySet) {
        for (const cb of entitySet) {
          try {
            cb(event)
          } catch (e) {
            console.error('[VfsBus] 实体监听器执行异常:', e)
          }
        }
      }
    }

    // 2. 路径级监听器
    const pathSet = this.pathListeners.get(event.relativePath)
    if (pathSet) {
      for (const cb of pathSet) {
        try {
          cb(event)
        } catch (e) {
          console.error('[VfsBus] 路径监听器执行异常:', e)
        }
      }
    }

    // 3. 全局监听器
    for (const cb of this.globalListeners) {
      try {
        cb(event)
      } catch (e) {
        console.error('[VfsBus] 全局监听器执行异常:', e)
      }
    }
  }

  /**
   * 销毁或清空
   */
  public clear(): void {
    this.cache.clear()
    this.rawCache.clear()
    this.entityListeners.clear()
    this.pathListeners.clear()
    this.globalListeners.clear()
    this.recentWrites = []
  }
}

/** 单例导出的默认 VFS 总线 */
export const vfsBus = new ReactiveVfsBus()
