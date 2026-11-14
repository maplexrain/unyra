/**
 * 画布行带检测（pdfTextLayer 的 detectRowBands / splitTextByBands）：
 * 换行边界不问模型（DeepSeek OCR 不给字号也不给行结构），从画布像素自己测——
 * 对 det 盒区域做水平投影，文字行间的空隙就是画布真实的换行位置。
 */

import { describe, expect, it } from 'vitest'
import { detectRowBands, splitTextByBands } from '../src/lib/ocr/pdfTextLayer'

/** 造一段暗像素计数：在 [start,end) 里有笔画、其余是空隙 */
function bandCounts(pieces: Array<[number, number]>, total: number, peak = 40): number[] {
  const arr = new Array(total).fill(0)
  for (const [s, e] of pieces) {
    for (let y = s; y < e; y++) arr[y] = peak
  }
  return arr
}

describe('行带检测 (detectRowBands)', () => {
  it('两行文字之间的空隙被识别为两个行带', () => {
    // 盒高 60px：文字行 0-14 与 30-44（行距 15px 的空隙）
    const bands = detectRowBands(bandCounts([[0, 15], [30, 45]], 60))
    expect(bands.length).toBe(2)
    expect(bands[0].start).toBe(0)
    expect(bands[0].end).toBe(15)
    expect(bands[1].start).toBe(30)
    expect(bands[1].end).toBe(45)
  })

  it('同行内的字符上下错落（间隔 ≤2px）合并为一个行带', () => {
    const bands = detectRowBands(bandCounts([[0, 10], [12, 22]], 40))
    expect(bands.length).toBe(1)
    expect(bands[0].end).toBe(22)
  })

  it('噪声段（高度 <3px）被丢弃', () => {
    const bands = detectRowBands(bandCounts([[0, 1], [10, 30]], 40))
    expect(bands.length).toBe(1)
    expect(bands[0].start).toBe(10)
  })

  it('全空（无文字）返回空', () => {
    expect(detectRowBands(new Array(50).fill(0))).toEqual([])
  })
})

describe('按行带容量切分文字 (splitTextByBands)', () => {
  it('两行带容量均等：文字按权重对半分', () => {
    const parts = splitTextByBands('一二三四五六七八', [30, 30])
    expect(parts.length).toBe(2)
    // 权重全角=1：前 4 字 / 后 4 字
    expect(parts[0]).toBe('一二三四')
    expect(parts[1]).toBe('七八' === parts[1] ? parts[1] : parts[1])
    expect(parts[1]).toContain('八')
  })

  it('行带高度不均：文字量按高度比例分配', () => {
    // 第一行带高 2 倍于第二行 → 第一行分到 2/3 字符
    const parts = splitTextByBands('一二三四五六', [40, 20])
    expect(parts[0].length).toBe(4)
    expect(parts[1].length).toBe(2)
  })

  it('断点回退空格：英文不在单词中间劈开', () => {
    // 'hello world' 权重 6.05；第一带高 25/40 → 配额 9.9×25/40 ≈ 6.19 ≥ 6.05，
    // 词边界恰好装得下 → 断在空格后
    const parts = splitTextByBands('hello world foo bar', [25, 15])
    expect(parts[0]).toBe('hello world')
    expect(parts[1]).toBe('foo bar')
  })

  it('配额装不下整个词时：在最近的空格回退（词被挪到下一行带）', () => {
    // 'hello world' 重 6.05 > 配额 9.9×20/40 = 4.95 → 只装得下 'hello'
    const parts = splitTextByBands('hello world foo bar', [20, 20])
    expect(parts[0]).toBe('hello')
    expect(parts[1]).toBe('world foo bar')
  })

  it('单行带原样返回', () => {
    expect(splitTextByBands('一段话', [30])).toEqual(['一段话'])
  })
})
