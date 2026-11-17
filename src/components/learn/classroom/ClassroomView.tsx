import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { StageViewport } from '../../../learn/classroom/StageViewport'
import { ActionCompiler } from '../../../learn/classroom/ActionCompiler'
import { LessonScheduler } from '../../../learn/classroom/LessonScheduler'
import { defaultClassroomTTS } from '../../../learn/classroom/ttsAdapter'
import { loadClassroomEntity, saveClassroomEntity } from '../../../learn/classroom/store'
import type { LessonCourse, SchedulerSnapshot, TimelineBeat } from '../../../learn/classroom/types'
import type { LearnStore } from '../../../learn/types'
import ClassroomStage from './ClassroomStage'
import ClassroomTimeline from './ClassroomTimeline'
import ClassroomControls from './ClassroomControls'
import ClassroomResourceDock from './ClassroomResourceDock'
import ClassroomEditorModal from './ClassroomEditorModal'
import { Presentation } from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomViewProps {
  classroomId: string
  store: LearnStore
  onOpenTab: (kind: string, targetId: string, extra?: Record<string, unknown>) => void
}

export default function ClassroomView({
  classroomId,
  store,
  onOpenTab,
}: ClassroomViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const entity = useMemo(() => loadClassroomEntity(classroomId), [classroomId])
  const [course, setCourse] = useState<LessonCourse>(() => entity.course)

  // 调度器与视口引用
  const viewportRef = useRef<StageViewport | null>(null)
  const schedulerRef = useRef<LessonScheduler | null>(null)

  // 播放状态快照
  const [snapshot, setSnapshot] = useState<SchedulerSnapshot>({
    status: 'idle',
    sceneIndex: 0,
    actionIndex: 0,
    activeBeatIndex: 0,
    playbackRate: 1.0,
  })
  const [beats, setBeats] = useState<TimelineBeat[]>([])

  // 界面状态
  const [isResourcesOpen, setIsResourcesOpen] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 获得挂载的子节点列表（从 store.edges 查找 downstream）
  const childNodeIds = useMemo(() => {
    return store.edges.filter((e) => e.from === classroomId).map((e) => e.to)
  }, [store.edges, classroomId])

  // 当 StageViewport 准备就绪时初始化调度器并自动开讲
  const handleViewportReady = useCallback((vp: StageViewport) => {
    viewportRef.current = vp
    const compiler = new ActionCompiler(vp, defaultClassroomTTS)
    const scheduler = new LessonScheduler(course, vp, compiler, (s) => {
      setSnapshot(s)
    })
    schedulerRef.current = scheduler
    setBeats(scheduler.getBeats())

    // 默认自动开始播放首个画面
    scheduler.play()
  }, [course])

  // 全屏状态同步
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      // 全屏切换后重新计算画布缩放
      setTimeout(() => viewportRef.current?.recalculateScale(), 100)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      schedulerRef.current?.destroy()
      schedulerRef.current = null
    }
  }, [])

  // 键盘快捷键（空格播放/暂停/跳过思考，左右箭头切换节拍）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      if (e.code === 'Space') {
        e.preventDefault()
        if (snapshot.status === 'waiting_checkpoint') {
          schedulerRef.current?.continueFromCheckpoint()
        } else if (snapshot.status === 'playing') {
          schedulerRef.current?.pause()
        } else {
          schedulerRef.current?.play()
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        schedulerRef.current?.nextBeat()
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        schedulerRef.current?.prevBeat()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [snapshot.status])

  // 控制动作
  const handleTogglePlay = () => {
    if (snapshot.status === 'playing') {
      schedulerRef.current?.pause()
    } else {
      schedulerRef.current?.play()
    }
  }

  const handlePrevBeat = () => schedulerRef.current?.prevBeat()
  const handleNextBeat = () => schedulerRef.current?.nextBeat()
  const handleSetRate = (rate: number) => schedulerRef.current?.setPlaybackRate(rate)
  const handleReplay = () => schedulerRef.current?.seekTo(0, 0)
  const handleSeek = (sIdx: number, aIdx: number) => schedulerRef.current?.seekTo(sIdx, aIdx)
  const handleContinueCheckpoint = () => schedulerRef.current?.continueFromCheckpoint()

  const handleToggleFullscreen = () => {
    if (!rootRef.current) return
    if (!document.fullscreenElement) {
      rootRef.current.requestFullscreen().catch(() => {})
    } else {
      document.exitFullscreen().catch(() => {})
    }
  }

  // 保存并热重载课件 DSL
  const handleSaveCourse = (nextCourse: LessonCourse) => {
    setCourse(nextCourse)
    entity.course = nextCourse
    saveClassroomEntity(entity)

    if (schedulerRef.current) {
      schedulerRef.current.updateCourse(nextCourse)
      setBeats(schedulerRef.current.getBeats())
      schedulerRef.current.seekTo(0, 0)
    }
  }

  const currentScene = course.scenes[snapshot.sceneIndex]

  return (
    <div
      ref={rootRef}
      className="flex flex-col w-full h-full min-h-0 bg-paper overflow-hidden select-none"
    >
      {/* 顶部标题条 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-line/50 bg-card/60 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-seal/15 text-seal shrink-0">
            <Presentation size={15} />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[13.5px] font-bold text-ink-strong truncate">
              {course.title || t('互动课堂')}
            </span>
            {currentScene && (
              <span className="text-[11.5px] text-ink-soft truncate opacity-80">
                · {currentScene.title}
              </span>
            )}
          </div>
        </div>

        {/* 画面进度胶囊 */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-line/40 text-[11px] font-mono text-ink-soft shrink-0">
          <span>{t('画面')}</span>
          <span className="font-bold text-ink">
            {snapshot.sceneIndex + 1} / {course.scenes.length}
          </span>
        </div>
      </div>

      {/* 主舞台与侧边资源坞 */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
        {/* 16:9 画布核心区域 */}
        <ClassroomStage
          onViewportReady={handleViewportReady}
          subtitle={snapshot.subtitle}
          checkpointTitle={snapshot.checkpointTitle}
          status={snapshot.status}
          onContinueCheckpoint={handleContinueCheckpoint}
        />

        {/* 关联子资源坞 */}
        {isResourcesOpen && (
          <ClassroomResourceDock
            store={store}
            classroomId={classroomId}
            childNodeIds={childNodeIds}
            onClose={() => setIsResourcesOpen(false)}
            onOpenTab={onOpenTab}
          />
        )}
      </div>

      {/* 底部无刻度节拍时间轴 */}
      <ClassroomTimeline
        beats={beats}
        activeBeatIndex={snapshot.activeBeatIndex}
        status={snapshot.status}
        onSeek={handleSeek}
      />

      {/* 底部控制台 */}
      <ClassroomControls
        status={snapshot.status}
        playbackRate={snapshot.playbackRate}
        onTogglePlay={handleTogglePlay}
        onPrevBeat={handlePrevBeat}
        onNextBeat={handleNextBeat}
        onSetRate={handleSetRate}
        onReplay={handleReplay}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleResources={() => setIsResourcesOpen((o) => !o)}
        hasResources={childNodeIds.length > 0}
        isResourcesOpen={isResourcesOpen}
        onOpenEditor={() => setIsEditorOpen(true)}
      />

      {/* 课件 JSON 编辑模态框 */}
      {isEditorOpen && (
        <ClassroomEditorModal
          course={course}
          onClose={() => setIsEditorOpen(false)}
          onSave={handleSaveCourse}
        />
      )}
    </div>
  )
}
