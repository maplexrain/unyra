/*
 * 视频笔记机制（VideoStudyTab 拆分模块）：
 * 笔记实体是节点宇宙中挂载在视频节点下的笔记节点——这里负责把它接进页签：
 * 有效视频节点 id 的解析（props.videoNodeId 优先，store.videoNodes 按
 * videoId / input 兜底匹配，缺失时新建笔记自动创建/登记视频节点）、笔记列表
 * 读取、编辑草稿与 400ms 防抖落盘、列表原地重命名、新建/删除、二级编辑页进出，
 * 以及「插入当前视频时间戳」（moji:video 协议链接，光标处插入并移动光标）。
 * 原样搬自 VideoStudyTab.tsx（注释一并带走），按仓库惯例收成 Deps 单对象的
 * 逻辑 hook；textarea 挂点 ref 由本 hook 拥有、递给悬浮笔记窗口。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { t } from '../../i18n'
import { videoLinkMarkdown } from '../../lib/videoLink'
import {
  createNoteForVideoNode,
  deleteNoteForVideoNode,
  getNotesForVideoNode,
  updateNoteForVideoNode,
} from '../../learn/video/nodes'
import type { LearnStore, NoteFile, VideoNodeEntity, VideoResource } from '../../learn/types'

/** 笔记机制需要宿主（页签门面）提供的入参 */
export interface VideoNotesDeps {
  /** 整个目标的 store */
  store?: LearnStore
  /** 提交 store 修改 */
  onCommitStore?: (next: LearnStore) => void
  /** 关联的视频节点 id（如果有） */
  videoNodeId?: string
  /** 绑定的视频资源：新建笔记兜底登记视频节点时要它的 id/input/title */
  video: VideoResource | null
  /** 初始输入（来自视频节点）：兜底匹配视频节点、新建节点补 input/title */
  initialInput: string
  /** 播放器此刻的位置（ms）：时间戳链接用 */
  currentMs: number
  /** 当前解析到的分页（选集）：时间戳链接带 page 用（只读 page 字段） */
  currentPage?: { page: number }
}

/**
 * 视频笔记机制：返回笔记列表/编辑态与全部笔记操作回调（悬浮笔记窗口直接用）。
 */
