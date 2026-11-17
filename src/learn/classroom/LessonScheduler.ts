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

  /** 开始或恢复播放 */
  public async play(): Promise<void> {
    if (this.status === 'playing') return
    if (this.status === 'paused') {
      this.resume()
      return
    }

    this.status = 'playing'
    const currentToken = ++this.runToken
    this.emitState()

    while (this.sceneIndex < this.course.scenes.length) {
      if (currentToken !== this.runToken) return
      const scene = this.course.scenes[this.sceneIndex]

      // 若处于本画面起点，重置并挂载画面初始 DOM
      if (this.actionIndex === 0) {
        this.stage.mountScene(scene.html)
      }

      while (this.actionIndex < scene.actions.length) {
        if (currentToken !== this.runToken) return
        const action = scene.actions[this.actionIndex]

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
          continue
        }

        this.emitState(action)
        const task = this.compiler.compile(action, this.playbackRate)
        const isBlocking = action.blocking ?? (action.type === 'speak')

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
    this.stage.mountScene(targetScene.html)

    // 单帧内重现前置所有视觉动作终态
    const end = Math.min(targetActionIndex, targetScene.actions.length)
    for (let i = 0; i < end; i++) {
      const prevAction = targetScene.actions[i]
      if (prevAction.type === 'visual') {
        const fastTask = this.compiler.compile(prevAction, 1.0)
        fastTask.instantFinish()
      }
    }

    this.sceneIndex = targetSceneIndex
    this.actionIndex = targetActionIndex
    this.status = 'idle'
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
      subtitle: act?.type === 'speak' ? act.subtitle ?? act.text : undefined,
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
