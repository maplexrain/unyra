import { ViewPlugin, Decoration, type DecorationSet, EditorView, type ViewUpdate } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/**
 * Vim 搜索当前激活匹配项（Active Search Match）高亮扩展：
 * 当处于 Vim 正则匹配搜索状态（通过 `/pattern` 或 `?pattern` 搜索）时，
 * 实时计算并为当前光标所在的匹配项全长注入 `.cm-searchMatch.cm-searchMatch-selected`，
 * 确保用户按 `n` 切换下一个匹配项或按 `N` 切换上一个匹配项时，
 * 目标匹配词呈现高对比度、清晰透亮的外边框与微光背景，光标定位清晰可见。
 */
const activeMatchPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none

    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }

    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view)
      }
    }

    private build(view: EditorView): DecorationSet {
      const cm = (view as any).cm
      if (!cm) return Decoration.none

      const vimState = cm.state?.vim
      const searchState = vimState?.searchState_
      if (!searchState || typeof searchState.getQuery !== 'function') return Decoration.none

      const query = searchState.getQuery()
      if (!query) return Decoration.none

      const head = view.state.selection.main.head
      try {
        const cursor = cm.getSearchCursor(query, { line: 0, ch: 0 })
        if (!cursor || typeof cursor.findNext !== 'function') return Decoration.none

        let match = cursor.findNext()
        while (match) {
          const fromPos = cursor.from()
          const toPos = cursor.to()
          if (fromPos && toPos) {
            const lineFrom = view.state.doc.line(Math.min(fromPos.line + 1, view.state.doc.lines))
            const lineTo = view.state.doc.line(Math.min(toPos.line + 1, view.state.doc.lines))
            const from = Math.min(lineFrom.from + fromPos.ch, lineFrom.to)
            const to = Math.min(lineTo.from + toPos.ch, lineTo.to)

            if (head >= from && head <= to) {
              return Decoration.set([
                Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' }).range(from, to),
              ])
            }
          }
          match = cursor.findNext()
        }
      } catch {
        // 安全容错，防坏正则或边界溢出
      }

      return Decoration.none
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

export function vimActiveSearchMatchHighlight(): Extension {
  return [activeMatchPlugin]
}
