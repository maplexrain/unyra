import { useState, useRef, useEffect, memo } from 'react'
import { marked } from 'marked'
import { Pencil, Plus, Trash2, Check, X } from 'lucide-react'
import type { Annotation } from '../../../learn/types'
import type { AnnotationActions } from '../../../lib/annotation'
import type { LocalImageResolver } from '../../../lib/docImages'
import { renderNote } from '../../../lib/markdown'
import { t } from '../../../i18n'
import MarkdownView from '../../MarkdownView'

export interface MarkdownBlockItem {
  id: string
  type: string
  raw: string
  prefix: string
}

/**
 * 将 Markdown 文本准确切分成顶级块（Block），保留空行与前缀
 */
export function splitMarkdownBlocks(md: string): { blocks: MarkdownBlockItem[]; trailing: string } {
  if (!md.trim()) {
    return { blocks: [], trailing: '' }
  }

  const tokens = marked.lexer(md)
  const blocks: MarkdownBlockItem[] = []
  let pendingPrefix = ''

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === 'space') {
      pendingPrefix += token.raw
    } else {
      blocks.push({
        id: `blk-${i}-${token.type}`,
        type: token.type,
        raw: token.raw,
        prefix: pendingPrefix,
      })
      pendingPrefix = ''
    }
  }

  return { blocks, trailing: pendingPrefix }
}

/**
 * 将修改后的 blocks 重新组装为完整 Markdown 文本
 */
export function joinMarkdownBlocks(blocks: MarkdownBlockItem[], trailing: string = ''): string {
  return blocks.map((b) => b.prefix + b.raw).join('') + trailing
}

interface Props {
  content: string
  onEditContent: (next: string) => void
  annotations?: Annotation[]
  knownConceptKeys?: Set<string>
  annotationActions?: AnnotationActions
  resolveLocalImage?: LocalImageResolver
}

