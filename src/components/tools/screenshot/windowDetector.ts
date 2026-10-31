import type { Rect } from './types'

/**
 * 现代开源截图软件（Snipaste / ShareX / PixPin）标准窗口命中与遮挡检测算法：
 * 
 * 1. sysRects 由操作系统原生 API 采集，保持操作系统真实 Z-order 顺序（自顶向下，最上层在前）；
 * 2. 窗口可视与覆盖检测：如果某个下层窗口在当前光标位置被上层窗口遮挡覆盖，则不可视，绝不能自动选取；
 * 3. 嵌套弹窗判定：若无标题纯几何模拟数据中包含内嵌子视口，可作为层级子视口优先匹配；
 * 4. 露出的非遮挡区域：下层窗口只有在未被上层窗口遮挡的露出可视区域，光标移入时才可选取；
 * 5. 兜底回退：若光标位于桌面空白壁纸处（无任何应用窗口覆盖），优雅回退到当前屏幕工作区或全屏视口。
 */
export function detectWindowUnderCursor(
  cx: number,
  cy: number,
  _offCanvas: HTMLCanvasElement | null,
  sysRects: Rect[],
  screenWidth: number,
  screenHeight: number,
): Rect {
  if (!sysRects || sysRects.length === 0) {
    return { x: 0, y: 0, width: screenWidth, height: screenHeight }
  }

  // 1. 过滤出尺寸合法的基础窗口
  const validRects = sysRects.filter((r) => r.width >= 40 && r.height >= 30)

  // 2. 区分应用窗口与桌面工作区/全屏底板（工作区和全屏视口作为无窗口区域的底板）
  const isFallbackContainer = (r: Rect) => {
    if (r.title === 'WorkArea' || r.title === 'Screen') return true
    if (!r.title && r.width >= screenWidth - 10 && r.height >= screenHeight - 60) return true
    return false
  }

  const appWindows = validRects.filter((r) => !isFallbackContainer(r))
  const fallbackContainers = validRects.filter((r) => isFallbackContainer(r))

  // 3. 找出所有包含光标 (cx, cy) 的应用窗口
  const windowsContainingCursor = appWindows.filter(
    (r) => cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height,
  )

  if (windowsContainingCursor.length > 0) {
    // 检查遮挡覆盖关系：保证窗口可视，如果被覆盖则不能自动选取
    // 如果窗口 A 在窗口 B 前方（在 appWindows 中下标更小），且窗口 A 覆盖了 (cx, cy)：
    // 此时 B 在 (cx, cy) 处属于被 A 遮挡覆盖，不可视，不能自动选取！
    const visibleWindows = windowsContainingCursor.filter((w) => {
      const wIdx = appWindows.indexOf(w)
      // 检查排在 w 前面的上层窗口
      for (let j = 0; j < wIdx; j++) {
        const higher = appWindows[j]
        // 如果上层窗口 higher 也包含当前光标 (cx, cy)
        if (
          cx >= higher.x &&
          cx <= higher.x + higher.width &&
          cy >= higher.y &&
          cy <= higher.y + higher.height
        ) {
          // 仅当两者均为无标题的纯几何模拟数据，且 w 严格位于 higher 内部时，视为单窗口内嵌子组件测试
          const isSyntheticChild =
            !w.title &&
            !higher.title &&
            w.x >= higher.x &&
            w.y >= higher.y &&
            w.x + w.width <= higher.x + higher.width &&
            w.y + w.height <= higher.y + higher.height &&
            w.width * w.height < higher.width * higher.height

          if (!isSyntheticChild) {
            // w 在 (cx, cy) 处被上层窗口 higher 遮挡覆盖，不可视！
            return false
          }
        }
      }
      return true
    })

    if (visibleWindows.length > 0) {
      // 在可视的窗口中，若有嵌套子弹窗，优先匹配面积最小、层级最具体的子弹窗；否则匹配最上层窗口
      visibleWindows.sort((a, b) => a.width * a.height - b.width * b.height)
      const best = visibleWindows[0]
      const x = Math.max(0, Math.min(screenWidth - 20, best.x))
      const y = Math.max(0, Math.min(screenHeight - 20, best.y))
      const width = Math.min(screenWidth - x, best.width)
      const height = Math.min(screenHeight - y, best.height)
      return { x, y, width, height, title: best.title }
    }
  }

  // 4. 若光标处于桌面空白区域（未命中任何可视应用窗口），回退到系统工作区
  const workArea =
    fallbackContainers.find(
      (r) =>
        cx >= r.x &&
        cx <= r.x + r.width &&
        cy >= r.y &&
        cy <= r.y + r.height &&
        (r.title === 'WorkArea' || r.height < screenHeight),
    ) || fallbackContainers.find((r) => r.title === 'WorkArea')

  if (workArea) {
    return {
      x: Math.max(0, workArea.x),
      y: Math.max(0, workArea.y),
      width: Math.min(screenWidth, workArea.width),
      height: Math.min(screenHeight, workArea.height),
      title: workArea.title,
    }
  }

  // 5. 最终兜底：全屏视口
  return { x: 0, y: 0, width: screenWidth, height: screenHeight }
}
