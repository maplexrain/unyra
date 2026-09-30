/**
 * 笔记的单元用例：名字怎么取、改名撞车怎么办、写入落到哪一份。
 *
 * 这里的错都很难在界面上发现：名字里的非法字符若不当场换掉，落盘时会被系统拒绝或
 * 悄悄变形，于是「界面上的名字」与「磁盘上的文件」分成两个；重名不去重则会两份内容
 * 互相覆盖——那是真正会丢东西的一类。
 */
import { describe, expect, it } from 'vitest'

import type { KnowledgeNode, NoteFile } from '../src/learn/types'
import {
  addNoteTo,
  appendNoteIn,
  findNote,
  NOTE_DEFAULT_NAME,
  noteChars,
  removeNoteFrom,
  renameNoteIn,
  uniqueNoteName,
  writeNoteIn,
} from '../src/learn/notes'

const AT = 1700000000000

const node = (notes: NoteFile[]): KnowledgeNode => ({
  id: 'n1',
  title: '极限',
  key: '极限',
  description: '',
  docs: { teaching: '正文' },
  notes,
  annotations: [],
  status: 'learning',
  origin: 'user',
  goalId: 'g1',
  createdAt: AT,
  updatedAt: AT,
})

const note = (name: string, content = ''): NoteFile => ({
  name,
  content,
  createdAt: AT,
  updatedAt: AT,
})

describe('笔记取名', () => {
  it('不给名字就用默认名', () => {
    expect(uniqueNoteName([], '')).toBe(NOTE_DEFAULT_NAME)
    expect(uniqueNoteName([], '   ')).toBe(NOTE_DEFAULT_NAME)
  })

  it('名字里的非法字符在**进内存那一刻**就换掉（它同时是文件名）', () => {
    // 斜杠、冒号、问号这些在磁盘上根本建不出文件；不换掉就是「写得进去、读不回来」
    expect(uniqueNoteName([], '错题/整理')).toBe('错题_整理')
    expect(uniqueNoteName([], 'a:b*c?')).toBe('a_b_c_')
  })

  it('撞名自动加序号，且大小写不敏感', () => {
    // Windows 的磁盘不分大小写：Notes 与 notes 是同一个文件，不能当成两份
    expect(uniqueNoteName([note('笔记')], '笔记')).toBe('笔记 (2)')
    expect(uniqueNoteName([note('notes')], 'Notes')).toBe('Notes (2)')
    expect(uniqueNoteName([note('笔记'), note('笔记 (2)')], '笔记')).toBe('笔记 (3)')
  })
})

describe('新建 / 改名 / 删除', () => {
  it('新建是追加在末尾，并回最终用的名字', () => {
    const r = addNoteTo(node([note('笔记')]), '错题本', AT)
    expect(r.name).toBe('错题本')
    expect(r.node.notes.map((n) => n.name)).toEqual(['笔记', '错题本'])
    expect(r.node.notes[1].content).toBe('')
  })

  it('改名：正文与创建时间留着，只换名字', () => {
    const r = renameNoteIn(node([note('笔记', '内容')]), '笔记', '错题本', AT + 1)
    expect(r?.name).toBe('错题本')
    expect(r?.node.notes[0].content).toBe('内容')
    expect(r?.node.notes[0].createdAt).toBe(AT)
    expect(r?.node.notes[0].updatedAt).toBe(AT + 1)
  })

  it('改名撞上别人时自动让开，而不是整次操作失败', () => {
    const r = renameNoteIn(node([note('笔记'), note('错题本')]), '笔记', '错题本', AT)
    expect(r?.name).toBe('错题本 (2)')
  })

  it('改名成自己（只改了大小写）不算撞车', () => {
    const r = renameNoteIn(node([note('笔记', '内容')]), '笔记', '笔记', AT)
    expect(r?.name).toBe('笔记')
  })

  it('改一份不存在的笔记：回 null，让调用方去提示', () => {
    expect(renameNoteIn(node([]), '没有这份', '随便', AT)).toBeNull()
  })

  it('删除只动那一份', () => {
    const next = removeNoteFrom(node([note('笔记'), note('错题本')]), '笔记', AT)
    expect(next.notes.map((n) => n.name)).toEqual(['错题本'])
    // 大小写不敏感地找得到目标：Windows 上删「notes」就是删「Notes」
    const two = removeNoteFrom(node([note('Notes')]), 'notes', AT)
    expect(two.notes).toEqual([])
  })

  it('找一份笔记：名字前后空格与大小写都不计较', () => {
    const list = [note('错题本')]
    expect(findNote(list, ' 错题本 ')?.name).toBe('错题本')
    expect(findNote(list, '不存在')).toBeUndefined()
  })
})

describe('写入正文', () => {
  it('整篇写入换掉内容，别的笔记不受影响', () => {
    const next = writeNoteIn(node([note('笔记', '旧的'), note('错题本', '另一份')]), '笔记', '新的', AT)
    expect(next?.notes[0].content).toBe('新的')
    expect(next?.notes[1].content).toBe('另一份')
  })

  it('写一份已经不在了的笔记：回 null（改名之后旧名字就失效了）', () => {
    expect(writeNoteIn(node([note('错题本')]), '笔记', '内容', AT)).toBeNull()
  })

  it('追加：空行分隔，且把末尾空白吃掉再拼', () => {
    const r = appendNoteIn(node([note('笔记', '第一段\n\n  ')]), '笔记', '第二段', AT)
    expect(r.node.notes[0].content).toBe('第一段\n\n第二段')
  })

  it('往不存在的一份追加 = 新建它（「记到笔记里」不该得到一句「没有这份笔记」）', () => {
    const r = appendNoteIn(node([]), '错题本', '第一道错题', AT)
    expect(r.name).toBe('错题本')
    expect(r.node.notes).toHaveLength(1)
    expect(r.node.notes[0].content).toBe('第一道错题')
  })

  it('字数是去掉空白后的长度（列表上显示的那个数）', () => {
    expect(noteChars(note('笔记', '一 二\n三'))).toBe(3)
  })
})
