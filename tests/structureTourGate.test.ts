// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isStructureTourSeen,
  markStructureTourSeen,
  TOUR_SEEN_KEYS,
} from '../src/components/learn/structure/StructureCanvas'

describe('Structure Tour Gate', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    delete (window as any).__UNYRA_TOUR_SEEN__
  })

  it('detects seen status from both unyra and moji legacy keys', () => {
    expect(isStructureTourSeen()).toBe(false)

    // 测试旧键兼容
    localStorage.setItem('moji:structure:tour-seen', '1')
    expect(isStructureTourSeen()).toBe(true)
  })

  it('marks structure tour seen in all storage layers and window object', () => {
    markStructureTourSeen()
    expect(isStructureTourSeen()).toBe(true)

    for (const key of TOUR_SEEN_KEYS) {
      expect(localStorage.getItem(key)).toBe('1')
    }
    expect((window as any).__UNYRA_TOUR_SEEN__).toBe(true)
  })
})
