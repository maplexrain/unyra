/**
 * 编辑器里的“格式化源码”动作。
 *
 * 单独拆出来是为了让 SourceEditor 只负责编辑器装配：按后缀选 Prettier parser、
 * 处理格式化中/成功/失败的临时提示、以及 Prettier 首次加载期间用户又改正文时
 * 放弃覆盖，都在这里收口。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import { extOfPath, formatSourceText, isSourceFormattable } from '../../lib/formatSource'

interface UseSourceFormatArgs {
  viewRef: RefObject<EditorView | null>
  /** 当前文件的扩展名；没有时从 label 推断 */
  ext?: string
  label: string
  readOnly: boolean
  /** 编辑器挂载时闭包里的“最新值”引用，避免快捷键/按钮拿到旧 props */
  extRef: RefObject<string | undefined>
  labelRef: RefObject<string>
  readOnlyRef: RefObject<boolean>
}

export function useSourceFormat({
  viewRef,
  ext,
  label,
  readOnly,
  extRef,
  labelRef,
  readOnlyRef,
}: UseSourceFormatArgs) {
  const [formatting, setFormatting] = useState(false)
  const [formatNote, setFormatNote] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null)
  const formattingRef = useRef(false)
  const formatNoteTimer = useRef<number | null>(null)
  const formatActionRef = useRef<() => void>(() => {})

  const showFormatNote = useCallback((text: string, tone: 'ok' | 'warn' = 'ok') => {
    setFormatNote({ text, tone })
    if (formatNoteTimer.current !== null) window.clearTimeout(formatNoteTimer.current)
    formatNoteTimer.current = window.setTimeout(() => {
      formatNoteTimer.current = null
      setFormatNote(null)
    }, 2400)
  }, [])

  const formatExt = ext || extOfPath(label)
  const canFormat = !readOnly && isSourceFormattable(formatExt)

  const handleFormat = useCallback(async () => {
    const view = viewRef.current
    if (!view || readOnlyRef.current || formattingRef.current) return
    const currentExt = extRef.current || extOfPath(labelRef.current)
    if (!isSourceFormattable(currentExt)) {
      showFormatNote(`${currentExt || '该类型'} 暂不支持格式化`, 'warn')
      return
    }
    formattingRef.current = true
    setFormatting(true)
    try {
      const source = view.state.doc.toString()
      const result = await formatSourceText(source, currentExt)
      if (!result.ok || result.text === undefined) {
        showFormatNote(result.error || '格式化失败', 'warn')
        return
      }
      // Prettier 首次加载对应 parser 可能要一两秒；期间用户又改了正文的话，
      // 不能拿旧快照整段覆盖新输入。
      if (view.state.doc.toString() !== source) {
        showFormatNote('格式化期间内容有变化，已取消', 'warn')
        return
      }
      if (result.text === source) {
        showFormatNote('已是最新格式')
        return
      }
      const head = Math.min(view.state.selection.main.head, result.text.length)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: result.text },
        selection: { anchor: head },
      })
      showFormatNote(`已格式化 · ${result.parser ?? currentExt}`)
    } catch (err) {
      showFormatNote(err instanceof Error ? err.message : String(err), 'warn')
    } finally {
      formattingRef.current = false
      setFormatting(false)
    }
  }, [showFormatNote, viewRef, readOnlyRef, extRef, labelRef])

  useEffect(() => {
    formatActionRef.current = () => void handleFormat()
  }, [handleFormat])

  useEffect(() => {
    return () => {
      if (formatNoteTimer.current !== null) window.clearTimeout(formatNoteTimer.current)
    }
  }, [])

  return { formatting, formatNote, canFormat, handleFormat, formatActionRef }
}
