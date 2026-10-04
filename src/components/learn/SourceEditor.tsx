import { useCallback, useEffect, useRef } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting, indentOnInput, indentUnit, bracketMatching, LanguageDescription } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages as codeLanguages } from '@codemirror/language-data'
import { tags } from '@lezer/highlight'
import { useDocScroll } from '../../lib/docScroll'
import { t } from '../../i18n'

/**
 * 源码视图：直接编辑文档源文。编辑器是 **CodeMirror 6**——轻量（按模块打包，
 * 用到的语言解析器才进包）、完全本地（没有一行代码走网络）、markdown 与几十门
 * 语言的开箱高亮全都是现成的。上一版手写的 contenteditable 在「换行该是什么
 * 节点」这类浏览器细节上反复反弹，这类问题正是成熟编辑器的立身之本，不再自造。
 *
 * 颜色全部落在 `--color-code-*` 这组 CSS 变量上（与正文代码块同一份配色，
 * 见 styles/code.css）：切主题只是换变量，编辑器里那段文档不必重新解析。
 *
 * 组件本身**不存内容**：value 由上层给、onChange 交回上层（上层把它记进暂存区，
 * 见 learn/drafts）。value 与编辑器不一致才是外部改动（暂存被撤、外部文件变了），
 * 那时才整段替换。Ctrl+S 不在这里处理：它是一条登记在快捷键注册表里的动作
 * （见 lib/shortcuts 的 learn.save）。
 */

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

const STATE_TEXT: Record<SaveState, string> = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中…',
  error: '保存失败',
}

const STATE_TONE: Record<SaveState, string> = {
  saved: 'text-ink-faint',
  dirty: 'text-warn-deep',
  saving: 'text-ink-faint',
  error: 'text-seal-deep',
}

/** 语法高亮配色：tags → `--color-code-*`（与 .tok-* 的映射一字不差，见 styles/code.css） */
const highlight = HighlightStyle.define([
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

/** 编辑器外观：底色透明（贴着面板走）、字体跟应用、正文留白与旧 textarea 一致 */
const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--color-ink)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.75' },
  '.cm-content': {
    paddingTop: '44px',
    paddingBottom: '20px',
    paddingLeft: '10px',
    paddingRight: '22px',
    caretColor: 'var(--color-seal)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-placeholder': { color: 'var(--color-ink-faint)' },
  '.cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--color-seal) 22%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--color-seal)' },
})

/** 语言按扩展名现配（markdown 内嵌代码块也各自高亮）；其余扩展名交给 language-data 的表 */
const langComp = new Compartment()
const readOnlyComp = new Compartment()

async function languageExtensions(ext?: string): Promise<Extension[]> {
  if (!ext || /\.(md|markdown)$/i.test(ext)) return [markdown({ base: markdownLanguage, codeLanguages })]
  const desc = LanguageDescription.matchFilename(codeLanguages, 'x' + ext)
  if (!desc) return []
  const support = await desc.load().catch(() => null)
  return support ? [support] : []
}

interface Props {
  value: string
  onChange: (next: string) => void
  /** 保存状态（由上层维护：它才知道内容去哪、存成了没有） */
  state: SaveState
  /** 保存失败的原因（state 为 error 时显示） */
  error?: string
  /** 左下角那句说明：这是哪一份文件 */
  label: string
  /** 扩展名（带点，如 '.py'）：按它选语法高亮的语言；认不出就是纯文本 */
  ext?: string
  /** 只读（比如正在等超级导师写这一节） */
  readOnly?: boolean
  placeholder?: string
  /** 正文字号系数，与预览视图共用同一个（见 lib/appearance 的 docScale） */
  scale?: number
  /** 上一次编辑到哪儿（px）：挂载时恢复一次，见 lib/docScroll */
  scrollTop?: number
  /** 滚动到哪儿了的上报（与预览各记各的：编辑位置与阅读位置是两回事） */
  onScrollTop?: (top: number) => void
}

