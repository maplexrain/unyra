/**
 * 确定性互动课堂运行时调度器 (LessonScheduler)
 * 驱动动作生命周期、维护阻塞/非阻塞双通道并发、执行 0ms 确定性快进 (Deterministic Seek)
 */
import type { ActionCompiler } from './ActionCompiler'
import type { StageViewport } from './StageViewport'
import { buildTimelineBeats, findBeatIndex } from './timeline'
import type {
  LessonAction,
  LessonCourse,
  PlaybackStatus,
  RunningTask,
  SchedulerSnapshot,
  TimelineBeat,
} from './types'

export class LessonScheduler {
  private status: PlaybackStatus = 'idle'
  private sceneIndex = 0
  private actionIndex = 0
  private playbackRate = 1.0

  private activeBlockingTask: RunningTask | null = null
  private backgroundTasks = new Set<RunningTask>()
  private runToken = 0 // 递增令牌，防止异步时序竞态
  private beats: TimelineBeat[] = []

  private course: LessonCourse
  private stage: StageViewport
  private compiler: ActionCompiler
  private onStateChange: (snapshot: SchedulerSnapshot) => void

  constructor(
    course: LessonCourse,
    stage: StageViewport,
    compiler: ActionCompiler,
    onStateChange: (snapshot: SchedulerSnapshot) => void
  ) {
    this.course = course
    this.stage = stage
    this.compiler = compiler
    this.onStateChange = onStateChange
    this.beats = buildTimelineBeats(this.course)
    // 实例化时立即启动向后看 3 句话的 TTS 预热
    this.maintainPreloadBuffer()
  }

  /** 获取时间轴节拍清单 */
  public getBeats(): TimelineBeat[] {
    return this.beats
  }

  /** 更新当前课程（例如流式追加 Scene 时） */
  public updateCourse(course: LessonCourse): void {
    this.course = course
    this.beats = buildTimelineBeats(this.course)
    this.emitState()
  }

