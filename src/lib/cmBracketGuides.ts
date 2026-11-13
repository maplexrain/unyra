import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { matchBrackets } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

/**
 * 跨行配对符号辅助线（Bracket Pair Connector Guides）：
 * 为代码中不同行的配对符号（如跨行大括号 {}、中括号 []、圆括号 ()）
 * 提供结构辅助线连接，方便一眼识别深层嵌套与块级对应关系。
 *
 * 核心准则：
 * 1. 绝对不能贯穿文字：若开括号或闭括号所在行包含前置代码文字（如 var MOUSE = {），
 *    严禁横穿代码文字，垂直线自该行下沿起步，开括号字符下方以纯净下标底托示意，文字行 100% 保持干净；
 * 2. 视觉沉浸克制，绝不喧宾夺主：线宽严格 1px，彻底去除发光模糊光晕（drop-shadow），色彩轻透自然；
 * 3. 纯直角折线，不要圆角：拐角全部采用标准的 90 度直角折转（M/H/V），线条利落干脆；
 * 4. 同行配对符号（如 import { foo } from 'bar'、单行数组等）严格剔除不画线。
 */

interface MeasuredGuide {
  id: string
  pathData: string
  isActive: boolean
}

/** 向上回溯查找覆盖光标的外层跨行配对的最大行数 */
const MAX_ENCLOSING_LOOKBACK = 120

export function findCrossLineBracketPairs(view: EditorView): Array<{
  openPos: number
  closePos: number
  startLine: number
  endLine: number
  isActive: boolean
}> {
  const { state } = view
  const doc = state.doc
  if (doc.length === 0) return []

  const pairs: Array<{
    openPos: number
    closePos: number
    startLine: number
    endLine: number
    isActive: boolean
  }> = []
  const seenOpenPos = new Set<number>()
  const head = state.selection.main.head

  // 1. 扫描当前视口可见区域内的所有开括号
  const vp = view.viewport
  const vpStartLine = doc.lineAt(vp.from).number
  const vpEndLine = doc.lineAt(vp.to).number

  // 2. 向上扩展扫描范围，确保视口内包含的闭括号能对应到上方可视外的开括号
  const curLine = doc.lineAt(head).number
  const minScanLine = Math.max(1, Math.min(vpStartLine - 10, curLine - MAX_ENCLOSING_LOOKBACK))
  const maxScanLine = Math.min(doc.lines, vpEndLine + 10)

  for (let l = minScanLine; l <= maxScanLine; l++) {
    const line = doc.line(l)
    const text = line.text
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === '{' || ch === '[' || ch === '(') {
        const openPos = line.from + i
        if (seenOpenPos.has(openPos)) continue

        const match = matchBrackets(state, openPos, 1)
        if (match && match.matched && match.end) {
          seenOpenPos.add(openPos)
          const closePos = match.end.from
          const startLine = doc.lineAt(openPos).number
          const endLine = doc.lineAt(closePos).number

          // 核心规矩：同一行的配对绝对不用辅助线连接，仅对不同行配对符号画线
          if (startLine !== endLine) {
            const isActive = head >= openPos && head <= match.end.to
            pairs.push({
              openPos,
              closePos,
              startLine,
              endLine,
              isActive,
            })
          }
        }
      }
    }
  }

  return pairs
}

class BracketGuidesPlugin {
  readonly view: EditorView
  private svgEl: SVGSVGElement
  private groupEl: SVGGElement

