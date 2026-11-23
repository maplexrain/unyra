import { describe, expect, it } from 'vitest'
import { mentionedRoleIdsOf, type MentionRole } from '../src/learn/roleWork/groupTargets'

const roles: MentionRole[] = [
  { id: 'tutor', names: ['导师龟'] },
  { id: 'dispatcher', names: ['调度龟'] },
  { id: 'designer', names: ['设计龟'] },
]

describe('群聊 @ 目标解析', () => {
  it('只认正文里真正 @ 到的 role，不把调度龟与设计龟混在一起', () => {
    expect(mentionedRoleIdsOf('@导师龟 请接一下这个任务', roles)).toEqual(['tutor'])
    expect(mentionedRoleIdsOf('@设计龟 做个课件', roles)).toEqual(['designer'])
  })

  it('一次 @ 多位按 role 名单顺序返回，且去重', () => {
    expect(mentionedRoleIdsOf('@设计龟 @导师龟 @导师龟', roles)).toEqual(['tutor', 'designer'])
  })

  it('@ 到不存在的名字不产生目标', () => {
    expect(mentionedRoleIdsOf('@维修龟 看一下', roles)).toEqual([])
  })
})
