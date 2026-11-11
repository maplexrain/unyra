/**
 * 通用参数化可交互教学仿真卡片（```pisc）
 *
 * 语法与渲染设计：
 * - 解析期（renderNote）：同步产出直角占位容器 HTML，记录编码后的 JS 源码与标题；
 *   支持在 ```pisc 同一行附带自定义标题（如 ```pisc 简谐振动受迫共振动态模拟）；
 * - 视觉与交互规范：
 *   1. 纯直角设计（rounded-none）：容器与内部结构一律无圆角；
 *   2. 禁止使用 emoji：全部状态与控制指示采用精致矢量的 SVG 图标绘制；
 *   3. 重置控制：无边框、无背景、纯 SVG 旋转图标按钮；
 * - 挂载期（hydratePisc）：在 DOM 提交后，为每个卡片实例化一个名为 card 的 HTMLCanvasElement，
 *   并置于严格受限的沙盒中执行，只允许在 canvas 上绘图并监听交互事件（pointerdown / pointermove / click 等）；
 * - 沙盒保护机制：
 *   1. 静态标识符拦截（PISC_FORBIDDEN）：阻止 window, document, fetch, localStorage, Worker 等全局对象与网络/存储 API；
 *   2. 作用域形参遮蔽：将高危全局变量遮蔽为 undefined，并注入安全的受限接口；
 *   3. 生命周期与资源追踪：自动追踪与清理 requestAnimationFrame、setTimeout、setInterval 与 card 上的事件监听，
 *      防止内存泄漏与后台无意义消耗。
 */

import { t } from '../i18n'
import type { PluginRenderContext } from './renderPlugins'

/** 围栏语言标识 */
export const PISC_LANG = 'pisc'

/**
 * 仿真代码安全静态拦截规则：
 * 严禁代码中直接访问外部 DOM/BOM 全局对象、网络请求、本地存储及多线程 Worker。
 */
export const PISC_FORBIDDEN =
  /\b(?:window|document|globalThis|parent|top|frames|localStorage|sessionStorage|indexedDB|cookie|fetch|XMLHttpRequest|WebSocket|Worker|SharedWorker|process|require|electron|navigator|location|history|eval|Function)\b/

/** 危险变量形参遮蔽名单（注意：eval 与 arguments 在严格模式下不可作为形参名，由 PISC_FORBIDDEN 静态拦截） */
const SHADOW_VARS = [
  'window',
  'document',
  'globalThis',
  'top',
  'parent',
  'self',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'SharedWorker',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'navigator',
  'location',
  'history',
  'process',
  'require',
]

/** 扩展带便捷交互辅助的 Canvas 元素接口 */
export interface PiscCanvasElement extends HTMLCanvasElement {
  /** 获取指针事件在画布局部坐标系（0..width, 0..height）中的坐标 */
  getPointerPos(e: MouseEvent | TouchEvent | PointerEvent): { x: number; y: number }
  /** 当前宿主是否处于深色模式 */
  readonly isDark: boolean
  /** 当前仿真卡片的标题 */
  readonly cardTitle?: string
  /** 注册卡片卸载/重置时的销毁回调 */
  onDestroy?(cleanup: () => void): void
}