export const NoteBlockPreview = memo(function NoteBlockPreview({
  content,
  onEditContent,
  annotations,
  knownConceptKeys,
  annotationActions,
  resolveLocalImage,
}: Props) {
  const { blocks, trailing } = splitMarkdownBlocks(content)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [draftText, setDraftText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 进入编辑时自动聚焦并调整高度
  useEffect(() => {
    if (editingIdx !== null && textareaRef.current) {
      const el = textareaRef.current
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.max(80, el.scrollHeight + 4)}px`
    }
  }, [editingIdx])

  const startEdit = (idx: number) => {
    setEditingIdx(idx)
    setDraftText(blocks[idx]?.raw ?? '')
  }

  const cancelEdit = () => {
    setEditingIdx(null)
    setDraftText('')
  }

  const saveBlock = (idx: number) => {
    const nextBlocks = [...blocks]
    const trimmed = draftText.trim()
    if (!trimmed) {
      // 若清空了该块，直接删除
      nextBlocks.splice(idx, 1)
    } else {
      nextBlocks[idx] = {
        ...nextBlocks[idx],
        raw: draftText,
      }
    }
    const newContent = joinMarkdownBlocks(nextBlocks, trailing)
    onEditContent(newContent)
    setEditingIdx(null)
    setDraftText('')
  }

  const deleteBlock = (idx: number) => {
    const nextBlocks = [...blocks]
    nextBlocks.splice(idx, 1)
    const newContent = joinMarkdownBlocks(nextBlocks, trailing)
    onEditContent(newContent)
    if (editingIdx === idx) {
      setEditingIdx(null)
      setDraftText('')
    }
  }

  const insertBlockAfter = (idx: number) => {
    const nextBlocks = [...blocks]
    const newBlock: MarkdownBlockItem = {
      id: `blk-new-${Date.now()}`,
      type: 'paragraph',
      raw: '',
      prefix: '\n\n',
    }
    nextBlocks.splice(idx + 1, 0, newBlock)
    const newContent = joinMarkdownBlocks(nextBlocks, trailing)
    onEditContent(newContent)
    setEditingIdx(idx + 1)
    setDraftText('')
  }

  const appendNewBlock = () => {
    const nextBlocks = [...blocks]
    const newBlock: MarkdownBlockItem = {
      id: `blk-new-${Date.now()}`,
      type: 'paragraph',
      raw: '',
      prefix: blocks.length > 0 ? '\n\n' : '',
    }
    nextBlocks.push(newBlock)
    const newContent = joinMarkdownBlocks(nextBlocks, trailing)
    onEditContent(newContent)
    setEditingIdx(nextBlocks.length - 1)
    setDraftText('')
  }

  if (blocks.length === 0) {
    return (
      <div className="py-8 text-center select-none">
        <button
          type="button"
          onClick={appendNewBlock}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-line-strong hover:border-seal text-ink-soft hover:text-seal text-xs rounded-none transition bg-paper"
        >
          <Plus size={13} />
          <span>{t('点击添加第一个笔记块…')}</span>
        </button>
      </div>
    )
  }

  return (
    <div className="note-blocks-container flex flex-col gap-1">
      {blocks.map((block, idx) => {
        const isEditing = editingIdx === idx

        return (
          <div key={block.id || idx} className="note-block-wrapper relative group/block">
            {isEditing ? (
              <div className="note-block-editor p-2 border border-seal bg-card/40 shadow-xs rounded-none my-2 transition-all">
                <textarea
                  ref={textareaRef}
                  value={draftText}
                  onChange={(e) => {
                    setDraftText(e.target.value)
                    e.target.style.height = 'auto'
                    e.target.style.height = `${Math.max(80, e.target.scrollHeight + 4)}px`
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      saveBlock(idx)
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelEdit()
                    }
                  }}
                  placeholder={t('在此输入 Markdown 内容…')}
                  className="w-full bg-paper border border-line p-2.5 font-sans text-xs text-ink rounded-none outline-none focus:border-seal leading-relaxed resize-y"
                  rows={3}
                />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => saveBlock(idx)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-seal text-white font-medium hover:bg-seal-deep rounded-none transition shadow-2xs"
                    >
                      <Check size={12} />
                      <span>{t('保存 (Ctrl+Enter)')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="inline-flex items-center gap-1 px-2.5 py-1 border border-line bg-paper text-ink-soft hover:text-ink hover:bg-surface rounded-none transition"
                    >
                      <X size={12} />
                      <span>{t('取消 (Esc)')}</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteBlock(idx)}
                    title={t('删除本块')}
                    className="inline-flex items-center gap-1 px-2 py-1 text-warn hover:text-warn-deep hover:bg-warn/10 rounded-none transition text-[11px]"
                  >
                    <Trash2 size={12} />
                    <span>{t('删除块')}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                onDoubleClick={() => startEdit(idx)}
                className="note-block-view relative border border-transparent hover:border-dashed hover:border-line-strong/60 rounded-none p-1 transition-colors"
                title={t('双击或点击右上角按钮即可就地编辑本块')}
              >
                {/* 悬停时的块操作按钮 */}
                <div className="no-print absolute top-1 right-1 z-10 hidden group-hover/block:flex items-center gap-1 bg-card/90 border border-line px-1 py-0.5 shadow-2xs rounded-none backdrop-blur select-none">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      startEdit(idx)
                    }}
                    title={t('编辑本块')}
                    className="flex h-5 w-5 items-center justify-center text-ink-soft hover:text-seal hover:bg-line/40 rounded-none transition"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteBlock(idx)
                    }}
                    title={t('删除本块')}
                    className="flex h-5 w-5 items-center justify-center text-ink-soft hover:text-warn-deep hover:bg-warn/10 rounded-none transition"
                  >
                    <Trash2 size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      insertBlockAfter(idx)
                    }}
                    title={t('在下方插入新块')}
                    className="flex h-5 w-5 items-center justify-center text-ink-soft hover:text-seal hover:bg-line/40 rounded-none transition"
                  >
                    <Plus size={11} />
                  </button>
                </div>

                {/* 块内容渲染 */}
                <MarkdownView
                  html={renderNote(block.raw)}
                  annotations={annotations}
                  knownConceptKeys={knownConceptKeys}
                  annotationActions={annotationActions}
                  resolveLocalImage={resolveLocalImage}
                />
              </div>
            )}
          </div>
        )
      })}

      {/* 底部追加新块入口 */}
      <div className="py-2 opacity-30 hover:opacity-100 transition-opacity flex justify-center select-none">
        <button
          type="button"
          onClick={appendNewBlock}
          className="inline-flex items-center gap-1 px-3 py-1 border border-dashed border-line hover:border-seal text-ink-faint hover:text-seal text-[11px] rounded-none transition bg-paper/60"
        >
          <Plus size={12} />
          <span>{t('在末尾添加新块')}</span>
        </button>
      </div>
    </div>
  )
})
