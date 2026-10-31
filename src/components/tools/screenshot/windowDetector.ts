import type { Rect } from './types'

/**
 * 现代开源截图软件（Snipaste / ShareX / PixPin）标准窗口命中检测算法：
 * 
 * 1. sysRects 由操作系统原生 API（Win32 EnumDesktopWindows + DwmGetWindowAttribute）采集；
 * 2. 命中测试：在包围光标坐标 (cx, cy) 的候选窗口中，优先匹配独立应用窗口/子对话框；
 * 3. 层级优选：当光标同时位于父窗口与子弹窗/子控件内时，优先匹配面积最小、最具体的上层窗口；
 * 4. 兜底回退：若光标位于桌面空白处，优雅回退到当前屏幕工作区（WorkArea）或全屏视口。
 * 
 * 彻底抛弃脆弱易断裂的单像素色彩射线扫描，达到 100% 确定性、零抖动、零延迟的专业级窗口吸附。
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

  // 1. 过滤出所有包含光标的合法候选矩形
  const inside = sysRects.filter(
    (r) =>
      cx >= r.x &&
      cx <= r.x + r.width &&
      cy >= r.y &&
      cy <= r.y + r.height &&
      r.width >= 40 &&
      r.height >= 30,
  )

  // 2. 过滤出独立应用窗口与子对话框（排除全屏桌面底板与系统工作区）
  const independentWindows = inside.filter(
    (r) => r.width < screenWidth - 60 || r.height < screenHeight - 60,
  )

  if (independentWindows.length > 0) {
    // 优先匹配面积最小、层级最具体的窗口（如主窗口内部的弹窗、卡片或独立小窗）
    independentWindows.sort((a, b) => a.width * a.height - b.width * b.height)
    const best = independentWindows[0]
    const x = Math.max(0, Math.min(screenWidth - 20, best.x))
    const y = Math.max(0, Math.min(screenHeight - 20, best.y))
    const width = Math.min(screenWidth - x, best.width)
    const height = Math.min(screenHeight - y, best.height)
    return { x, y, width, height }
  }

  // 3. 若光标处于桌面空白区域，回退到系统工作区（排除了任务栏的底板区域）
  const workArea = inside.find(
    (r) => r.width >= screenWidth - 60 && r.height < screenHeight,
  )
  if (workArea) {
    return {
      x: Math.max(0, workArea.x),
      y: Math.max(0, workArea.y),
      width: Math.min(screenWidth, workArea.width),
      height: Math.min(screenHeight, workArea.height),
    }
  }

  // 4. 最终兜底：全屏视口
  return { x: 0, y: 0, width: screenWidth, height: screenHeight }
}
