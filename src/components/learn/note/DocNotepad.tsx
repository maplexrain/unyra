import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftToLine, ArrowRightToLine, GripVertical, Square, StickyNote, TextWrap, Trash2 } from 'lucide-react'
import type { DocNotepadItem } from '../../../learn/types'
import { DOC_TW_CLASS } from '../../../lib/docTailwind'
import { t } from '../../../i18n'

/** 形态 / 浮动侧 / 宽度的补丁；宽度在拖拽结束时提交（拖拽中直改 DOM，不进 React） */
export type NotepadPatch = Partial<Pick<DocNotepadItem, 'mode' | 'float' | 'width'>>

/** 行内形态只落进文本容器：在围栏、表格、列表壳里浮一张卡没有意义 */
const INLINE_BLOCK_TAGS = new Set(['P', 'BLOCKQUOTE', 'LI', 'DD', 'DT'])
const INLINE_MIN_WIDTH = 160
const INLINE_DEFAULT_WIDTH = 240

interface NotepadRowProps {
  item: DocNotepadItem
  onUpdate: (id: string, content: string) => void
  onDelete: (id: string) => void
  onPatch: (id: string, patch: NotepadPatch) => void
  onDragStart?: (e: DragEvent<HTMLDivElement>, id: string) => void
}

