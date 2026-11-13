import { getIndentUnit, matchBrackets } from '@codemirror/language'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginValue,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { combineConfig, type Extension, Facet, RangeSetBuilder, type Line, type EditorState } from '@codemirror/state'

/**
 * IntelliJ IDEA 风格的垂直缩进导引线与跨行配对块高亮（Vertical Indent & Scope Guides）：
 *
 * 核心设计准则（严格对齐 IntelliJ IDEA 经典表现）：
 * 1. 纯垂直线（Vertical Guides）：只在行首的前导空白缩进列绘制垂直线，纯直角、零圆角；
 * 2. 绝对不贯穿文字：每行的导向线宽度严格限制在行首缩进空白宽度内，文字区域无任何多余线条遮挡；
 * 3. 绝不悬空右侧：垂直线永远位于左侧基准缩进槽内，绝不跟随行末开括号向右漂移；
 * 4. 极细克制不喧宾夺主：线宽严格 1px，未激活状态为极淡墨色点线，激活状态为天青色实线，无刺眼发光光晕；
 * 5. 同行配对不画线：单行符号（如 import { foo } from 'bar'）起止行相同，不产生跨行高亮；
 * 6. 活动作用域高亮（Active Scope Guide）：当光标在跨行代码块内部或在配对括号上时，该块左侧缩进线高亮贯穿全块。
 */

export interface IndentGuideConfig {
  highlightActiveBlock?: boolean
  hideFirstIndent?: boolean
  thickness?: number
}

const indentGuideFacet = Facet.define<IndentGuideConfig, Required<IndentGuideConfig>>({
  combine(configs) {
    return combineConfig(configs, {
      highlightActiveBlock: true,
      hideFirstIndent: true, // 默认隐藏第 0 列（贴着行号的那一条），保持行号边界干净清爽
      thickness: 1,
    })
  },
})

export interface CrossLinePair {
  openPos: number
  closePos: number
  startLine: number
  endLine: number
  isActive: boolean
}

const MAX_ENCLOSING_LOOKBACK = 120

/**
 * 辅助检测当前视口及周边的跨行配对符号（保持向后兼容及测试支持）
 */
export function findCrossLineBracketPairs(view: EditorView): CrossLinePair[] {
  const { state } = view
  const doc = state.doc
  if (doc.length === 0) return []

  const pairs: CrossLinePair[] = []
  const seenOpenPos = new Set<number>()
  const head = state.selection.main.head

  const vp = view.viewport
  const vpStartLine = doc.lineAt(vp.from).number
  const vpEndLine = doc.lineAt(vp.to).number

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

/** 计算字符串前导空白的有效缩进列数（兼容 Tab 与空格） */
function numColumns(str: string, tabSize: number): number {
  let col = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === ' ' || ch === '\u00A0') {
      col += 1
    } else if (ch === '\t') {
      col += tabSize - (col % tabSize)
    } else if (ch === '\r') {
      continue
    } else {
      break
    }
  }
  return col
}

interface IndentLineEntry {
  line: Line
  level: number
  empty: boolean
  activeLevel?: number
}

function getVisibleLines(view: EditorView, state: EditorState): Set<Line> {
  const lines = new Set<Line>()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = state.doc.lineAt(pos)
      if (!lines.has(line)) {
        lines.add(line)
      }
      pos = line.to + 1
    }
  }
  return lines
}

/**
 * 视口行缩进层级与当前活动块映射分析器
 */
class IndentationMap {
  private map = new Map<number, IndentLineEntry>()
  private lines: Set<Line>
  private state: EditorState
  private unitWidth: number

  constructor(
    lines: Set<Line>,
    state: EditorState,
    unitWidth: number,
  ) {
    this.lines = lines
    this.state = state
    this.unitWidth = unitWidth
    for (const line of this.lines) {
      this.add(line)
    }
    this.findAndSetActiveLines()
  }

  get(lineNo: number): IndentLineEntry | undefined {
    return this.map.get(lineNo)
  }

  private set(line: Line, level: number): IndentLineEntry {
    const empty = !line.text.trim().length
    const entry: IndentLineEntry = { line, level, empty }
    this.map.set(line.number, entry)
    return entry
  }

