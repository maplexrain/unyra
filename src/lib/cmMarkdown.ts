/**
 * 源码编辑器（CodeMirror 6）的**外观**：Markdown 语法高亮配色 + 编辑器主题。
 *
 * 从 components/learn/SourceEditor 搬出来的（那边只剩接线）：随笔窗口（components/learn/essay）
 * 也要一个带 Markdown 高亮的输入框，而两处的配色必须**是同一套**——同一份 Markdown 在
 * 文档源码里是那几个颜色、在随笔里换成另一套，看起来就像两个应用。
 *
 * 颜色全部落在 `--color-code-*` 这组变量上（与正文代码块同一份配色，见 styles/code.css）：
 * 切主题只是换变量，编辑器里那段文字不必重新解析。
 */

import { HighlightStyle } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/** 语法高亮配色：tags → `--color-code-*`（与 .tok-* 的映射一字不差，见 styles/code.css） */
export const markdownHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--color-code-comment)', fontStyle: 'italic' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--color-code-string)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--color-code-number)' },
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.operatorKeyword,
      tags.definitionKeyword,
      tags.controlKeyword,
      tags.moduleKeyword,
    ],
    color: 'var(--color-code-keyword)',
  },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--color-code-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--color-code-type)' },
  { tag: tags.variableName, color: 'var(--color-code-variable)' },
  { tag: tags.tagName, color: 'var(--color-code-tag)' },
  { tag: [tags.standard(tags.variableName), tags.standard(tags.name)], color: 'var(--color-code-builtin)' },
  { tag: tags.meta, color: 'var(--color-code-meta)' },
  { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--color-code-punct)' },
  { tag: tags.invalid, color: 'var(--color-code-invalid)' },
])

/**
 * 编辑器主题：底色透明（贴着面板走）、字体跟应用，内边距由调用方给。
 *
 * 内边距必须能配：文档源码视图的正文左右留白是按 `doc-measure` 那一列调的
 * （上 20 / 下 20 / 左 10 / 右 22），而随笔窗口里是一块小面板，同样的留白会显得很空。
 */
export function markdownEditorTheme(pad: {
  top: number
  bottom: number
  left: number
  right: number
}): Extension {
  return EditorView.theme({
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--color-ink)' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.75' },
    '.cm-content': {
      paddingTop: pad.top + 'px',
      paddingBottom: pad.bottom + 'px',
      paddingLeft: pad.left + 'px',
      paddingRight: pad.right + 'px',
      caretColor: 'var(--color-seal)',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-placeholder': { color: 'var(--color-ink-faint)' },
    '.cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal) 22%, transparent) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--color-seal)' },
  })
}