export default function SourceEditor({
  value,
  onChange,
  state,
  error,
  label,
  ext,
  readOnly = false,
  placeholder,
  scale = 1,
  scrollTop,
  onScrollTop,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  /** 上层给进来的最新 value：updateListener 里只把「用户真的改了」交出去 */
  const valueRef = useRef(value)
  const changeRef = useRef(onChange)
  useEffect(() => {
    changeRef.current = onChange
  }, [onChange])

  /**
   * 取滚动元素的那只回调必须是**稳定**的：useDocScroll 拿它当 effect 依赖，每轮渲染
   * 现写的箭头会让滚动监听被反复拆掉重挂——而拆的时候还要补发一次位置上报，等于白写盘。
   * view 常驻到卸载（语言变化走 compartment 重配，不重建实例），scrollDOM 一直是同一个。
   */
  const getScrollEl = useCallback((): HTMLElement | null => viewRef.current?.scrollDOM ?? null, [])
  // 编辑位置与阅读位置各记各的（键由上层分开）：共用一格的话，切换视图会互相拽
  useDocScroll(getScrollEl, scrollTop, onScrollTop, true)

  // 挂载：创建 view；卸载：销毁
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          history(),
          keymap.of([indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
          // 符号自动补全（输入 ( [ { " ' ` 自动带出另一半、跳过与删除成对）与括号配对高亮
          closeBrackets(),
          bracketMatching(),
          // 自动缩进：换行继承上一行的缩进，语言有语法的话按语法缩进；缩进单位是两个空格
          indentOnInput(),
          indentUnit.of('  '),
          EditorView.lineWrapping,
          readOnlyComp.of([]),
          langComp.of([]),
          cmPlaceholder(placeholder ?? ''),
          syntaxHighlighting(highlight),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const next = update.state.doc.toString()
              valueRef.current = next
              changeRef.current(next)
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // value / onChange / placeholder 都走 ref 或按初值：这只 effect 一辈子只跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部改动（暂存被撤、外部文件被换）：与编辑器当前内容不一致才整段替换
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === view.state.doc.toString()) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  // 只读：走 compartment 重配，不重建实例
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyComp.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    })
  }, [readOnly])

  // 语言：按扩展名加载（异步——语言解析器是本地按需的 ESM 包）
  useEffect(() => {
    let alive = true
    void languageExtensions(ext).then((extensions) => {
      if (!alive) return
      viewRef.current?.dispatch({ effects: langComp.reconfigure(extensions) })
    })
    return () => {
      alive = false
    }
  }, [ext])

  // 字号系数：直接写在根元素上，与预览共用同一个设置
  useEffect(() => {
    const view = viewRef.current
    if (view) view.dom.style.fontSize = Math.round(13 * scale * 10) / 10 + 'px'
  }, [scale])

  const chars = value.replace(/\s/g, '').length

  return (
    <div className="print-flat flex min-h-0 flex-1 flex-col bg-card">
      {/*
        pt-11 交给 .cm-content 的内边距（见 editorTheme）：文档区右上角浮着那排按钮
        （悬浮组），画面窄的时候它正压在首行上——首行从这里往下让开一整条按钮的高度。
      */}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />

      {/* 底栏：这是哪一份文件、多少字、存了没有。三件事都只在编辑时才需要，所以放最下面 */}
      <div className="no-print flex shrink-0 items-center gap-3 border-t border-line px-4 py-1 text-[11px] text-ink-faint">
        <span className="min-w-0 flex-1 truncate" title={label}>
          {label}
        </span>
        <span className="shrink-0 tabular-nums">{t('{0} 字', chars)}</span>
        <span
          className={'shrink-0 ' + STATE_TONE[state]}
          title={state === 'error' ? error : t(STATE_TEXT[state])}
        >
          {t(STATE_TEXT[state])}
        </span>
      </div>
    </div>
  )
}
