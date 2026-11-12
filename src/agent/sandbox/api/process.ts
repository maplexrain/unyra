/**
 * 这个文件负责什么：受控系统进程 api 的装配（process.*）——进程的创建、启动、状态、
 * 输出、停止、列举与删除，全部经宿主原生桥（见 api/native.ts 的 getNativeProcess）；
 * 无桥环境兜 mock 返回值，让编排照常走通。
 */
import { asRecord, asText } from '../refs'
import { wrapApi } from '../wrap'
import { getNativeProcess } from './native'
import type { SandboxCall } from '../types'

/** 受控进程域：process.create/start/status/output/stop/list/get/delete（本组不走 opts，直接问原生桥） */
export function installProcess(api: Record<string, unknown>, log: SandboxCall[]): void {
  wrapApi(api, 'process.create', async (args) => {
    const opt = asRecord(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: 'proc_mock_1', command: asText(opt.command), args: [], cwd: '' }
    return await np.create({
      command: asText(opt.command),
      args: Array.isArray(opt.args) ? opt.args.map(asText) : undefined,
      cwd: typeof opt.cwd === 'string' ? opt.cwd : undefined,
      env: opt.env && typeof opt.env === 'object' ? (opt.env as Record<string, string>) : undefined,
    })
  }, log)

  wrapApi(api, 'process.start', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: pid, pid: 1234 }
    return await np.start(pid)
  }, log)

  wrapApi(api, 'process.run', async (args) => {
    const opt = asRecord(args[0])
    const np = getNativeProcess()
    if (!np) {
      return { ok: true, process_id: 'proc_mock_run', exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 0 }
    }
    return await np.run({
      command: asText(opt.command),
      args: Array.isArray(opt.args) ? opt.args.map(asText) : undefined,
      cwd: typeof opt.cwd === 'string' ? opt.cwd : undefined,
      env: opt.env && typeof opt.env === 'object' ? (opt.env as Record<string, string>) : undefined,
      timeoutMs: typeof opt.timeoutMs === 'number' ? opt.timeoutMs : undefined,
      cleanup: typeof opt.cleanup === 'boolean' ? opt.cleanup : undefined,
    })
  }, log)

  wrapApi(api, 'process.wait', async (args) => {
    const pid = asText(args[0])
    const opt = asRecord(args[1])
    const np = getNativeProcess()
    if (!np) {
      return { ok: true, process_id: pid, exited: true, exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 0 }
    }
    return await np.wait(pid, {
      timeoutMs: typeof opt.timeoutMs === 'number' ? opt.timeoutMs : undefined,
      matchText: typeof opt.matchText === 'string' ? opt.matchText : undefined,
    })
  }, log)

  wrapApi(api, 'process.status', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, status: { process_id: pid, command: '', args: [], cwd: '', running: false, exited: true, exitCode: 0, signal: null } }
    return await np.status(pid)
  }, log)

  wrapApi(api, 'process.output', async (args) => {
    const pid = asText(args[0])
    const opt = asRecord(args[1])
    const np = getNativeProcess()
    if (!np) return { ok: true, stdout: '', stderr: '', text: '', offset: 0, next_offset: 0 }
    return await np.output(pid, {
      offset: typeof opt.offset === 'number' ? opt.offset : undefined,
      reset: opt.reset === true,
    })
  }, log)

  wrapApi(api, 'process.stop', async (args) => {
    const pid = asText(args[0])
    const opt = asRecord(args[1])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: pid, stopped: true }
    return await np.stop(pid, {
      timeoutMs: typeof opt.timeoutMs === 'number' ? opt.timeoutMs : undefined,
      force: opt.force === true,
    })
  }, log)

  wrapApi(api, 'process.list', async () => {
    const np = getNativeProcess()
    if (!np) return { ok: true, processes: [] }
    return await np.list()
  }, log)

  wrapApi(api, 'process.get', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process: { process_id: pid, command: '', args: [], cwd: '', running: false, exited: true, exitCode: 0, signal: null } }
    return await np.get(pid)
  }, log)

  wrapApi(api, 'process.delete', async (args) => {
    const pid = asText(args[0])
    const np = getNativeProcess()
    if (!np) return { ok: true, process_id: pid, deleted: true }
    return await np.delete(pid)
  }, log)
}