  private measureReq = {
    read: (view: EditorView): MeasuredGuide[] => {
      const pairs = findCrossLineBracketPairs(view)
      if (pairs.length === 0) return []

      const scrollerRect = view.scrollDOM.getBoundingClientRect()
      const scrollLeft = view.scrollDOM.scrollLeft
      const scrollTop = view.scrollDOM.scrollTop
      const doc = view.state.doc

      const measured: MeasuredGuide[] = []

      for (const pair of pairs) {
        // 读取开括号与闭括号的具体字符屏幕坐标
        const openCoords = view.coordsAtPos(pair.openPos)
        const closeCoords = view.coordsAtPos(pair.closePos)

        // 倘若开闭两端都完全在视口外且无法获取坐标，则跳过
        if (!openCoords && !closeCoords) continue

        const startLine = doc.line(pair.startLine)
        const endLine = doc.line(pair.endLine)

        const openCharIdx = pair.openPos - startLine.from
        const closeCharIdx = pair.closePos - endLine.from

        // 核心安全原则：检查开闭括号左侧是否含有非空白文字
        const openHasPrefix = /\S/.test(startLine.text.slice(0, openCharIdx))
        const closeHasPrefix = /\S/.test(endLine.text.slice(0, closeCharIdx))

        let openX = 0
        let openY = 0
        let openBottom = 0
        let openCharWidth = 8

        if (openCoords) {
          openX = Math.round(openCoords.left - scrollerRect.left + scrollLeft)
          openY = Math.round(openCoords.top - scrollerRect.top + scrollTop + (openCoords.bottom - openCoords.top) / 2)
          openBottom = Math.round(openCoords.bottom - scrollerRect.top + scrollTop)
          openCharWidth = Math.max(6, Math.round(openCoords.right - openCoords.left))
        } else {
          // 开括号在视口上方溢出：取视口顶部截断
          openX = scrollerRect.left + 20
          openY = Math.max(0, scrollTop - 10)
          openBottom = openY + 16
        }

        let closeX = 0
        let closeY = 0

        if (closeCoords) {
          closeX = Math.round(closeCoords.left - scrollerRect.left + scrollLeft)
          closeY = Math.round(closeCoords.top - scrollerRect.top + scrollTop + (closeCoords.bottom - closeCoords.top) / 2)
        } else {
          // 闭括号在视口下方溢出：向下平滑延伸
          closeX = openX
          closeY = scrollTop + scrollerRect.height + 20
        }

        // 垂直导轨 X 坐标：对齐在闭括号左侧空白处（通常离闭括号字符 4px）
        // 确保垂直线走在左侧空白缩进槽内，绝不贴字
        const guideX = Math.max(6, Math.min(openX, closeX) - 4)

        // 构建纯直角折线（绝对不要圆角，全部使用直角 M / H / V）
        let pathData = ''

        if (openHasPrefix) {
          // 第一原则：开括号前面有文字（如 var MOUSE = {），严禁水平横线横穿文字！
          // 垂直导轨线从开括号所在行底边 (openBottom) 垂直向下延伸到闭括号高度
          // 并在开括号字符正下方画一个微小精致的直角下标托线，清晰呼应括号本体，文字中间 100% 保持干净
          if (!closeHasPrefix) {
            pathData = `M ${guideX} ${openBottom} V ${closeY} H ${closeX} M ${openX} ${openBottom} H ${openX + openCharWidth}`
          } else {
            pathData = `M ${guideX} ${openBottom} V ${closeY} M ${openX} ${openBottom} H ${openX + openCharWidth}`
          }
        } else {
          // 开括号前面是纯缩进空白（如换行单独成行的 {）：水平线在空白区域延伸，绝不贯穿文字
          if (!closeHasPrefix) {
            pathData = `M ${openX} ${openY} H ${guideX} V ${closeY} H ${closeX}`
          } else {
            pathData = `M ${openX} ${openY} H ${guideX} V ${closeY}`
          }
        }

        measured.push({
          id: `${pair.openPos}-${pair.closePos}`,
          pathData,
          isActive: pair.isActive,
        })
      }

      return measured
    },

    write: (measured: MeasuredGuide[]) => {
      // 清空旧路径，高效同步新几何线条
      while (this.groupEl.firstChild) {
        this.groupEl.removeChild(this.groupEl.firstChild)
      }

      for (const item of measured) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', item.pathData)
        path.setAttribute('class', `cm-bracket-guide-line ${item.isActive ? 'cm-bracket-guide-active' : ''}`)
        path.setAttribute('fill', 'none')
        this.groupEl.appendChild(path)
      }
    },
  }

  constructor(view: EditorView) {
    this.view = view

    // 创建 SVG 辅助线承载容器并追加到 scrollDOM 下层
    this.svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.svgEl.setAttribute('class', 'cm-bracket-guides-svg')
    this.svgEl.setAttribute('aria-hidden', 'true')

    this.groupEl = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.svgEl.appendChild(this.groupEl)

    // 插入在 scrollDOM 内部文本图层之后，避免阻挡任何点击选择
    this.view.scrollDOM.appendChild(this.svgEl)
    this.scheduleMeasure()
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
      this.scheduleMeasure()
    }
  }

  private scheduleMeasure() {
    this.view.requestMeasure(this.measureReq)
  }

  destroy() {
    this.svgEl.remove()
  }
}

/** 跨行括号辅助线主题样式：克制沉浸、极细直角、不喧宾夺主 */
const bracketGuidesTheme = EditorView.baseTheme({
  '.cm-bracket-guides-svg': {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'visible',
    zIndex: 1,
  },
  // 未激活状态下的背景跨行括号导线：极细低调的半透明点虚线，安静不抢戏
  '.cm-bracket-guide-line': {
    stroke: 'color-mix(in srgb, var(--color-ink, #cdd6f4) 11%, transparent)',
    strokeWidth: '1px',
    strokeDasharray: '2.5 3',
    strokeLinecap: 'square',
    strokeLinejoin: 'miter',
    shapeRendering: 'crispEdges',
    transition: 'stroke 120ms ease, opacity 120ms ease',
  },
  // 当前光标所处代码块激活的跨行配对连线：纯净优雅的天青墨色 1px 直角细实线，不带任何刺眼的发光光晕模糊
  '.cm-bracket-guide-line.cm-bracket-guide-active': {
    stroke: 'color-mix(in srgb, var(--color-seal, #38bdf8) 42%, transparent)',
    strokeWidth: '1px',
    strokeDasharray: 'none',
    filter: 'none',
  },
})

/**
 * 导出 CodeMirror 6 跨行配对符号辅助线连接扩展
 */
export function bracketPairGuides(): Extension {
  return [ViewPlugin.fromClass(BracketGuidesPlugin), bracketGuidesTheme]
}
