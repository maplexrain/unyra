/**
 * 收藏夹的单元用例。
 *
 * 钉的是「一条收藏的身份、三个入口的增删、显示名的现查」与读盘校验——
 * 身份算错的表现是「同一个网址能收藏两遍」或「取消收藏摘不掉」；
 * 校验漏了的表现是侧栏里躺着一堆点开是空白的死收藏。
 */
import { describe, expect, it } from 'vitest'

import type { FavoriteItem, FavoriteRef, KnowledgeNode } from '../src/learn/types'
import type { Exam } from '../src/learn/exam'
import {
  favoriteKey,
  favoriteKeyOfTab,
  favoriteRefOfTab,
  favoriteTitle,
  removeFavorite,
  removeFavoriteGroup,
  renameFavoriteGroup,
  renameWebFavorite,
  setFavoriteGroup,
  tabRefOfFavorite,
  toggleFavorite,
} from '../src/learn/favorites'
import { normalizeFavorites } from '../src/learn/store/normalize/tabs'
import { buildState } from '../src/learn/files/state'
import { emptyLearnStore } from '../src/learn/store/empty'
import { tabKey } from '../src/learn/tabs'

const at = 1700000000000

/** 造一个最小节点（校验只看 id / notes / superdocs） */
const node = (id: string, extra: Partial<KnowledgeNode> = {}): KnowledgeNode =>
  ({
    id,
    goalId: 'g1',
    title: '节点 ' + id,
    createdAt: at,
    updatedAt: at,
    ...extra,
  }) as KnowledgeNode

describe('收藏的身份', () => {
  it('前缀与 tabKey 对齐；网页收藏认网址而不是开签 key', () => {
    expect(favoriteKey({ kind: 'teach', nodeId: 'n1' })).toBe('t:n1')
    expect(favoriteKey({ kind: 'note', nodeId: 'n1', note: '错题本' })).toBe('n:n1:错题本')
    expect(favoriteKey({ kind: 'super', nodeId: 'n1', name: '实验' })).toBe('s:n1:实验')
    expect(favoriteKey({ kind: 'outline', nodeId: 'n1' })).toBe('o:n1')
    expect(favoriteKey({ kind: 'exam', nodeId: 'n1', examId: 'e1', attemptId: 'a1' })).toBe('e:e1:a1')
    expect(favoriteKey({ kind: 'local', path: 'C:\\a\\b.md' })).toBe('l:C:\\a\\b.md')
    // 同一网址、两枚不同 key 的页签 → 同一条收藏；标题/图标是展示信息，不参与身份
    expect(favoriteKey({ kind: 'web', url: 'https://a.dev' })).toBe('u:https://a.dev')
    expect(favoriteKey({ kind: 'web', url: 'https://a.dev', title: 'Python 文档', icon: 'https://a.dev/f.ico' })).toBe(
      'u:https://a.dev',
    )
    expect(favoriteKeyOfTab({ kind: 'web', url: 'https://a.dev', key: 'k1' })).toBe('u:https://a.dev')
    expect(favoriteKeyOfTab({ kind: 'web', url: 'https://a.dev', key: 'k2' })).toBe('u:https://a.dev')
    // 起始页没有网址，没有可收藏的东西
    expect(favoriteKeyOfTab({ kind: 'web', url: '', key: 'k1' })).toBeNull()
    // 网页收藏的身份与网页页签的身份是两回事（key 进 tabKey、不进 favoriteKey）
    expect(tabKey({ kind: 'web', url: 'https://a.dev', key: 'k1' })).toBe('w:k1')
  })

  it('页签 ↔ 收藏：网页只留网址、打开时现场开新签；其余原样', () => {
    expect(favoriteRefOfTab({ kind: 'web', url: 'https://a.dev', key: 'k1' })).toEqual({ kind: 'web', url: 'https://a.dev' })
    expect(favoriteRefOfTab({ kind: 'web', url: '', key: 'k1' })).toBeNull()
    expect(favoriteRefOfTab({ kind: 'teach', nodeId: 'n1' })).toEqual({ kind: 'teach', nodeId: 'n1' })

    const ref = tabRefOfFavorite({ kind: 'web', url: 'https://a.dev' })
    expect(ref.kind === 'web' && ref.url === 'https://a.dev' && ref.key.length > 0).toBe(true)
    // 每次打开都是一次新的开签（key 不同），网址相同
    expect(tabRefOfFavorite({ kind: 'web', url: 'https://a.dev' })).not.toEqual(ref)
    expect(tabRefOfFavorite({ kind: 'local', path: 'C:\\a.md' })).toEqual({ kind: 'local', path: 'C:\\a.md' })
  })
})

