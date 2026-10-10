import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAllWebHistory,
  loadWebHistory,
  recordWebHistory,
  removeWebHistoryEntry,
  searchWebHistory,
  updateWebHistoryMeta,
} from '../src/learn/web/webHistory'

const storageMap = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => storageMap.set(key, String(value)),
  removeItem: (key: string) => storageMap.delete(key),
  clear: () => storageMap.clear(),
}

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
})

describe('webHistory', () => {
  beforeEach(() => {
    storageMap.clear()
    clearAllWebHistory()
  })

  it('records a new visited url and persists to localStorage', () => {
    recordWebHistory('https://github.com/maplexrain/unyra', 'Unyra GitHub')
    const list = loadWebHistory()
    expect(list).toHaveLength(1)
    expect(list[0].url).toBe('https://github.com/maplexrain/unyra')
    expect(list[0].title).toBe('Unyra GitHub')
    expect(list[0].visitCount).toBe(1)
  })

  it('increments visit count and moves existing url to front on re-visit', () => {
    recordWebHistory('https://example.com', 'Example')
    recordWebHistory('https://google.com', 'Google')
    recordWebHistory('https://example.com', 'Example Renamed')

    const list = loadWebHistory()
    expect(list).toHaveLength(2)
    expect(list[0].url).toBe('https://example.com')
    expect(list[0].title).toBe('Example Renamed')
    expect(list[0].visitCount).toBe(2)
  })

  it('updates metadata without incrementing visit count', () => {
    recordWebHistory('https://example.com', 'Old Title')
    updateWebHistoryMeta('https://example.com', { title: 'New Title', favicon: 'https://example.com/icon.png' })

    const list = loadWebHistory()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('New Title')
    expect(list[0].favicon).toBe('https://example.com/icon.png')
    expect(list[0].visitCount).toBe(1)
  })

  it('searches history by url or title with ranking', () => {
    recordWebHistory('https://github.com/maplexrain/unyra', '归一 Unyra')
    recordWebHistory('https://google.com', 'Google Search')
    recordWebHistory('https://wikipedia.org', 'Wikipedia')

    const githubResults = searchWebHistory('github')
    expect(githubResults).toHaveLength(1)
    expect(githubResults[0].url).toBe('https://github.com/maplexrain/unyra')

    const unyraResults = searchWebHistory('Unyra')
    expect(unyraResults).toHaveLength(1)
    expect(unyraResults[0].url).toBe('https://github.com/maplexrain/unyra')
  })

  it('removes individual history entry', () => {
    recordWebHistory('https://a.com', 'A')
    recordWebHistory('https://b.com', 'B')
    expect(loadWebHistory()).toHaveLength(2)

    removeWebHistoryEntry('https://a.com')
    const list = loadWebHistory()
    expect(list).toHaveLength(1)
    expect(list[0].url).toBe('https://b.com')
  })
})
