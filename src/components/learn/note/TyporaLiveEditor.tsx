/**
 * Typora 风格所见即所得 Markdown 实时预览编辑器（Live Preview Editor）
 *
 * 核心设计：
 * 1. 彻底告别传统块级弹窗/卡片编辑体验，回归 Typora 与 Obsidian Live Preview 的单画布连续编辑体验：
 *    整篇笔记直接作为渲染好的排版文档呈现在眼前，任意位置点击即可直接落光标打字、回车、删除。
 * 2. 语法标记智能隐显（Typora 的核心交互体验）：
 *    - 当光标离开标题、加粗、斜体、行内代码、引用块时，语法符号（如 #、**、*、`、> 等）自动平滑隐去，呈现精美的排版视觉；
 *    - 当光标移入该元素或行时，语法标记自动现形，方便直接进行 Markdown 语法修改与编辑。
 * 3. 严格遵循全局直角规范（rounded-none），无任何圆角类名。
 */

import { memo, useEffect, useRef } from 'react'
import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  placeholder as cmPlaceholder,
  type ViewUpdate,
} from '@codemirror/view'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown'
import { languages as codeLanguages } from '@codemirror/language-data'
import { syntaxTree } from '@codemirror/language'
import { markdownHighlight } from '../../../lib/cmMarkdown'
import { t } from '../../../i18n'

// 1. 行级装饰插件：处理标题字号、引用块左边线、代码块底色与水平分割线
export const typoraLinePlugin = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = this.build(u.view)
      }
    }
    build(view: EditorView) {
      const { state } = view
      const builder = new RangeSetBuilder<Decoration>()
      const tree = syntaxTree(state)

      for (let i = 1; i <= state.doc.lines; i++) {
        const line = state.doc.line(i)
        const node = tree.resolveInner(line.from, 1)
        let cls: string | null = null

        if (node.name === 'ATXHeading1') cls = 'cm-typora-h1'
        else if (node.name === 'ATXHeading2') cls = 'cm-typora-h2'
        else if (node.name === 'ATXHeading3') cls = 'cm-typora-h3'
        else if (node.name === 'ATXHeading4') cls = 'cm-typora-h4'
        else if (node.name === 'ATXHeading5') cls = 'cm-typora-h5'
        else if (node.name === 'ATXHeading6') cls = 'cm-typora-h6'
        else if (node.name === 'Blockquote' || node.parent?.name === 'Blockquote') cls = 'cm-typora-quote'
        else if (node.name === 'HorizontalRule') cls = 'cm-typora-hr'
        else if (node.name === 'FencedCode' || node.parent?.name === 'FencedCode') cls = 'cm-typora-code-line'

        if (cls) {
          builder.add(line.from, line.from, Decoration.line({ class: cls }))
        }
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

// 2. 行内排版样式插件：粗体、斜体、行内代码、删除线、超链接等
export const typoraInlinePlugin = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = this.build(u.view)
      }
    }
    build(view: EditorView) {
      const { state } = view
      const builder = new RangeSetBuilder<Decoration>()
      const tree = syntaxTree(state)
      const items: { from: number; to: number; cls: string }[] = []

      tree.iterate({
        enter(node) {
          if (node.name === 'StrongEmphasis') {
            items.push({ from: node.from, to: node.to, cls: 'cm-typora-bold' })
          } else if (node.name === 'Emphasis') {
            items.push({ from: node.from, to: node.to, cls: 'cm-typora-italic' })
          } else if (node.name === 'InlineCode') {
            items.push({ from: node.from, to: node.to, cls: 'cm-typora-inline-code' })
          } else if (node.name === 'Strikethrough') {
            items.push({ from: node.from, to: node.to, cls: 'cm-typora-strike' })
          } else if (node.name === 'Link') {
            items.push({ from: node.from, to: node.to, cls: 'cm-typora-link' })
          }
        },
      })

      // 保证严格从前到后有序插入
      items.sort((a, b) => a.from - b.from || b.to - a.to)
      for (const item of items) {
        if (item.from < item.to) {
          builder.add(item.from, item.to, Decoration.mark({ class: item.cls }))
        }
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

// 3. 语法标记隐显插件（Typora 核心交互）：光标未停留时隐去 Markdown 标记，光标触达时光标就地显形
export const typoraDelimiterPlugin = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = this.build(u.view)
      }
    }
    build(view: EditorView) {
      const { state } = view
      const builder = new RangeSetBuilder<Decoration>()
      const tree = syntaxTree(state)
      const sel = state.selection.main
      const marks: { from: number; to: number; cls: string }[] = []

      tree.iterate({
        enter(node) {
          if (
            node.name === 'HeaderMark' ||
            node.name === 'EmphasisMark' ||
            node.name === 'CodeMark' ||
            node.name === 'QuoteMark'
          ) {
            const line = state.doc.lineAt(node.from)
            const isLineScope = node.name === 'HeaderMark' || node.name === 'QuoteMark'
            const parent = node.node.parent

            let isActive = false
            if (isLineScope) {
              isActive = sel.from <= line.to && sel.to >= line.from
            } else if (parent) {
              isActive = sel.from <= parent.to && sel.to >= parent.from
            }

            let from = node.from
            let to = node.to
            if (!isActive && isLineScope) {
              // 标题或引用未激活时，将标记后的空格一并隐去，使首字对齐左边距
              if (state.sliceDoc(to, to + 1) === ' ') {
                to += 1
              }
            }

            marks.push({
              from,
              to,
              cls: isActive ? 'cm-typora-mark-active' : 'cm-typora-mark-hidden',
            })
          } else if (node.name === 'Link') {
            // 超链接 [text](url)：未激活时光标在外，隐去 [ 和 ](url)，仅保留文本；激活时全量展开
            const isLinkActive = sel.from <= node.to && sel.to >= node.from
            if (!isLinkActive) {
              const text = state.sliceDoc(node.from, node.to)
              const closingBracket = text.indexOf('](')
              if (closingBracket !== -1) {
                // 隐去首个 [
                marks.push({ from: node.from, to: node.from + 1, cls: 'cm-typora-mark-hidden' })
                // 隐去 ](...)
                marks.push({ from: node.from + closingBracket, to: node.to, cls: 'cm-typora-mark-hidden' })
              }
            }
          }
        },
      })

      marks.sort((a, b) => a.from - b.from || b.to - a.to)
      for (const m of marks) {
        if (m.from < m.to) {
          builder.add(m.from, m.to, Decoration.mark({ class: m.cls }))
        }
      }
      return builder.finish()
    }
  },
  { decorations: (v) => v.decorations }
)

