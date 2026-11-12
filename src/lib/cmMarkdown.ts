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
    // 现代专业 IDE 风格文字选中样式：清爽轻透的发光遮罩层，保持语法高亮 100% 完好，视觉轻盈不压抑
    '.cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal, #38bdf8) 14%, rgba(56, 189, 248, 0.15)) !important',
      borderRadius: '2px',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal, #38bdf8) 18%, rgba(56, 189, 248, 0.20)) !important',
    },
    // 原生选中伪元素：完全透明背景（交给底层的 cm-selectionBackground 渲染），
    // 强制 color: currentColor 锁定各 Token 自带的语法高亮颜色，绝不被任何全局选中样式变成白字
    '.cm-content ::selection, .cm-content *::selection, .cm-editor ::selection, .cm-editor *::selection': {
      backgroundColor: 'transparent !important',
      color: 'currentColor !important',
      WebkitTextFillColor: 'currentColor !important',
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
    // 行号单元格：仅针对 lineNumbers 栏生效，右侧保留适度呼吸间距，绝不污染折叠栏
    '.cm-lineNumbers .cm-gutterElement': {
      padding: '0 8px 0 10px !important',
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
    // 代码块折叠栏 (Fold Gutter) - 紧凑内嵌在行号与右边框之间，完全居中偏左排布，绝不压线或出界
    '.cm-foldGutter': {
      width: '18px',
      minWidth: '18px',
      padding: '0',
      userSelect: 'none',
      cursor: 'default',
    },
    '.cm-foldGutter .cm-gutterElement': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '18px !important',
      minWidth: '18px !important',
      padding: '0 !important',
      marginLeft: '0 !important',
      marginRight: '0 !important',
      marginBottom: '0 !important',
      textAlign: 'center !important',
      cursor: 'pointer',
      color: 'var(--color-seal, #38bdf8)',
      backgroundColor: 'transparent !important',
      transform: 'none !important',
      boxSizing: 'border-box',
    },
    // 折叠小图标与平滑旋转动效：收起向右（0deg），展开向下（90deg），200ms 丝滑过渡
    '.cm-fold-marker': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '14px',
      height: '14px',
      borderRadius: '2px',
      cursor: 'pointer',
      color: 'var(--color-seal, #38bdf8)',
      backgroundColor: 'transparent !important',
      // 向左微移 2px，彻底避开右侧边框线条，完整舒展展示小箭头
      transform: 'translateX(-2px)',
      transition: 'opacity 0.15s ease, color 0.15s ease, transform 0.15s ease',
    },
    '.cm-fold-marker .cm-fold-chevron': {
      display: 'block',
      transformOrigin: 'center center',
    },
    // 展开状态标记平时清晰可见（0.85），小箭头朝下，触发时带有平滑转动动画
    '.cm-fold-marker-open': {
      opacity: '0.85',
    },
    '.cm-fold-marker-open .cm-fold-chevron': {
      animation: 'cm-fold-chevron-to-down 200ms cubic-bezier(0.2, 0.8, 0.25, 1) forwards',
    },
    '.cm-gutters:hover .cm-fold-marker-open': {
      opacity: '1',
    },
    '.cm-fold-marker:hover': {
      opacity: '1 !important',
      color: 'var(--color-seal, #38bdf8) !important',
      transform: 'translateX(-2px) scale(1.2)',
      backgroundColor: 'transparent !important',
    },
    '.cm-fold-marker:active': {
      transform: 'translateX(-2px) scale(0.9)',
    },
    // 折叠状态标记醒目常驻，小箭头朝右（0度）
    '.cm-fold-marker-folded': {
      opacity: '1 !important',
      color: 'var(--color-seal, #38bdf8) !important',
      backgroundColor: 'transparent !important',
    },
    '.cm-fold-marker-folded .cm-fold-chevron': {
      animation: 'cm-fold-chevron-to-right 200ms cubic-bezier(0.2, 0.8, 0.25, 1) forwards',
    },
    '@keyframes cm-fold-chevron-to-down': {
      '0%': { transform: 'rotate(0deg)' },
      '100%': { transform: 'rotate(90deg)' },
    },
    '@keyframes cm-fold-chevron-to-right': {
      '0%': { transform: 'rotate(90deg)' },
      '100%': { transform: 'rotate(0deg)' },
    },
    // 折叠后的行尾占位胶囊（...）：带有美观的弹出过渡动画，点击即可一键展开
    '.cm-foldPlaceholder': {
      display: 'inline-flex',
      alignItems: 'center',
      backgroundColor: 'color-mix(in srgb, var(--color-seal, #38bdf8) 14%, var(--color-card)) !important',
      color: 'var(--color-seal, #38bdf8) !important',
      border: '1px solid color-mix(in srgb, var(--color-seal, #38bdf8) 35%, transparent) !important',
      borderRadius: '4px',
      padding: '0 6px',
      margin: '0 4px',
      fontSize: '11px',
      lineHeight: '1.4',
      fontFamily: IDEA_MONO_FONT,
      cursor: 'pointer',
      letterSpacing: '1px',
      userSelect: 'none',
      boxShadow: '0 1px 3px color-mix(in srgb, var(--color-seal, #38bdf8) 10%, transparent)',
      transition: 'all 0.16s ease',
      animation: 'cm-fold-pill-in 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
    },
    '.cm-foldPlaceholder:hover': {
      backgroundColor: 'color-mix(in srgb, var(--color-seal, #38bdf8) 24%, var(--color-card)) !important',
      borderColor: 'var(--color-seal, #38bdf8) !important',
      boxShadow: '0 0 8px color-mix(in srgb, var(--color-seal, #38bdf8) 35%, transparent)',
      transform: 'scale(1.04)',
    },
    '.cm-foldPlaceholder:active': {
      transform: 'scale(0.96)',
    },
    '@keyframes cm-fold-pill-in': {
      '0%': {
        opacity: '0',
        transform: 'scale(0.82)',
      },
      '100%': {
        opacity: '1',
        transform: 'scale(1)',
      },
    },
    // IDEA 风格：当前行行号不带粗暴色块，字体显著变大（仅针对行号数字进行放大，绝不作用于折叠列）
    '.cm-lineNumbers .cm-activeLineGutter': {
      color: 'var(--color-ink-strong) !important',
      backgroundColor: 'transparent !important',
      opacity: '1 !important',
      fontWeight: '700 !important',
      transform: 'scale(1.16)',
      transformOrigin: 'right center',
    },
    // 确保折叠列在当前行绝不受到放大或背景色影响
    '.cm-foldGutter .cm-activeLineGutter': {
      backgroundColor: 'transparent !important',
      transform: 'none !important',
    },
    // IDEA 风格：当前行整行柔和横向带状底色高亮，沉浸不晃眼
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--color-ink) 4.5%, transparent) !important',
    },
  })
}
