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
  WidgetType,
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

// 1. 行级装饰插件：处理标题字号、引用块左边线、代码块底色、水平分割线与列表排版
export const typoraLinePlugin = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none
    constructor(view: EditorView) {
      this.decorations = this.build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = this.build(u.view)
      }
    }
    build(view: EditorView) {
      const { state } = view
      const builder = new RangeSetBuilder<Decoration>()
      const tree = syntaxTree(state)

      for (let i = 1; i <= state.doc.lines; i++) {
        const line = state.doc.line(i)
        const nonSpace = line.text.search(/\S/)
        if (nonSpace < 0) continue

        // 采集行首非空字符与行末字符位置，向上回溯语法树祖先确定块类型
        const checkPositions = [line.from + nonSpace, Math.max(line.from + nonSpace, line.to - 1)]
        let headingLevel = 0
        let isQuote = false
        let isHr = false
        let isCode = false
        let isListItem = false
        let listDepth = 0

        for (const pos of checkPositions) {
          let cur: any = tree.resolveInner(pos, 1)
          let currentListDepth = 0
          while (cur && cur.name !== 'Document') {
            if (!headingLevel) {
              if (cur.name === 'ATXHeading1' || cur.name === 'SetextHeading1') headingLevel = 1
              else if (cur.name === 'ATXHeading2' || cur.name === 'SetextHeading2') headingLevel = 2
              else if (cur.name === 'ATXHeading3') headingLevel = 3
              else if (cur.name === 'ATXHeading4') headingLevel = 4
              else if (cur.name === 'ATXHeading5') headingLevel = 5
              else if (cur.name === 'ATXHeading6') headingLevel = 6
            }
            if (cur.name === 'Blockquote') isQuote = true
            if (cur.name === 'HorizontalRule') isHr = true
            if (cur.name === 'FencedCode' || cur.name === 'CodeBlock') isCode = true
            if (cur.name === 'ListItem') isListItem = true
            if (cur.name === 'BulletList' || cur.name === 'OrderedList') currentListDepth++
            cur = cur.parent
          }
          if (currentListDepth > listDepth) listDepth = currentListDepth
        }

        const classes: string[] = []
        if (headingLevel) classes.push('cm-typora-h' + headingLevel)
        if (isQuote) classes.push('cm-typora-quote')
        if (isHr) classes.push('cm-typora-hr')
        if (isCode) classes.push('cm-typora-code-line')
        if (isListItem) {
          classes.push('cm-typora-list-item')
          if (listDepth > 1) {
            classes.push('cm-typora-list-l' + Math.min(listDepth, 4))
          }
        }

        if (classes.length > 0) {
          builder.add(line.from, line.from, Decoration.line({ class: classes.join(' ') }))
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
      if (u.docChanged || u.viewportChanged) {
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

/** 无序列表圆点原生 Widget：杜绝 CSS 伪元素与零字号导致的 baseline 错位与下沉问题 */
export class BulletWidget extends WidgetType {
  readonly depth: number
  readonly from: number

  constructor(depth: number, from: number) {
    super()
    this.depth = depth
    this.from = from
  }
  eq(other: BulletWidget) {
    return this.depth === other.depth && this.from === other.from
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span')
    const depthCls = this.depth === 2 ? 'cm-typora-bullet-l2' : this.depth >= 3 ? 'cm-typora-bullet-l3' : ''
    span.className = `cm-typora-bullet ${depthCls}`.trim()
    span.textContent = this.depth === 2 ? '◦' : this.depth >= 3 ? '▪' : '•'
    span.setAttribute('aria-hidden', 'true')
    span.onmousedown = (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.from } })
      view.focus()
    }
    return span
  }
  ignoreEvent() {
    return true
  }
}

/** 任务列表复选框原生 Widget：直角设计，支持直接鼠标点击切换勾选状态 */
export class TaskWidget extends WidgetType {
  readonly checked: boolean
  readonly pos: number

  constructor(checked: boolean, pos: number) {
    super()
    this.checked = checked
    this.pos = pos
  }
  eq(other: TaskWidget) {
    return this.checked === other.checked && this.pos === other.pos
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = `cm-typora-task ${this.checked ? 'cm-typora-task-checked' : 'cm-typora-task-unchecked'}`
    wrap.setAttribute('role', 'checkbox')
    wrap.setAttribute('aria-checked', String(this.checked))
    wrap.textContent = this.checked ? '✓' : ''
    wrap.onmousedown = (e) => {
      if (view.state.readOnly) return
      e.preventDefault()
      const replacement = this.checked ? '[ ]' : '[x]'
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 3, insert: replacement },
      })
    }
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

