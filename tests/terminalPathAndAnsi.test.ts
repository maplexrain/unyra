import { describe, expect, it } from 'vitest'
import {
  cleanTerminalText,
} from '../src/components/terminal/ansi'
import {
  formatCdError,
  normalizeTerminalPath,
  resolveCdTarget,
} from '../src/components/terminal/terminalPath'

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
})
