import { describe, expect, it } from 'vitest'
import { nextDefaultGoalTitle } from '../src/components/learn/workspace/goalNaming'

describe('新建学习目标默认名', () => {
  it('没有旧目标时从 1 开始', () => {
    expect(nextDefaultGoalTitle([])).toBe('新目标 [1]')
  })

  it('取已有编号最大值 +1，忽略无关标题', () => {
    expect(
      nextDefaultGoalTitle([
        { title: '新目标 [3]' },
        { title: '函数与极限' },
        { title: '新目标（8）' },
        { title: '新目标 [2]' },
      ]),
    ).toBe('新目标 [9]')
  })

  it('标题缺失不会抛错', () => {
    expect(nextDefaultGoalTitle([{}, { title: '新目标 [1]' }])).toBe('新目标 [2]')
  })
})
