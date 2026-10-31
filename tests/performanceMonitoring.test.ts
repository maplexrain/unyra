/**
 * 性能优化与监控专项测试（VFS 批处理、缓存容量封顶、常驻页签释放与指标聚合）。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  initVfsStoreSync,
  registerStoreSyncListener,
  flushVfsStoreSync,
  getVfsSyncStats,
  queueVfsStoreEvent,
} from '../src/vfs/storeSync'
import { vfsBus } from '../src/vfs/bus'
import { clearResidentTabs, getResidentStats, touchRecent } from '../src/learn/resident'
import type { LearnStore } from '../src/learn/types'
import { emptyLearnStore } from '../src/learn/store'

describe('VFS 密集文件写入微批处理调度器', () => {
  it('多个并发文件事件在批处理刷新前聚合，只触发一次 Store 派发更新', () => {
    let dispatchCount = 0
    let lastStore: LearnStore = emptyLearnStore()

    const unregister = registerStoreSyncListener((updater) => {
      dispatchCount++
      lastStore = updater(lastStore)
    })

    // 模拟 AI 密集创建 5 个超级文档文件
    for (let i = 0; i < 5; i++) {
      queueVfsStoreEvent({
        path: `docs/test-goal/node-1/superdocs/test-${i}.html`,
        action: 'write',
        content: `<h1>实验 ${i}</h1>`,
      })
    }

    // 尚未触发同步刷新时，还没有派发
    expect(dispatchCount).toBe(0)

    // 模拟 rAF 帧到期或同步 flush
    flushVfsStoreSync()

    // 5 个事件应该被合并为仅 1 次 dispatchStoreUpdate！
    expect(dispatchCount).toBe(1)

    // 统计指标应记录了 5 个事件与消峰次数
    const stats = getVfsSyncStats()
    expect(stats.totalEvents).toBeGreaterThanOrEqual(5)
    expect(stats.coalescedCount).toBeGreaterThanOrEqual(4)

    unregister()
  })
})

describe('VFS 缓存有界性与 LRU 封顶机制', () => {
  it('大量文件连续写入时，rawCache 不超过容量上限并自动淘汰旧数据', async () => {
    // 写入 350 个不同的文件（超过 MAX_CACHE_ENTRIES 300）
    for (let i = 0; i < 350; i++) {
      await vfsBus.write(`test-overflow/file-${i}.txt`, `内容 ${i}`)
    }

    const stats = vfsBus.getCacheStats()
    expect(stats.rawCount).toBeLessThanOrEqual(stats.maxEntries)
    expect(stats.maxEntries).toBe(300)

    // 清空缓存能力
    vfsBus.clearAllCache()
    expect(vfsBus.getCacheStats().rawCount).toBe(0)
    expect(vfsBus.getCacheStats().dataCount).toBe(0)
  })
})

describe('常驻页签 DOM 释放与急救回收机制', () => {
  it('clearResidentTabs 能够立即回收非激活页签的常驻名额', () => {
    touchRecent('tab-1')
    touchRecent('tab-2')
    touchRecent('tab-3')
    touchRecent('tab-4')

    expect(getResidentStats().count).toBe(4)

    // 一键释放，仅保留当前正在阅读的 tab-4
    clearResidentTabs('tab-4')
    expect(getResidentStats().count).toBe(1)
    expect(getResidentStats().ids).toEqual(['tab-4'])

    // 全部释放
    clearResidentTabs()
    expect(getResidentStats().count).toBe(0)
  })
})