describe('收藏 / 取消收藏', () => {
  it('没收藏过排到末尾；收藏过（比身份）就摘掉', () => {
    const a: FavoriteRef = { kind: 'teach', nodeId: 'n1' }
    const b: FavoriteRef = { kind: 'web', url: 'https://a.dev' }
    const list = toggleFavorite([], a, at)
    expect(list).toEqual([{ kind: 'teach', nodeId: 'n1', at }])
    const both = toggleFavorite(list, b, at + 1)
    expect(both.map((f) => favoriteKey(f))).toEqual(['t:n1', 'u:https://a.dev'])
    // 再 toggle 一次 = 取消收藏
    expect(removeFavorite(toggleFavorite(both, a, at), favoriteKey(a))).toEqual([
      { kind: 'web', url: 'https://a.dev', at: at + 1 },
    ])
  })

  it('同一网址的第二枚页签看到的是「已收藏」，取消也摘的是同一条', () => {
    const list = toggleFavorite([], { kind: 'web', url: 'https://a.dev' }, at)
    // 另一枚 key 不同的页签指向同一网址：favoriteKeyOfTab 相同 → 已收藏
    const key = favoriteKeyOfTab({ kind: 'web', url: 'https://a.dev', key: 'other' })
    expect(removeFavorite(list, key as string)).toEqual([])
  })

  it('removeFavorite 摘掉目标、其余原样保留', () => {
    const list: FavoriteItem[] = [
      { kind: 'teach', nodeId: 'n1', at },
      { kind: 'local', path: 'C:\\a.md', at: at + 1 },
    ]
    expect(removeFavorite(list, 'l:C:\\a.md')).toEqual([{ kind: 'teach', nodeId: 'n1', at }])
    expect(removeFavorite(list, 'l:C:\\gone.md')).toEqual(list)
  })
})

describe('收藏的标题（现查）', () => {
  const nodeTitle = (id: string) => (id === 'n1' ? '夹逼定理' : undefined)
  const examTitle = (examId: string, attemptId: string) =>
    examId === 'e1' && attemptId === 'a1' ? '《极限小考》8/12' : undefined

  it('节点类现查节点名；试卷查考试名', () => {
    expect(favoriteTitle({ kind: 'teach', nodeId: 'n1' }, nodeTitle, examTitle)).toBe('夹逼定理')
    expect(favoriteTitle({ kind: 'outline', nodeId: 'n1' }, nodeTitle, examTitle)).toBe('夹逼定理 · 大纲')
    expect(favoriteTitle({ kind: 'exam', nodeId: 'n1', examId: 'e1', attemptId: 'a1' }, nodeTitle, examTitle)).toBe('《极限小考》8/12')
    // 节点已删除、考试查不到：给兜底文案而不是 undefined
    expect(favoriteTitle({ kind: 'teach', nodeId: 'gone' }, nodeTitle, examTitle)).toBeTruthy()
    expect(favoriteTitle({ kind: 'exam', nodeId: 'n1', examId: 'x', attemptId: 'y' }, nodeTitle, examTitle)).toBeTruthy()
  })

  it('网页优先显示收藏那一刻记下的标题，没记下退回域名；本地文件显示文件名；笔记与超级文档用名字', () => {
    expect(favoriteTitle({ kind: 'web', url: 'https://docs.python.org/3/', title: 'Python 3 文档' }, nodeTitle)).toBe('Python 3 文档')
    expect(favoriteTitle({ kind: 'web', url: 'https://docs.python.org/3/' }, nodeTitle)).toBe('docs.python.org')
    expect(favoriteTitle({ kind: 'web', url: '不是网址' }, nodeTitle)).toBe('不是网址')
    expect(favoriteTitle({ kind: 'local', path: 'C:\\a\\b\\notes.md' }, nodeTitle)).toBe('notes.md')
    expect(favoriteTitle({ kind: 'note', nodeId: 'n1', note: '错题本' }, nodeTitle)).toBe('错题本')
    expect(favoriteTitle({ kind: 'super', nodeId: 'n1', name: '实验' }, nodeTitle)).toBe('实验')
  })
})

