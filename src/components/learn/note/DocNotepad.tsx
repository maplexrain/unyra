import React, { memo, useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, StickyNote, Trash2 } from 'lucide-react'
import type { DocNotepadItem } from '../../../learn/types'
import { t } from '../../../i18n'

interface NotepadRowProps {
  item: DocNotepadItem
  onUpdate: (id: string, content: string) => void
  onDelete: (id: string) => void
  onDragStart?: (e: DragEvent<HTMLDivElement>, id: string) => void
}

export const DocNotepadRow = memo(function DocNotepadRow({
  item,
  onUpdate,
  onDelete,
  onDragStart,
}: NotepadRowProps) {
  const [content, setContent] = useState(item.content)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 随外部数据同步（如从其他端或历史恢复）
  useEffect(() => {
    setContent(item.content)
  }, [item.content])

  // 自动根据内容伸缩高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 40)}px`
  }, [content])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setContent(next)
    onUpdate(item.id, next)
  }

  return (
    <div
      data-notepad-id={item.id}
      className="group relative my-2.5 rounded-xl border border-amber-300/40 bg-amber-50/70 p-2.5 shadow-xs transition-colors hover:border-amber-400/60 dark:border-amber-500/30 dark:bg-amber-950/20 dark:hover:border-amber-400/50"
    >
      <div className="mb-1.5 flex items-center gap-1.5 select-none">
        {/* 拖动手柄：支持改变便签在文章中的插入位置 */}
        <div
          draggable
          onDragStart={(e) => onDragStart?.(e, item.id)}
          className="flex h-5 w-5 cursor-grab items-center justify-center rounded text-ink-faint transition hover:bg-amber-200/50 hover:text-ink active:cursor-grabbing dark:hover:bg-amber-900/50"
          title={t('按住拖动以改变便签插入位置')}
        >
          <GripVertical size={13} />
        </div>

        <StickyNote size={13} className="shrink-0 text-amber-500" />
        <span className="text-[11px] font-medium text-ink-soft">{t('随文笔记')}</span>

        <button
          type="button"
          onClick={() => onDelete(item.id)}
          title={t('删除此条便签')}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-ink-faint opacity-60 transition hover:bg-amber-200/50 hover:text-red-500 hover:opacity-100 dark:hover:bg-amber-900/50"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        rows={1}
        value={content}
        onChange={handleChange}
        placeholder={t('在此记录随文笔记，支持实时编辑，数据完全独立记录在节点上…')}
        className="w-full resize-none bg-transparent px-1 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-faint/60 focus:outline-hidden"
      />
    </div>
  )
})

interface DocNotepadLayerProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  notepads: DocNotepadItem[]
  onUpdateNotepad: (id: string, content: string) => void
  onDeleteNotepad: (id: string) => void
  onMoveNotepad: (id: string, targetBlockIndex: number) => void
}

/**
 * 将节点上的便签列表挂载到教学文档 DOM 中对应 blockIndex 的插槽内
 */
export function DocNotepadLayer({
  containerRef,
  notepads,
  onUpdateNotepad,
  onDeleteNotepad,
  onMoveNotepad,
}: DocNotepadLayerProps) {
  const [slots, setSlots] = useState<{ id: string; element: HTMLElement }[]>([])
  const draggedIdRef = useRef<string | null>(null)

  // 扫描渲染内容并在对应位置插入 slot 占位元素
  useEffect(() => {
    const body = containerRef.current
    if (!body) return

    const markdownBody = body.querySelector('.markdown-body') as HTMLElement || body
    const existingSlots = new Map<string, HTMLElement>()
    markdownBody.querySelectorAll<HTMLElement>('[data-doc-notepad-slot]').forEach((el) => {
      const id = el.getAttribute('data-doc-notepad-slot')
      if (id) existingSlots.set(id, el)
    })

    const newSlots: { id: string; element: HTMLElement }[] = []
    const activeIds = new Set(notepads.map((n) => n.id))

    // 清除已不在列表中的旧插槽
    existingSlots.forEach((el, id) => {
      if (!activeIds.has(id)) {
        el.remove()
      }
    })

    // 过滤出正文真实的块级子元素
    const children = Array.from(markdownBody.children).filter(
      (el) => !el.hasAttribute('data-doc-notepad-slot') && !el.classList.contains('block-notepad-slot'),
    ) as HTMLElement[]

    notepads.forEach((item) => {
      let slot = existingSlots.get(item.id)
      if (!slot) {
        slot = document.createElement('div')
        slot.setAttribute('data-doc-notepad-slot', item.id)
        slot.className = 'block-notepad-slot my-1'
      }

      // 根据 blockIndex 确定挂载位置
      if (item.blockIndex < 0 || children.length === 0) {
        markdownBody.insertBefore(slot, markdownBody.firstChild)
      } else {
        const targetChild = children[Math.min(item.blockIndex, children.length - 1)]
        if (targetChild && targetChild.nextSibling !== slot) {
          markdownBody.insertBefore(slot, targetChild.nextSibling)
        } else if (!targetChild) {
          markdownBody.appendChild(slot)
        }
      }

      newSlots.push({ id: item.id, element: slot })
    })

    setSlots(newSlots)
  }, [containerRef, notepads])

  // 为正文各块挂载拖拽放置监听
  useEffect(() => {
    const body = containerRef.current
    if (!body) return
    const markdownBody = body.querySelector('.markdown-body') as HTMLElement || body

    const handleDragOver = (e: globalThis.DragEvent) => {
      if (!draggedIdRef.current) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
    }

    const handleDrop = (e: globalThis.DragEvent) => {
      const draggedId = draggedIdRef.current
      if (!draggedId) return
      e.preventDefault()

      // 计算落点 blockIndex
      const children = Array.from(markdownBody.children).filter(
        (el) => !el.hasAttribute('data-doc-notepad-slot') && !el.classList.contains('block-notepad-slot'),
      ) as HTMLElement[]

      let targetIndex = children.length - 1
      for (let i = 0; i < children.length; i++) {
        const rect = children[i].getBoundingClientRect()
        if (i === 0 && e.clientY < rect.top) {
          targetIndex = -1
          break
        }
        if (e.clientY <= rect.bottom) {
          targetIndex = i
          break
        }
      }

      onMoveNotepad(draggedId, targetIndex)
      draggedIdRef.current = null
    }

    markdownBody.addEventListener('dragover', handleDragOver)
    markdownBody.addEventListener('drop', handleDrop)

    return () => {
      markdownBody.removeEventListener('dragover', handleDragOver)
      markdownBody.removeEventListener('drop', handleDrop)
    }
  }, [containerRef, onMoveNotepad])

  const handleDragStart = useCallback((_e: DragEvent<HTMLDivElement>, id: string) => {
    draggedIdRef.current = id
  }, [])

  return (
    <>
      {slots.map(({ id, element }) => {
        const item = notepads.find((n) => n.id === id)
        if (!item) return null
        return createPortal(
          <DocNotepadRow
            key={id}
            item={item}
            onUpdate={onUpdateNotepad}
            onDelete={onDeleteNotepad}
            onDragStart={handleDragStart}
          />,
          element,
        )
      })}
    </>
  )
}
