import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical, StickyNote, Trash2 } from 'lucide-react'
import type { DocNotepadItem } from '../../../learn/types'
import { DOC_TW_CLASS } from '../../../lib/docTailwind'
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
  const latestContentRef = useRef(item.content)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 外部 content 变化时（如从其他端或历史恢复，仅在不同步时更新）
  useEffect(() => {
    if (item.content !== latestContentRef.current) {
      latestContentRef.current = item.content
      setContent(item.content)
    }
  }, [item.content])

  // 立即将最新的文本持久化至上层
  const flushChange = useCallback(
    (text: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      latestContentRef.current = text
      onUpdate(item.id, text)
    },
    [item.id, onUpdate],
  )

  // 组件卸载时若有未提交的改动立即保存
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        onUpdate(item.id, latestContentRef.current)
      }
    }
  }, [item.id, onUpdate])

  // 自动根据内容伸缩高度
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 36)}px`
  }, [content])

  // 本地响应式输入：平滑 60fps 输入，防抖 300ms 写盘
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    latestContentRef.current = next
    setContent(next)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      flushChange(next)
    }, 300)
  }

  const handleBlur = () => {
    flushChange(latestContentRef.current)
  }

  return (
    <div
      data-notepad-id={item.id}
      className="group relative my-2 rounded-none border-0 bg-line/25 px-3 py-2 transition-colors hover:bg-line/35 dark:bg-card/50 dark:hover:bg-card/70"
    >
      <div className="mb-1 flex items-center gap-1.5 select-none">
        {/* 拖动手柄：支持改变便签在文章中的插入位置 */}
        <div
          draggable
          onDragStart={(e) => onDragStart?.(e, item.id)}
          className="flex h-5 w-5 cursor-grab items-center justify-center text-ink-faint transition hover:text-ink active:cursor-grabbing"
          title={t('按住拖动以改变便签插入位置')}
        >
          <GripVertical size={13} />
        </div>

        <StickyNote size={13} className="shrink-0 text-seal/80" />
        <span className="text-[11px] font-medium text-ink-soft">{t('随文笔记')}</span>

        <button
          type="button"
          onClick={() => onDelete(item.id)}
          title={t('删除此条便签')}
          className="ml-auto flex h-5 w-5 items-center justify-center text-ink-faint opacity-50 transition hover:text-red-500 hover:opacity-100"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        rows={1}
        value={content}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={t('在此记录随文笔记，支持实时编辑，数据完全独立记录在节点上…')}
        className="w-full resize-none bg-transparent px-0 text-[12.5px] leading-relaxed text-ink placeholder:text-ink-faint/40 focus:outline-hidden"
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

/** 辅助获取真实的文档内容容器 */
function getDocContainer(body: HTMLElement): HTMLElement {
  return (body.querySelector(`.${DOC_TW_CLASS}`) as HTMLElement) ||
    (body.querySelector('.markdown-body') as HTMLElement) ||
    body
}

const DROP_INDICATOR_ATTR = 'data-notepad-drop-indicator'

/** 获取或创建拖拽时的实时落点占位元素 */
function getOrCreateDropIndicator(container: HTMLElement): HTMLElement {
  let el = container.querySelector(`[${DROP_INDICATOR_ATTR}]`) as HTMLElement | null
  if (!el) {
    el = document.createElement('div')
    el.setAttribute(DROP_INDICATOR_ATTR, 'true')
    el.className = 'notepad-drop-indicator my-1 h-[2px] w-full rounded-full bg-seal/80 shadow-2xs transition-all pointer-events-none'
  }
  return el
}

/** 清除拖拽落点占位元素 */
function removeDropIndicator(container: HTMLElement) {
  const el = container.querySelector(`[${DROP_INDICATOR_ATTR}]`)
  if (el) el.remove()
}

/** 过滤出正文真实的块级子元素 */
function getDocBlockChildren(container: HTMLElement): HTMLElement[] {
  return Array.from(container.children).filter(
    (el) =>
      !el.hasAttribute('data-doc-notepad-slot') &&
      !el.classList.contains('block-notepad-slot') &&
      !el.hasAttribute(DROP_INDICATOR_ATTR),
  ) as HTMLElement[]
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

  // 计算结构指纹（仅当便签 ID 集合或 blockIndex 发生变化时才触发 DOM 插槽重排，输入内容时不触发重排）
  const layoutFingerprint = useMemo(
    () => notepads.map((n) => `${n.id}:${n.blockIndex}`).join('|'),
    [notepads],
  )

  // 扫描渲染内容并在对应位置插入 slot 占位元素
  useEffect(() => {
    const body = containerRef.current
    if (!body) return

    const docContainer = getDocContainer(body)
    const existingSlots = new Map<string, HTMLElement>()
    docContainer.querySelectorAll<HTMLElement>('[data-doc-notepad-slot]').forEach((el) => {
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

    const children = getDocBlockChildren(docContainer)

    notepads.forEach((item) => {
      let slot = existingSlots.get(item.id)
      if (!slot) {
        slot = document.createElement('div')
        slot.setAttribute('data-doc-notepad-slot', item.id)
        slot.className = 'block-notepad-slot my-1'
      }

      // 根据 blockIndex 确定挂载位置
      if (item.blockIndex < 0 || children.length === 0) {
        if (docContainer.firstChild !== slot) {
          docContainer.insertBefore(slot, docContainer.firstChild)
        }
      } else {
        const targetChild = children[Math.min(item.blockIndex, children.length - 1)]
        if (targetChild && targetChild.nextSibling !== slot) {
          docContainer.insertBefore(slot, targetChild.nextSibling)
        } else if (!targetChild && slot.parentElement !== docContainer) {
          docContainer.appendChild(slot)
        }
      }

      newSlots.push({ id: item.id, element: slot })
    })

    setSlots(newSlots)

    return () => {
      // 卸载时清理所有已插入的插槽元素
      existingSlots.forEach((el) => el.remove())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, layoutFingerprint])

  // 为正文各块挂载拖拽放置监听及实时占位落点
  useEffect(() => {
    const body = containerRef.current
    if (!body) return
    const docContainer = getDocContainer(body)

    const calculateTargetIndex = (e: globalThis.DragEvent): number => {
      const children = getDocBlockChildren(docContainer)
      if (children.length === 0) return -1
      for (let i = 0; i < children.length; i++) {
        const rect = children[i].getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        if (i === 0 && e.clientY < midY) {
          return -1
        }
        if (e.clientY <= rect.bottom) {
          return e.clientY < midY ? i - 1 : i
        }
      }
      return children.length - 1
    }

    const handleDragOver = (e: globalThis.DragEvent) => {
      if (!draggedIdRef.current) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'

      const targetIndex = calculateTargetIndex(e)
      const children = getDocBlockChildren(docContainer)
      const indicator = getOrCreateDropIndicator(docContainer)

      if (targetIndex < 0 || children.length === 0) {
        if (docContainer.firstChild !== indicator) {
          docContainer.insertBefore(indicator, docContainer.firstChild)
        }
      } else {
        const targetChild = children[Math.min(targetIndex, children.length - 1)]
        if (targetChild && targetChild.nextSibling !== indicator) {
          docContainer.insertBefore(indicator, targetChild.nextSibling)
        }
      }
    }

    const handleDragLeave = (e: globalThis.DragEvent) => {
      // 当离开容器边界时移除占位线
      if (!body.contains(e.relatedTarget as Node)) {
        removeDropIndicator(docContainer)
      }
    }

    const handleDrop = (e: globalThis.DragEvent) => {
      const draggedId = draggedIdRef.current
      removeDropIndicator(docContainer)
      if (!draggedId) return
      e.preventDefault()

      const targetIndex = calculateTargetIndex(e)
      onMoveNotepad(draggedId, targetIndex)
      draggedIdRef.current = null
    }

    const handleDragEnd = () => {
      removeDropIndicator(docContainer)
      draggedIdRef.current = null
    }

    body.addEventListener('dragover', handleDragOver)
    body.addEventListener('dragleave', handleDragLeave)
    body.addEventListener('drop', handleDrop)
    window.addEventListener('dragend', handleDragEnd)

    return () => {
      body.removeEventListener('dragover', handleDragOver)
      body.removeEventListener('dragleave', handleDragLeave)
      body.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragend', handleDragEnd)
      removeDropIndicator(docContainer)
    }
  }, [containerRef, onMoveNotepad])

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, id: string) => {
    draggedIdRef.current = id
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
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
