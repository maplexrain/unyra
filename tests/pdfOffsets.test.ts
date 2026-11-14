import { describe, expect, it } from 'vitest'
import { PdfPageMetrics } from '../src/learn/pdfOffsets'

/** A4 基准（scale=1）尺寸：595 × 842 */
const A4 = { width: 595, height: 842 }
/** 横版 A4 基准尺寸 */
const A4L = { width: 842, height: 595 }

describe('PDF 页高换算表 (learn/pdfOffsets)', () => {
  it('pageTop 常数项正确：表头 32（容器 padding + 首页 margin），页间距 32（my-4）', () => {
    const m = new PdfPageMetrics(A4)
    // 第 1 页块顶 = 32
    expect(m.pageTop(1, 1)).toBe(32)
    // 第 2 页块顶 = 32 + 842 + 32
    expect(m.pageTop(2, 1)).toBe(32 + 842 + 32)
    // zoom 只乘高度，不乘间距与表头
    expect(m.pageTop(2, 2)).toBe(32 + 842 * 2 + 32)
  })

  it('pageAt 往返一致：pageAt(pageTop(p)) 恰好落在第 p 页（等高页）', () => {
    const m = new PdfPageMetrics(A4)
    for (let p = 1; p <= 50; p++) {
      m.setBase(p, A4)
    }
    for (let p = 1; p <= 50; p++) {
      expect(m.pageAt(m.pageTop(p, 1), 1, 50)).toBe(p)
      // 页块内任意位置（差 1px 到块尾）都还在这页
      expect(m.pageAt(m.pageTop(p, 1) + 841, 1, 50)).toBe(p)
      // 块尾进入下一页（末页之后无处可去，钳回最后一页）
      expect(m.pageAt(m.pageTop(p, 1) + 842 + 32, 1, 50)).toBe(Math.min(50, p + 1))
    }
  })

  it('混合页面尺寸（横版/竖版）按已量测基准精确映射，估算不漂移', () => {
    const m = new PdfPageMetrics(A4)
    m.setBase(1, A4)
    m.setBase(2, A4L) // 横版更矮（595）
    m.setBase(3, A4)
    // 第 2 页块顶 = 32 + 842 + 32
    const top2 = 32 + 842 + 32
    expect(m.pageAt(top2, 1, 3)).toBe(2)
    // 第 3 页块顶 = top2 + 595 + 32（横版高度是 595 不是 842）
    const top3 = top2 + 595 + 32
    expect(m.pageAt(top3, 1, 3)).toBe(3)
    expect(m.pageAt(top3 - 1, 1, 3)).toBe(2)
  })

  it('量不到的页回落到回退尺寸，与占位 DOM 的口径一致；setBase 后立即生效', () => {
    const m = new PdfPageMetrics(A4)
    // 只量过第 1 页：第 2 页未量测 → 用回退尺寸（842）
    m.setBase(1, A4)
    expect(m.sizeOf(2)).toEqual(A4)
    const top3Before = m.pageTop(3, 1)
    expect(top3Before).toBe(32 + (842 + 32) * 2)
    // 第 2 页量测到横版：第 3 页块顶随之前移
    m.setBase(2, A4L)
    expect(m.pageTop(3, 1)).toBe(32 + 842 + 32 + 595 + 32)
  })

  it('zoom 缩放不要求重建表：基准高度前缀和 × zoom 即得布局', () => {
    const m = new PdfPageMetrics(A4)
    m.setBase(1, A4)
    m.setBase(2, A4)
    // zoom=1.5：第 2 页块顶 = 32 + 842*1.5 + 32
    expect(m.pageTop(2, 1.5)).toBeCloseTo(32 + 842 * 1.5 + 32, 6)
    expect(m.pageAt(m.pageTop(2, 1.5) + 16, 1.5, 2)).toBe(2)
  })

  it('setBase 同值重复上报不算变化（不会反复 bump 版本触发重渲染）', () => {
    const m = new PdfPageMetrics(A4)
    expect(m.setBase(1, A4)).toBe(true)
    expect(m.setBase(1, A4)).toBe(false)
    expect(m.setBase(1, { ...A4 })).toBe(false)
    expect(m.setBase(1, { width: 595, height: 500 })).toBe(true)
  })

  it('pageAt 越界钳制：任何 y 都落在 1..numPages，滚到底返回最后一页', () => {
    const m = new PdfPageMetrics(A4)
    m.setBase(1, A4)
    m.setBase(2, A4)
    expect(m.pageAt(-500, 1, 2)).toBe(1)
    expect(m.pageAt(Number.MAX_SAFE_INTEGER, 1, 2)).toBe(2)
    expect(m.pageAt(0, 1, 0)).toBe(1)
  })
})
