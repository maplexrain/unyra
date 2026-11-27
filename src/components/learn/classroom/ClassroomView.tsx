import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { StageViewport } from '../../../learn/classroom/StageViewport'
import { ActionCompiler } from '../../../learn/classroom/ActionCompiler'
import { LessonScheduler } from '../../../learn/classroom/LessonScheduler'
import { defaultClassroomTTS } from '../../../learn/classroom/ttsAdapter'
import { loadClassroomEntity, saveClassroomEntity } from '../../../learn/classroom/store'
import type {
  ClassroomEntity,
  LessonCourse,
  SchedulerSnapshot,
  TimelineBeat,
  SubtitleStyleConfig,
} from '../../../learn/classroom/types'
import { DEFAULT_SUBTITLE_SETTINGS } from '../../../learn/classroom/types'
import type { LearnStore } from '../../../learn/types'
import ClassroomStage from './ClassroomStage'
import ClassroomTimeline from './ClassroomTimeline'
import ClassroomControls from './ClassroomControls'
import ClassroomResourceDock from './ClassroomResourceDock'
import ClassroomEditorModal from './ClassroomEditorModal'
import { Presentation, Sparkles, FileCode } from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomViewProps {
  classroomId: string
  store: LearnStore
  onOpenTab: (kind: string, targetId: string, extra?: Record<string, unknown>) => void
  onGenerateClassroom?: (classroomId: string) => void
  onUpdateClassroom?: (entity: ClassroomEntity) => void
}

