import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { foldable } from '@codemirror/language'

const scopeLineDeco = Decoration.line({
  class: 'cm-scope-active-line',
})

/** 最大向上回溯查找可折叠代码块的行数，保障超大文档下的毫秒级性能 */
const MAX_LOOKBACK_LINES = 160

export interface ScopeRange {
  start: number
  end: number
}

/**
 * 探测包含当前光标位置的最内层代码块作用域
 */
export function findEnclosingScope(
  state: EditorView['state'],
  pos: number,
  maxLookback = MAX_LOOKBACK_LINES
): ScopeRange | null {
  if (state.doc.length === 0) return null
  const curLine = state.doc.lineAt(pos)
  const minLine = Math.max(1, curLine.number - maxLookback)

  for (let l = curLine.number; l >= minLine; l--) {
    const line = state.doc.line(l)
    const fold = foldable(state, line.from, line.to)
    if (fold) {
      const endLine = state.doc.lineAt(fold.to)
      // 必须是跨行代码块（行数 >= 2），且当前光标行位于 [l, endLine.number] 闭区间内
      if (endLine.number > l && curLine.number <= endLine.number) {
        return { start: l, end: endLine.number }
      }
    }
  }

  return null
}

function buildScopeDecorations(state: EditorView['state'], scope: ScopeRange | null): DecorationSet {
  if (!scope) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  for (let l = scope.start; l <= scope.end; l++) {
    const line = state.doc.line(l)
    builder.add(line.from, line.from, scopeLineDeco)
  }
  return builder.finish()
}

/**
 * 代码块（当前作用域）样式突出插件：
 * 根据光标所在位置，自动侦测并高亮当前最内层包含代码块（函数、类、对象、HTML标签、Markdown 代码块等），
 * 提供与当前光标行协调的层次化背景突显。
 */
export const scopeHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    currentScope: ScopeRange | null = null

    constructor(view: EditorView) {
      this.currentScope = findEnclosingScope(view.state, view.state.selection.main.head)
      this.decorations = buildScopeDecorations(view.state, this.currentScope)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        const nextScope = findEnclosingScope(update.state, update.state.selection.main.head)
        const isSame =
          this.currentScope === nextScope ||
          (this.currentScope !== null &&
            nextScope !== null &&
            this.currentScope.start === nextScope.start &&
            this.currentScope.end === nextScope.end)

        if (!isSame || update.docChanged) {
          this.currentScope = nextScope
          this.decorations = buildScopeDecorations(update.state, this.currentScope)
        }
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

export function scopeHighlight(): Extension {
  return [scopeHighlightPlugin]
}