/** 检查当前是否为深色模式 */
export function isDarkModeActive(): boolean {
  if (typeof document === 'undefined') return false
  const root = document.documentElement
  const dataTheme = root.getAttribute('data-theme')
  if (
    dataTheme === 'dark' ||
    dataTheme === 'graphite' ||
    dataTheme === 'navy' ||
    dataTheme === 'contrast' ||
    dataTheme === 'black' ||
    dataTheme === 'cyber'
  ) {
    return true
  }
  if (root.classList.contains('dark')) return true
  if (dataTheme === 'system' || !dataTheme) {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return false
}

/**
 * 降级展示错误信息的卡片（严格直角风格）
 */
export function piscFallback(message: string, source: string, ctx: PluginRenderContext): string {
  return (
    `<div class="moji-pisc moji-pisc-error">` +
    `<div class="moji-pisc-msg">${ctx.escape(message)}</div>` +
    `<pre><code>${ctx.escape(source.trim())}</code></pre>` +
    `</div>`
  )
}

/**
 * 将 ```pisc [title] 围栏转换为占位 HTML
 * @param source 代码块正文
 * @param ctx 插件上下文
 * @param info 围栏同行的附加标题（如 ```pisc 阻尼简谐振动 中的标题）
 */
export function piscBlock(source: string, ctx: PluginRenderContext, info = ''): string {
  const raw = source.trim()
  const cleanTitle = (info ?? '').replace(/^["'“”](.*)["'“”]$/, '$1').trim()
  const displayTitle = cleanTitle || t('可交互仿真卡片')

  if (!raw) return piscFallback(t('仿真卡片代码为空'), source, ctx)
  if (PISC_FORBIDDEN.test(raw)) {
    return piscFallback(
      t('仿真代码含有受限的全局对象或网络 API（仅允许在 canvas 中进行绘图与交互）'),
      source,
      ctx,
    )
  }

  return (
    `<div class="moji-pisc" data-pisc="${ctx.attr(raw)}" data-pisc-title="${ctx.attr(displayTitle)}">` +
    `<div class="moji-pisc-head">` +
    `<div class="moji-pisc-title">` +
    `<svg class="moji-pisc-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>` +
    `<line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>` +
    `<line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>` +
    `<line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line>` +
    `<line x1="17" y1="16" x2="23" y2="16"></line>` +
    `</svg>` +
    `<span class="moji-pisc-label">${ctx.escape(displayTitle)}</span>` +
    `</div>` +
    `<button type="button" class="moji-pisc-btn moji-pisc-reset-btn" title="${t('重置仿真')}">` +
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>` +
    `<path d="M3 3v5h5"></path>` +
    `</svg>` +
    `</button>` +
    `</div>` +
    `<div class="moji-pisc-stage">` +
    `<canvas class="moji-pisc-canvas" width="640" height="360"></canvas>` +
    `</div>` +
    `<div class="moji-pisc-status"></div>` +
    `</div>`
  )
}

/**
 * 在受控沙盒中运行仿真代码
 * @returns 销毁与资源清理函数
 */
export function runPiscSandbox(
  card: PiscCanvasElement,
  code: string,
  onError?: (err: Error) => void,
): () => void {
  // 资源与监听器追踪表
  const activeRafs = new Set<number>()
  const activeTimeouts = new Set<number>()
  const activeIntervals = new Set<number>()
  const trackedListeners: Array<{
    type: string
    listener: EventListenerOrEventListenerObject
    options?: boolean | AddEventListenerOptions
  }> = []

  let customDestroy: (() => void) | undefined

  // 挂载 helper 方法
  card.getPointerPos = (e: MouseEvent | TouchEvent | PointerEvent) => {
    const rect = card.getBoundingClientRect()
    const scaleX = rect.width > 0 ? card.width / rect.width : 1
    const scaleY = rect.height > 0 ? card.height / rect.height : 1

    let clientX = 0
    let clientY = 0

    if ('clientX' in e && typeof e.clientX === 'number') {
      clientX = e.clientX
      clientY = e.clientY
    } else if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    }

    return {
      x: Math.max(0, Math.min(card.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(card.height, (clientY - rect.top) * scaleY)),
    }
  }

  Object.defineProperty(card, 'isDark', {
    get: isDarkModeActive,
    configurable: true,
  })

  card.onDestroy = (fn: () => void) => {
    customDestroy = fn
  }

  // 劫持 addEventListener 便于统一注销
  const origAddEventListener = card.addEventListener.bind(card)
  const origRemoveEventListener = card.removeEventListener.bind(card)

  card.addEventListener = (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    trackedListeners.push({ type, listener, options })
    origAddEventListener(type, listener, options)
  }

  // 安全受控的异步/定时调度
  const safeRAF = (cb: FrameRequestCallback): number => {
    if (typeof window === 'undefined') return 0
    const id = window.requestAnimationFrame((time) => {
      activeRafs.delete(id)
      cb(time)
    })
    activeRafs.add(id)
    return id
  }

  const safeCAF = (id: number): void => {
    if (typeof window === 'undefined') return
    activeRafs.delete(id)
    window.cancelAnimationFrame(id)
  }

  const safeSetTimeout = (handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
    if (typeof window === 'undefined') return 0
    const id = window.setTimeout(
      (...a: unknown[]) => {
        activeTimeouts.delete(id)
        if (typeof handler === 'function') handler(...a)
      },
      timeout,
      ...args,
    )
    activeTimeouts.add(id)
    return id
  }

  const safeClearTimeout = (id: number): void => {
    if (typeof window === 'undefined') return
    activeTimeouts.delete(id)
    window.clearTimeout(id)
  }

  const safeSetInterval = (handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
    if (typeof window === 'undefined') return 0
    const id = window.setInterval(handler, timeout, ...args)
    activeIntervals.add(id)
    return id
  }

  const safeClearInterval = (id: number): void => {
    if (typeof window === 'undefined') return
    activeIntervals.delete(id)
    window.clearInterval(id)
  }

  const safeConsole = {
    log: (...args: unknown[]) => console.log('[pisc]', ...args),
    info: (...args: unknown[]) => console.info('[pisc]', ...args),
    warn: (...args: unknown[]) => console.warn('[pisc]', ...args),
    error: (...args: unknown[]) => console.error('[pisc]', ...args),
  }

  const safePerformance = {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  }

  let returnedCleanup: unknown

  try {
    const paramNames = [
      'card',
      ...SHADOW_VARS,
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'console',
      'performance',
      `"use strict";\n${code}`,
    ]
    // 构造沙盒执行器：传入 card，将高危全局变量全部绑定为 undefined，注入受控安全 API
    const runner = new Function(...paramNames)
    const undefinedShadows = SHADOW_VARS.map(() => undefined)

    returnedCleanup = runner.call(
      card,
      card,
      ...undefinedShadows,
      safeRAF,
      safeCAF,
      safeSetTimeout,
      safeClearTimeout,
      safeSetInterval,
      safeClearInterval,
      safeConsole,
      safePerformance,
    )
  } catch (err) {
    const errorObj = err instanceof Error ? err : new Error(String(err))
    onError?.(errorObj)
  }

  // 资源清理闭包
  return () => {
    // 1. 注销画布事件监听
    for (const { type, listener, options } of trackedListeners) {
      try {
        origRemoveEventListener(type, listener, options)
      } catch {}
    }
    trackedListeners.length = 0

    // 2. 清理动画与定时器
    if (typeof window !== 'undefined') {
      for (const id of activeRafs) window.cancelAnimationFrame(id)
      for (const id of activeTimeouts) window.clearTimeout(id)
      for (const id of activeIntervals) window.clearInterval(id)
    }
    activeRafs.clear()
    activeTimeouts.clear()
    activeIntervals.clear()

    // 3. 执行用户自定义清理函数
    if (typeof returnedCleanup === 'function') {
      try {
        returnedCleanup()
      } catch {}
    }
    if (typeof customDestroy === 'function') {
      try {
        customDestroy()
      } catch {}
    }
  }
}

/**
 * 挂载根节点内所有可交互仿真卡片（```pisc）
 */
export function hydratePisc(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  const cards = Array.from(root.querySelectorAll<HTMLElement>('.moji-pisc[data-pisc]'))

  for (const container of cards) {
    if (container.dataset.hydrated === 'true') continue
    container.dataset.hydrated = 'true'

    const rawCode = container.getAttribute('data-pisc')
    if (!rawCode) continue

    let code = ''
    try {
      code = decodeURIComponent(rawCode)
    } catch {
      code = rawCode
    }

    const rawTitle = container.getAttribute('data-pisc-title')
    let title = ''
    if (rawTitle) {
      try {
        title = decodeURIComponent(rawTitle)
      } catch {
        title = rawTitle
      }
    }

    const canvas = container.querySelector<PiscCanvasElement>('canvas.moji-pisc-canvas')
    const statusEl = container.querySelector<HTMLElement>('.moji-pisc-status')
    const resetBtn = container.querySelector<HTMLButtonElement>('.moji-pisc-reset-btn')

    if (!canvas) continue

    if (title) {
      Object.defineProperty(canvas, 'cardTitle', {
        value: title,
        writable: false,
        configurable: true,
      })
    }

    let instanceCleanup: (() => void) | null = null

    const startInstance = () => {
      // 停止上一实例
      if (instanceCleanup) {
        instanceCleanup()
        instanceCleanup = null
      }

      // 重置状态与画布绘制区
      if (statusEl) statusEl.innerHTML = ''
      const ctx = canvas.getContext?.('2d')
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }

      instanceCleanup = runPiscSandbox(canvas, code, (err) => {
        if (statusEl) {
          statusEl.innerHTML =
            `<div class="moji-pisc-msg">${t('仿真脚本执行异常: {0}', err.message)}</div>`
        }
      })
    }

    startInstance()

    if (resetBtn) {
      const onResetClick = (e: MouseEvent) => {
        e.preventDefault()
        startInstance()
      }
      resetBtn.addEventListener('click', onResetClick)
      cleanups.push(() => {
        resetBtn.removeEventListener('click', onResetClick)
        if (instanceCleanup) instanceCleanup()
      })
    } else {
      cleanups.push(() => {
        if (instanceCleanup) instanceCleanup()
      })
    }
  }

  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch {}
    }
  }
}

/**
 * 教学 Agent 的 PISC 语法指引（用于系统提示词与指引）。
 */
export const PISC_SYNTAX_GUIDE = `通用参数化可交互教学仿真卡片（PISC）：用三个反引号 + pisc 编写自包含的交互式动态仿真画布，支持在同一行后直接指定卡片标题。
- 语法格式：
\`\`\`pisc [自定义卡片标题，可选]
// card 为传入的 HTMLCanvasElement 实例，默认尺寸 640x360
const ctx = card.getContext('2d');
// 在 canvas 内部进行纯图形绘制与事件交互
\`\`\`
- 标题语法示例：
  · \`\`\`pisc 简谐振动受迫共振动态模拟\`\`\`
  · \`\`\`pisc 快速排序双指针分区演化过程\`\`\`
  · \`\`\`pisc Lotka-Volterra 捕食者与猎物相空间周期\`\`\`
- 运行机制与沙盒边界：
  · 传入名为 card 的 canvas 实例（this 亦指向 card）；
  · 代码运行在严格受限的沙盒中，**严禁使用任何 emoji 图标，严禁访问 window / document / DOM 外部节点 / 网络与本地存储 API**；
  · 仅允许在 card 提供的 canvas 画布上使用 Canvas 2D API 绘图，并通过 card.addEventListener 监听鼠标/触控交互（如 pointerdown, pointermove, pointerup, click）；
  · 便捷辅助：可调用 card.getPointerPos(e) 精确换算鼠标/触控在画布局部坐标系（0..width, 0..height）中的坐标；读取 card.isDark 获知当前是否为深色主题；读取 card.cardTitle 获知卡片标题；
  · 支持标准的 requestAnimationFrame、cancelAnimationFrame、setTimeout、setInterval 以及 Math、Date、Array 等标准语言特性；
  · 支持返回清理函数（或设置 card.onDestroy = fn）在卡片重置/卸载时清理资源。
- 泛化应用场景（允许出现在任何需要直观可交互教学、打破抽象认知壁垒的场景中，不仅限于数学）：
  1. **物理与工程科学**：动力学与天体轨道、带电粒子偏转、波动干涉衍射、热力学分子运动、RLC电路阻尼、PID控制回路响应；
  2. **计算机科学与软件工程**：算法执行演化（排序/最短路/A*寻路/动态规划填表）、数据结构动态操作（树平衡旋转/堆调整/哈希冲突）、OS内存分页与调度、TCP滑动窗口与状态机；
  3. **数理统计与几何**：微积分极限与导数切线逼近、矩阵线性变换网格拉伸、概率分布与马尔可夫链、梯度下降极值优化；
  4. **生物学与生态演化**：种群竞争与捕食周期、基因漂变与遗传规律、神经元动作电位脉冲触发；
  5. **经济学与社会博弈**：市场供需均衡曲线动态漂移、囚徒困境演化博弈；
  6. **通用概念实验台与互动探究**：在任何需要让学习者“调一调参数、拖一拖节点、直观看到结果变化”的教学节点中主动引入。
- 界面规范与设计建议：
  · 卡片与内部元素遵循极简纯直角（无圆角）设计语言；
  · 重置按钮为纯 SVG 图标，无边框背景与文字；
  · 在 canvas 画布内部直接绘制简洁的参数调节滑块、状态开关或可拖拽控制点，标注参数数值与物理量单位。`
