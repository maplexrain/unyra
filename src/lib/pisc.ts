/**
 * 参数化可交互仿真卡片（```pisc）
 *
 * 语法与渲染设计：
 * - 解析期（renderNote）：同步产出占位容器 HTML，记录编码后的 JS 源码；
 * - 挂载期（hydratePisc）：在 DOM 提交后，为每个卡片实例化一个名为 card 的 HTMLCanvasElement，
 *   并置于受限沙盒中执行，只允许在 canvas 上绘图并监听交互事件（pointerdown / pointermove / click 等）；
 * - 沙盒保护机制：
 *   1. 静态标识符拦截（PISC_FORBIDDEN）：阻止 window, document, fetch, localStorage, Worker 等全局对象与网络/存储 API；
 *   2. 作用域形参遮蔽：将危险全局变量遮蔽为 undefined，并注入安全的受限接口；
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
 * 降级展示错误信息的卡片
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
 * 将 ```pisc 围栏转换为占位 HTML
 */
export function piscBlock(source: string, ctx: PluginRenderContext): string {
  const raw = source.trim()
  if (!raw) return piscFallback(t('仿真卡片代码为空'), source, ctx)
  if (PISC_FORBIDDEN.test(raw)) {
    return piscFallback(
      t('仿真代码含有受限的全局对象或网络 API（仅允许在 canvas 中进行绘图与交互）'),
      source,
      ctx,
    )
  }

  return (
    `<div class="moji-pisc" data-pisc="${ctx.attr(raw)}">` +
    `<div class="moji-pisc-head">` +
    `<div class="moji-pisc-title">` +
    `<span class="moji-pisc-icon">🕹️</span>` +
    `<span class="moji-pisc-label">${t('可交互仿真卡片')}</span>` +
    `</div>` +
    `<button type="button" class="moji-pisc-btn moji-pisc-reset-btn" title="${t('重新运行仿真')}">${t('重置')}</button>` +
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

    const canvas = container.querySelector<PiscCanvasElement>('canvas.moji-pisc-canvas')
    const statusEl = container.querySelector<HTMLElement>('.moji-pisc-status')
    const resetBtn = container.querySelector<HTMLButtonElement>('.moji-pisc-reset-btn')

    if (!canvas) continue

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
export const PISC_SYNTAX_GUIDE = `参数化可交互仿真卡片（PISC）：用三个反引号 + pisc 编写可交互的数学/物理/算法动态仿真画布。
- 语法格式：
\`\`\`pisc
// card 为传入的 HTMLCanvasElement 实例，默认尺寸 640x360
const ctx = card.getContext('2d');
// 编写绘制逻辑与交互逻辑
\`\`\`
- 运行机制与沙盒边界：
  · 传入名为 card 的 canvas 实例（this 亦指向 card）；
  · 代码运行在严格受限的沙盒中，**严禁访问 window / document / DOM 外部节点 / 网络 API**；
  · 仅允许在 card 提供的 canvas 画布上使用 Canvas 2D API 绘图，并通过 card.addEventListener 监听鼠标/触控交互（如 pointerdown, pointermove, pointerup, click）；
  · 便捷辅助：可调用 card.getPointerPos(e) 精确换算鼠标/触控在画布局部坐标系（0..width, 0..height）中的坐标；读取 card.isDark 获知当前是否为深色主题；
  · 支持标准的 requestAnimationFrame、cancelAnimationFrame、setTimeout、setInterval 以及 Math、Date 等标准对象；
  · 支持返回清理函数（或设置 card.onDestroy = fn）在卡片重置/卸载时清理资源。
- 适用场景：
  · 物理动力学仿真（单摆、阻尼振动、小球碰撞、万有引力引力场轨迹）；
  · 数学与几何可视化（函数极值梯度下降过程、傅里叶级数合成波、矢量场与流线、三维旋转投影）；
  · 计算机科学与算法演示（排序算法动态演进、二叉树构建遍历、网格寻路 A*、蒙特卡洛积分采样）；
  · 控制理论与系统仿真（PID 调节器动态响应、状态机与反馈回路）。
- 设计建议：
  · 在 canvas 画布内绘制参数调节区域（如滑块、按钮、可拖拽控制点）；
  · 提供直观的数字指示与坐标轴/标签，让学习者能直观通过鼠标拖拽交互，感知参数对系统的动态影响。`