/** Typora 实时预览专用排版主题与直角规范 */
const typoraTheme = EditorView.theme({
  '&': {
    height: 'auto',
    backgroundColor: 'transparent',
    color: 'var(--color-ink)',
    fontFamily: 'inherit',
    lineHeight: '1.8',
  },
  '.cm-scroller': {
    overflow: 'visible',
    fontFamily: 'inherit',
    lineHeight: '1.8',
  },
  '.cm-content': {
    paddingTop: '6px',
    paddingBottom: '32px',
    paddingLeft: '0',
    paddingRight: '0',
    caretColor: 'var(--color-seal)',
    maxWidth: '100%',
    fontSize: 'calc(14.5px * var(--doc-scale, 1))',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': {
    color: 'var(--color-ink-faint)',
    fontStyle: 'italic',
    fontSize: '13px',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--color-seal) 22%, transparent) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-seal)',
    borderLeftWidth: '2px',
  },
  '.cm-line': {
    padding: '1.5px 0',
  },

  /* 标题体系（大标题排版） */
  '.cm-typora-h1': {
    fontSize: '1.85em',
    fontWeight: '700',
    lineHeight: '1.3',
    color: 'var(--color-ink-strong)',
    marginTop: '1.1em',
    marginBottom: '0.45em',
  },
  '.cm-typora-h2': {
    fontSize: '1.45em',
    fontWeight: '650',
    lineHeight: '1.35',
    color: 'var(--color-ink-strong)',
    marginTop: '0.9em',
    marginBottom: '0.35em',
    borderBottom: '1px solid color-mix(in srgb, var(--color-line) 60%, transparent)',
    paddingBottom: '0.2em',
  },
  '.cm-typora-h3': {
    fontSize: '1.22em',
    fontWeight: '600',
    lineHeight: '1.4',
    color: 'var(--color-ink-strong)',
    marginTop: '0.75em',
    marginBottom: '0.3em',
  },
  '.cm-typora-h4': {
    fontSize: '1.08em',
    fontWeight: '600',
    marginTop: '0.6em',
    marginBottom: '0.25em',
    color: 'var(--color-ink-strong)',
  },
  '.cm-typora-h5': {
    fontSize: '1em',
    fontWeight: '600',
    color: 'var(--color-ink-strong)',
  },
  '.cm-typora-h6': {
    fontSize: '0.92em',
    fontWeight: '600',
    color: 'var(--color-ink-soft)',
  },

  /* 引用块样式 */
  '.cm-typora-quote': {
    borderLeft: '3px solid var(--color-seal)',
    paddingLeft: '14px',
    fontStyle: 'italic',
    color: 'var(--color-ink-soft)',
    backgroundColor: 'color-mix(in srgb, var(--color-paper-deep) 35%, transparent)',
  },

  /* 水平分割线 */
  '.cm-typora-hr': {
    borderBottom: '2px solid var(--color-line)',
    margin: '1.4em 0',
  },

  /* 代码块行底色与等宽字体 */
  '.cm-typora-code-line': {
    fontFamily: 'var(--font-code, monospace)',
    backgroundColor: 'color-mix(in srgb, var(--color-paper-deep) 70%, transparent)',
    paddingLeft: '14px',
    paddingRight: '14px',
    fontSize: '0.9em',
  },

  /* 行内样式 */
  '.cm-typora-bold': {
    fontWeight: '700',
    color: 'var(--color-ink-strong)',
  },
  '.cm-typora-italic': {
    fontStyle: 'italic',
  },
  '.cm-typora-inline-code': {
    fontFamily: 'var(--font-code, monospace)',
    backgroundColor: 'var(--color-paper-deep)',
    border: '1px solid var(--color-line)',
    borderRadius: '0px !important',
    padding: '1px 5px',
    fontSize: '0.88em',
    color: 'var(--color-seal-deep, var(--color-ink))',
  },
  '.cm-typora-strike': {
    textDecoration: 'line-through',
    opacity: '0.65',
  },
  '.cm-typora-link': {
    color: 'var(--color-seal)',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
  },

  /* 语法标记隐显控制 */
  '.cm-typora-mark-hidden': {
    display: 'inline-block',
    width: '0 !important',
    height: '0 !important',
    fontSize: '0 !important',
    lineHeight: '0 !important',
    opacity: '0 !important',
    overflow: 'hidden !important',
    verticalAlign: 'middle !important',
    pointerEvents: 'none !important',
  },
  '.cm-typora-mark-active': {
    fontFamily: 'var(--font-code, monospace)',
    fontSize: '0.82em',
    opacity: '0.55',
    color: 'var(--color-seal)',
    userSelect: 'none',
  },
})

