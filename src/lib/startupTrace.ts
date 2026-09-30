/**
 * 渲染层的启动耗时打点（配合 electron/startup.ts 一起看）。
 *
 * 打点本身几乎不花钱（就是往数组里塞一个 performance.now()），所以常开；
 * 「什么时候读」由主进程决定——只有开了 MOJI_STARTUP_TRACE 的主进程才会来取。
 * 数据挂在 globalThis.__mojiStartup 上，是给排查用的调试口，不是应用状态。
 *
 * 两个基准要对齐才不会看错：
 * - 这里的 performance.now() 是**相对导航开始**（文档创建）的毫秒数；
 * - 主进程那侧是**相对进程启动**。两者差一个「Electron 引导 + 主进程求值 + 建窗口」，
 *   差值可以从主进程的 main:window 与这里的 r:module-eval 对照着读。
 */
export interface RendererStartup {
  /** [阶段名, 相对导航开始的毫秒数] */
  marks: Array<[string, number]>
  /** 浏览器给的那几条标准指标（有没有、数值多少都由内核决定） */
  paint: Record<string, number>
  /** 文档时间线的几个节点 */
  nav: Record<string, number>
  /** startupSpan 记下的段：名字 → [次数, 合计 ms, 最长 ms] */
  spans: Record<string, [number, number, number]>
  /** 这一屏到底是什么：元素数、有没有落在登录页——用来核对「量的是不是同一个界面」 */
  screen: { elements: number; login: boolean; text: number }
}

const marks: Array<[string, number]> = []
let done = false

/** 打一个点。同名可重复（后面的会覆盖前一个同名的读数） */
export function startupMark(label: string): void {
  marks.push([label, performance.now()])
}

/**
 * 量一段同步代码。用于「某个函数到底花了多久」这种问题：
 * 结果进 User Timing（performance.measure），随快照一起回传，按名字聚合。
 */
export function startupSpan<T>(label: string, fn: () => T): T {
  const t0 = performance.now()
  try {
    return fn()
  } finally {
    performance.measure(label, { start: t0, end: performance.now() })
  }
}

const PAINT_KEYS = ['first-paint', 'first-contentful-paint'] as const
const NAV_KEYS = ['domInteractive', 'domContentLoadedEventEnd', 'loadEventEnd'] as const

function snapshot(): RendererStartup {
  const paint: Record<string, number> = {}
  for (const e of performance.getEntriesByType('paint')) {
    if ((PAINT_KEYS as readonly string[]).includes(e.name)) paint[e.name] = e.startTime
  }
  const nav: Record<string, number> = {}
  const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (n) for (const k of NAV_KEYS) nav[k] = n[k]
  const spans: Record<string, [number, number, number]> = {}
  for (const e of performance.getEntriesByType('measure')) {
    const cur = spans[e.name] ?? [0, 0, 0]
    spans[e.name] = [cur[0] + 1, cur[1] + e.duration, Math.max(cur[2], e.duration)]
  }
  const text = document.body.innerText ?? ''
  return {
    marks,
    paint,
    nav,
    spans,
    screen: {
      elements: document.getElementsByTagName('*').length,
      login: text.includes('开始使用') || text.includes('选择一位学习者'),
      text: text.length,
    },
  }
}

/**
 * 首帧真正画出来之后再回传。
 *
 * 为什么用两层 rAF：React 的提交（commit）只是把 DOM 写好，真正的绘制在下一帧。
 * 只记到 commit 会把「浏览器还没画」当成「已经好了」，看起来比实际快一截。
 * 第一层 rAF 排在绘制之后，第二层确保绘制已经发生。
 */
export function reportStartupMarks(): void {
  if (done) return
  done = true
  // 先等 App 真的提交过（r:app-commit 是它的 useEffect 打的），再等两帧等浏览器画出来。
  // 不等的话 rAF 有可能抢在 React 提交之前跑完，读数会比 commit 还早，看着像 bug。
  const waitCommit = (left: number): void => {
    if (left <= 0 || marks.some(([l]) => l === 'r:app-commit')) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          startupMark('r:painted')
          const payload = snapshot()
          ;(globalThis as { __mojiStartup?: () => RendererStartup }).__mojiStartup = () => payload
        })
      })
      return
    }
    requestAnimationFrame(() => waitCommit(left - 1))
  }
  waitCommit(300)
}