  /** 设置倍速 */
  public setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.5, Math.min(3.0, rate))
    this.emitState()
  }

  /** 获取当前快照 */
  public getSnapshot(): SchedulerSnapshot {
    return this.buildSnapshot()
  }

  /** 初始化挂载首个画面 DOM，保持 idle 状态等待手动触发播放 */
  public mountInitial(): void {
    if (this.course.scenes.length > 0) {
      const scene = this.course.scenes[0]
      this.stage.mountScene(scene.html ?? '')
      this.sceneIndex = 0
      this.actionIndex = 0
      this.status = 'idle'
      this.maintainPreloadBuffer()
      this.emitState()
    }
  }

  /** 开始或恢复播放 */
  public async play(): Promise<void> {
    if (this.status === 'playing') return
    if (this.status === 'paused') {
      this.resume()
      return
    }
    
    // 如果播放已结束，重置状态以支持重播
    if (this.status === 'ended') {
      this.sceneIndex = 0
      this.actionIndex = 0
    }

    this.status = 'playing'
    const currentToken = ++this.runToken
    this.maintainPreloadBuffer()
    this.emitState()

    while (this.sceneIndex < this.course.scenes.length) {
      if (currentToken !== this.runToken) return
      const scene = this.course.scenes[this.sceneIndex]
      const actions = scene.actions ?? []

      // 若处于本画面起点，重置并挂载画面初始 DOM
      if (this.actionIndex === 0) {
        this.stage.mountScene(scene.html ?? '')
      }

      while (this.actionIndex < actions.length) {
        if (currentToken !== this.runToken) return
        const action = actions[this.actionIndex]

        // 检查点拦截：等待学生点击继续或按键
        if (action.type === 'checkpoint') {
          this.status = 'waiting_checkpoint'
          const task = this.compiler.compile(action, this.playbackRate)
          this.activeBlockingTask = task
          this.emitState(action)
          await task.finished
          this.activeBlockingTask = null
          if (currentToken !== this.runToken) return
          this.status = 'playing'
          this.actionIndex++
          this.maintainPreloadBuffer()
          continue
        }

        // 口语讲解动作：确保声音与字幕同步，并滚动预加载三句话缓冲区
        if (action.type === 'speak') {
          this.maintainPreloadBuffer()
          let voiceEmitted = false
          const onVoiceReady = () => {
            if (!voiceEmitted && currentToken === this.runToken) {
              voiceEmitted = true
              this.emitState(action)
            }
          }

          const task = this.compiler.compile(action, this.playbackRate, onVoiceReady)
          // 兜底微定时器：若音频层异常，避免阻断字幕露出
          const fallbackTimer = window.setTimeout(onVoiceReady, 60)

          const isBlocking = action.blocking ?? true
          if (isBlocking) {
            this.activeBlockingTask = task
            await task.finished
            clearTimeout(fallbackTimer)
            this.activeBlockingTask = null
            if (currentToken !== this.runToken) return
          } else {
            this.backgroundTasks.add(task)
            task.finished.finally(() => {
              clearTimeout(fallbackTimer)
              this.backgroundTasks.delete(task)
            })
          }

          this.actionIndex++
          this.maintainPreloadBuffer()
          continue
        }

        this.emitState(action)
        const task = this.compiler.compile(action, this.playbackRate)
        const isBlocking = action.blocking ?? false

        if (isBlocking) {
          this.activeBlockingTask = task
          await task.finished
          this.activeBlockingTask = null
          if (currentToken !== this.runToken) return
        } else {
          // 非阻塞动作：推入后台集合并行运行，不阻塞主循环
          this.backgroundTasks.add(task)
          task.finished.finally(() => {
            this.backgroundTasks.delete(task)
          })
        }

        this.actionIndex++
      }

      // 画面边界汇合（Barrier）：本画面动作全部跑完，强制完成所有残余后台动画
      this.flushBackgroundTasks()
      this.sceneIndex++
      this.actionIndex = 0
      this.maintainPreloadBuffer()
    }

    if (currentToken === this.runToken) {
      this.status = 'ended'
      this.emitState()
    }
  }

  /** 暂停播放 */
  public pause(): void {
    if (this.status !== 'playing') return
    this.status = 'paused'
    this.activeBlockingTask?.pause()
    this.backgroundTasks.forEach((t) => t.pause())
    this.emitState()
  }

  /** 恢复播放 */
  public resume(): void {
    if (this.status !== 'paused') return
    this.status = 'playing'
    this.activeBlockingTask?.resume()
    this.backgroundTasks.forEach((t) => t.resume())
    this.emitState()
  }

  /** 在检查点处继续 */
  public continueFromCheckpoint(): void {
    if (this.status === 'waiting_checkpoint' && this.activeBlockingTask) {
      this.activeBlockingTask.instantFinish()
    }
  }

  /**
   * 任意节拍跳转 (Deterministic Seek)
   * 1. 废除旧异步循环，立即停止所有正在朗读的语音与动画；
   * 2. 重置目标画面的初始 HTML；
   * 3. 在同一渲染帧内对目标画面 [0, targetActionIndex - 1] 的所有视觉动作同步应用 instantFinish；
   * 4. 更新游标并恢复播放。
   */
  public seekTo(targetSceneIndex: number, targetActionIndex: number): void {
    this.runToken++
    this.activeBlockingTask?.abort()
    this.activeBlockingTask = null
    this.abortBackgroundTasks()

    const targetScene = this.course.scenes[targetSceneIndex]
    if (!targetScene) return

    // 重置目标画面初始 HTML
    this.stage.mountScene(targetScene.html ?? '')

    // 单帧内重现前置所有视觉动作终态
    const targetActions = targetScene.actions ?? []
    const end = Math.min(targetActionIndex, targetActions.length)
    for (let i = 0; i < end; i++) {
      const prevAction = targetActions[i]
      if (prevAction.type === 'visual') {
        const fastTask = this.compiler.compile(prevAction, 1.0)
        fastTask.instantFinish()
      }
    }

    this.sceneIndex = targetSceneIndex
    this.actionIndex = targetActionIndex
    this.status = 'idle'
    this.maintainPreloadBuffer()
    this.play()
  }

  /** 跳转至下一个节拍 */
  public nextBeat(): void {
    const curBeatIdx = findBeatIndex(this.beats, this.sceneIndex, this.actionIndex)
    if (curBeatIdx + 1 < this.beats.length) {
      const nextBeat = this.beats[curBeatIdx + 1]
      this.seekTo(nextBeat.sceneIndex, nextBeat.startActionIndex)
    }
  }

  /** 跳转至上一个节拍 */
  public prevBeat(): void {
    const curBeatIdx = findBeatIndex(this.beats, this.sceneIndex, this.actionIndex)
    if (curBeatIdx - 1 >= 0) {
      const prevBeat = this.beats[curBeatIdx - 1]
      this.seekTo(prevBeat.sceneIndex, prevBeat.startActionIndex)
    } else {
      // 已经在第一个节拍，重置本节拍
      const cur = this.beats[0]
      if (cur) this.seekTo(cur.sceneIndex, cur.startActionIndex)
    }
  }

  /**
   * 维护向后看三句话的 TTS 预加载滑动窗口
   * 确保无论演播推进到哪一步，缓冲区内始终保持后续 3 句 speak 音频已合成与预热
   */
  public maintainPreloadBuffer(): void {
    const queue: string[] = []
    let s = this.sceneIndex
    let a = this.actionIndex

    while (s < this.course.scenes.length && queue.length < 3) {
      const scene = this.course.scenes[s]
      const actions = scene.actions ?? []
      while (a < actions.length && queue.length < 3) {
        const act = actions[a]
        if (act.type === 'speak' && act.text.trim()) {
          queue.push(act.text.trim())
        }
        a++
      }
      s++
      a = 0
    }

    for (const text of queue) {
      this.compiler.preloadSpeak(text, this.playbackRate)
    }
  }

  /** 强制完成所有后台残存任务 */
  private flushBackgroundTasks(): void {
    this.backgroundTasks.forEach((t) => t.instantFinish())
    this.backgroundTasks.clear()
  }

  /** 中止所有后台任务 */
  private abortBackgroundTasks(): void {
    this.backgroundTasks.forEach((t) => t.abort())
    this.backgroundTasks.clear()
  }

  private buildSnapshot(currentAction?: LessonAction): SchedulerSnapshot {
    const activeBeatIndex = findBeatIndex(this.beats, this.sceneIndex, this.actionIndex)
    const act = currentAction ?? this.course.scenes[this.sceneIndex]?.actions[this.actionIndex]
    return {
      status: this.status,
      sceneIndex: this.sceneIndex,
      actionIndex: this.actionIndex,
      activeBeatIndex,
      // 字幕与 TTS 唯一源：TTS 朗读与屏幕字幕严格使用 act.text，绝对一致
      subtitle: act?.type === 'speak' ? act.text : undefined,
      checkpointTitle: act?.type === 'checkpoint' ? act.title : undefined,
      playbackRate: this.playbackRate,
    }
  }

  private emitState(currentAction?: LessonAction): void {
    this.onStateChange(this.buildSnapshot(currentAction))
  }

  public destroy(): void {
    this.runToken++
    this.activeBlockingTask?.abort()
    this.activeBlockingTask = null
    this.abortBackgroundTasks()
  }
}
