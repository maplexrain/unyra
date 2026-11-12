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
 * IntelliJ IDEA 风格等宽代码字体栈：
 * 优先采用 JetBrains Mono，回落到 Cascadia Code / Fira Code / Consolas
 */
export const IDEA_MONO_FONT =
  "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Cascadia Mono', Consolas, 'Sarasa Mono SC', Menlo, Monaco, monospace"

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
  gutterLeft?: number
}): Extension {
  return EditorView.theme({
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--color-ink)' },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: IDEA_MONO_FONT,
      lineHeight: '1.75',
      WebkitFontSmoothing: 'antialiased',
      position: 'relative',
    },
    '.cm-content': {
      paddingTop: pad.top + 'px',
      paddingBottom: pad.bottom + 'px',
      paddingLeft: pad.left + 'px',
      paddingRight: pad.right + 'px',
      caretColor: 'transparent !important',
      fontFamily: IDEA_MONO_FONT,
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-placeholder': { color: 'var(--color-ink-faint)' },
    // 现代专业 IDE 风格文字选中样式：通透微光深蓝混合，文字高亮清晰锐利，消除暗浊脏色
    '.cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal) 30%, rgba(59, 130, 246, 0.32)) !important',
      borderRadius: '2px',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal) 36%, rgba(59, 130, 246, 0.42)) !important',
    },
    '.cm-content ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal) 36%, rgba(59, 130, 246, 0.42)) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--color-seal)' },
    // 左侧行号栏 (Gutters) - IntelliJ IDEA 风格
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--color-ink-faint)',
      borderRight: '1px solid color-mix(in srgb, var(--color-line) 40%, transparent)',
      paddingLeft: (pad.gutterLeft ?? 0) + 'px',
      userSelect: 'none',
      fontFamily: IDEA_MONO_FONT,
    },
    // 注意：CodeMirror 默认对 .cm-lineNumbers .cm-gutterElement 设置了 padding: 0 3px 0 5px
    // 导致行号贴紧右侧边框。通过 .cm-lineNumbers .cm-gutterElement 赋予右内边距，确保呼吸留白。
    // 行高与盒模型严格与正文同步，绝不对 font-size 做 transition，彻底根除光标移动画面抖动。
    '.cm-gutterElement, .cm-lineNumbers .cm-gutterElement': {
      padding: '0 10px 0 10px !important',
      minWidth: '38px !important',
      textAlign: 'right !important',
      fontSize: '11.5px',
      letterSpacing: '-0.3px',
      fontFamily: IDEA_MONO_FONT,
      fontVariantNumeric: 'tabular-nums',
      opacity: '0.45',
      color: 'var(--color-ink-faint)',
      boxSizing: 'border-box',
      lineHeight: 'inherit',
      transition: 'color 0.12s ease, opacity 0.12s ease',
    },
    // 代码块折叠栏 (Fold Gutter) - IntelliJ IDEA / VS Code 风格
    '.cm-foldGutter': {
      width: '18px',
      minWidth: '18px',
      userSelect: 'none',
      cursor: 'default',
    },
    '.cm-foldGutter .cm-gutterElement': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 !important',
      cursor: 'pointer',
      color: 'var(--color-ink-faint)',
    },
    '.cm-fold-marker': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '14px',
      height: '14px',
      borderRadius: '3px',
      cursor: 'pointer',
      color: 'var(--color-ink-faint)',
      transition: 'all 0.12s ease',
    },
    // 展开状态标记平时幽雅半隐，鼠标悬停在左侧栏或该行时自然浮现
    '.cm-fold-marker-open': {
      opacity: '0.2',
    },
    '.cm-gutters:hover .cm-fold-marker-open': {
      opacity: '0.7',
    },
    '.cm-fold-marker:hover': {
      opacity: '1 !important',
      color: 'var(--color-seal) !important',
      backgroundColor: 'color-mix(in srgb, var(--color-seal) 16%, transparent)',
    },
    // 折叠状态标记醒目常驻，标明代码已收拢
    '.cm-fold-marker-folded': {
      opacity: '1 !important',
      color: 'var(--color-seal) !important',
    },
    // 折叠后的行尾占位胶囊（...），点击即可一键展开
    '.cm-foldPlaceholder': {
      display: 'inline-flex',
      alignItems: 'center',
      backgroundColor: 'color-mix(in srgb, var(--color-seal) 14%, var(--color-card)) !important',
      color: 'var(--color-seal) !important',
      border: '1px solid color-mix(in srgb, var(--color-seal) 35%, transparent) !important',
      borderRadius: '4px',
      padding: '0 6px',
      margin: '0 4px',
      fontSize: '11px',
      lineHeight: '1.4',
      fontFamily: IDEA_MONO_FONT,
      cursor: 'pointer',
      letterSpacing: '1px',
      userSelect: 'none',
      boxShadow: '0 1px 3px color-mix(in srgb, var(--color-seal) 10%, transparent)',
      transition: 'all 0.15s ease',
    },
    '.cm-foldPlaceholder:hover': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal) 24%, var(--color-card)) !important',
      borderColor: 'var(--color-seal) !important',
      boxShadow: '0 0 6px color-mix(in srgb, var(--color-seal) 30%, transparent)',
      transform: 'translateY(-0.5px)',
    },
    // IDEA 风格：当前行行号不带粗暴色块，字体显著变大（通过 transform 放大 16%，零重排零抖动），并以高对比度前景色与加粗自然凸显
    '.cm-activeLineGutter, .cm-lineNumbers .cm-activeLineGutter': {
      color: 'var(--color-ink-strong) !important',
      backgroundColor: 'transparent !important',
      opacity: '1 !important',
      fontWeight: '700 !important',
      transform: 'scale(1.16)',
      transformOrigin: 'right center',
    },
    // IDEA 风格：当前行整行柔和横向带状底色高亮，沉浸不晃眼
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--color-ink) 4.5%, transparent) !important',
    },
  })
}
