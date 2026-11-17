// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  getNextTerminalSeq,
  getTerminalMeta,
  setTerminalMeta,
  subscribeTerminalMeta,
  unregisterTerminalMeta,
} from '../src/components/terminal/terminalRegistry'
import {
  filterTerminalOptions,
  TERMINAL_SHELL_OPTIONS,
} from '../src/components/learn/workspace/VimTerminalDropdown'
import { initDoubleShiftListener } from '../src/lib/doubleShiftListener'
import { tabKey, tabTitle } from '../src/learn/tabs'
import type { LearnTab, TabRef } from '../src/learn/types/tabs'
import {
  preserveCurrentSelection,
  restoreOrClearPreservedSelection,
} from '../src/components/learn/workspace/vimSelectionPreserve'
import * as commandBarFocus from '../src/lib/commandBarFocus'

describe('terminal multi-tab and registry', () => {
  it('getNextTerminalSeq allocates sequence IDs monotonically avoiding collisions', () => {
    const tabs: LearnTab[] = [
      {
        id: 'term:1',
        ref: { kind: 'terminal', termId: '1', shell: 'powershell' },
        createdAt: 100,
      },
      {
        id: 'term:2',
        ref: { kind: 'terminal', termId: '2', shell: 'cmd' },
        createdAt: 200,
      },
    ]

    expect(getNextTerminalSeq([])).toBe('1')
    expect(getNextTerminalSeq(tabs)).toBe('3')

    // 如果序号有空隙（例如 1 和 3 已开），优先补齐 2
    const gappedTabs: LearnTab[] = [
      {
        id: 'term:1',
        ref: { kind: 'terminal', termId: '1' },
        createdAt: 100,
      },
      {
        id: 'term:3',
        ref: { kind: 'terminal', termId: '3' },
        createdAt: 300,
      },
    ]
    expect(getNextTerminalSeq(gappedTabs)).toBe('2')
  })

  it('tabKey and tabTitle support independent terminal tabs and dynamic titles', () => {
    const ref1: TabRef = { kind: 'terminal', termId: '1', shell: 'powershell' }
    const ref2: TabRef = { kind: 'terminal', termId: '2', shell: 'cmd' }
    const refCustom: TabRef = { kind: 'terminal', termId: '3', title: '3: npm run test' }

    expect(tabKey(ref1)).toBe('term:1')
    expect(tabKey(ref2)).toBe('term:2')
    expect(tabKey({ kind: 'terminal' })).toBe('term:terminal')

    const nodeTitle = () => undefined
    expect(tabTitle(ref1, nodeTitle)).toBe('1: pwsh')
    expect(tabTitle(ref2, nodeTitle)).toBe('2: cmd')
    expect(tabTitle(refCustom, nodeTitle)).toBe('3: npm run test')
  })

  it('setTerminalMeta updates state and notifies subscribers', () => {
    const notifications: string[] = []
    const unsub = subscribeTerminalMeta((id) => notifications.push(id))

    setTerminalMeta('term_test_1', {
      termId: 'term_test_1',
      title: '1: npm run dev',
      runningPid: 'pid_999',
      currentCommand: 'npm run dev',
      shell: 'powershell',
    })

    const meta = getTerminalMeta('term_test_1')
    expect(meta?.runningPid).toBe('pid_999')
    expect(meta?.currentCommand).toBe('npm run dev')
    expect(notifications).toContain('term_test_1')

    unregisterTerminalMeta('term_test_1')
    expect(getTerminalMeta('term_test_1')).toBeUndefined()
    unsub()
  })

  it('filterTerminalOptions accurately filters shell types', () => {
    expect(filterTerminalOptions('')).toEqual(TERMINAL_SHELL_OPTIONS)
    expect(filterTerminalOptions('power').map((x) => x.kind)).toEqual(['powershell'])
    expect(filterTerminalOptions('pwsh').map((x) => x.kind)).toEqual(['powershell'])
    expect(filterTerminalOptions('cmd').map((x) => x.kind)).toEqual(['cmd'])
    expect(filterTerminalOptions('bash').map((x) => x.kind)).toEqual(['bash'])
  })

  it('initDoubleShiftListener triggers :open mode on double Shift and ignores intervening keys', () => {
    const openBarSpy = vi.spyOn(commandBarFocus, 'openGlobalCommandBar').mockImplementation(() => {})
    const cleanup = initDoubleShiftListener()

    const now = Date.now()
    const dateSpy = vi.spyOn(Date, 'now')

    // 第一次按 Shift
    dateSpy.mockReturnValue(now)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
    expect(openBarSpy).not.toHaveBeenCalled()

    // 200ms 后第二次按 Shift -> 触发双击 Shift 唤起 open 模式
    dateSpy.mockReturnValue(now + 200)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
    expect(openBarSpy).toHaveBeenCalledWith({ mode: ':', prefill: 'open ' })

    openBarSpy.mockClear()

    // 测试非 Shift 键阻断：Shift -> 'A' -> Shift
    dateSpy.mockReturnValue(now + 1000)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
    dateSpy.mockReturnValue(now + 1100)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    dateSpy.mockReturnValue(now + 1200)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }))
    // 因为中间夹杂了 'a'，不能触发双击 Shift
    expect(openBarSpy).not.toHaveBeenCalled()

    cleanup()
    openBarSpy.mockRestore()
    dateSpy.mockRestore()
  })

  it('preserveCurrentSelection sets data-vim-command-open attribute and cleans up on restore', () => {
    expect(document.documentElement.getAttribute('data-vim-command-open')).toBeNull()

    preserveCurrentSelection()
    expect(document.documentElement.getAttribute('data-vim-command-open')).toBe('true')

    restoreOrClearPreservedSelection()
    expect(document.documentElement.getAttribute('data-vim-command-open')).toBeNull()
  })
})
