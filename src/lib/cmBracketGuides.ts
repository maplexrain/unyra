import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { matchBrackets } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

/**
 * 跨行配对符号辅助线（Bracket Pair Connector Guides）：
 * 为代码中不同行的配对符号（如跨行大括号 {}、中括号 []、圆括号 ()）
 * 提供连贯直观的结构辅助线连接，方便一眼识别深层嵌套与块级对应关系。
 *
 * 规范与约束：
 * 1. 同一行的配对符号（如 import { foo } from 'bar'、单行数组/对象）绝对不连线，保持行内代码清爽；
 * 2. 跨行配对符号从开括号向左拐弯并垂直向下延伸贯穿，最后平滑连接至闭括号，形成优美的包络辅助线；
 * 3. 光标当前所在的最内层配对符号高亮为天青色实线微光（Active Guide），其余层级以沉浸半透虚线呈现；
 * 4. 严格在 CodeMirror 6 的 requestMeasure 周期内读取几何尺寸与写回 SVG，零重排开销。
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

  // 2. 为了保证视口内看到闭括号时、其开括号在视口上方也能被连接，
  // 向上扩展扫描范围或针对当前光标所在行回溯
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

      const measured: MeasuredGuide[] = []

      for (const pair of pairs) {
        // 读取开括号与闭括号的具体字符屏幕坐标
        const openCoords = view.coordsAtPos(pair.openPos)
        const closeCoords = view.coordsAtPos(pair.closePos)

        // 倘若开闭两端都完全在视口外且无法获取坐标，则跳过
        if (!openCoords && !closeCoords) continue

        let openX: number
        let openY: number
        let closeX: number
        let closeY: number

        if (openCoords) {
          openX = openCoords.left - scrollerRect.left + scrollLeft
          openY = openCoords.top - scrollerRect.top + scrollTop + (openCoords.bottom - openCoords.top) / 2
        } else {
          // 开括号在视口上方溢出：取视口顶部截断
          openX = scrollerRect.left + 20
          openY = Math.max(0, scrollTop - 10)
        }

        if (closeCoords) {
          closeX = closeCoords.left - scrollerRect.left + scrollLeft
          closeY = closeCoords.top - scrollerRect.top + scrollTop + (closeCoords.bottom - closeCoords.top) / 2
        } else {
          // 闭括号在视口下方溢出：向下平滑延伸
          closeX = openX
          closeY = scrollTop + scrollerRect.height + 20
        }

        // 垂直导线对齐基准：以闭括号左侧偏左或缩进位置为导向
        const r = 4 // 圆角半径
        const guideX = Math.max(8, Math.min(openX, closeX) - 3)

        // 生成带平滑圆角的标准折线 SVG 路径数据：
        // 开括号(openX, openY) -> 水平折向(guideX + r, openY) -> 圆角转垂直 -> 延伸至(guideX, closeY - r) -> 圆角转水平 -> 闭括号(closeX, closeY)
        const pathData =
          openY < closeY
            ? `M ${openX} ${openY} H ${guideX + r} Q ${guideX} ${openY} ${guideX} ${openY + r} V ${closeY - r} Q ${guideX} ${closeY} ${guideX + r} ${closeY} H ${closeX}`
            : `M ${openX} ${openY} V ${closeY} H ${closeX}`

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

/** 跨行括号辅助线主题样式 */
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
  // 未激活状态下的背景跨行括号导线：优雅低调的微光虚线，清晰分明且绝不抢戏
  '.cm-bracket-guide-line': {
    stroke: 'color-mix(in srgb, var(--color-ink, #cdd6f4) 18%, transparent)',
    strokeWidth: '1.2px',
    strokeDasharray: '3.5 2.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    transition: 'stroke 140ms ease, stroke-width 140ms ease',
  },
  // 当前光标所处代码块激活的跨行配对连线：醒目的天青色微光实线，配合柔和外发光
  '.cm-bracket-guide-line.cm-bracket-guide-active': {
    stroke: 'var(--color-seal, #38bdf8)',
    strokeWidth: '1.5px',
    strokeDasharray: 'none',
    filter: 'drop-shadow(0 0 3px color-mix(in srgb, var(--color-seal, #38bdf8) 60%, transparent))',
  },
})

/**
 * 导出 CodeMirror 6 跨行配对符号辅助线连接扩展
 */
export function bracketPairGuides(): Extension {
  return [ViewPlugin.fromClass(BracketGuidesPlugin), bracketGuidesTheme]
}