export const DocNotepadRow = memo(function DocNotepadRow({
  item,
  onUpdate,
  onDelete,
  onPatch,
  onDragStart,
}: NotepadRowProps) {
  const [content, setContent] = useState(item.content)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const latestContentRef = useRef(item.content)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const resizeRef = useRef<{ startX: number; startW: number; maxW: number } | null>(null)

  const inline = item.mode === 'inline'
  const floatSide = item.float === 'right' ? 'right' : 'left'

  // 行内形态下卡片 portaled 在浮动壳里：壳就是这张卡的宽度载体
  const wrapperEl = () => rootRef.current?.parentElement ?? null

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

  /*
   * 行内宽度拉伸：拖拽中直改浮动壳的 width（绕开 React，重排零开销），
   * 松手才把最终值经 patch 记到节点上。float 左卡手柄在右缘（右拖加宽），
   * 右卡手柄在左缘（左拖加宽），所以 dx 按 float 侧翻一次符号。
   */
  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const wrap = wrapperEl()
    if (!wrap) return
    e.preventDefault()
    const hostW = wrap.parentElement?.clientWidth ?? 0
    resizeRef.current = {
      startX: e.clientX,
      startW: wrap.offsetWidth,
      maxW: Math.max(INLINE_MIN_WIDTH + 40, hostW - 80),
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = resizeRef.current
    const wrap = wrapperEl()
    if (!st || !wrap) return
    const dx = (e.clientX - st.startX) * (floatSide === 'right' ? -1 : 1)
    const w = Math.min(st.maxW, Math.max(INLINE_MIN_WIDTH, Math.round(st.startW + dx)))
    wrap.style.width = `${w}px`
  }

  const handleResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已释放时忽略 */
    }
    const wrap = wrapperEl()
    if (wrap) onPatch(item.id, { width: Math.round(wrap.offsetWidth) })
  }

  return (
    <div
      data-notepad-id={item.id}
      ref={rootRef}
      className={
        inline
          ? 'group relative w-full bg-ink/[0.06] px-3 py-2 shadow-sm transition-colors hover:bg-ink/[0.09]'
          : 'group relative my-2 rounded-none border-0 bg-ink/[0.04] px-3 py-2 transition-colors hover:bg-ink/[0.07]'
      }
    >
      {inline && (
        <div
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          title={t('拖动调节宽度')}
          className={
            'absolute bottom-2 top-2 z-10 w-1.5 cursor-ew-resize rounded-full bg-seal/70 opacity-0 transition-opacity group-hover:opacity-70 ' +
            (floatSide === 'right' ? 'left-0' : 'right-0')
          }
        />
      )}

      <div className="mb-1 flex items-center gap-1.5 select-none">
        {/* 拖动手柄：仅块级形态提供，支持改变便签在文章中的插入位置（行内要挪位置先切回块级） */}
        {!inline && (
          <div
            draggable
            onDragStart={(e) => onDragStart?.(e, item.id)}
            className="flex h-5 w-5 cursor-grab items-center justify-center text-ink-faint transition hover:text-ink active:cursor-grabbing"
            title={t('按住拖动以改变便签插入位置')}
          >
            <GripVertical size={13} />
          </div>
        )}

        <StickyNote size={13} className="shrink-0 text-ink-soft/70" />
        <span className="text-[11px] font-medium text-ink-soft">{t('随文笔记')}</span>

        {/* 块级 ⇄ 行内形态切换 */}
        <button
          type="button"
          onClick={() => onPatch(item.id, { mode: inline ? 'block' : 'inline' })}
          title={inline ? t('切换为块级（独占一行）') : t('切换为行内（正文环绕）')}
          className="flex h-5 w-5 items-center justify-center text-ink-faint opacity-60 transition hover:text-ink hover:opacity-100"
        >
          {inline ? <Square size={12} /> : <TextWrap size={12} />}
        </button>

        {/* 行内形态的浮动侧切换 */}
        {inline && (
          <button
            type="button"
            onClick={() => onPatch(item.id, { float: floatSide === 'right' ? 'left' : 'right' })}
            title={floatSide === 'right' ? t('靠左浮动') : t('靠右浮动')}
            className="flex h-5 w-5 items-center justify-center text-ink-faint opacity-60 transition hover:text-ink hover:opacity-100"
          >
            {floatSide === 'right' ? <ArrowLeftToLine size={12} /> : <ArrowRightToLine size={12} />}
          </button>
        )}

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
  onPatchNotepad: (id: string, patch: NotepadPatch) => void
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
 * 行内形态的宿主块解析：blockIndex 对准文本容器；不满足（围栏/表格壳等）时回落 null，走块级插槽。
 * blockIndex 的口径是「插在第几个块之后」，行内就取它对准的那一块当宿主。
 */
function resolveInlineHost(item: DocNotepadItem, children: HTMLElement[]): HTMLElement | null {
  if (item.mode !== 'inline' || children.length === 0) return null
  const anchor = children[Math.max(0, Math.min(item.blockIndex, children.length - 1))]
  return anchor && INLINE_BLOCK_TAGS.has(anchor.tagName) ? anchor : null
}

/** 清掉某个元素上「行内宿主」的标记（类名与 flow-root 都是挂上去的，都要摘干净） */
function unmarkInlineHost(el: Element): void {
  el.classList.remove('doc-notepad-inline-host')
  ;(el as HTMLElement).style.display = ''
}

/**
 * 将节点上的便签列表挂载到教学文档 DOM 中：
 * 块级便签插在对应 blockIndex 的插槽内，行内便签以浮动壳落在宿主块内部、正文环绕。
 */
export function DocNotepadLayer({
  containerRef,
  notepads,
  onUpdateNotepad,
  onDeleteNotepad,
  onMoveNotepad,
  onPatchNotepad,
}: DocNotepadLayerProps) {
  const [slots, setSlots] = useState<{ id: string; element: HTMLElement }[]>([])
  const draggedIdRef = useRef<string | null>(null)

  // 计算结构指纹（块位/形态/浮动侧变化才重排插槽；输入内容与拖宽都不触发重排）
  const layoutFingerprint = useMemo(
    () => notepads.map((n) => `${n.id}:${n.blockIndex}:${n.mode ?? 'block'}:${n.float ?? 'left'}`).join('|'),
    [notepads],
  )

  // 扫描渲染内容并在对应位置挂载插槽（块级）或浮动壳（行内）
  useEffect(() => {
    const body = containerRef.current
    if (!body) return

    const docContainer = getDocContainer(body)
    const existingSlots = new Map<string, HTMLElement>()
    docContainer.querySelectorAll<HTMLElement>('[data-doc-notepad-slot]').forEach((el) => {
      const id = el.getAttribute('data-doc-notepad-slot')
      if (id) existingSlots.set(id, el)
    })
    const existingFloats = new Map<string, HTMLElement>()
    docContainer.querySelectorAll<HTMLElement>('[data-doc-notepad-float]').forEach((el) => {
      const id = el.getAttribute('data-doc-notepad-float')
      if (id) existingFloats.set(id, el)
    })

    const activeIds = new Set(notepads.map((n) => n.id))
    existingSlots.forEach((el, id) => {
      if (!activeIds.has(id)) el.remove()
    })
    existingFloats.forEach((el, id) => {
      if (!activeIds.has(id)) el.remove()
    })
    // 行内宿主标记全量摘除，下面按本轮归属重挂（模式/锚点切换后不留残迹）
    docContainer.querySelectorAll('.doc-notepad-inline-host').forEach(unmarkInlineHost)

    const children = getDocBlockChildren(docContainer)
    const newSlots: { id: string; element: HTMLElement }[] = []

    notepads.forEach((item) => {
      const inlineHost = resolveInlineHost(item, children)

      if (inlineHost) {
        // 换成行内形态：块级残留的旧插槽收走
        existingSlots.get(item.id)?.remove()
        existingSlots.delete(item.id)

        let wrap = existingFloats.get(item.id)
        if (!wrap) {
          wrap = document.createElement('div')
          wrap.setAttribute('data-doc-notepad-float', item.id)
          wrap.className = 'doc-notepad-float'
          existingFloats.set(item.id, wrap)
        }
        wrap.style.float = item.float === 'right' ? 'right' : 'left'
        // 文字侧留出呼吸距离，底部留缝避免下一块贴着卡片底
        wrap.style.margin = item.float === 'right' ? '0 0 6px 10px' : '0 10px 6px 0'
        wrap.style.width = `${Math.round(item.width ?? INLINE_DEFAULT_WIDTH)}px`
        // flow-root 把浮动壳框进宿主块：正文在块内环绕，卡片再高也不会压到后续内容
        inlineHost.classList.add('doc-notepad-inline-host')
        inlineHost.style.display = 'flow-root'
        if (wrap.parentElement !== inlineHost) {
          wrap.remove()
          inlineHost.insertBefore(wrap, inlineHost.firstChild)
        }
        newSlots.push({ id: item.id, element: wrap })
        return
      }

      // 换成块级形态（或本来就是）：行内残留的旧浮动壳收走
      existingFloats.get(item.id)?.remove()
      existingFloats.delete(item.id)

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
      // 卸载时清理所有插槽与浮动壳，宿主标记也要摘
      docContainer.querySelectorAll('[data-doc-notepad-slot],[data-doc-notepad-float]').forEach((el) => el.remove())
      docContainer.querySelectorAll('.doc-notepad-inline-host').forEach(unmarkInlineHost)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, layoutFingerprint])

  // 行内便签宽度的外部同步（如撤销/其他端改动）：指纹不含宽度，这里按值对齐浮动壳
  useEffect(() => {
    const body = containerRef.current
    if (!body) return
    const docContainer = getDocContainer(body)
    for (const n of notepads) {
      if (n.mode !== 'inline' || n.width === undefined) continue
      const wrap = docContainer.querySelector<HTMLElement>(`[data-doc-notepad-float="${n.id}"]`)
      if (!wrap) continue
      const w = `${Math.round(n.width)}px`
      if (wrap.style.width !== w) wrap.style.width = w
    }
  }, [containerRef, notepads])

  // 为正文各块挂载拖拽放置监听及实时占位落点（仅块级形态用：手柄只在块级卡片上）
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
            onPatch={onPatchNotepad}
            onDragStart={handleDragStart}
          />,
          element,
        )
      })}
    </>
  )
}
