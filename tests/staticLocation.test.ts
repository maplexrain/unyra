/**
 * 目标级资源目录的兜底：刚建的空目标还没有根节点，但磁盘上的目标目录已经按目标名存在。
 * 群聊附件转存必须找到它，否则消息会静默变成「没有附件」。
 */
import { describe, expect, it } from 'vitest'
import { goalDirOf, goalStaticDir } from '../src/learn/static/location'
import type { LearnStore } from '../src/learn/types'

const emptyGoalStore = (rootNodeId: string): LearnStore =>
  ({
    goals: [
      {
        id: 'g1',
        rootNodeId,
        title: '高等数学',
        question: '高等数学',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    nodes: [],
    edges: [],
    conversations: [],
  }) as unknown as LearnStore

describe('静态资源目录', () => {
  it('空目标（rootNodeId 为空）按目标名退回目标目录，不再判定为没有目录', () => {
    const store = emptyGoalStore('')
    expect(goalDirOf(store, 'g1')).toBe('docs/高等数学')
    expect(goalStaticDir(store, 'g1')).toBe('docs/高等数学/static')
  })

  it('目标不存在时仍返回 null', () => {
    const store = emptyGoalStore('')
    expect(goalDirOf(store, 'missing')).toBeNull()
    expect(goalStaticDir(store, 'missing')).toBeNull()
  })
})