describe('读盘校验（normalizeFavorites）', () => {
  const exams: Exam[] = [
    {
      id: 'e1',
      nodeId: 'n1',
      title: '极限小考',
      createdAt: at,
      questions: [],
      attempts: [{ id: 'a1', startedAt: at, answers: [] }],
    },
  ] as unknown as Exam[]
  const byId = new Map([
    ['n1', node('n1', { notes: [{ name: '错题本', createdAt: at } as KnowledgeNode['notes'][number]] })],
    ['n2', node('n2')],
  ])

  it('指向已不存在东西的收藏丢掉；形状不合法的丢掉', () => {
    const out = normalizeFavorites(
      [
        { kind: 'teach', nodeId: 'n1', at },
        { kind: 'teach', nodeId: 'gone', at }, // 节点没了
        { kind: 'note', nodeId: 'n1', note: '改名了的笔记', at }, // 笔记名对不上
        { kind: 'note', nodeId: 'n1', note: '错题本', at },
        { kind: 'exam', nodeId: 'n1', examId: 'e1', attemptId: 'a1', at },
        { kind: 'exam', nodeId: 'n1', examId: 'e1', attemptId: 'gone', at }, // 没考过这一次
        { kind: 'web', url: 'javascript:alert(1)', at }, // 只认 http(s)
        { kind: 'web', url: 'https://a.dev', at },
        { kind: 'local', path: '', at }, // 空路径
        null,
        '垃圾',
      ],
      byId,
      exams,
    )
    expect(out.map((f) => favoriteKey(f))).toEqual(['t:n1', 'n:n1:错题本', 'e:e1:a1', 'u:https://a.dev'])
  })

  it('同一身份只留一条（先来的赢）；at 缺失补当前时间', () => {
    const out = normalizeFavorites(
      [
        { kind: 'teach', nodeId: 'n1', at },
        { kind: 'teach', nodeId: 'n1', at: at + 9 },
        { kind: 'web', url: 'https://a.dev' },
      ],
      byId,
      exams,
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ kind: 'teach', nodeId: 'n1', at })
    expect(out[1].at).toBeGreaterThan(0)
  })

  it('网页收藏的标题与站点图标：合法的留着、超长截断、形状不对的弃掉（身份仍只认网址）', () => {
    const out = normalizeFavorites(
      [
        { kind: 'web', url: 'https://a.dev', title: '  Python 文档  ', icon: 'https://a.dev/f.ico', at },
        { kind: 'web', url: 'https://b.dev', title: 'x'.repeat(500), at },
        { kind: 'web', url: 'https://c.dev', icon: 'javascript:alert(1)', at },
        { kind: 'web', url: 'https://d.dev', title: 42, icon: 7, at },
      ],
      byId,
      exams,
    )
    expect(out[0]).toEqual({ kind: 'web', url: 'https://a.dev', title: 'Python 文档', icon: 'https://a.dev/f.ico', at })
    expect(out[1]).toEqual({ kind: 'web', url: 'https://b.dev', title: 'x'.repeat(200), at })
    expect(out[2]).toEqual({ kind: 'web', url: 'https://c.dev', at })
    expect(out[3]).toEqual({ kind: 'web', url: 'https://d.dev', at })
  })

  it('不是数组返回空', () => {
    expect(normalizeFavorites(null, byId, exams)).toEqual([])
    expect(normalizeFavorites('x', byId, exams)).toEqual([])
  })
})

