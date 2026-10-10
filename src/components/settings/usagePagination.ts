/**
 * 用量统计 - 最近请求分页辅助计算
 */

export const USAGE_PAGE_SIZE = 20

/**
 * 分页数字窗算法：保持稳定的按键数量，两端与中间平滑过渡
 * @param current 当前页（1-indexed）
 * @param total 总页数
 */
export function getPageNumbers(current: number, total: number): Array<number | '...'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', total]
  }
  if (current >= total - 3) {
    return [1, '...', total - 4, total - 3, total - 2, total - 1, total]
  }
  return [1, '...', current - 1, current, current + 1, '...', total]
}

/**
 * 计算切片范围
 */
export function paginateRecords<T>(
  items: T[],
  page: number,
  pageSize = USAGE_PAGE_SIZE,
): {
  totalPages: number
  safePage: number
  pagedItems: T[]
  startItem: number
  endItem: number
} {
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const startIdx = (safePage - 1) * pageSize
  const pagedItems = items.slice(startIdx, startIdx + pageSize)
  const startItem = total === 0 ? 0 : startIdx + 1
  const endItem = Math.min(safePage * pageSize, total)
  return { totalPages, safePage, pagedItems, startItem, endItem }
}
