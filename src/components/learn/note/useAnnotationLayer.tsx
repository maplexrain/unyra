/**
 * 这个文件负责什么：注解输入区（NoteDialog）的**接线**——它什么时候开、开在哪个词条上、
 * 存/删/取消各走哪条路、样式预览怎么落到正文上。
 *
 * 词条是否还注解得了（cannotAnnotate）由上层传进来：「了解」那条路也要用同一个判断，
 * 判断必须落在**渲染结果**上（见 NodeNote 里那段说明），口径只能有一份。
 */
import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import NoteDialog from '../NoteDialog'
import type { Annotation, AnnotationStyle } from '../../../learn/types'
import { endAnnotationPreview, previewAnnotationStyle, type AnnotationActions } from '../../../lib/annotation'
import type { MarkKind } from '../../../learn/reading'

interface Opts {
  /** 这一份文档上已有的注解（了解 + 用户自己写的） */
  annotations: Annotation[]
  /** 正文根节点：样式预览就地在它上面做 */
  bodyRef: RefObject<HTMLDivElement | null>
  /** 词条还注解得了吗（判断落在渲染结果上，见文件头） */
  cannotAnnotate: (term: string) => boolean
  /** 保存成功那一刻记一笔「真读了」（采集器的 mark，见 learn/useReadingTracker） */
  markReading: (kind: MarkKind) => void
  /** 保存一条自己写的注解（Markdown + 样式）；同一词条再次保存即覆盖 */
  onSaveAnnotation?: (term: string, body: string, style?: AnnotationStyle, occurrence?: number) => void
  /** 删除某词条上的注解 */
  onDeleteAnnotation?: (term: string) => void
}

/**
 * 注解输入区的状态与接线。返回的 dialog 直接摆进文档列底部（它是占位的输入区，
 * 由那一列的 flex 决定位置）；openNote 给选词菜单的「注解」那一项用。
 */
export function useAnnotationLayer({
  annotations,
  bodyRef,
  cannotAnnotate,
  markReading,
  onSaveAnnotation,
  onDeleteAnnotation,
}: Opts) {
  // 注解窗口：term 非空时打开；editing 决定标题与按钮（修改既有注解 vs 新建）
  const [noteDialog, setNoteDialog] = useState<{
    term: string
    /** 词条在正文里第几次出现（从 0 起）：存注解与实时预览都按同一处 */
    occurrence: number
    editing: boolean
  } | null>(null)

  /** 该词条上已有的注解（了解，或用户自己写的） */
  const annotationOf = (term: string) => annotations.find((x) => x.term === term)

  const currentNote = (term: string): string => {
    const a = annotationOf(term)
    return a?.kind === 'note' ? a.body : ''
  }

  /**
   * 「注解」：打开输入区。已存在同词条的注解时进入修改模式并预填内容与样式。
   * 出现序号优先取这条注解自己记着的那个（改注解＝改原来那处），
   * 新建时用这次选区算出来的序号。
   */
  const openNote = (term: string, occurrence: number) => {
    if (cannotAnnotate(term)) return
    const existing = annotationOf(term)
    setNoteDialog({ term, occurrence: existing?.occurrence ?? occurrence, editing: !!existing })
  }

  /**
   * 保存注解。返回 false 表示没存成——NoteDialog 会据此把退场动画撤回，
   * 窗口留在原地，用户刚写的内容不至于丢掉。
   *
   * 只在**新建**时要求词条还在正文里：改一条既有注解时它可能只是暂时匹配不上
   * （正文被重写过），改内容本身仍然有意义，拦下来反而添乱。
   */
  const saveNote = (term: string, body: string, style?: AnnotationStyle): boolean => {
    markReading('note')
    if (!annotationOf(term) && cannotAnnotate(term)) return false
    const occurrence = noteDialog?.occurrence
    setNoteDialog(null)
    onSaveAnnotation?.(term, body, style, occurrence)
    return true
  }

  const deleteNote = (term: string) => {
    setNoteDialog(null)
    onDeleteAnnotation?.(term)
  }

  /**
   * 样式预览的收尾：输入区一关（或本组件卸载）就把正文恢复原样——
   * 临时包出来的 span 拆掉、动过样式的 span 写回原内联样式。
   *
   * 放在 effect 里而不是各条关闭路径上：取消、保存、删除、Esc、切节点都得收，
   * 逐条去挂容易漏；effect 的清理函数顺带把「换词条」也覆盖了。
   */
  useEffect(() => {
    if (!noteDialog) endAnnotationPreview()
    return () => endAnnotationPreview()
  }, [noteDialog])

  /** 正文里那条注解浮层上的「修改/删除」，接到同一套开合上（见 DocBody 的 annotationActions） */
  const annotationActions: AnnotationActions = {
    // 浮层里的「修改」直接开输入区，预填已有内容；
    // 出现序号沿用这条注解记着的那个，否则改完再存会把它挪到第一次出现
    onEdit: (term) => setNoteDialog({ term, occurrence: annotationOf(term)?.occurrence ?? 0, editing: true }),
    onDelete: onDeleteAnnotation,
  }

  const dialog: ReactNode = noteDialog ? (
    <NoteDialog
      term={noteDialog.term}
      initial={currentNote(noteDialog.term)}
      initialStyle={annotationOf(noteDialog.term)?.style}
      editing={noteDialog.editing}
      onSubmit={(body, style) => saveNote(noteDialog.term, body, style)}
      onCancel={() => setNoteDialog(null)}
      onDelete={() => deleteNote(noteDialog.term)}
      onStylePreview={(style) => {
        const body = bodyRef.current
        if (body) previewAnnotationStyle(body, noteDialog.term, noteDialog.occurrence, style)
      }}
    />
  ) : null

  return { dialog, openNote, annotationActions }
}
