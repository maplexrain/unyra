/**
 * 视频页签：两种形态，同一个组件。
 *
 * - **创建态**（`video` 为空，全局一份，键 v:new）：只有一个输入框 + 创建按钮。
 *   输入不一定是 URL——交给已装载的插件逐个 `match()` 认领，认领后展示该插件的
 *   `createFields` 表单，填完创建。插件与输入在这一刻确定，之后不再让用户重填。
 * - **绑定态**（`video` 有值，键 v:<id>）：页里**没有任何输入组件**，进页即按
 *   资源的「输入 + 字段」自动解析；标题栏/播放器/选集/字幕条照旧。
 *
 * 两种形态都走 `lib/videoPlugins` 的派发（match → resolve → 宿主归一 + 时长对账）。
 * 流地址每次解析都重新登记（media-relay 不落盘）；解析结果不随页签持久化。
 * 视频页签由工作区的常驻层 keepalive 渲染（切走只藏不卸，播放不打断）。
 *
 * 重构说明：
 * - 移除底部三栏；
 * - Tab 键左侧栏：三行垂直均分，高度权重为 1:1:1（选集列表、字幕列表、视频分段）；
 * - 移除导出选集字幕按钮及相关逻辑；
 * - Tab 键右侧栏：视频笔记栏，支持新建、删除笔记，点击进入二级页面编辑；
 * - 笔记实体为节点宇宙中挂载在视频节点下的笔记节点；
 * - 二级页面顶部栏包含「插入当前视频时间戳」按钮；
 * - 顶/底栏收缩渐变遮罩，侧边栏避开顶底栏（top-[40px] bottom-[56px]）。
 *
 * 模块拆分（纯搬运，行为与对外导出不变）：
 * - 创建态表单与 VideoCreateDraft 类型 → VideoCreateForm.tsx（类型由本文件转发导出）；
 * - 视频引擎（解析/进度/续播/分段/moji:video 跳转/音频登记/字幕行跟随）→ useVideoStudy.ts；
 * - 笔记机制（视频节点下的笔记列表/编辑/新建/删除/时间戳插入）→ useVideoNotes.ts；
 * - 左侧浮层（选集/字幕/视频分段三行）→ VideoStudySidebar.tsx；
 * - 本文件保留：Props、覆盖层开关与键盘快捷键、三种形态的组装渲染（门面）。
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, MonitorPlay } from 'lucide-react'
import { t } from '../../i18n'
import { isWeb } from '../../lib/native'
import VideoPlayer from './VideoPlayer'
import VideoNotesFloatingWindow from './VideoNotesFloatingWindow'
import VideoCreateForm, { type VideoCreateDraft } from './VideoCreateForm'
import { useVideoStudy } from './useVideoStudy'
import { useVideoNotes } from './useVideoNotes'
import VideoStudySidebar from './VideoStudySidebar'
import type { LearnStore, VideoRecap, VideoResource } from '../../learn/types'

/** 转发导出：创建态的工作区回调签名（调用方仍从本文件引用，见 videoTabBridge / VideoTabLayer） */
export type { VideoCreateDraft }

interface Props {
  /** 绑定的视频资源；空 = 创建态 */
  video?: VideoResource | null
  /** 关联的视频节点 id（如果有） */
  videoNodeId?: string
  /** 整个目标的 store */
  store?: LearnStore
  /** 提交 store 修改 */
  onCommitStore?: (next: LearnStore) => void
  /** 初始输入（来自视频节点） */
  initialInput?: string
  /** 创建（工作区负责落库、开绑定页签、关掉创建页签） */
  onCreate?: (draft: VideoCreateDraft) => void
  /** 解析成功回写标题（资源列表显示真实标题） */
  onResolved?: (title: string) => void
  /** 播放进度（毫秒，节流后上报）：工作区写进视频资源，下次打开自动跳回 */
  onProgress?: (positionMs: number, source: string) => void
  /** 选集切换：把「停在的那一项」写进资源（重开回到同一集） */
  onSelection?: (source: string, title: string) => void
  /** 视频分段保存：按当前来源写进资源 */
  onSaveRecap?: (source: string, recap: VideoRecap) => void
  /** 自己的页签 id：音频控制登记的键（页签条的快捷静音按钮按它找上来） */
  tabId?: string
  /** 页签此刻是否激活：切走就停播（VideoPlayer 的 active） */
  active?: boolean
}

