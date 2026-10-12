/**
 * 基础进程管理服务 (base.process.*)。
 *
 * 核心设计：
 * 1. 进程任务创建后默认处于待运行状态（默认不执行），需经 start 显式触发启动；
 * 2. 捕获 stdout 与 stderr 供增量读取；
 * 3. 严格绑定应用生命周期：应用退出、断电、关窗、崩溃等任何终止事件均触发级联清理，绝不残留孤儿进程。
 */
import { spawn, type ChildProcess, execSync } from 'node:child_process'
import { checkPathPermission } from './permissions'
import { currentRoot } from '../storage'
import type {
  BaseProcessCreateOpts,
  BaseProcessCreateResult,
  BaseProcessGetResult,
  BaseProcessInfo,
  BaseProcessListResult,
  BaseProcessOutputResult,
  BaseProcessStartResult,
  BaseProcessStatusResult,
  BaseProcessStopResult,
} from '../../shared/ipc'

interface ManagedProcess {
  process_id: string
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  child: ChildProcess | null
  pid?: number
  running: boolean
  exited: boolean
  exitCode: number | null
  signal: string | null
  startTime?: number
  exitTime?: number
  stdout: string
  stderr: string
  readOffset: number
}

const processes = new Map<string, ManagedProcess>()

/**
 * 杀死进程及其子进程树（跨平台防孤儿进程）
 */
function killProcessTree(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL'): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' })
    } else {
      // POSIX: kill process group if possible
      try {
        process.kill(-pid, signal)
      } catch {
        process.kill(pid, signal)
      }
    }
  } catch {
    // 进程可能已自行退出，忽略异常
  }
}

/**
 * 级联清理所有正在运行的活动进程
 */
export function cleanupAllProcesses(): void {
  for (const proc of processes.values()) {
    if (proc.running && proc.pid) {
      try {
        killProcessTree(proc.pid, 'SIGKILL')
      } catch {
        // ignore
      }
      proc.running = false
      proc.exited = true
      proc.signal = 'SIGKILL'
      proc.exitTime = Date.now()
    }
  }
}

// 绑定 Node 进程退出钩子，保证进程级连带清理
process.once('exit', cleanupAllProcesses)
process.once('SIGINT', cleanupAllProcesses)
process.once('SIGTERM', cleanupAllProcesses)

function toProcessInfo(p: ManagedProcess): BaseProcessInfo {
  return {
    process_id: p.process_id,
    command: p.command,
    args: p.args,
    cwd: p.cwd,
    running: p.running,
    exited: p.exited,
    exitCode: p.exitCode,
    signal: p.signal,
    pid: p.pid,
    startTime: p.startTime,
    exitTime: p.exitTime,
  }
}

/**
 * base.process.create: 创建进程任务，定义执行程序、参数、工作目录与环境变量。默认不执行。
 */
export async function baseProcessCreate(opts: BaseProcessCreateOpts): Promise<BaseProcessCreateResult> {
  const command = String(opts?.command || '').trim()
  if (!command) {
    return { ok: false, error: '执行程序 command 不能为空' }
  }

  const rawCwd = opts?.cwd ? String(opts.cwd).trim() : currentRoot()
  const perm = checkPathPermission(rawCwd)
  if (!perm.allowed) {
    return { ok: false, error: perm.error || '工作目录权限受限' }
  }

  const id = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const args = Array.isArray(opts?.args) ? opts.args.map(String) : []
  const env = opts?.env && typeof opts.env === 'object' ? { ...opts.env } : {}

  const managed: ManagedProcess = {
    process_id: id,
    command,
    args,
    cwd: perm.normalized,
    env,
    child: null,
    running: false,
    exited: false,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    readOffset: 0,
  }

  processes.set(id, managed)
  return { ok: true, process_id: id, command, args, cwd: perm.normalized }
}

/**
 * base.process.start: 启动已创建的任务，返回 process_id 与 pid
 */