export function useVideoNotes({
  store,
  onCommitStore,
  videoNodeId,
  video,
  initialInput,
  currentMs,
  currentPage,
}: VideoNotesDeps) {
  /** 当前在二级页面编辑的笔记 id；null 为列表页 */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)

  /** 挂载的有效视频节点 ID（优先使用 props.videoNodeId，兜底从 store.videoNodes 按 videoId / input 匹配） */
  /** 动态创建/认领的视频节点 ID 缓存（避免异步 store 回流前漂移） */
  const [assignedVideoNodeId, setAssignedVideoNodeId] = useState<string | null>(null)

  /** 当前编辑态的笔记对象暂存，保证即时切入二级页面不闪烁 */
  const [activeEditingNote, setActiveEditingNote] = useState<NoteFile | null>(null)

  const effectiveVideoNodeId = useMemo(() => {
    if (videoNodeId) return videoNodeId
    if (assignedVideoNodeId) return assignedVideoNodeId
    if (!store) return undefined
    if (video?.id) {
      const match = (store.videoNodes ?? []).find((vn) => vn.videoId === video.id)
      if (match) return match.id
    }
    if (initialInput) {
      const match = (store.videoNodes ?? []).find((vn) => vn.input === initialInput)
      if (match) return match.id
    }
    return undefined
  }, [videoNodeId, assignedVideoNodeId, store, video?.id, initialInput])

  /** 挂载在当前视频节点下的所有笔记节点实体 */
  const videoNotes = useMemo<NoteFile[]>(() => {
    if (!store || !effectiveVideoNodeId) return []
    return getNotesForVideoNode(store, effectiveVideoNodeId)
  }, [store, effectiveVideoNodeId])

  /** 编辑态的草稿正文（标题直接在列表页中原地重命名） */
  const [draftContent, setDraftContent] = useState('')
  const saveTimerRef = useRef<number | null>(null)
  const latestStoreRef = useRef(store)
  useEffect(() => {
    latestStoreRef.current = store
  }, [store])

  const noteTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  /** 当前正在编辑的笔记对象：只要 editingNoteId 有值，永不返回 null */
  const currentEditingNote = useMemo<NoteFile | null>(() => {
    if (!editingNoteId) return null
    const found = videoNotes.find((n) => n.id === editingNoteId)
    if (found) return found
    if (activeEditingNote && activeEditingNote.id === editingNoteId) {
      return {
        ...activeEditingNote,
        content: draftContent,
      }
    }
    return {
      id: editingNoteId,
      name: t('未命名笔记'),
      content: draftContent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  }, [videoNotes, editingNoteId, activeEditingNote, draftContent])

  useEffect(() => {
    if (currentEditingNote && currentEditingNote.content !== draftContent) {
      setDraftContent(currentEditingNote.content)
    }
  }, [currentEditingNote?.id])

  /** 提交笔记正文变更并写回 store */
  const commitNoteDraft = useCallback(
    (content: string) => {
      const currentStore = latestStoreRef.current || store
      if (!editingNoteId || !currentStore || !onCommitStore) return
      const targetNote = videoNotes.find((n) => n.id === editingNoteId)
      const name = targetNote?.name || t('未命名笔记')
      const nextStore = updateNoteForVideoNode(currentStore, editingNoteId, { name, content })
      onCommitStore(nextStore)
    },
    [editingNoteId, store, onCommitStore, videoNotes],
  )

  /** 在笔记列表中原地重命名某篇笔记 */
  const handleRenameNote = useCallback(
    (noteId: string, newTitle: string) => {
      const currentStore = latestStoreRef.current || store
      if (!currentStore || !onCommitStore) return
      const trimmed = newTitle.trim() || t('未命名笔记')
      const nextStore = updateNoteForVideoNode(currentStore, noteId, { name: trimmed })
      onCommitStore(nextStore)
    },
    [store, onCommitStore],
  )

  const handleContentChange = (val: string) => {
    setDraftContent(val)
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      commitNoteDraft(val)
    }, 400)
  }

  /** 返回笔记列表：有未落盘定时器立即落盘并清空 editingNoteId */
  /** 点击切换进入某份笔记的二级编辑页 */
  const handleSelectNote = (noteId: string) => {
    const found = videoNotes.find((n) => n.id === noteId)
    if (found) {
      setActiveEditingNote(found)
      setDraftContent(found.content)
    }
    setEditingNoteId(noteId)
  }

  /** 返回笔记列表：有未落盘定时器立即落盘并清空 editingNoteId */
  const handleBackToList = () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    commitNoteDraft(draftContent)
    setEditingNoteId(null)
    setActiveEditingNote(null)
  }

  /** 在当前光标处（或末尾）插入当前视频时间戳超链接（moji:video 协议） */
  const handleInsertTimestamp = () => {
    const pageNum = currentPage?.page
    const mdLink = videoLinkMarkdown({ page: pageNum, timeMs: currentMs }) + ' '
    const textarea = noteTextareaRef.current
    if (!textarea) {
      const next = draftContent ? `${draftContent}\n${mdLink}` : mdLink
      setDraftContent(next)
      commitNoteDraft(next)
      return
    }

    const start = textarea.selectionStart ?? draftContent.length
    const end = textarea.selectionEnd ?? draftContent.length
    const next = draftContent.slice(0, start) + mdLink + draftContent.slice(end)
    setDraftContent(next)
    commitNoteDraft(next)

    // 光标移到插入的时间戳超链接之后
    window.setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + mdLink.length, start + mdLink.length)
    }, 0)
  }

  /** 新建一条笔记并挂载到当前视频节点上 */
  const handleCreateNote = () => {
    const currentStore = latestStoreRef.current || store
    if (!currentStore || !onCommitStore) return

    let targetVideoNodeId = effectiveVideoNodeId
    let storeToUse = currentStore

    // 如果还没有对应的视频节点（例如直接打开老视频资源的情况），自动为该视频资源创建/登记一个视频节点
    if (!targetVideoNodeId) {
      const vNodeId = crypto.randomUUID()
      const now = Date.now()
      const targetGoalId = storeToUse.goals?.[0]?.id || 'default'
      const newVNode: VideoNodeEntity = {
        id: vNodeId,
        goalId: targetGoalId,
        videoId: video?.id ?? null,
        input: video?.input || initialInput || '',
        title: video?.title || initialInput || t('视频'),
        titleCustomized: false,
        confirmed: !!video?.id,
        createdAt: now,
        updatedAt: now,
      }
      storeToUse = {
        ...storeToUse,
        videoNodes: [...(storeToUse.videoNodes ?? []), newVNode],
      }
      targetVideoNodeId = vNodeId
      setAssignedVideoNodeId(vNodeId)
    }

    const { store: nextStore, note } = createNoteForVideoNode(storeToUse, targetVideoNodeId)
    setActiveEditingNote(note)
    setDraftContent(note.content)
    setEditingNoteId(note.id)
    onCommitStore(nextStore)
  }

  /** 删除某条笔记 */
  const handleDeleteNote = (noteId: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    const currentStore = latestStoreRef.current || store
    if (!currentStore || !onCommitStore) return
    const nextStore = deleteNoteForVideoNode(currentStore, noteId)
    onCommitStore(nextStore)
    if (editingNoteId === noteId) {
      setEditingNoteId(null)
      setActiveEditingNote(null)
    }
  }

  return {
    videoNotes,
    editingNoteId,
    currentEditingNote,
    draftContent,
    noteTextareaRef,
    handleContentChange,
    handleCreateNote,
    handleRenameNote,
    handleDeleteNote,
    handleSelectNote,
    handleBackToList,
    handleInsertTimestamp,
  }
}
