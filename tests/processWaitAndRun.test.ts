import { describe, expect, it } from 'vitest'
import {
  baseProcessCreate,
  baseProcessDelete,
  baseProcessRun,
  baseProcessStart,
  baseProcessWait,
} from '../electron/base/process'
import { syncAllowedDirs } from '../electron/base/permissions'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

describe('受控进程事件驱动等待与一键运行 (process.wait & process.run)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-wait-test-'))
  syncAllowedDirs([tmpDir])

  describe('1. baseProcessWait 事件驱动等待', () => {
    it('当进程正常退出时，立即精确唤醒并返回完整的 stdout 与 exitCode，而非睡眠盲等', async () => {
      // 启动一个打印字符并退出的 node 进程
      const createRes = await baseProcessCreate({
        command: 'node',
        args: ['-e', 'console.log("HELLO_ASYNC_EVENT"); process.exit(0)'],
        cwd: tmpDir,
      })
      expect(createRes.ok).toBe(true)
      if (!createRes.ok) return

      const pid = createRes.process_id
      const startRes = await baseProcessStart(pid)
      expect(startRes.ok).toBe(true)

      const startWait = Date.now()
      const waitRes = await baseProcessWait(pid, { timeoutMs: 10000 })
      const elapsed = Date.now() - startWait

      expect(waitRes.ok).toBe(true)
      if (waitRes.ok) {
        expect(waitRes.exited).toBe(true)
        expect(waitRes.exitCode).toBe(0)
        expect(waitRes.stdout).toContain('HELLO_ASYNC_EVENT')
        // 验证执行完成后立即唤醒，耗时合理，绝不需要硬等几秒
        expect(elapsed).toBeLessThan(5000)
      }

      // 对已经退出的进程再次调用 wait，应同步立即返回
      const reWait = await baseProcessWait(pid)
      expect(reWait.ok).toBe(true)
      if (reWait.ok) {
        expect(reWait.exited).toBe(true)
        expect(reWait.stdout).toContain('HELLO_ASYNC_EVENT')
      }

      await baseProcessDelete(pid)
    })

    it('支持 matchText 就绪字符唤醒（针对常驻后台服务），就绪即刻返回且服务保持运行', async () => {
      // 模拟后台常驻服务：先输出 READY 标记，然后保持睡眠不退出
      const serverScript = `
        console.log("Server starting...");
        setTimeout(() => {
          console.log("Local: http://localhost:8080 ready");
        }, 100);
        setInterval(() => {}, 1000);
      `
      const createRes = await baseProcessCreate({
        command: 'node',
        args: ['-e', serverScript],
        cwd: tmpDir,
      })
      expect(createRes.ok).toBe(true)
      if (!createRes.ok) return

      const pid = createRes.process_id
      await baseProcessStart(pid)

      // 监听就绪字符
      const waitRes = await baseProcessWait(pid, {
        matchText: 'Local: http://localhost:8080',
        timeoutMs: 10000,
      })

      expect(waitRes.ok).toBe(true)
      if (waitRes.ok) {
        expect(waitRes.matched).toBe(true)
        expect(waitRes.exited).toBe(false) // 服务仍在运行中，未被杀死！
        expect(waitRes.stdout).toContain('Local: http://localhost:8080')
      }

      // 清理常驻进程
      await baseProcessDelete(pid)
    })

    it('当进程超时未退出时，返回 timedOut: true 标记', async () => {
      // 启动一个长时间休眠的进程
      const createRes = await baseProcessCreate({
        command: 'node',
        args: ['-e', 'setTimeout(() => {}, 10000)'],
        cwd: tmpDir,
      })
      expect(createRes.ok).toBe(true)
      if (!createRes.ok) return

      const pid = createRes.process_id
      await baseProcessStart(pid)

      // 设置 200ms 超时
      const waitRes = await baseProcessWait(pid, { timeoutMs: 200 })
      expect(waitRes.ok).toBe(true)
      if (waitRes.ok) {
        expect(waitRes.timedOut).toBe(true)
      }

      await baseProcessDelete(pid)
    })
  })

  describe('2. baseProcessRun 一键式运行', () => {
    it('能够一键完成 创建 -> 启动 -> 等待 -> 收集输出 -> 自动清理 全流程', async () => {
      const res = await baseProcessRun({
        command: 'node',
        args: ['-e', 'console.log("ONE_LINE_RUN_SUCCESS"); process.exit(0)'],
        cwd: tmpDir,
        timeoutMs: 10000,
        cleanup: true,
      })

      expect(res.ok).toBe(true)
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('ONE_LINE_RUN_SUCCESS')
      expect(res.durationMs).toBeGreaterThan(0)
    })

    it('命令失败时正确回传非 0 退出码及错误信息', async () => {
      const res = await baseProcessRun({
        command: 'node',
        args: ['-e', 'console.error("SYNTAX_FAIL"); process.exit(2)'],
        cwd: tmpDir,
        timeoutMs: 10000,
      })

      expect(res.ok).toBe(false)
      expect(res.exitCode).toBe(2)
      expect(res.stderr).toContain('SYNTAX_FAIL')
    })
  })

  describe('3. 沙箱环境 api.process.run 与 api.process.wait 门面集成', () => {
    it('在沙盒 api 对象上挂载并能成功调度原生 run 和 wait', async () => {
      const globalAny = globalThis as unknown as {
        window?: Record<string, unknown>
      }
      globalAny.window = {
        mojiNative: {
          process: {
            run: baseProcessRun,
            wait: baseProcessWait,
          },
        },
      }

      const { installProcess } = await import('../src/agent/sandbox/api/process')
      const api: Record<string, unknown> = {}
      const log: any[] = []
      installProcess(api, log)

      expect(typeof (api.process as any).run).toBe('function')
      expect(typeof (api.process as any).wait).toBe('function')

      // 验证通过沙盒 api.process.run 调用
      const runRes = await (api.process as any).run({
        command: 'node',
        args: ['-e', 'console.log("SANDBOX_RUN_OK")'],
        cwd: tmpDir,
      })
      expect(runRes.ok).toBe(true)
      expect(runRes.stdout).toContain('SANDBOX_RUN_OK')
    })
  })
})
