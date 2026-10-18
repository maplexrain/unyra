/**
 * 随笔的输入框：一个**带 Markdown 语法高亮**的纯文本编辑器（CodeMirror 6）。
 *
 * 与文档的源码视图（components/learn/SourceEditor）是同一个引擎、同一套配色
 * （见 lib/cmMarkdown），只是不带保存状态、不带滚动记忆——随笔是随手写的，
 * 每敲一下都会自动进 store（去抖在 EssayDock 那一层），没有「保存」这个动作。
 *
 * 组件本身不存内容：value 由上层给、onChange 交回上层。与 SourceEditor 同一条规矩——
 * value 与编辑器不一致才是外部改动（切到了另一条随笔），那时才整段替换。
 */
import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { markdownEditorTheme, markdownHighlight } from '../../../lib/cmMarkdown'

interface Props {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}

/** 小面板里的留白：比文档正文紧一档（那边是 20/20/10/22） */
const theme = markdownEditorTheme({ top: 10, bottom: 10, left: 12, right: 12 })

export default function EssayEditor({ value, onChange, placeholder }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const changeRef = useRef(onChange)
  useEffect(() => {
    changeRef.current = onChange
  }, [onChange])

  // 挂载：建一次编辑器；卸载：销毁。value / onChange 走 ref，不在依赖里（同 SourceEditor）
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current ?? undefined,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          indentOnInput(),
          indentUnit.of('  '),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage }),
          cmPlaceholder(placeholder ?? ''),
          syntaxHighlighting(markdownHighlight),
          theme,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            const next = update.state.doc.toString()
            valueRef.current = next
            changeRef.current(next)
          }),
        ],
      }),
    })
    viewRef.current = view
    // 窗口一开就等着写字：光标直接落进输入区，并且停在**末尾**（它是「随手记」，
    // 而且打开时自动接上的是今天那条——继续往下写，不是回到开头去改历史）
    view.focus()
    view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 只跑一次：value / onChange / placeholder 都按挂载时那一刻算（见上面 ref 的说明）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /*
   * 外部改动（切到了另一条随笔、删掉当前这条回到空白）：与编辑器当前内容不一致才整段替换，
   * 并把光标放回开头——切过去看到的该是这一条的头，而不是上一条留在半截处的滚动位置。
   */
  useEffect(() => {
    const view = viewRef.current
    if (!view || value === view.state.doc.toString()) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: 0 },
      scrollIntoView: true,
    })
  }, [value])

  // 字号比正文小一档（随笔窗口是一块小面板）：写在宿主上，编辑器内部跟着继承
  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden text-[13px]" />
}
