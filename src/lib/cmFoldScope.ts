import { EditorView } from '@codemirror/view'
import {
  foldCode,
  unfoldCode,
  foldAll,
  unfoldAll,
  foldable,
  foldEffect,
  unfoldEffect,
  foldedRanges,
} from '@codemirror/language'

/** 检查指定区间是否已经被折叠 */
function isRangeAlreadyFolded(view: EditorView, from: number, to: number): boolean {
  let isFolded = false
  foldedRanges(view.state).between(from, to, (f, t) => {
    if (f <= from && t >= to) {
      isFolded = true
      return false
    }
  })
  return isFolded
}

/** 查找覆盖当前光标位置的折叠区间 */
function findEnclosingFoldedRange(view: EditorView, pos: number): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null
  foldedRanges(view.state).between(Math.max(0, pos - 1), pos + 1, (f, t) => {
    result = { from: f, to: t }
    return false
  })
  return result
}

/**
 * 智能折叠当前代码块：
 * 1. 优先尝试折叠当前光标所在行（若当前行本身为函数、类、对象、标签等起始行）；
 * 2. 若当前行不可折叠，向上回溯查找包含当前行的最内层代码块起始行并执行折叠；
 * 3. 成功折叠并派发 foldEffect 时返回 true。
 */
export function foldCurrentScope(view: EditorView, maxLookback = 180): boolean {
  // 1. 如果当前光标行本身就是折叠起始行，直接执行官方折叠
  if (foldCode(view)) return true

  // 2. 否则向上回溯查找包含当前光标行的最内层代码块
  const { state } = view
  const pos = state.selection.main.head
  const curLine = state.doc.lineAt(pos)
  const minLine = Math.max(1, curLine.number - maxLookback)

  for (let l = curLine.number - 1; l >= minLine; l--) {
    const line = state.doc.line(l)
    const fold = foldable(state, line.from, line.to)
    if (fold) {
      const endLine = state.doc.lineAt(fold.to)
      // 当前光标行必须严格处于该代码块范围内部 [l, endLine.number]
      if (endLine.number >= curLine.number) {
        // 确保该范围尚未被折叠
        if (!isRangeAlreadyFolded(view, fold.from, fold.to)) {
          view.dispatch({
            effects: foldEffect.of(fold),
          })
          return true
        }
      }
    }
  }

  return false
}

/**
 * 智能展开当前代码块：
 * 1. 优先尝试展开当前行或当前选区内已折叠的代码块；
 * 2. 若当前处于已折叠行的末尾或内部，回溯查找覆盖当前位置的最近折叠区间并执行展开；
 * 3. 成功展开时返回 true。
 */
export function unfoldCurrentScope(view: EditorView, maxLookback = 180): boolean {
  // 1. 优先尝试展开当前行
  if (unfoldCode(view)) return true

  // 2. 查找覆盖当前光标位置的折叠区间并展开
  const pos = view.state.selection.main.head
  const currentFold = findEnclosingFoldedRange(view, pos)
  if (currentFold) {
    view.dispatch({
      effects: unfoldEffect.of(currentFold),
    })
    return true
  }

  // 3. 向上回溯查找最近一处已被折叠的代码块并展开
  const { state } = view
  const curLine = state.doc.lineAt(pos)
  const minLine = Math.max(1, curLine.number - maxLookback)

  for (let l = curLine.number - 1; l >= minLine; l--) {
    const line = state.doc.line(l)
    let foundRange: { from: number; to: number } | null = null
    foldedRanges(state).between(line.from, line.to, (f, t) => {
      foundRange = { from: f, to: t }
      return false
    })
    if (foundRange) {
      view.dispatch({
        effects: unfoldEffect.of(foundRange),
      })
      return true
    }
  }

  return false
}

export { foldAll, unfoldAll }
