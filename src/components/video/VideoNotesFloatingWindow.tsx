/**
 * 视频笔记悬浮窗口组件：
 * - 悬浮在视频播放器容器内，支持自由拖动（拖动顶部栏）与调节窗口大小（右下角拖拽手柄）；
 * - 纯色半透明背景，不使用消耗性能的模糊滤镜；
 * - 状态持久化到 localStorage（位置 x, y 与尺寸 width, height）；
 * - 默认尺寸为 600x400，默认位置为右侧垂直居中；
 * - 顶部栏按钮采用无文字、无边框、无背景的纯 SVG 图标按钮；
 * - 一级页面支持笔记列表与卡片内直接重命名笔记；
 * - 二级页面去掉标题输入框，提供全高度 Markdown 笔记编辑空间，支持一键插入时间戳跳转链接。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  ChevronLeft,
  Clock,
  GripHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { t } from '../../i18n'
import type { NoteFile } from '../../learn/types'

export const NOTES_WINDOW_STORAGE_KEY = 'moji.video.notesWindow'
export const DEFAULT_WINDOW_WIDTH = 600
export const DEFAULT_WINDOW_HEIGHT = 400
export const MIN_WINDOW_WIDTH = 360
export const MIN_WINDOW_HEIGHT = 240

export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
}

export function loadNotesWindowState(): WindowState {
  try {
    const raw = localStorage.getItem(NOTES_WINDOW_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WindowState>
      if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        return {
          x: typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : undefined,
          y: typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : undefined,
          width: Math.max(MIN_WINDOW_WIDTH, parsed.width),
          height: Math.max(MIN_WINDOW_HEIGHT, parsed.height),
        }
      }
    }
  } catch {}
  return {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
  }
}

export function saveNotesWindowState(state: WindowState) {
  try {
    localStorage.setItem(NOTES_WINDOW_STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

interface Props {
  open: boolean
  onClose: () => void
  currentMs: number
  videoNotes: NoteFile[]
  editingNoteId: string | null
  currentEditingNote: NoteFile | null
  draftContent: string
  onContentChange: (content: string) => void
  onCreateNote: () => void
  onRenameNote: (noteId: string, newName: string) => void
  onDeleteNote: (noteId: string, e: React.MouseEvent) => void
  onSelectNote: (noteId: string) => void
  onBackToList: () => void
  onInsertTimestamp: () => void
  noteTextareaRef: React.RefObject<HTMLTextAreaElement | null>
}

export default function VideoNotesFloatingWindow({
  open,
  onClose,
  videoNotes,
  editingNoteId,
  currentEditingNote,
  draftContent,
  onContentChange,
  onCreateNote,
  onRenameNote,
  onDeleteNote,
  onSelectNote,
  onBackToList,
  onInsertTimestamp,
  noteTextareaRef,
}: Props) {
  const windowRef = useRef<HTMLDivElement | null>(null)
  const [windowState, setWindowState] = useState<WindowState>(loadNotesWindowState)
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  // 记录拖动与缩放的起始指针状态
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; initW: number; initH: number } | null>(null)

  // 列表页内原地重命名标题的状态
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingText, setRenamingText] = useState<string>('')

  // 监听并获取视频播放器父容器尺寸
  useEffect(() => {
    const el = windowRef.current
    const parent = el?.parentElement
    if (!parent) return

    const updateSize = () => {
      const w = parent.clientWidth
      const h = parent.clientHeight
      if (w > 0 && h > 0) {
        setContainerSize({ width: w, height: h })
      }
    }

    updateSize()
    const ro = new ResizeObserver(updateSize)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  // 计算当前有效显示尺寸（不超过父容器）
  const effectiveWidth = useMemo(() => {
    const maxW = containerSize.width > 0 ? Math.max(MIN_WINDOW_WIDTH, containerSize.width - 24) : DEFAULT_WINDOW_WIDTH
    return Math.min(maxW, Math.max(MIN_WINDOW_WIDTH, windowState.width))
  }, [containerSize.width, windowState.width])

  const effectiveHeight = useMemo(() => {
    const maxH = containerSize.height > 0 ? Math.max(MIN_WINDOW_HEIGHT, containerSize.height - 48) : DEFAULT_WINDOW_HEIGHT
    return Math.min(maxH, Math.max(MIN_WINDOW_HEIGHT, windowState.height))
  }, [containerSize.height, windowState.height])

  // 计算默认位置：右侧对齐（右边距 24px）、垂直居中
  const defaultPos = useMemo(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0) {
      return { x: 24, y: 48 }
    }
    const defX = Math.max(16, containerSize.width - effectiveWidth - 24)
    const defY = Math.max(16, Math.floor((containerSize.height - effectiveHeight) / 2))
    return { x: defX, y: defY }
  }, [containerSize.width, containerSize.height, effectiveWidth, effectiveHeight])

  // 当前有效位置（若未持久化过位置或位置越界，自动回落并贴合视口）
  const posX = useMemo(() => {
    if (windowState.x === undefined) return defaultPos.x
    if (containerSize.width <= 0) return windowState.x
    const maxX = Math.max(0, containerSize.width - effectiveWidth)
    return Math.min(maxX, Math.max(0, windowState.x))
  }, [windowState.x, defaultPos.x, containerSize.width, effectiveWidth])

  const posY = useMemo(() => {
    if (windowState.y === undefined) return defaultPos.y
    if (containerSize.height <= 0) return windowState.y
    const maxY = Math.max(0, containerSize.height - effectiveHeight)
    return Math.min(maxY, Math.max(0, windowState.y))
  }, [windowState.y, defaultPos.y, containerSize.height, effectiveHeight])

  // 判断是否点击到了不可拖动的交互元素
  const isInteractiveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false
    return !!target.closest('button, input, textarea, a, select, [data-no-drag]')
  }

  // 顶部栏拖拽开始
  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isInteractiveTarget(e.target)) return
    e.preventDefault()
    e.stopPropagation()

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: posX,
      initY: posY,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // 拖拽移动
  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.stopPropagation()

    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY

    const maxX = containerSize.width > 0 ? Math.max(0, containerSize.width - effectiveWidth) : 2000
    const maxY = containerSize.height > 0 ? Math.max(0, containerSize.height - effectiveHeight) : 2000

    const nextX = Math.min(maxX, Math.max(0, dragRef.current.initX + dx))
    const nextY = Math.min(maxY, Math.max(0, dragRef.current.initY + dy))

    setWindowState((prev) => ({
      ...prev,
      x: nextX,
      y: nextY,
    }))
  }

  // 拖拽结束
  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    saveNotesWindowState({
      ...windowState,
      x: posX,
      y: posY,
      width: effectiveWidth,
      height: effectiveHeight,
    })
  }

  // 右下角尺寸调节开始
  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initW: effectiveWidth,
      initH: effectiveHeight,
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  // 尺寸调节移动
  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    e.preventDefault()
    e.stopPropagation()

    const dx = e.clientX - resizeRef.current.startX
    const dy = e.clientY - resizeRef.current.startY

    const maxW = containerSize.width > 0 ? Math.max(MIN_WINDOW_WIDTH, containerSize.width - posX) : 2000
    const maxH = containerSize.height > 0 ? Math.max(MIN_WINDOW_HEIGHT, containerSize.height - posY) : 2000

    const nextW = Math.min(maxW, Math.max(MIN_WINDOW_WIDTH, resizeRef.current.initW + dx))
    const nextH = Math.min(maxH, Math.max(MIN_WINDOW_HEIGHT, resizeRef.current.initH + dy))

    setWindowState((prev) => ({
      ...prev,
      width: nextW,
      height: nextH,
    }))
  }

  // 尺寸调节结束
  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return
    resizeRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}

    saveNotesWindowState({
      ...windowState,
      x: posX,
      y: posY,
      width: effectiveWidth,
      height: effectiveHeight,
    })
  }

  const handleStartRename = (note: NoteFile, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setRenamingId(note.id)
    setRenamingText(note.name)
  }

  const handleCommitRename = (noteId: string) => {
    const trimmed = renamingText.trim()
    if (trimmed) {
      onRenameNote(noteId, trimmed)
    }
    setRenamingId(null)
  }

  if (!open) return null

  return (
    <div
      ref={windowRef}
      style={{
        left: `${posX}px`,
        top: `${posY}px`,
        width: `${effectiveWidth}px`,
        height: `${effectiveHeight}px`,
      }}
      className="absolute z-30 flex flex-col rounded-xl border border-white/15 bg-[#141416]/95 text-white shadow-2xl overflow-hidden select-none animate-in fade-in zoom-in-95 duration-100"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 拖动顶部栏 Header（纯图标按钮，无文字无背景无边框） */}
      <div
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={handleHeaderPointerUp}
        onPointerCancel={handleHeaderPointerUp}
        className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-2 cursor-move select-none"
      >
        {editingNoteId && currentEditingNote ? (
          /* 二级编辑页顶部栏 */
          <>
            <div className="flex items-center gap-1 min-w-0" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={onBackToList}
                title={t('返回笔记列表')}
                className="p-1 text-white/70 hover:text-white transition cursor-pointer"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="truncate text-[12.5px] font-medium text-white/90 ml-1">
                {currentEditingNote.name}
              </span>
            </div>

            <div className="flex items-center gap-1.5" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={onCreateNote}
                title={t('新建笔记')}
                className="p-1 text-white/80 hover:text-white transition cursor-pointer"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                onClick={onInsertTimestamp}
                title={t('在光标处插入当前时间戳跳转链接')}
                className="p-1 text-pink-400 hover:text-pink-300 transition cursor-pointer"
              >
                <Clock size={16} />
              </button>
              <GripHorizontal size={14} className="text-white/30 shrink-0 mx-0.5" />
              <button
                type="button"
                onClick={onClose}
                title={t('收起笔记 (双击 Shift)')}
                className="p-1 text-white/60 hover:text-white transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </>
        ) : (
          /* 一级列表页顶部栏 */
          <>
            <div className="flex items-center gap-2 min-w-0" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
              <BookOpen size={16} className="text-pink-400 shrink-0" />
              <span className="text-[12.5px] font-semibold text-white/95 truncate">{t('视频笔记')}</span>
              {videoNotes.length > 0 && (
                <span className="text-[11px] text-white/50 font-mono">
                  ({videoNotes.length})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5" data-no-drag onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={onCreateNote}
                title={t('新建笔记')}
                className="p-1 text-white/80 hover:text-white transition cursor-pointer"
              >
                <Plus size={18} />
              </button>
              <GripHorizontal size={14} className="text-white/30 shrink-0 mx-0.5" />
              <button
                type="button"
                onClick={onClose}
                title={t('收起笔记 (双击 Shift)')}
                className="p-1 text-white/60 hover:text-white transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* 主体内容区 */}
      {editingNoteId && currentEditingNote ? (
        /* 二级页面：编辑某份笔记（无标题输入框，全高度正文编辑区） */
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 p-3.5">
            <textarea
              ref={noteTextareaRef}
              value={draftContent}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder={t('记录你的思考、问题或随堂笔记（支持 Markdown，点上方时钟图标可插入时间戳超链接）…')}
              className="h-full w-full resize-none bg-transparent font-sans text-[12.5px] leading-relaxed text-white/90 placeholder:text-white/30 outline-none"
            />
          </div>
        </div>
      ) : (
        /* 一级页面：笔记列表（支持在列表项中直接编辑标题） */
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
          {videoNotes.length > 0 ? (
            <div className="flex flex-col gap-2">
              {videoNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => onSelectNote(note.id)}
                  className="group relative flex flex-col gap-1 rounded-lg bg-white/[0.04] p-3 transition hover:bg-white/[0.08] cursor-pointer border border-white/5 hover:border-white/15"
                >
                  <div className="flex items-center justify-between gap-2">
                    {renamingId === note.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={renamingText}
                        onChange={(e) => setRenamingText(e.target.value)}
                        onBlur={() => handleCommitRename(note.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleCommitRename(note.id)
                          } else if (e.key === 'Escape') {
                            setRenamingId(null)
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="min-w-0 flex-1 bg-white/10 rounded px-2 py-0.5 text-[12px] font-medium text-white outline-none border border-pink-400/50"
                      />
                    ) : (
                      <span
                        className="truncate text-[12.5px] font-medium text-white/95"
                        onDoubleClick={(e) => handleStartRename(note, e)}
                        title={t('双击或点右侧铅笔可修改标题')}
                      >
                        {note.name}
                      </span>
                    )}

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition" data-no-drag>
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(note, e)}
                        title={t('修改标题')}
                        className="p-1 text-white/40 hover:text-white transition cursor-pointer"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => onDeleteNote(note.id, e)}
                        title={t('删除笔记')}
                        className="p-1 text-white/40 hover:text-red-400 transition cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {note.content ? (
                    <p className="line-clamp-2 text-[11.5px] leading-relaxed text-white/60">
                      {note.content.replace(/^#+\s+/gm, '')}
                    </p>
                  ) : (
                    <p className="text-[11px] italic text-white/30">{t('（空笔记）')}</p>
                  )}

                  <span className="text-[10px] text-white/40 font-mono">
                    {new Date(note.updatedAt || note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Pencil size={24} className="text-white/20" />
              <p className="max-w-[340px] text-[12px] leading-relaxed text-white/45">
                {t('还没有笔记：点击上方加号或下方按钮即可记录学习要点，并实时挂在视频节点下。')}
              </p>
              <button
                type="button"
                onClick={onCreateNote}
                className="mt-1 flex items-center gap-1.5 rounded-lg bg-pink-600 px-3.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-pink-700 cursor-pointer shadow-md"
              >
                <Plus size={14} />
                <span>{t('新建第一份笔记')}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 右下角调节窗口大小手柄 */}
      <div
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        title={t('拖拽调节窗口大小')}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize select-none flex items-center justify-center text-white/25 hover:text-white/70 transition"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none">
          <path d="M8 2L2 8M9 5L5 9M9 8L8 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}