const readOnlyComp = new Compartment()

interface Props {
  content: string
  onChange?: (next: string) => void
  readOnly?: boolean
  placeholder?: string
}

export const TyporaLiveEditor = memo(function TyporaLiveEditor({
  content,
  onChange,
  readOnly = false,
  placeholder,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(content)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  // 初始化 CodeMirror 6 实时预览视图
  useEffect(() => {
    if (!hostRef.current) return

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          history(),
          keymap.of([indentWithTab, ...closeBracketsKeymap, ...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          closeBrackets(),
          bracketMatching(),
          indentOnInput(),
          indentUnit.of('  '),
          EditorView.lineWrapping,
          readOnlyComp.of(EditorState.readOnly.of(readOnly)),
          markdown({ base: markdownLanguage, codeLanguages }),
          cmPlaceholder(placeholder ?? t('写点笔记… (所见即所得实时编辑，支持 Markdown 语法)')),
          syntaxHighlighting(markdownHighlight),
          typoraLinePlugin,
          typoraInlinePlugin,
          typoraDelimiterPlugin,
          typoraTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString()
              valueRef.current = next
              changeRef.current?.(next)
            }
          }),
        ],
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [placeholder])

  // 响应只读状态变化
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: readOnlyComp.reconfigure(EditorState.readOnly.of(readOnly)),
      })
    }
  }, [readOnly])

  // 响应外部 content 改动（如撤销暂存、外部写入）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (content !== currentDoc) {
      valueRef.current = content
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: content },
      })
    }
  }, [content])

  return (
    <div
      ref={hostRef}
      className="typora-live-editor w-full min-h-[360px] select-text outline-none rounded-none"
    />
  )
})