  private add(line: Line): IndentLineEntry {
    if (this.map.has(line.number)) {
      return this.map.get(line.number)!
    }

    if (!line.length || !line.text.trim().length) {
      if (line.number === 1) {
        return this.set(line, 0)
      }
      const prev = this.closestNonEmpty(line.number, -1)
      const next = this.closestNonEmpty(line.number, 1)
      if (prev.level >= next.level) {
        return this.set(line, prev.level)
      }
      if (next.level > prev.level) {
        return this.set(line, prev.level + 1)
      }
      return this.set(line, next.level)
    }

    const col = numColumns(line.text, this.state.tabSize)
    const level = Math.floor(col / this.unitWidth)
    return this.set(line, level)
  }

  private closestNonEmpty(startLineNo: number, dir: -1 | 1): { level: number } {
    let l = startLineNo + dir
    while (dir === -1 ? l >= 1 : l <= this.state.doc.lines) {
      if (this.map.has(l)) {
        const entry = this.map.get(l)!
        if (!entry.empty) return entry
      }
      const line = this.state.doc.line(l)
      if (line.text.trim().length) {
        const col = numColumns(line.text, this.state.tabSize)
        return { level: Math.floor(col / this.unitWidth) }
      }
      l += dir
    }
    return { level: 0 }
  }

  /**
   * 精确计算当前光标所处的跨行代码块，并高亮该代码块对应的垂直缩进导线
   */
  private findAndSetActiveLines() {
    const head = this.state.selection.main.head
    const curLine = this.state.doc.lineAt(head)

    // 1. 优先尝试精准配对括号检测：若光标正位于或紧邻某个括号字符
    const bracketPositions = [head, head - 1]
    for (const bPos of bracketPositions) {
      if (bPos >= 0 && bPos <= this.state.doc.length) {
        const match = matchBrackets(this.state, bPos, 1)
        if (match && match.matched && match.end) {
          const startLine = this.state.doc.lineAt(Math.min(bPos, match.end.from))
          const endLine = this.state.doc.lineAt(Math.max(bPos, match.end.from))
          if (startLine.number !== endLine.number) {
            // 获取块内部的缩进级别
            const startCol = numColumns(startLine.text, this.state.tabSize)
            const targetActiveLevel = Math.floor(startCol / this.unitWidth) + 1
            this.markActiveSpan(startLine.number, endLine.number, targetActiveLevel)
            return
          }
        }
      }
    }

    // 2. 启发式作用域分析（IntelliJ IDEA 经典机制）：基于当前行缩进深度向上和向下查找作用域
    let curEntry = this.get(curLine.number)
    if (!curEntry) {
      curEntry = this.add(curLine)
    }

    let activeLevel = curEntry.level
    if (activeLevel === 0) {
      // 当前行在根层级（如 export function ... {），检查下一行是否开启了新块
      if (curLine.number < this.state.doc.lines) {
        const nextCol = numColumns(this.state.doc.line(curLine.number + 1).text, this.state.tabSize)
        const nextLevel = Math.floor(nextCol / this.unitWidth)
        if (nextLevel > 0) {
          activeLevel = nextLevel
        } else {
          return
        }
      } else {
        return
      }
    }

    // 向上扫描查找代码块起始行
    let blockStart = curLine.number
    for (let l = curLine.number; l >= 1; l--) {
      const line = this.state.doc.line(l)
      if (line.text.trim().length === 0) continue
      const lvl = Math.floor(numColumns(line.text, this.state.tabSize) / this.unitWidth)
      if (lvl < activeLevel) {
        blockStart = l
        break
      }
      blockStart = l
    }

    // 向下扫描查找代码块闭合行
    let blockEnd = curLine.number
    for (let l = curLine.number; l <= this.state.doc.lines; l++) {
      const line = this.state.doc.line(l)
      if (line.text.trim().length === 0) continue
      const lvl = Math.floor(numColumns(line.text, this.state.tabSize) / this.unitWidth)
      if (lvl < activeLevel) {
        blockEnd = l
        break
      }
      blockEnd = l
    }

    if (blockStart !== blockEnd) {
      this.markActiveSpan(blockStart, blockEnd, activeLevel)
    }
  }

  private markActiveSpan(startLineNo: number, endLineNo: number, activeLevel: number) {
    for (let l = startLineNo; l <= endLineNo; l++) {
      const entry = this.get(l)
      if (entry) {
        entry.activeLevel = activeLevel
      }
    }
  }
}

/**
 * 构造纯垂直直角缩进线 CSS 背景渐变（纯标准 CSS repeating-linear-gradient，绝不贯穿文字）
 */
function createGradient(markerVar: string, thickness: number, indentWidth: number, startCol: number, colCount: number) {
  const gradient = `repeating-linear-gradient(to right, var(${markerVar}) 0 ${thickness}px, transparent ${thickness}px ${indentWidth}ch)`
  return `${gradient} ${startCol * indentWidth}ch/calc(${indentWidth * colCount}ch) no-repeat`
}

