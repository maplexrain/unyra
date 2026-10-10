import { describe, expect, it } from 'vitest'
import { getPageNumbers, paginateRecords, USAGE_PAGE_SIZE } from '../src/components/settings/usagePagination'

describe('getPageNumbers', () => {
  it('总页数 <= 7 时全部平铺展开', () => {
    expect(getPageNumbers(1, 1)).toEqual([1])
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(getPageNumbers(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('靠左边缘时（current <= 4）右侧省略', () => {
    expect(getPageNumbers(1, 10)).toEqual([1, 2, 3, 4, 5, '...', 10])
    expect(getPageNumbers(4, 10)).toEqual([1, 2, 3, 4, 5, '...', 10])
  })

  it('靠右边缘时（current >= total - 3）左侧省略', () => {
    expect(getPageNumbers(7, 10)).toEqual([1, '...', 6, 7, 8, 9, 10])
    expect(getPageNumbers(10, 10)).toEqual([1, '...', 6, 7, 8, 9, 10])
  })

  it('位于中间时两侧均省略', () => {
    expect(getPageNumbers(5, 10)).toEqual([1, '...', 4, 5, 6, '...', 10])
    expect(getPageNumbers(6, 10)).toEqual([1, '...', 5, 6, 7, '...', 10])
  })
})

describe('paginateRecords', () => {
  it('默认每页 20 条', () => {
    expect(USAGE_PAGE_SIZE).toBe(20)
  })

  it('空列表时返回安全默认值', () => {
    const res = paginateRecords([], 1, 20)
    expect(res.totalPages).toBe(1)
    expect(res.safePage).toBe(1)
    expect(res.pagedItems).toEqual([])
    expect(res.startItem).toBe(0)
    expect(res.endItem).toBe(0)
  })

  it('多页切片与边界计算准确', () => {
    const items = Array.from({ length: 45 }, (_, i) => i + 1)

    // 第 1 页
    const p1 = paginateRecords(items, 1, 20)
    expect(p1.totalPages).toBe(3)
    expect(p1.safePage).toBe(1)
    expect(p1.pagedItems).toHaveLength(20)
    expect(p1.pagedItems[0]).toBe(1)
    expect(p1.pagedItems[19]).toBe(20)
    expect(p1.startItem).toBe(1)
    expect(p1.endItem).toBe(20)

    // 第 2 页
    const p2 = paginateRecords(items, 2, 20)
    expect(p2.safePage).toBe(2)
    expect(p2.pagedItems).toHaveLength(20)
    expect(p2.pagedItems[0]).toBe(21)
    expect(p2.pagedItems[19]).toBe(40)
    expect(p2.startItem).toBe(21)
    expect(p2.endItem).toBe(40)

    // 第 3 页（最后一页，只剩 5 条）
    const p3 = paginateRecords(items, 3, 20)
    expect(p3.safePage).toBe(3)
    expect(p3.pagedItems).toHaveLength(5)
    expect(p3.pagedItems[0]).toBe(41)
    expect(p3.pagedItems[4]).toBe(45)
    expect(p3.startItem).toBe(41)
    expect(p3.endItem).toBe(45)
  })

  it('越界页码自动夹住（防负数与越上界）', () => {
    const items = Array.from({ length: 30 }, (_, i) => i + 1)
    const over = paginateRecords(items, 99, 20)
    expect(over.safePage).toBe(2)
    expect(over.pagedItems).toHaveLength(10)

    const under = paginateRecords(items, -5, 20)
    expect(under.safePage).toBe(1)
    expect(under.pagedItems).toHaveLength(20)
  })
})
