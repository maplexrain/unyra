import { describe, expect, it } from 'vitest'

function stepTab(
  tabs: Array<{ id: string }>,
  currentActiveId: string,
  direction: 'back' | 'forward',
): string | null {
  if (tabs.length <= 1) return null
  const curIdx = tabs.findIndex((t) => t.id === currentActiveId)
  const idx = curIdx >= 0 ? curIdx : 0
  const nextIdx =
    direction === 'back'
      ? (idx - 1 + tabs.length) % tabs.length
      : (idx + 1) % tabs.length
  return tabs[nextIdx].id
}

describe('鼠标前进与后退侧键切换标签页算法', () => {
  const tabs = [
    { id: 'tab-1' },
    { id: 'tab-2' },
    { id: 'tab-3' },
    { id: 'tab-4' },
  ]

  it('后退 (Back) 向左切换上一个标签页', () => {
    // 从 tab-2 后退到 tab-1
    expect(stepTab(tabs, 'tab-2', 'back')).toBe('tab-1')
    // 从 tab-3 后退到 tab-2
    expect(stepTab(tabs, 'tab-3', 'back')).toBe('tab-2')
  })

  it('前进 (Forward) 向右切换下一个标签页', () => {
    // 从 tab-2 前进到 tab-3
    expect(stepTab(tabs, 'tab-2', 'forward')).toBe('tab-3')
    // 从 tab-3 前进到 tab-4
    expect(stepTab(tabs, 'tab-3', 'forward')).toBe('tab-4')
  })

  it('循环切换边界条件：首位后退循环至末尾，末位前进循环至首位', () => {
    // 首位 tab-1 后退 -> 循环至 tab-4
    expect(stepTab(tabs, 'tab-1', 'back')).toBe('tab-4')
    // 末位 tab-4 前进 -> 循环至 tab-1
    expect(stepTab(tabs, 'tab-4', 'forward')).toBe('tab-1')
  })

  it('单标签页或无标签页时不触发切换', () => {
    expect(stepTab([{ id: 'only-one' }], 'only-one', 'back')).toBeNull()
    expect(stepTab([{ id: 'only-one' }], 'only-one', 'forward')).toBeNull()
    expect(stepTab([], 'none', 'forward')).toBeNull()
  })
})
