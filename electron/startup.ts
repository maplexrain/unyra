/**
 * 启动耗时追踪。
 *
 * 为什么要专门有这么一小块：启动快慢是「感觉」，凭感觉优化只会优化错地方。
 * 打开它跑一次，就能看到时间到底花在哪一段——
 *
 *   main:eval      Electron 引导 + 主进程整包的解析与求值（所有 import 都在这一步）
 *   main:ready     app ready（协议、托盘、IPC 注册都在它之前）
 *   main:window    窗口对象建好（还没加载页面）
 *   main:loadFile  页面 did-finish-load（渲染层脚本已跑完、bootApp 已经 await 过）
 *   main:shown     ready-to-show → 窗口真正显示（用户「看见东西」的时刻）
 *   渲染层的各段见 src/lib/startupTrace.ts，随 webContents 一起回传
 *
 * 默认完全不做事（一次 `process.env` 读取）。要看的时候把 MOJI_STARTUP_TRACE 指向一个文件：
 *
 *   $env:MOJI_STARTUP_TRACE="$PWD\startup.json"; npm start
 *   # 打包版：设好环境变量再启动 exe 即可
 *   # 加上 MOJI_STARTUP_TRACE_EXIT=1 会在写完之后自己退出（给 scripts/startup-trace.mjs 用）
 *
 * 为什么是写文件而不是打印：Windows 上的 GUI 进程没有父控制台，stdout 抓不住；
 * 写成 JSON 还方便脚本读进来做「改进前 / 改进后」的对照。
 */
import { writeFileSync } from 'node:fs'

export interface StartupMark {
  /** 阶段名 */
  label: string
  /**
   * performance.now() 读数。注意它的零点（performance.timeOrigin）**不是**进程启动时刻，
   * 实测比进程启动晚约 70 ms（Electron 引导期间才建起 Node 的性能时间线），
   * 所以它只能用来算**段与段之间**的差；要看「离用户双击过了多久」得用 wall。
   */
  ms: number
  /** 墙钟（Date.now()）：与外部观测脚本同一个时钟，能直接算出「相对进程创建」的时间 */
  wall: number
}

const target = process.env.MOJI_STARTUP_TRACE ?? ''
let enabled = false
const marks: StartupMark[] = []
let rendererMarks: unknown = null
let flushed = false

export function startupTraced(): boolean {
  return enabled
}

/** 打开追踪。必须在任何 lap 之前调用（main.ts 的第一件事） */
export function initStartupTrace(): boolean {
  if (!target) return false
  enabled = true
  // 第一笔就记在这里：能记到的最早时刻就是主进程模块求值的最后一行
  lap('main:eval')
  return true
}

/** 打一个点。没开追踪时什么也不做（调用点在热路径上也没有代价） */
export function lap(label: string): void {
  if (!enabled) return
  marks.push({ label, ms: performance.now(), wall: Date.now() })
}

/** 渲染层回传的那一份（形状见 src/lib/startupTrace.ts），原样存着 */
export function setRendererMarks(payload: unknown): void {
  if (!enabled || rendererMarks) return
  rendererMarks = payload
}

export function startupSpent(): number {
  return marks.length ? marks[marks.length - 1].ms : 0
}

/** 落盘。写失败就算了——为了测时间把应用弄挂是最蠢的失败模式 */
export function flushStartupTrace(note?: string): void {
  if (!enabled || flushed) return
  flushed = true
  try {
    writeFileSync(
      target,
      JSON.stringify(
        {
          startedAt: new Date(marks.length ? marks[0].wall : Date.now()).toISOString(),
          wallAtFlush: Date.now(),
          note: note ?? null,
          main: marks,
          renderer: rendererMarks,
        },
        null,
        2,
      ),
      'utf-8',
    )
  } catch (err) {
    console.error('[startup] 追踪结果写不进去：', err)
  }
}
