/**
 * 暂存区（改了还没保存的正文）的单元用例。
 *
 * 钉的是「一条暂存该在什么时候出现、什么时候消失、改名时跟着谁走」。
 * 这几件事错了界面都不会报错：圆点该亮不亮、保存之后正文跳回旧版、改名把改动弄丢——
 * 用户只会觉得「这软件有时候会吃掉我写的东西」，而那是最不能出的一类问题。
 */
import { describe, expect, it } from 'vitest'

import {
  draftOf,
  dropDraft,
  dropDrafts,
  moveDraft,
  normalizeDrafts,
  putDraft,
  stageDraft,
  type Drafts,
} from '../src/learn/drafts'

describe('读一份暂存', () => {
  it('没有这一条就是 undefined（「没改过」只有这一个判据）', () => {
    expect(draftOf({}, 't:n1')).toBeUndefined()
    expect(draftOf(undefined, 't:n1')).toBeUndefined()
    expect(draftOf({ 't:n1': '正文' }, 't:n2')).toBeUndefined()
    expect(draftOf({ 't:n1': '正文' }, null)).toBeUndefined()
  })

  it('空串是一份有效的暂存：把正文删光也是改动', () => {
    expect(draftOf({ 't:n1': '' }, 't:n1')).toBe('')
  })
})

describe('记一笔改动', () => {
  it('与已保存的一模一样就不留这一条（改回原样，圆点自己灭）', () => {
    expect(stageDraft({}, 't:n1', '同一份', '同一份')).toEqual({})
    expect(stageDraft({ 't:n1': '改过的' }, 't:n1', '同一份', '同一份')).toEqual({})
  })

  it('不一样就记下来；内容没变时原样返回（不白换对象）', () => {
    const a = stageDraft({}, 't:n1', '改过的', '原来那份')
    expect(a).toEqual({ 't:n1': '改过的' })
    // 同一个对象：下游的 memo 靠它判断「要不要重算」
    expect(stageDraft(a, 't:n1', '改过的', '原来那份')).toBe(a)
  })

  it('put / drop 是它的两半：调用方自己判「还是不是改动过」', () => {
    const a = putDraft({}, 'l:C:/a.md', '改了')
    expect(a).toEqual({ 'l:C:/a.md': '改了' })
    expect(putDraft(a, 'l:C:/a.md', '改了')).toBe(a)
    expect(dropDraft(a, 'l:C:/a.md')).toEqual({})
    // 本来就没有这一条：原样返回
    expect(dropDraft(a, 't:别的')).toBe(a)
  })
})

describe('暂存跟着页签走', () => {
  it('改名搬家：键里含笔记名，名字换了键也得换（否则圆点没了、内容也回不来）', () => {
    const a: Drafts = { 'n:n1:旧名': '改到一半', 't:n1': '另一份' }
    expect(moveDraft(a, 'n:n1:旧名', 'n:n1:新名')).toEqual({ 'n:n1:新名': '改到一半', 't:n1': '另一份' })
  })

  it('没有那一份、或新旧同名时原样返回', () => {
    const a: Drafts = { 't:n1': 'x' }
    expect(moveDraft(a, 'n:n1:没有', 'n:n1:新名')).toBe(a)
    expect(moveDraft(a, 't:n1', 't:n1')).toBe(a)
  })

  it('页签没了（删笔记、删节点）：它的暂存一并清掉', () => {
    const a: Drafts = { 't:n1': 'x', 'n:n1:笔记': 'y', 't:n2': 'z' }
    expect(dropDrafts(a, ['t:n1', 'n:n1:笔记'])).toEqual({ 't:n2': 'z' })
    // 一个都没命中：原样返回
    expect(dropDrafts(a, ['t:没有'])).toBe(a)
    expect(dropDrafts(a, [])).toBe(a)
  })
})

describe('读回来的暂存区', () => {
  const ids = new Set(['n1'])

  it('形状不对的一律丢掉（state.json 是会被手改的）', () => {
    expect(normalizeDrafts(null, ids)).toEqual({})
    expect(normalizeDrafts('不是对象', ids)).toEqual({})
    expect(normalizeDrafts([1, 2], ids)).toEqual({})
    expect(normalizeDrafts({ 't:n1': 5, 't:n2': '正文' }, ids)).toEqual({})
  })

  it('指向已经不在的节点的丢掉；本地文件的键不查文件在不在', () => {
    const raw = { 't:n1': 'a', 'n:n1:笔记': 'b', 't:没了': 'c', 'n:没了:笔记': 'd', 'l:C:\\a.md': 'e' }
    expect(normalizeDrafts(raw, ids)).toEqual({ 't:n1': 'a', 'n:n1:笔记': 'b', 'l:C:\\a.md': 'e' })
  })

  it('空键丢掉，空正文留着（那是「把正文删光了」）', () => {
    expect(normalizeDrafts({ '': 'x', 't:n1': '' }, ids)).toEqual({ 't:n1': '' })
  })
})