describe('落盘往返（buildState）', () => {
  it('有收藏写出；空收藏不写（空字段只会让人以为收藏过什么）', () => {
    const withFavs = { ...emptyLearnStore(), favorites: [{ kind: 'web', url: 'https://a.dev', at }] as FavoriteItem[] }
    expect(buildState(withFavs).favorites).toEqual([{ kind: 'web', url: 'https://a.dev', at }])
    expect('favorites' in buildState(emptyLearnStore())).toBe(false)
  })
})

describe('分组文件夹', () => {
  const web = (url: string, group?: string): FavoriteItem =>
    ({ kind: 'web', url, at, ...(group ? { group } : {}) })
  const list = (): FavoriteItem[] => [web('https://a.dev'), web('https://b.dev', '文档'), web('https://c.dev', '文档')]

  it('移入 / 移出：只动目标那一条，身份不变', () => {
    const next = setFavoriteGroup(list(), 'u:https://a.dev', '资料')
    expect(next[0]).toEqual({ kind: 'web', url: 'https://a.dev', at, group: '资料' })
    expect(next[1]).toEqual({ kind: 'web', url: 'https://b.dev', at, group: '文档' })
    // 移回顶层：group 字段整个摘掉（不是存空串）
    const back = setFavoriteGroup(next, 'u:https://a.dev', null)
    expect(back[0]).toEqual({ kind: 'web', url: 'https://a.dev', at })
  })

  it('改组名：成员原样跟着走', () => {
    const next = renameFavoriteGroup(list(), '文档', '学习资料')
    expect(next.map((f) => f.group)).toEqual([undefined, '学习资料', '学习资料'])
    // 名字没变（或清成了空）就不动
    expect(renameFavoriteGroup(list(), '文档', '文档')).toEqual(list())
  })

  it('拆组：成员回顶层，一条不丢', () => {
    const next = removeFavoriteGroup(list(), '文档')
    expect(next).toHaveLength(3)
    expect(next.every((f) => !f.group)).toBe(true)
  })

  it('改网页收藏的显示名：只认 web、清掉空白不动', () => {
    const next = renameWebFavorite(list(), 'u:https://a.dev', '  Unyra 仓库  ')
    expect(next[0].kind === 'web' && next[0].title).toBe('Unyra 仓库')
    expect(renameWebFavorite(list(), 'u:https://a.dev', '   ')).toEqual(list())
    // 本地文件没有可存的显示名，不动
    const locals: FavoriteItem[] = [{ kind: 'local', path: 'C:\\a.md', at }]
    expect(renameWebFavorite(locals, 'l:C:\\a.md', 'x')).toEqual(locals)
  })

  it('normalize 读盘：group 合法的保留、形状不对的当没有', () => {
    const out = normalizeFavorites(
      [
        { kind: 'web', url: 'https://a.dev', at, group: '  资料站  ' },
        { kind: 'web', url: 'https://b.dev', at, group: '   ' },
        { kind: 'web', url: 'https://c.dev', at, group: 42 },
        { kind: 'web', url: 'https://d.dev', at, group: 'x'.repeat(80) },
      ],
      new Map(),
      [],
    )
    expect(out[0]).toMatchObject({ url: 'https://a.dev', group: '资料站' })
    expect(out[1]).toEqual({ kind: 'web', url: 'https://b.dev', at })
    expect(out[2]).toEqual({ kind: 'web', url: 'https://c.dev', at })
    expect(out[3].group).toHaveLength(64)
  })
})
