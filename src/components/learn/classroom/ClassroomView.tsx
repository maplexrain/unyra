import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { StageViewport } from '../../../learn/classroom/StageViewport'
import { ActionCompiler } from '../../../learn/classroom/ActionCompiler'
import { LessonScheduler } from '../../../learn/classroom/LessonScheduler'
import { defaultClassroomTTS } from '../../../learn/classroom/ttsAdapter'
import { loadClassroomEntity, saveClassroomEntity } from '../../../learn/classroom/store'
import type {
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
}

export default function ClassroomView({
  classroomId,
  store,
  onOpenTab,
  onGenerateClassroom,
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

    // 若课件有内容，默认自动开始播放首个画面
    if (course.scenes.length > 0) {
      scheduler.play()
    }
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
    entity.course = nextCourse
    saveClassroomEntity(entity)

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
            {isCourseEmpty ? '0' : snapshot.sceneIndex + 1} / {course.scenes.length}
          </span>
        </div>
      </div>

      {/* 主舞台与侧边资源坞 */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">
        {/* 空白课件引导态 */}
        {isCourseEmpty ? (
          <div className="flex-1 w-full h-full bg-[#07090e] flex items-center justify-center p-6 select-none">
            <div className="flex flex-col items-center gap-5 max-w-md text-center p-8 rounded-3xl bg-slate-900/90 border border-white/10 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-500/15 text-sky-400 border border-sky-500/20 shadow-lg">
                <Presentation size={32} />
              </div>
              <div className="space-y-2">
                <div className="text-[20px] font-bold text-slate-100">{t('互动课件尚未生成')}</div>
                <div className="text-[13px] text-slate-400 leading-relaxed">
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
                  className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 font-medium text-[13px] transition active:scale-98 cursor-pointer border border-white/10"
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