export default function VideoStudyTab({
  video = null,
  onCreate,
  onResolved,
  onProgress,
  onSelection,
  onSaveRecap,
  tabId,
  active = true,
  videoNodeId,
  store,
  onCommitStore,
  initialInput = '',
}: Props) {
  const bound = !!video

  /* 视频引擎：解析 / 进度 / 续播 / 分段 / 跳转 / 音频登记 / 字幕行跟随（见 useVideoStudy.ts） */
  const engine = useVideoStudy({ video, active, tabId, onResolved, onSelection, onProgress, onSaveRecap })
  const {
    busy,
    error,
    relayUrl,
    source,
    transcript,
    transcriptNote,
    currentMs,
    chaptersBusy,
    switchStill,
    playerRef,
    listRef,
    rowRefs,
    chapterListRef,
    segments,
    activeIdx,
    chapterRows,
    activeChapterIdx,
    totalTranscriptChars,
    runResolve,
    seekMs,
    runChapters,
    triggerAutoChaptersOnPlay,
    handleTimeUpdate,
    handleSeeked,
    applyExternalSubtitle,
  } = engine

  /** 当前解析到的分页（选集）：时间戳插入与绑定态副标题标签共用 */
  const currentPage = source?.pages?.find((p) => p.current)

  /* 视频笔记机制：视频节点下的笔记列表 / 编辑 / 时间戳插入（见 useVideoNotes.ts） */
  const notes = useVideoNotes({ store, onCommitStore, videoNodeId, video, initialInput, currentMs, currentPage })
  const {
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
  } = notes

  /** 左侧抽屉（选集列表 + 字幕列表 + 视频分段）：按 Tab 展开/收起 */
  const [leftOverlayOpen, setLeftOverlayOpen] = useState(false)

  /** 悬浮窗口（笔记栏）：双击 Shift 展开/收起 */
  const [rightOverlayOpen, setRightOverlayOpen] = useState(false)

  /** 记录上一次按下 Shift 键的时间戳，用于检测双击 Shift */
  const lastShiftTimeRef = useRef(0)

  /** 键盘快捷键监听：Tab 切换左侧栏，双击 Shift 切换右侧悬浮笔记窗口 */
  useEffect(() => {
    if (!active) return

    const isEditingElement = (el: HTMLElement | null) => {
      if (!el) return false
      const tag = el.tagName.toUpperCase()
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (isEditingElement(target)) {
        return
      }

      if (e.key === 'Tab') {
        e.preventDefault()
        setLeftOverlayOpen((prev) => !prev)
        return
      }

      if (e.key === 'Shift') {
        const now = performance.now()
        const delta = now - lastShiftTimeRef.current
        if (delta > 60 && delta < 400) {
          setRightOverlayOpen((prev) => !prev)
          lastShiftTimeRef.current = 0
        } else {
          lastShiftTimeRef.current = now
        }
        return
      }

      lastShiftTimeRef.current = 0
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [active])

  /* ---------- 浏览器（WebUI）模式 ---------- */
  if (isWeb()) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center select-none">
        <MonitorPlay size={32} className="text-seal/70" />
        <div className="text-[14px] font-semibold text-ink-strong">{t('视频学习仅桌面端可用')}</div>
        <p className="max-w-md text-[12px] leading-relaxed text-ink-faint">
          {t('视频流由主进程的本地媒体通道转发（防盗链头 `<video>` 发不出来），浏览器模式里没有这条通道。')}
        </p>
      </div>
    )
  }

  /* ---------- 创建态 ---------- */
  if (!bound) {
    return <VideoCreateForm video={video} initialInput={initialInput} onCreate={onCreate} />
  }

  const pageLabel = currentPage ? 'P' + currentPage.page + ' ' + currentPage.title : undefined
  const hasTranscript = !!transcript?.segments?.length

  /**
   * 左侧浮层（按 Tab 展开/收起）：选集 / 字幕 / 视频分段三行垂直均分，
   * 实现见 VideoStudySidebar.tsx（含原 leftOverlay 的布局说明注释）。
   */
  const leftOverlay = (
    <VideoStudySidebar
      open={leftOverlayOpen}
      source={source}
      busy={busy}
      segments={segments}
      activeIdx={activeIdx}
      chapterRows={chapterRows}
      activeChapterIdx={activeChapterIdx}
      chaptersBusy={chaptersBusy}
      totalTranscriptChars={totalTranscriptChars}
      hasTranscript={hasTranscript}
      transcriptNote={transcriptNote}
      listRef={listRef}
      rowRefs={rowRefs}
      chapterListRef={chapterListRef}
      onClose={() => setLeftOverlayOpen(false)}
      onResolveSource={(nextSource) => void runResolve(nextSource, video?.fields)}
      onSeekMs={seekMs}
      onRunChapters={() => void runChapters()}
    />
  )

  /**
   * 悬浮视频笔记窗口组件：
   * - 悬浮在视频播放器容器内，可自由拖动与调节窗口大小，位置与尺寸持久化；
   * - 默认尺寸 600x400，默认位置在右侧垂直居中；
   * - 实体挂载在当前视频节点下，支持新建/删除/编辑笔记及插入时间戳。
   */
  const rightOverlay = (
    <VideoNotesFloatingWindow
      open={rightOverlayOpen}
      onClose={() => setRightOverlayOpen(false)}
      currentMs={currentMs}
      videoNotes={videoNotes}
      editingNoteId={editingNoteId}
      currentEditingNote={currentEditingNote}
      draftContent={draftContent}
      onContentChange={handleContentChange}
      onCreateNote={handleCreateNote}
      onRenameNote={handleRenameNote}
      onDeleteNote={handleDeleteNote}
      onSelectNote={handleSelectNote}
      onBackToList={handleBackToList}
      onInsertTimestamp={handleInsertTimestamp}
      noteTextareaRef={noteTextareaRef}
    />
  )

  /* ---------- 绑定态：没有输入组件，自动解析 ---------- */
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper select-none">
      {/* 错误横幅 */}
      {error && (
        <div className="shrink-0 border-b border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[12px] leading-relaxed text-red-500 dark:text-red-300">
          {error}
        </div>
      )}

      {source && relayUrl ? (
        <div className="relative min-h-0 flex-1 bg-black overflow-hidden">
          <VideoPlayer
            ref={playerRef}
            src={relayUrl}
            active={active}
            title={source.title}
            durationMs={source.durationMs}
            transcript={transcript}
            leftOverlay={leftOverlay}
            leftOverlayOpen={leftOverlayOpen}
            onToggleLeftOverlay={() => setLeftOverlayOpen((v) => !v)}
            rightOverlay={rightOverlay}
            rightOverlayOpen={rightOverlayOpen}
            onToggleRightOverlay={() => setRightOverlayOpen((v) => !v)}
            subLabel={pageLabel}
            transitionStill={switchStill}
            chapters={chapterRows.length ? chapterRows : null}
            onPlay={triggerAutoChaptersOnPlay}
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleSeeked}
            onExternalSubtitleLoaded={applyExternalSubtitle}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center select-none">
          {busy ? (
            <>
              <Loader2 size={26} className="animate-spin text-seal/70" />
              <p className="text-[12px] text-ink-faint">{t('正在解析视频来源…')}</p>
            </>
          ) : (
            <>
              <MonitorPlay size={30} className="text-seal/50" />
              <p className="max-w-[420px] text-[12px] leading-relaxed text-ink-faint">
                {t('这个视频还没有解析出来：检查插件是否已启用、凭据是否配好，然后重新打开本页签。')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
