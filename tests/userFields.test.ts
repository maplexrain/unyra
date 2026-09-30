/**
 * 画像字段的单元用例（user/fields）。
 *
 * 这一段守的是「导师代写画像」那条路上的三处边界——它们在界面上都不报错，
 * 只会在几轮之后以别的样子出现：
 * 1. 头像必须留在本地：它是几百 KB 的 data URL，漏进一次回执就是几十万字符的上下文；
 * 2. 归一要严：年龄越界、性别认不出、超长文本，都要**说清楚**而不是悄悄丢掉或悄悄截断；
 * 3. 表单答案 → 画像的那一步映射：留空不是错误、一个字段不合法不能带塌整张表单。
 */
import { describe, expect, it } from 'vitest'

import { emptyProfile, type UserProfile } from '../src/user/types'
import {
  PROFILE_FIELDS,
  PROFILE_FIELD_LABEL,
  answerTextOf,
  coerceProfileValue,
  isProfileField,
  patchFromAnswers,
  profileFieldList,
  profileForModel,
} from '../src/user/fields'

const profile = (patch: Partial<UserProfile> = {}): UserProfile => ({ ...emptyProfile(), ...patch })

describe('画像字段名单', () => {
  it('头像不在可写字段里', () => {
    expect(PROFILE_FIELDS).not.toContain('avatar')
    expect(isProfileField('avatar')).toBe(false)
    expect(isProfileField('education')).toBe(true)
    expect(isProfileField('身高')).toBe(false)
  })

  it('每个字段都有中文名，报错里能直接列出来', () => {
    for (const f of PROFILE_FIELDS) expect(PROFILE_FIELD_LABEL[f]).toBeTruthy()
    expect(profileFieldList()).toContain('education（教育程度）')
  })
})

describe('给模型看的那份画像', () => {
  it('头像不出门，未填的字段不编造', () => {
    const view = profileForModel(profile({ nickname: '小林', avatar: 'data:image/png;base64,AAAA' }))!
    expect(JSON.stringify(view)).not.toContain('data:image')
    expect(view.nickname).toBe('小林')
    expect(view.education).toBe('')
    expect(view.age).toBeNull()
  })

  it('filled / missing 分得清「没填」与「填了但为空」', () => {
    const view = profileForModel(profile({ nickname: '小林', education: '本科', gender: 'female' }))!
    expect(view.filled).toEqual(['nickname', 'gender', 'education'])
    expect(view.missing).toContain('major')
    expect(view.gender).toBe('女')
  })

  it('性别是「不便透露」时算没填——那是默认值，不是信息', () => {
    const view = profileForModel(profile({ nickname: '小林' }))!
    expect(view.gender).toBe('')
    expect(view.filled).not.toContain('gender')
  })

  it('没有画像时回 null，调用方据此说「读不到」', () => {
    expect(profileForModel(null)).toBeNull()
    expect(profileForModel(undefined)).toBeNull()
  })
})

describe('取值归一', () => {
  it('年龄收数字与数字串，越界就拒', () => {
    expect(coerceProfileValue('age', '35')).toEqual({ ok: true, value: 35 })
    expect(coerceProfileValue('age', 42)).toEqual({ ok: true, value: 42 })
    expect(coerceProfileValue('age', '35 岁')).toEqual({ ok: true, value: 35 })
    expect(coerceProfileValue('age', 500).ok).toBe(false)
    expect(coerceProfileValue('age', '不小了').ok).toBe(false)
  })

  it('性别中英文写法都收，认不出就拒（不静默落成默认值）', () => {
    expect(coerceProfileValue('gender', '男')).toEqual({ ok: true, value: 'male' })
    expect(coerceProfileValue('gender', 'Female')).toEqual({ ok: true, value: 'female' })
    expect(coerceProfileValue('gender', '保密')).toEqual({ ok: true, value: 'undisclosed' })
    const bad = coerceProfileValue('gender', '高达')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('高达')
  })

  it('文本字段去掉首尾空白；超长按存储层的上限截断并说明', () => {
    expect(coerceProfileValue('major', '  计算机科学  ')).toEqual({ ok: true, value: '计算机科学' })
    const long = coerceProfileValue('skills', 'x'.repeat(500))
    expect(long.ok).toBe(true)
    if (long.ok) {
      expect(String(long.value).length).toBe(400)
      expect(long.note).toContain('400')
    }
  })

  it('空值与对象、布尔值一律拒（不能拿「有值」假装填过）', () => {
    expect(coerceProfileValue('education', '').ok).toBe(false)
    expect(coerceProfileValue('education', '   ').ok).toBe(false)
    expect(coerceProfileValue('education', null).ok).toBe(false)
    expect(coerceProfileValue('education', true).ok).toBe(false)
    expect(coerceProfileValue('education', { v: 'x' }).ok).toBe(false)
  })
})

describe('表单答案 → 画像', () => {
  const q = (id: string, field?: string) => ({ id, ...(field ? { userInfo: field } : {}) })

  it('简答取正文，选择取选项文字，多选连起来，「其他」的补充跟着走', () => {
    expect(answerTextOf({ id: 'q1', type: 'short', text: ' 大三 ' })).toBe('大三')
    expect(answerTextOf({ id: 'q1', type: 'single', picked: ['本科'] })).toBe('本科')
    expect(answerTextOf({ id: 'q1', type: 'multiple', picked: ['Python', 'SQL'] })).toBe('Python、SQL')
    expect(answerTextOf({ id: 'q1', type: 'single', other: '中专' })).toBe('中专')
    expect(answerTextOf({ id: 'q1', type: 'multiple', picked: ['A'], other: 'B' })).toBe('A、B')
  })

  it('只映射标了 userInfo 的题，其余答案不碰画像', () => {
    const r = patchFromAnswers(
      [q('q1', 'education'), q('q2')],
      [
        { id: 'q1', type: 'single', picked: ['本科'] },
        { id: 'q2', type: 'short', text: '想学微积分' },
      ],
    )
    expect(r.patch).toEqual({ education: '本科' })
    expect(r.applied).toEqual([{ field: 'education', label: '教育程度', value: '本科' }])
    expect(r.skipped).toEqual([])
  })

  it('留空不是错误：跳过并说明，不写空值进去', () => {
    const r = patchFromAnswers([q('q1', 'role')], [{ id: 'q1', type: 'short' }])
    expect(r.patch).toEqual({})
    expect(r.applied).toEqual([])
    expect(r.skipped[0]?.reason).toContain('留空')
  })

  it('一道题写不进去不影响别的题（绝不一票否决整张表单）', () => {
    const r = patchFromAnswers(
      [q('q1', 'age'), q('q2', 'skills'), q('q3', '身高')],
      [
        { id: 'q1', type: 'short', text: '很大' },
        { id: 'q2', type: 'short', text: 'Python' },
        { id: 'q3', type: 'short', text: '180' },
      ],
    )
    expect(r.patch).toEqual({ skills: 'Python' })
    expect(r.applied.map((a) => a.field)).toEqual(['skills'])
    expect(r.skipped.length).toBe(2)
    expect(r.skipped[0]?.reason).toContain('年龄')
    expect(r.skipped[1]?.reason).toContain('身高')
  })

  it('答案里没有这道题（被 when 藏起来 / 用户没翻到）也算留空', () => {
    const r = patchFromAnswers([q('q1', 'language')], [])
    expect(r.patch).toEqual({})
    expect(r.skipped[0]?.field).toBe('language')
  })
})
