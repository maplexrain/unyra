import { describe, expect, it } from 'vitest'
import {
  firstMentionedRoleIdOf,
  groupSelfMentionError,
  mentionedRoleIdsOf,
  mentionsUserInGroup,
  type MentionRole,
} from '../src/learn/roleWork/groupTargets'

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

  it('@ 名字后没有空格就不算一次成功艾特', () => {
    expect(mentionedRoleIdsOf('@导师龟，请接一下', roles)).toEqual([])
    expect(mentionedRoleIdsOf('@导师龟：请接一下', roles)).toEqual([])
    expect(mentionedRoleIdsOf('请找 @导师龟', roles)).toEqual([])
    expect(mentionedRoleIdsOf('@导师龟\n请接一下', roles)).toEqual([])
    expect(mentionedRoleIdsOf('@导师龟\t请接一下', roles)).toEqual([])
    expect(mentionedRoleIdsOf('@导师龟\u3000请接一下', roles)).toEqual(['tutor'])
  })

  it('一次 @ 多位按 role 名单顺序返回，且去重', () => {
    expect(mentionedRoleIdsOf('@设计龟 @导师龟 @导师龟', roles)).toEqual(['tutor', 'designer'])
  })

  it('@ 到不存在的名字不产生目标', () => {
    expect(mentionedRoleIdsOf('@维修龟 看一下', roles)).toEqual([])
  })

  it('@ 可以点名多位，不再有人数上限；mention 取正文里最先出现的那个', () => {
    expect(mentionedRoleIdsOf('@导师龟 @设计龟 一起看', roles)).toEqual(['tutor', 'designer'])
    expect(firstMentionedRoleIdOf('@导师龟 @设计龟 一起看', roles)).toBe('tutor')
    expect(firstMentionedRoleIdOf('@设计龟 先看，@导师龟 再看', roles)).toBe('designer')
    expect(firstMentionedRoleIdOf('@用户 已完成', roles)).toBeNull()
  })

  it('群聊里显式 @ 自己会被拒绝；@ 别人则正常', () => {
    expect(groupSelfMentionError(['tutor'], 'tutor', '导师龟')).toContain('不能 @ 自己（导师龟）')
    expect(groupSelfMentionError(['tutor', 'designer'], 'tutor', '导师龟')).toContain('不能 @ 自己（导师龟）')
    expect(groupSelfMentionError(['designer'], 'tutor', '导师龟')).toBeNull()
    expect(groupSelfMentionError([], 'tutor', '导师龟')).toBeNull()
  })

  it('@ 用户是给用户看的最终汇报，不投递给任何 role', () => {
    expect(mentionsUserInGroup('@用户 文章已经写完，请查收')).toBe(true)
    expect(mentionsUserInGroup('@张三 文章已经写完，请查收', '张三')).toBe(true)
    expect(mentionsUserInGroup('@用户，文章已经写完')).toBe(false)
    expect(mentionsUserInGroup('@导师龟 请接一下这个任务', '张三')).toBe(false)
  })
})
