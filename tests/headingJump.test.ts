/**
 * 大纲跳转的**目标位置算式**（见 lib/outline 的 headingJumpTarget）。
 *
 * 为什么值得一个用例：这条式子是跳转的核心，而它唯一的性质——
 * **结果与「此刻滚到哪」无关**——正是「动画可以每帧重算目标」的前提。
 * 一旦有人把它改成「先记下当前位置再算」，这条用例立刻会红，
 * 而那个 bug 在界面上表现为「跳一次跳不准，得点好几次」。
 */
import { describe, expect, it } from 'vitest'

import { headingJumpTarget } from '../src/lib/outline'

/** 容器顶在视口 100px 处（不随滚动变化）；标题在正文里第 2000px 处 */
const box = (scrollTop: number) => ({
  scrollTop,
  getBoundingClientRect: () => ({ top: 100 }),
})
const headAt = (docOffset: number, scrollTop: number) => ({
  getBoundingClientRect: () => ({ top: 100 + docOffset - scrollTop }),
})

describe('目标位置', () => {
  it('把标题放到容器顶往下 gap 处（按标题在正文里的绝对位置算）', () => {
    expect(headingJumpTarget(box(0), headAt(2000, 0), 16)).toBe(1984)
    expect(headingJumpTarget(box(0), headAt(2000, 0), 0)).toBe(2000)
  })

  it('与此刻滚到哪无关：动画每帧重算目标也不会漂', () => {
    const at0 = headingJumpTarget(box(0), headAt(2000, 0), 16)
    const at500 = headingJumpTarget(box(500), headAt(2000, 500), 16)
    const at1900 = headingJumpTarget(box(1900), headAt(2000, 1900), 16)
    expect(at500).toBe(at0)
    expect(at1900).toBe(at0)
  })

  it('往上跳也是同一个式子（负数方向同样成立）', () => {
    expect(headingJumpTarget(box(1200), headAt(300, 1200), 16)).toBe(284)
  })
})
