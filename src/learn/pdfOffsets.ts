/**
 * PDF 连续滚动模式的**页高换算表**（PdfDocView 专用）：
 *
 * 「滚动位置 ↔ 页码」只有这一个换算器——旧做法 onScroll 用「均匀页高估算」页码、
 * IntersectionObserver 又用精确页码回写，两个写者对不上号时活跃窗口抖动，页面
 * 反复挂载/卸载（滚动卡顿的主因之一）。现在 currentPage 只由 onScroll 经这张表
 * 推导（观察器只负责触发渲染与文字提取，不再写页码），混合页面尺寸（横版/混纸）
 * 也按**已量测的基準尺寸**精确累计——量不到的页用第 1 页/回退尺寸占位，与占位
 * DOM 的实际高度一致，估算永远追得上真实布局。
 *
 * 关键性质：表里存的是 **scale=1 基准高度**的前缀和，zoom 只在查询时乘上去——
 * 缩放不需要重建表（CSS 的页间距 my-4 与容器 padding 不随缩放，是常数项）。
 */

export interface PdfPageSize {
  width: number
  height: number
}

/** 页块之间的间距：页面本身的 my-4（16 + 16） */
const BLOCK_GAP = 32
/** 表头常数：容器 p-4 的上 padding（16）+ 首页 my-4 的上 margin（16） */
const LEAD = 32

export class PdfPageMetrics {
  /** 已量测页的 scale=1 基准尺寸（页面挂载时上报，跨 zoom 复用） */
  private base = new Map<number, PdfPageSize>()
  /** 量不到的页的回退基准尺寸（默认取第 1 页，加载后 setFallback） */
  private fallback: PdfPageSize = { width: 595, height: 842 }
  /** 基准高度前缀和：S[p] = 第 1..p 页基准高度之和（zoom 无关） */
  private S: number[] = [0]
  private dirty = true

  constructor(fallback?: PdfPageSize) {
    if (fallback) this.fallback = fallback
  }

  /** 文档加载后更新回退尺寸（第 1 页的基准尺寸） */
  setFallback(size: PdfPageSize): void {
    this.fallback = size
    this.dirty = true
  }

  /**
   * 登记一页的基准尺寸。返回 true = 有变化（调用方据此刷新依赖尺寸的视图）；
   * 同值重复上报（React 重挂等）不算变化，不触发任何失效。
   */
  setBase(pageNum: number, size: PdfPageSize): boolean {
    const prev = this.base.get(pageNum)
    if (prev && prev.width === size.width && prev.height === size.height) return false
    this.base.set(pageNum, size)
    this.dirty = true
    return true
  }

  /** 某页的基准尺寸；量不到回落到回退尺寸（与占位 DOM 的取值口径一致） */
  sizeOf(pageNum: number): PdfPageSize {
    return this.base.get(pageNum) ?? this.fallback
  }

  /** 确保前缀和覆盖到 numPages（惰性重建：尺寸登记后第一次查询时算一次 O(n)） */
  private ensure(numPages: number): void {
    if (!this.dirty && this.S.length - 1 >= numPages) return
    const S: number[] = [0]
    for (let p = 1; p <= numPages; p++) {
      S[p] = S[p - 1] + this.sizeOf(p).height
    }
    this.S = S
    this.dirty = false
  }

  /** 第 p 页块顶的滚动坐标（含页间距与表头常数；需要 S[p-1]，先确保前缀和覆盖） */
  pageTop(pageNum: number, zoom: number): number {
    this.ensure(Math.max(0, pageNum - 1))
    return LEAD + this.S[Math.max(0, pageNum - 1)] * zoom + (pageNum - 1) * BLOCK_GAP
  }

  /**
   * 滚动锚点 y（通常取 scrollTop + clientHeight * 0.3，即视口上 1/3 处）落在哪一页。
   * 二分查找，O(log n)——onScroll 每帧调用也不构成负担。
   */
  pageAt(y: number, zoom: number, numPages: number): number {
    if (numPages <= 0) return 1
    this.ensure(numPages)
    let lo = 1
    let hi = numPages
    let ans = 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.pageTop(mid, zoom) <= y) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  }
}