// 3. 语法标记隐显插件（Typora 核心交互）：光标未停留时隐去 Markdown 标记并排版化渲染，光标触达时光标就地显形
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
      const items: { from: number; to: number; deco: Decoration }[] = []

      tree.iterate({
        enter(node) {
          if (
            node.name === 'HeaderMark' ||
            node.name === 'EmphasisMark' ||
            node.name === 'CodeMark' ||
            node.name === 'QuoteMark'
          ) {
            const isLineScope = node.name === 'HeaderMark' || node.name === 'QuoteMark'
            const parent = node.node.parent

            let from = node.from
            let to = node.to
            if (isLineScope && state.sliceDoc(to, to + 1) === ' ') {
              to += 1
            }

            let isActive = false
            if (isLineScope) {
              // 关键：标题与引用只有当光标触及标记区域（行首至标记末尾）时才展开；
              // 在正文标题内部移动光标或打字时，标记保持隐藏，整行文字不发生左右水平位移跳动
              isActive = sel.empty
                ? sel.from <= to && sel.from >= from
                : sel.from <= to && sel.to >= from
            } else if (parent) {
              isActive = sel.from <= parent.to && sel.to >= parent.from
            }

            items.push({
              from,
              to,
              deco: isActive
                ? Decoration.mark({ class: 'cm-typora-mark-active' })
                : Decoration.replace({}),
            })
          } else if (node.name === 'HorizontalRule') {
            const line = state.doc.lineAt(node.from)
            const isActive = sel.from <= line.to && sel.to >= line.from
            items.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: isActive ? 'cm-typora-hr-text-active' : 'cm-typora-hr-text-hidden' }),
            })
          } else if (node.name === 'ListMark') {
            const parent = node.node.parent
            const grandParent = parent?.parent
            const isOrdered = grandParent?.name === 'OrderedList'
            const hasTask = (parent?.getChildren('Task').length ?? 0) > 0

            let from = node.from
            let to = node.to
            if (state.sliceDoc(to, to + 1) === ' ') {
              to += 1
            }

            // 当光标进入标记区域或选取覆盖标记时显形源码，否则保持优雅排版渲染
            const isMarkActive = sel.empty
              ? sel.from < to && sel.from >= from
              : sel.from < to && sel.to > from

            if (isMarkActive) {
              items.push({ from, to, deco: Decoration.mark({ class: 'cm-typora-mark-active' }) })
            } else {
              if (hasTask) {
                // 任务列表行：前置 - 标号直接折叠占位，由 TaskMarker 负责呈现勾选框
                items.push({ from, to, deco: Decoration.replace({}) })
              } else if (isOrdered) {
                // 有序列表行：保留数字，高亮显示序号
                items.push({ from, to, deco: Decoration.mark({ class: 'cm-typora-ordered-mark' }) })
              } else {
                // 无序列表行：根据嵌套深度使用原生 BulletWidget 替换显示为圆点 Bullet
                let depth = 1
                let p = grandParent?.parent
                while (p && p.name !== 'Document') {
                  if (p.name === 'BulletList' || p.name === 'OrderedList') depth++
                  p = p.parent
                }
                items.push({
                  from,
                  to,
                  deco: Decoration.replace({ widget: new BulletWidget(depth, from) }),
                })
              }
            }
          } else if (node.name === 'TaskMarker') {
            let from = node.from
            let to = node.to
            if (state.sliceDoc(to, to + 1) === ' ') {
              to += 1
            }

            const isMarkActive = sel.empty
              ? sel.from < to && sel.from >= from
              : sel.from < to && sel.to > from

            if (isMarkActive) {
              items.push({ from, to, deco: Decoration.mark({ class: 'cm-typora-mark-active' }) })
            } else {
              const rawText = state.sliceDoc(node.from, node.to).toLowerCase()
              const isChecked = rawText.includes('x')
              items.push({
                from,
                to,
                deco: Decoration.replace({ widget: new TaskWidget(isChecked, node.from) }),
              })
            }
          } else if (node.name === 'Link') {
            // 超链接 [text](url)：未激活时光标在外，隐去 [ 和 ](url)，仅保留文本；激活时全量展开
            const isLinkActive = sel.from <= node.to && sel.to >= node.from
            if (!isLinkActive) {
              const text = state.sliceDoc(node.from, node.to)
              const closingBracket = text.indexOf('](')
              if (closingBracket !== -1) {
                // 隐去首个 [
                items.push({ from: node.from, to: node.from + 1, deco: Decoration.replace({}) })
                // 隐去 ](...)
                items.push({ from: node.from + closingBracket, to: node.to, deco: Decoration.replace({}) })
              }
            }
          }
        },
      })

      items.sort((a, b) => a.from - b.from || b.to - a.to)
      for (const item of items) {
        if (item.from < item.to) {
          builder.add(item.from, item.to, item.deco)
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
    marginTop: '0 !important',
    marginBottom: '0 !important',
  },

  /* 标题体系（大标题排版） */
  '.cm-typora-h1': {
    fontSize: '1.85em !important',
    fontWeight: '700 !important',
    lineHeight: '1.3',
    color: 'var(--color-ink-strong)',
    paddingTop: '0.7em',
    paddingBottom: '0.25em',
  },
  '.cm-typora-h1 span': {
    fontSize: 'inherit !important',
    lineHeight: 'inherit',
  },
  '.cm-typora-h2': {
    fontSize: '1.45em !important',
    fontWeight: '650 !important',
    lineHeight: '1.35',
    color: 'var(--color-ink-strong)',
    paddingTop: '0.55em',
    paddingBottom: '0.2em',
    borderBottom: '1px solid color-mix(in srgb, var(--color-line) 60%, transparent)',
  },
  '.cm-typora-h2 span': {
    fontSize: 'inherit !important',
    lineHeight: 'inherit',
  },
  '.cm-typora-h3': {
    fontSize: '1.22em !important',
    fontWeight: '600 !important',
    lineHeight: '1.4',
    color: 'var(--color-ink-strong)',
    paddingTop: '0.45em',
    paddingBottom: '0.15em',
  },
  '.cm-typora-h3 span': {
    fontSize: 'inherit !important',
    lineHeight: 'inherit',
  },
  '.cm-typora-h4': {
    fontSize: '1.08em !important',
    fontWeight: '600 !important',
    paddingTop: '0.35em',
    paddingBottom: '0.15em',
    color: 'var(--color-ink-strong)',
  },
  '.cm-typora-h4 span': {
    fontSize: 'inherit !important',
    lineHeight: 'inherit',
  },
  '.cm-typora-h5': {
    fontSize: '1em !important',
    fontWeight: '600 !important',
    color: 'var(--color-ink-strong)',
  },
  '.cm-typora-h6': {
    fontSize: '0.92em !important',
    fontWeight: '600 !important',
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

  /* 水平分割线：常态下隐藏 markdown 源码 ---，纯净呈现横线；光标移入时浮现编辑标记 */
  '.cm-typora-hr': {
    position: 'relative',
    minHeight: '1.6em',
    lineHeight: '1.6em',
    paddingTop: '0.55em',
    paddingBottom: '0.55em',
    margin: '0',
    cursor: 'text',
  },
  '.cm-typora-hr::after': {
    content: '""',
    position: 'absolute',
    left: '0',
    right: '0',
    top: '50%',
    transform: 'translateY(-50%)',
    height: '1px',
    backgroundColor: 'var(--color-line)',
    pointerEvents: 'none',
  },
  '.cm-typora-hr-text-hidden': {
    display: 'inline-block',
    fontSize: '0 !important',
    lineHeight: '0 !important',
    color: 'transparent !important',
    opacity: '0 !important',
    width: '0 !important',
    height: '0 !important',
    overflow: 'hidden',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  '.cm-typora-hr-text-active': {
    position: 'relative',
    zIndex: '2',
    display: 'inline-block',
    fontFamily: 'var(--font-code, monospace)',
    fontSize: '0.78em',
    padding: '1px 8px',
    backgroundColor: 'var(--color-paper-deep)',
    color: 'var(--color-seal)',
    border: '1px solid var(--color-line)',
    borderRadius: '0px',
    userSelect: 'none',
    lineHeight: '1.4',
  },

  /* 列表项与嵌套排版 */
  '.cm-typora-list-item': {
    paddingLeft: '0.25em',
  },
  '.cm-typora-list-l2': {
    paddingLeft: '1.5em',
  },
  '.cm-typora-list-l3': {
    paddingLeft: '2.75em',
  },
  '.cm-typora-list-l4': {
    paddingLeft: '4em',
  },

  /* 无序列表圆点（Bullet）原生 Widget 排版 */
  '.cm-typora-bullet': {
    display: 'inline-block',
    color: 'var(--color-seal)',
    fontWeight: '700',
    width: '1.25em',
    textAlign: 'left',
    userSelect: 'none',
    lineHeight: 'inherit',
    verticalAlign: 'baseline',
  },
  '.cm-typora-bullet-l2': {
    fontSize: '0.9em',
    color: 'var(--color-seal)',
  },
  '.cm-typora-bullet-l3': {
    fontSize: '0.85em',
    color: 'var(--color-ink-soft)',
  },

  /* 有序列表序号 */
  '.cm-typora-ordered-mark': {
    display: 'inline-block',
    minWidth: '1.3em',
    color: 'var(--color-seal)',
    fontWeight: '600',
    fontVariantNumeric: 'tabular-nums',
  },

  /* 任务列表复选框 Widget（严格遵循全站直角规范 rounded-none / borderRadius: 0px） */
  '.cm-typora-task': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    marginRight: '0.55em',
    verticalAlign: 'middle',
    userSelect: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
    lineHeight: '1',
    fontSize: '10px',
    fontWeight: '700',
  },
  '.cm-typora-task-unchecked': {
    border: '1.5px solid var(--color-ink-soft)',
    borderRadius: '0px',
    backgroundColor: 'transparent',
    color: 'transparent',
  },
  '.cm-typora-task-checked': {
    border: '1.5px solid var(--color-seal)',
    borderRadius: '0px',
    backgroundColor: 'var(--color-seal)',
    color: 'var(--color-paper, #ffffff)',
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
    // 若与本地最新值一致，说明是由本地内部打字 updateListener 触发的父级重渲染，避免重复 dispatch 破坏选区
    if (content === valueRef.current) return
    const currentDoc = view.state.doc.toString()
    const normContent = content.replace(/\r\n/g, '\n')
    if (normContent !== currentDoc) {
      valueRef.current = normContent
      const prevSel = view.state.selection.main
      const safeAnchor = Math.min(prevSel.anchor, normContent.length)
      const safeHead = Math.min(prevSel.head, normContent.length)
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: normContent },
        selection: { anchor: safeAnchor, head: safeHead },
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