export default function ClassroomView({
  classroomId,
  store,
  onOpenTab,
  onGenerateClassroom,
  onUpdateClassroom,
}: ClassroomViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const entity = useMemo(() => loadClassroomEntity(classroomId, '新课堂', store), [classroomId, store])
  const [course, setCourse] = useState<LessonCourse>(() => entity.course)

  useEffect(() => {
    setCourse(entity.course)
  }, [entity])

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

  // 字幕配置（默认白字黑描边、默认开启，记住用户偏好）
  const [showSubtitle, setShowSubtitle] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem('moji:classroom:subtitle_show')
      return v !== null ? v === 'true' : true
    } catch {
      return true
    }
  })

  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleConfig>(() => {
    try {
      const raw = localStorage.getItem('moji:classroom:subtitle_style')
      if (raw) return { ...DEFAULT_SUBTITLE_SETTINGS.style, ...JSON.parse(raw) }
    } catch {}
    return DEFAULT_SUBTITLE_SETTINGS.style
  })

  const handleToggleSubtitle = useCallback(() => {
    setShowSubtitle((prev) => {
      const next = !prev
      try {
        localStorage.setItem('moji:classroom:subtitle_show', String(next))
      } catch {}
      return next
    })
  }, [])

  const handleChangeSubtitleStyle = useCallback((patch: Partial<SubtitleStyleConfig>) => {
    setSubtitleStyle((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem('moji:classroom:subtitle_style', JSON.stringify(next))
      } catch {}
      return next
    })
  }, [])

  // 界面状态
  const [isResourcesOpen, setIsResourcesOpen] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 获得挂载的子节点列表（从 store.edges 查找 downstream）
  const childNodeIds = useMemo(() => {
    return store.edges.filter((e) => e.from === classroomId).map((e) => e.to)
  }, [store.edges, classroomId])

  // 当 StageViewport 准备就绪时初始化调度器
  const handleViewportReady = useCallback((vp: StageViewport) => {
    viewportRef.current = vp
    const compiler = new ActionCompiler(vp, defaultClassroomTTS)
    const scheduler = new LessonScheduler(course, vp, compiler, (s) => {
      setSnapshot(s)
    })
    schedulerRef.current = scheduler
    setBeats(scheduler.getBeats())

    // 禁止自动播放，初始挂载首个画面，保持 idle 就绪状态，等待用户手动点击播放
    scheduler.mountInitial()
  }, [course])

  // 全屏状态同步
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
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
    const nextEntity: ClassroomEntity = {
      ...entity,
      title: nextCourse.title || entity.title,
      course: nextCourse,
    }
    saveClassroomEntity(nextEntity)
    onUpdateClassroom?.(nextEntity)

    if (schedulerRef.current) {
      schedulerRef.current.updateCourse(nextCourse)
      setBeats(schedulerRef.current.getBeats())
      if (nextCourse.scenes.length > 0) {
        schedulerRef.current.seekTo(0, 0)
      }
    }
  }

  const currentScene = course.scenes[snapshot.sceneIndex]
  const isCourseEmpty = course.scenes.length === 0

  return (
    <div
      ref={rootRef}
      className="flex flex-col w-full h-full min-h-0 bg-paper text-ink overflow-hidden select-none"
    >
      {/* 顶部标题条：跟随主题配色 */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-line/60 bg-card/70 backdrop-blur-md shrink-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-seal/15 text-seal shrink-0 shadow-2xs">
            <Presentation size={17} />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <h1 className="text-[14px] font-bold text-ink-strong truncate">
              {course.title || t('互动课堂')}
            </h1>
            {currentScene && (
              <span className="text-[12px] text-ink-soft truncate opacity-85">
                · {currentScene.title}
              </span>
            )}
          </div>
        </div>

        {/* 右侧：画面进度胶囊与全屏入口 */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-line/40 text-[11px] font-mono text-ink-soft">
            <span>{t('画面')}</span>
            <span className="font-bold text-ink">
              {isCourseEmpty ? '0' : snapshot.sceneIndex + 1} / {course.scenes.length}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsEditorOpen(true)}
            title={t('编写 DSL')}
            className="p-1.5 rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
          >
            <FileCode size={16} />
          </button>
        </div>
      </header>

      {/* 主舞台与侧边资源坞 */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden bg-paper-deep">
        {/* 空白课件引导态 */}
        {isCourseEmpty ? (
          <div className="flex-1 w-full h-full flex items-center justify-center p-6 select-none bg-paper-deep">
            <div className="flex flex-col items-center gap-5 max-w-md text-center p-8 rounded-3xl bg-card border border-line shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-seal/15 text-seal border border-seal/20 shadow-md">
                <Presentation size={32} />
              </div>
              <div className="space-y-2">
                <div className="text-[20px] font-bold text-ink-strong">{t('互动课件尚未生成')}</div>
                <div className="text-[13px] text-ink-soft leading-relaxed">
                  {t('当前课堂暂无画面与动作剧场。您可以让 AI 导师结合上游教学内容自动规划生成 16:9 动态课件，或手动编写课件 DSL。')}
                </div>
              </div>
              <div className="flex items-center gap-3 w-full pt-2">
                <button
                  type="button"
                  onClick={() => onGenerateClassroom?.(classroomId)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-seal hover:bg-seal-deep text-white font-bold text-[13.5px] shadow-lg shadow-seal/25 transition active:scale-98 cursor-pointer"
                >
                  <Sparkles size={16} />
                  <span>{t('生成互动课堂')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(true)}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-card hover:bg-line/40 text-ink-soft hover:text-ink font-medium text-[13px] transition active:scale-98 cursor-pointer border border-line"
                >
                  <FileCode size={15} />
                  <span>{t('编写 DSL')}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <ClassroomStage
            onViewportReady={handleViewportReady}
            subtitle={snapshot.subtitle}
            checkpointTitle={snapshot.checkpointTitle}
            status={snapshot.status}
            onContinueCheckpoint={handleContinueCheckpoint}
            showSubtitle={showSubtitle}
            subtitleStyle={subtitleStyle}
          />
        )}

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

      {/* 底部控制台：跟随主题配色 */}
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
        showSubtitle={showSubtitle}
        onToggleSubtitle={handleToggleSubtitle}
        subtitleStyle={subtitleStyle}
        onChangeSubtitleStyle={handleChangeSubtitleStyle}
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