function makeBackgroundCSS(
  entry: IndentLineEntry,
  indentWidth: number,
  hideFirstIndent: boolean,
  thickness: number,
): string {
  const { level, activeLevel } = entry
  if (level <= 0) return ''

  const startCol = hideFirstIndent ? 1 : 0
  if (level < startCol) return ''

  const totalCols = level - startCol
  if (totalCols <= 0 && activeLevel !== level) return ''

  const bgs: string[] = []

  if (activeLevel !== undefined && activeLevel >= startCol && activeLevel <= level) {
    const beforeActive = activeLevel - startCol
    if (beforeActive > 0) {
      bgs.push(createGradient('--indent-guide-base-color', thickness, indentWidth, startCol, beforeActive))
    }
    // 当前高亮块所归属的垂直缩进导向线（1px 天青墨色，纯垂直直角）
    bgs.push(createGradient('--indent-guide-active-color', thickness, indentWidth, activeLevel, 1))

    const afterActive = level - activeLevel
    if (afterActive > 0) {
      bgs.push(createGradient('--indent-guide-base-color', thickness, indentWidth, activeLevel + 1, afterActive))
    }
  } else {
    // 全普通缩进槽
    bgs.push(createGradient('--indent-guide-base-color', thickness, indentWidth, startCol, totalCols))
  }

  return bgs.join(', ')
}

class IndentGuidesPlugin implements PluginValue {
  decorations: DecorationSet = Decoration.none
  private view: EditorView
  private unitWidth: number

  constructor(view: EditorView) {
    this.view = view
    this.unitWidth = getIndentUnit(view.state) || 2
    this.generate(view.state)
  }

  update(update: ViewUpdate) {
    const unitWidth = getIndentUnit(update.state) || 2
    const unitWidthChanged = unitWidth !== this.unitWidth
    if (unitWidthChanged) {
      this.unitWidth = unitWidth
    }

    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      unitWidthChanged ||
      update.geometryChanged
    ) {
      this.generate(update.state)
    }
  }

  private generate(state: EditorState) {
    const builder = new RangeSetBuilder<Decoration>()
    const lines = getVisibleLines(this.view, state)
    const { hideFirstIndent, thickness } = state.facet(indentGuideFacet)
    const map = new IndentationMap(lines, state, this.unitWidth)

    for (const line of lines) {
      const entry = map.get(line.number)
      if (!entry || entry.level <= 0) continue

      const bgStyle = makeBackgroundCSS(entry, this.unitWidth, hideFirstIndent, thickness)
      if (!bgStyle) continue

      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: 'cm-indent-guide-line',
          attributes: {
            style: `--indent-guides: ${bgStyle};`,
          },
        }),
      )
    }

    this.decorations = builder.finish()
  }
}

/** IntelliJ IDEA 风格优雅主题：克制沉浸、极细 1px、纯正直角垂直、无发光虚影 */
const indentGuidesTheme = EditorView.baseTheme({
  '&light': {
    '--indent-guide-base-color': 'color-mix(in srgb, var(--color-ink, #0f172a) 10%, transparent)',
    '--indent-guide-active-color': 'color-mix(in srgb, var(--color-seal, #0284c7) 65%, transparent)',
  },
  '&dark': {
    '--indent-guide-base-color': 'color-mix(in srgb, var(--color-ink, #cdd6f4) 10%, transparent)',
    '--indent-guide-active-color': 'color-mix(in srgb, var(--color-seal, #38bdf8) 60%, transparent)',
  },
  '.cm-line': {
    position: 'relative',
  },
  // 缩进导轨伪元素层：绝对定位在代码行左侧前导区域，纯 CSS 渐变渲染，绝无横穿文字，零圆角
  '.cm-indent-guide-line::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '2px', // 对齐 CodeMirror .cm-line 默认内边距
    right: 0,
    bottom: 0,
    background: 'var(--indent-guides)',
    pointerEvents: 'none',
    zIndex: '-1',
  },
})

/**
 * 导出 IntelliJ IDEA 风格的垂直缩进导引线与当前配对块高亮扩展
 */
export function bracketPairGuides(config?: IndentGuideConfig): Extension {
  return [
    config ? indentGuideFacet.of(config) : [],
    indentGuidesTheme,
    ViewPlugin.fromClass(IndentGuidesPlugin, {
      decorations: (v) => v.decorations,
    }),
  ]
}
