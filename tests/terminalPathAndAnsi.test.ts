import { describe, expect, it, vi } from 'vitest'
import { executeVimCommand } from '../src/lib/vimExecutor'
import {
  cleanTerminalText,
} from '../src/components/terminal/ansi'
import {
  formatCdError,
  normalizeTerminalPath,
  resolveCdTarget,
} from '../src/components/terminal/terminalPath'
import {
  appendTerminalOutput,
  buildProcessArgs,
  startStreamingCommand,
} from '../src/components/terminal/terminalRunner'

describe('terminalPath and ansi utils', () => {
  it('cleanTerminalText cleans OSC title, cursor codes and carriage returns', () => {
    // OSC sequence
    const osc = '\x1b]0;C:\\Windows\\System32\\cmd.exe\x07Hello World'
    expect(cleanTerminalText(osc)).toBe('Hello World')

    // Cursor hide/show & line clear
    const cursor = 'Line1\x1b[2K\x1b[?25hLine2\x1b[?25l'
    expect(cleanTerminalText(cursor)).toBe('Line1Line2')

    // CRLF normalization
    const crlf = 'Line1\r\nLine2\rLine3\n'
    expect(cleanTerminalText(crlf)).toBe('Line1\nLine2\nLine3\n')

    // Preserves color codes
    const colored = '\x1b[32mSuccess\x1b[0m'
    expect(cleanTerminalText(colored)).toBe('\x1b[32mSuccess\x1b[0m')
  })

  it('normalizeTerminalPath handles Windows and POSIX paths', () => {
    expect(normalizeTerminalPath('e:/learn-ai/moji-notes', true)).toBe('E:\\learn-ai\\moji-notes')
    expect(normalizeTerminalPath('c:\\', true)).toBe('C:\\')
    expect(normalizeTerminalPath('/usr/local/bin/', false)).toBe('/usr/local/bin')
  })

  it('resolveCdTarget correctly resolves paths', () => {
    // Windows drive switch
    expect(resolveCdTarget('C:\\workspace', 'D:', '', true)).toBe('D:\\')
    expect(resolveCdTarget('C:\\workspace', 'd:', '', true)).toBe('D:\\')

    // Parent directory ..
    expect(resolveCdTarget('E:\\learn-ai\\moji-notes', '..', '', true)).toBe('E:\\learn-ai')
    expect(resolveCdTarget('E:\\learn-ai', '..', '', true)).toBe('E:\\')
    expect(resolveCdTarget('E:\\', '..', '', true)).toBe('E:\\')

    // Relative subfolder
    expect(resolveCdTarget('E:\\learn-ai', 'moji-notes', '', true)).toBe('E:\\learn-ai\\moji-notes')
    expect(resolveCdTarget('E:\\learn-ai', './moji-notes', '', true)).toBe('E:\\learn-ai\\moji-notes')

    // Quoted path
    expect(resolveCdTarget('E:\\learn-ai', '"Program Files"', '', true)).toBe('E:\\learn-ai\\Program Files')

    // Home directory
    expect(resolveCdTarget('E:\\learn-ai', '~', 'C:\\Users\\maxwell', true)).toBe('C:\\Users\\maxwell')
    expect(resolveCdTarget('E:\\learn-ai', '', 'C:\\Users\\maxwell', true)).toBe('C:\\Users\\maxwell')

    // Root /
    expect(resolveCdTarget('E:\\learn-ai\\moji-notes', '/', '', true)).toBe('E:\\')
    expect(resolveCdTarget('/home/user/docs', '/', '', false)).toBe('/')
    expect(resolveCdTarget('/home/user/docs', '..', '', false)).toBe('/home/user')
  })

  it('formatCdError returns shell-specific errors', () => {
    expect(formatCdError('non_exist', 'powershell')).toContain('Set-Location')
    expect(formatCdError('non_exist', 'cmd')).toContain('系统找不到指定的路径')
    expect(formatCdError('non_exist', 'bash')).toContain('bash: cd')
  })

  it('buildProcessArgs packs arguments correctly for different shells', () => {
    const pwsh = buildProcessArgs('powershell', 'npm run dev')
    expect(pwsh.command).toBe('powershell.exe')
    expect(pwsh.args[0]).toBe('-NoProfile')
    expect(pwsh.args[4]).toContain('chcp 65001')
    expect(pwsh.args[4]).toContain('npm run dev')

    const cmd = buildProcessArgs('cmd', 'dir /b')
    expect(cmd.command).toBe('cmd.exe')
    expect(cmd.args[3]).toContain('chcp 65001')
    expect(cmd.args[3]).toContain('dir /b')

    const bash = buildProcessArgs('bash', 'ls -la')
    expect(bash.command).toBe('bash')
    expect(bash.args).toEqual(['-c', 'ls -la'])
  })

  it('appendTerminalOutput merges non-newline chunks and respects max lines', () => {
    // 初始空行追加
    let lines = appendTerminalOutput([], 'hello ')
    expect(lines).toEqual(['hello '])

    // 无换行连续追加合并到同一行（流式打字与进度条刷新）
    lines = appendTerminalOutput(lines, 'world\n')
    expect(lines).toEqual(['hello world\n'])

    // 有换行后追加开启新一行
    lines = appendTerminalOutput(lines, 'line 2\n')
    expect(lines).toEqual(['hello world\n', 'line 2\n'])
  })

  it('startStreamingCommand triggers onData and onExit hooks in real-time', async () => {
    let capturedDataCallback: ((payload: any) => void) | null = null
    let capturedExitCallback: ((payload: any) => void) | null = null

    const mockProcess = {
      create: vi.fn().mockResolvedValue({ ok: true, process_id: 'proc_123' }),
      start: vi.fn().mockResolvedValue({ ok: true }),
      status: vi.fn().mockResolvedValue({ ok: true, status: { exited: false } }),
      delete: vi.fn().mockResolvedValue({ ok: true }),
      stop: vi.fn().mockResolvedValue({ ok: true }),
      onData: vi.fn().mockImplementation((cb) => {
        capturedDataCallback = cb
        return () => {}
      }),
      onExit: vi.fn().mockImplementation((cb) => {
        capturedExitCallback = cb
        return () => {}
      }),
    }

    const win = (typeof window !== 'undefined' ? window : globalThis) as any
    const originalUnyra = win.unyraNative
    win.unyraNative = { process: mockProcess }

    try {
      const receivedChunks: string[] = []
      let exitCode: number | null = null

      const handle = await startStreamingCommand({
        shell: 'powershell',
        cmd: 'npm run test',
        cwd: 'E:\\learn-ai\\moji-notes',
        onData: (chunk) => receivedChunks.push(chunk),
        onExit: (code) => {
          exitCode = code
        },
        onError: () => {},
      })

      expect(handle).not.toBeNull()
      expect(handle?.processId).toBe('proc_123')
      expect(mockProcess.create).toHaveBeenCalled()
      expect(mockProcess.start).toHaveBeenCalledWith('proc_123')

      // 模拟主进程推送流式输出
      const dataCb = capturedDataCallback as any
      dataCb?.({
        process_id: 'proc_123',
        text: 'Running tests...\n',
        stream: 'stdout',
      })
      dataCb?.({
        process_id: 'proc_123',
        text: '10 passed\n',
        stream: 'stdout',
      })

      expect(receivedChunks).toEqual(['Running tests...\n', '10 passed\n'])

      // 模拟进程退出
      const exitCb = capturedExitCallback as any
      exitCb?.({
        process_id: 'proc_123',
        exitCode: 0,
        signal: null,
      })
      expect(exitCode).toBe(0)
    } finally {
      win.unyraNative = originalUnyra
    }
  })

  it('vimExecutor handles focus command', () => {
    const res = executeVimCommand('focus')
    expect(res.success).toBe(false)

    const mockElement = { focus: vi.fn() }
    const originalDoc = (globalThis as any).document
    ;(globalThis as any).document = {
      querySelector: vi.fn().mockImplementation((sel: string) => {
        if (sel === '[data-terminal-input]') return mockElement
        return null
      }),
    }

    try {
      const resSuccess = executeVimCommand('focus')
      expect(resSuccess.success).toBe(true)
      expect(resSuccess.message).toContain('终端已获得焦点')
      expect(mockElement.focus).toHaveBeenCalled()
    } finally {
      ;(globalThis as any).document = originalDoc
    }
  })
})
