// @vitest-environment happy-dom
/**
 * 记忆模式（lib/memoryMode）的单元用例：文档键、种子洗牌的确定性与均匀性、
 * 状态的存取往返与开关/换种子。遮罩本身是 CSS 伪元素 + 正文标记 effect，见 useMemoryMode。
 */
import { describe, expect, it } from 'vitest'
import {
  chunkIntoPieces,
  loadMemoryMode,
  memoryDocKey,
  memoryHash,
  memoryRandom,
  memoryShuffle,
  pickSpaced,
  rerollMemorySeed,
  setMemoryPercent,
  toggleMemoryMode,
} from '../src/lib/memoryMode'

const KEY = 'node-1:teaching'

describe('教学文档记忆模式 (memoryMode)', () => {
  it('文档键：教学文档按 节点id:种类（带笔记名）算，按钮与正文两侧必须算出同一把', () => {
    expect(memoryDocKey('n1', 'teaching')).toBe('n1:teaching')
    expect(memoryDocKey('n1', 'teaching', '错题本')).toBe('n1:teaching:错题本')
    expect(memoryDocKey('n1', 'teaching')).toBe(memoryDocKey('n1', 'teaching', undefined))
  })

  it('同一颗种子洗出来的顺序完全一致（种子持久化 = 重开应用盖住同一批块）', () => {
    expect(memoryShuffle(40, 12345)).toEqual(memoryShuffle(40, 12345))
    const a = memoryShuffle(40, 1)
    const b = memoryShuffle(40, 2)
    // 都是 0..39 的一个排列：不重不漏
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    expect([...b].sort((x, y) => x - y)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    // 不同种子大概率不同序（均匀随机分布的来源）
    expect(a.some((v, i) => v !== b[i])).toBe(true)
  })

  it('按范围取前 k 个即均匀随机覆盖：0% 一个不盖、100% 全盖', () => {
    const shuffled = memoryShuffle(10, 77)
    const pick = (percent: number) => new Set(shuffled.slice(0, Math.round((10 * percent) / 100)))
    expect(pick(0).size).toBe(0)
    expect(pick(100).size).toBe(10)
    expect(pick(50).size).toBe(5)
  })

  it('chunkIntoPieces：同一种子切同一批片；相邻片首尾相接不丢字符', () => {
    const text = '极限是微积分的核心概念，描述函数趋于某一点的 behavior 与连续性。'
    const pieces = chunkIntoPieces(text, memoryRandom(memoryHash(99, 0)))
    expect(pieces.length).toBeGreaterThan(1)
    let cursor = 0
    for (const p of pieces) {
      expect(p.start).toBe(cursor)
      expect(p.end).toBeGreaterThan(p.start)
      cursor = p.end
    }
    expect(cursor).toBe(text.length)
    // 确定性：同一种子重切完全一致（种子持久化 = 重开应用切分不变）
    expect(chunkIntoPieces(text, memoryRandom(memoryHash(99, 0)))).toEqual(pieces)
  })

  it('pickSpaced：等距铺开（片不重复、不越界），n<k 封顶 n，n=0 空', () => {
    const r = memoryRandom(memoryHash(7, 1))
    const a = pickSpaced(10, 3, r)
    expect(a.length).toBe(3)
    expect(new Set(a).size).toBe(3)
    expect(Math.max(...a)).toBeLessThan(10)
    expect(pickSpaced(5, 99, r).length).toBe(5)
    expect(pickSpaced(0, 5, r)).toEqual([])
    expect(pickSpaced(10, 0, r)).toEqual([])
  })

  it('状态按文档存取：默认关、范围 70、随机种子；写进去读回来一致', () => {
    const first = loadMemoryMode(KEY)
    expect(first.on).toBe(false)
    expect(first.percent).toBe(70)
    const rolled = rerollMemorySeed(KEY)
    expect(loadMemoryMode(KEY).seed).toBe(rolled.seed)
    setMemoryPercent(KEY, 35)
    expect(loadMemoryMode(KEY).percent).toBe(35)
    const on = toggleMemoryMode(KEY)
    expect(on.on).toBe(true)
    expect(loadMemoryMode(KEY).on).toBe(true)
    // 两份文档各存各的，互不串
    expect(loadMemoryMode('node-2:teaching').on).toBe(false)
    expect(loadMemoryMode('node-2:teaching').percent).toBe(70)
  })
})