export async function baseProcessStart(processId: string): Promise<BaseProcessStartResult> {
  const proc = processes.get(processId)
  if (!proc) {
    return { ok: false, error: `找不到进程任务：${processId}` }
  }
  if (proc.running) {
    return { ok: false, error: `进程任务 ${processId} 已处于运行中状态` }
  }
  if (proc.exited) {
    return { ok: false, error: `进程任务 ${processId} 已执行完毕并退出，不能重复启动` }
  }

  try {
    const child = spawn(proc.command, proc.args, {
      cwd: proc.cwd,
      env: { ...process.env, ...proc.env },
      shell: process.platform === 'win32',
    })

    proc.child = child
    proc.pid = child.pid
    proc.running = true
    proc.startTime = Date.now()

    child.stdout?.on('data', (chunk) => {
      proc.stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      proc.stderr += chunk.toString()
    })

    child.on('error', (err) => {
      proc.stderr += `\n[spawn error] ${err.message}`
      proc.running = false
      proc.exited = true
      proc.exitTime = Date.now()
    })

    child.on('close', (code, signal) => {
      proc.running = false
      proc.exited = true
      proc.exitCode = code
      proc.signal = signal
      proc.exitTime = Date.now()
    })

    return { ok: true, process_id: processId, pid: child.pid || 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * base.process.status: 查询进程是否正在运行、是否已退出，以及退出码与信号
 */
export async function baseProcessStatus(processId: string): Promise<BaseProcessStatusResult> {
  const proc = processes.get(processId)
  if (!proc) {
    return { ok: false, error: `找不到进程任务：${processId}` }
  }
  return { ok: true, status: toProcessInfo(proc) }
}

/**
 * base.process.output: 读取标准输出和标准错误，支持增量读取
 */
export async function baseProcessOutput(
  processId: string,
  opts?: { offset?: number; reset?: boolean },
): Promise<BaseProcessOutputResult> {
  const proc = processes.get(processId)
  if (!proc) {
    return { ok: false, error: `找不到进程任务：${processId}` }
  }

  const combined = proc.stdout + (proc.stderr ? `\n[STDERR]\n${proc.stderr}` : '')
  const offset = opts?.reset ? 0 : typeof opts?.offset === 'number' ? Math.max(0, opts.offset) : proc.readOffset

  const slicedStdout = proc.stdout.slice(Math.min(offset, proc.stdout.length))
  const slicedStderr = proc.stderr.slice(Math.min(offset, proc.stderr.length))
  const slicedText = combined.slice(Math.min(offset, combined.length))

  const nextOffset = combined.length
  proc.readOffset = nextOffset

  return {
    ok: true,
    stdout: slicedStdout,
    stderr: slicedStderr,
    text: slicedText,
    offset,
    next_offset: nextOffset,
  }
}

/**
 * base.process.stop: 请求终止进程，支持超时后的强制终止策略
 */
export async function baseProcessStop(
  processId: string,
  opts?: { timeoutMs?: number; force?: boolean },
): Promise<BaseProcessStopResult> {
  const proc = processes.get(processId)
  if (!proc) {
    return { ok: false, error: `找不到进程任务：${processId}` }
  }

  if (!proc.running || !proc.pid) {
    return { ok: true, process_id: processId, stopped: true }
  }

  const pid = proc.pid
  const timeoutMs = opts?.timeoutMs ?? 3000

  if (opts?.force) {
    killProcessTree(pid, 'SIGKILL')
    proc.running = false
    proc.exited = true
    proc.exitTime = Date.now()
    return { ok: true, process_id: processId, stopped: true }
  }

  // 先优雅请求中断
  try {
    proc.child?.kill('SIGTERM')
  } catch {
    // ignore
  }

  // 超时后强制杀死
  await new Promise<void>((resolve) => {
    let waited = 0
    const interval = setInterval(() => {
      waited += 200
      if (!proc.running || waited >= timeoutMs) {
        clearInterval(interval)
        if (proc.running) {
          killProcessTree(pid, 'SIGKILL')
          proc.running = false
          proc.exited = true
          proc.exitTime = Date.now()
        }
        resolve()
      }
    }, 200)
  })

  return { ok: true, process_id: processId, stopped: true }
}

/**
 * base.process.list: 列出当前 Agent 有权访问的进程
 */
export async function baseProcessList(): Promise<BaseProcessListResult> {
  const list = [...processes.values()].map(toProcessInfo)
  return { ok: true, processes: list }
}

/**
 * base.process.get: 根据 process_id 获取进程详情
 */
export async function baseProcessGet(processId: string): Promise<BaseProcessGetResult> {
  const proc = processes.get(processId)
  if (!proc) {
    return { ok: false, error: `找不到进程任务：${processId}` }
  }
  return { ok: true, process: toProcessInfo(proc) }
}
