/**
 * terminalRunner: 负责原生集成终端底层系统进程生命周期管理与实时流式输出调度。
 *
 * 核心机制：
 * 1. 跨平台参数构造：针对 powershell、cmd、bash 正确打包参数与环境变量（FORCE_COLOR=1, PYTHONUNBUFFERED=1）；
 * 2. 毫秒级双工流式输出：监听主进程 onData 事件，逐块清洗 ANSI 并实时推送至终端流缓冲；
 * 3. 强力 PID 绑定与树级中断：真实捕获底层 PID，支持 Ctrl+C 发送任务树级 kill 信号立即中断；
 * 4. 退出状态监听与保底清理：监听 onExit 与心跳轮询，进程退出后自动释放任务资源并归还 Prompt 控制权。
 */

import { cleanTerminalText } from './ansi'
import type { ShellKind } from './TerminalHeader'

export interface ProcessRunnerBridge {
  create: (opts: any) => Promise<any>
  start: (id: string) => Promise<any>
  status: (id: string) => Promise<any>
  output?: (id: string, opts?: any) => Promise<any>
  stop: (id: string, opts?: any) => Promise<any>
  delete: (id: string) => Promise<any>
  onData?: (cb: (payload: { process_id: string; text: string; stream: 'stdout' | 'stderr' }) => void) => () => void
  onExit?: (cb: (payload: { process_id: string; exitCode: number | null; signal: string | null }) => void) => () => void
}

export function getNativeProcess(): ProcessRunnerBridge | null {
  const win = (typeof window !== 'undefined' ? window : globalThis) as unknown as {
    unyraNative?: { process?: ProcessRunnerBridge }
    mojiNative?: { process?: ProcessRunnerBridge }
  }
  return win?.unyraNative?.process ?? win?.mojiNative?.process ?? null
}

export function getNativeFiles(): any {
  const win = (typeof window !== 'undefined' ? window : globalThis) as unknown as {
    unyraNative?: { files?: any; base?: { files?: any } }
    mojiNative?: { files?: any; base?: { files?: any } }
  }
  return win?.unyraNative?.files ?? win?.unyraNative?.base?.files ?? win?.mojiNative?.files ?? null
}

export function buildProcessArgs(shell: ShellKind, cmd: string): { command: string; args: string[] } {
  const trimmed = cmd.trim()
  if (shell === 'cmd') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', trimmed],
    }
  }
  if (shell === 'bash') {
    return {
      command: 'bash',
      args: ['-c', trimmed],
    }
  }
  // 默认 PowerShell
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', trimmed],
  }
}

/**
 * 将增量终端输出合并追加到现有行列表。
 * 若上一行未换行，则合并至上一行；并限制最大缓存行数防止内存溢出。
 */
export function appendTerminalOutput(prevLines: string[], rawChunk: string): string[] {
  const cleaned = cleanTerminalText(rawChunk)
  if (!cleaned) return prevLines

  const maxLines = 3000
  const lines = prevLines.length > maxLines ? prevLines.slice(prevLines.length - 2000) : [...prevLines]

  if (lines.length === 0) {
    return [cleaned]
  }

  const lastIdx = lines.length - 1
  const lastLine = lines[lastIdx]

  // 若最后一行不以换行符结尾，将其与新内容拼接
  if (!lastLine.endsWith('\n')) {
    lines[lastIdx] = lastLine + cleaned
  } else {
    lines.push(cleaned)
  }

  return lines
}

export interface StreamingExecutionHandle {
  processId: string
  abort: () => Promise<void>
}

export interface RunStreamingCommandParams {
  shell: ShellKind
  cmd: string
  cwd: string
  onData: (chunk: string) => void
  onExit: (exitCode: number | null, signal: string | null) => void
  onError: (err: string) => void
}

/**
 * 启动一个原生命令并接入实时流式输出
 */
export async function startStreamingCommand(
  params: RunStreamingCommandParams,
): Promise<StreamingExecutionHandle | null> {
  const np = getNativeProcess()
  if (!np || !np.create || !np.start) {
    params.onError('[Web 演示模式] 终端原生系统进程执行需要运行在 Electron 桌面环境。')
    return null
  }

  const { command, args } = buildProcessArgs(params.shell, params.cmd)

  try {
    const createRes = await np.create({
      command,
      args,
      cwd: params.cwd || undefined,
      timeoutMs: 3600000, // 允许常驻 1 小时，由用户 Ctrl+C 自行决定何时中断
      trusted: true,
      env: {
        FORCE_COLOR: '1',
        PYTHONUNBUFFERED: '1',
      },
    })

    if (!createRes?.ok || !createRes.process_id) {
      params.onError(createRes?.error || '无法创建子进程任务')
      return null
    }

    const processId: string = createRes.process_id
    let isTerminated = false

    // 资源清理器
    const cleanup = () => {
      if (isTerminated) return
      isTerminated = true
      if (unsubData) unsubData()
      if (unsubExit) unsubExit()
      if (pollTimer) clearInterval(pollTimer)
      void np.delete(processId).catch(() => {})
    }

    // 1. 订阅实时流式 stdout / stderr 输出
    const unsubData = np.onData?.((payload) => {
      if (payload.process_id === processId && payload.text) {
        params.onData(payload.text)
      }
    })

    // 2. 订阅退出事件
    const unsubExit = np.onExit?.((payload) => {
      if (payload.process_id === processId) {
        cleanup()
        params.onExit(payload.exitCode, payload.signal)
      }
    })

    // 3. 心跳检测保底轮询（每 400ms 检查是否异常中断或已退出，防止 IPC 事件丢失）
    const pollTimer = setInterval(async () => {
      if (isTerminated) return
      try {
        const st = await np.status(processId)
        if (st?.status?.exited) {
          cleanup()
          params.onExit(st.status.exitCode ?? 0, st.status.signal ?? null)
        }
      } catch {
        cleanup()
        params.onExit(null, null)
      }
    }, 400)

    // 4. 启动进程
    const startRes = await np.start(processId)
    if (!startRes?.ok) {
      cleanup()
      params.onError(startRes?.error || '启动进程失败')
      return null
    }

    return {
      processId,
      abort: async () => {
        try {
          await np.stop(processId, { force: true })
        } finally {
          cleanup()
        }
      },
    }
  } catch (err) {
    params.onError(err instanceof Error ? err.message : String(err))
    return null
  }
}
