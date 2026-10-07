/**
 * 文档区分组与分割的单元用例（见 src/learn/groups.ts）。
 *
 * 这一层错了，界面上是「页签跑丢了 / 那一格再也点不动 / 关掉一个页签整块屏幕空了」——
 * 都不是报错，而是「东西不见了」，最难查的一类。所以凡是「关掉之后谁接管焦点」
 * 「拖走最后一个页签那一格还在不在」这类判断，都在这里钉住。
 */
import { describe, expect, it } from 'vitest'

import type { LearnTab, TabRef } from '../src/learn/types'
import {
  FIRST_GROUP,
  activateIn,
  activeIdsOf,
  allTabs,
  closeIds,
  closeIn,
  emptyDocs,
  findSplit,
  findTab,
  focusedGroup,
  focusedTab,
  groupIdOfTab,
  groupIdsOf,
  groupOf,
  landingAfter,
  moveTab,
  normalizeDocs,
  openInGroup,
  renameTabRef,
  reorderIn,
  resizePair,
  setFocus,
  setSizes,
  splitSpecOf,
  splitWith,
  zoneAtPoint,
} from '../src/learn/groups'

const AT = 1700000000000

/** 造一个页签（id 规则与 learn/tabs 的 tabKey 一致：t:/n:/o:/l: 前缀 + 指向的东西） */
const tab = (ref: TabRef): LearnTab => ({
  id:
    ref.kind === 'teach'
      ? 't:' + ref.nodeId
      : ref.kind === 'note'
        ? 'n:' + ref.nodeId + ':' + ref.note
        : ref.kind === 'super'
          ? 's:' + ref.nodeId + ':' + ref.name
          : ref.kind === 'exam'
            ? 'e:' + ref.examId + ':' + ref.attemptId
            : ref.kind === 'outline'
            ? 'o:' + ref.nodeId
            : ref.kind === 'web'
              ? 'w:' + ref.key
              : ref.kind === 'guard'
                ? 'g:guard'
                : ref.kind === 'report'
                  ? 'r:' + ref.reportId
                  : ref.kind === 'settings'
                    ? 'set:settings'
                    : ref.kind === 'usage'
                      ? 'u:usage'
                      : ref.kind === 'mind'
                        ? 'm:mind'
                        : ref.kind === 'agentSettings'
                          ? 'set:agent'
                          : ref.kind === 'local'
                            ? 'l:' + ref.path
                            : '',
  ref,
  createdAt: AT,
})

const teach = (id: string): TabRef => ({ kind: 'teach', nodeId: id })
const local = (path: string): TabRef => ({ kind: 'local', path })
const idOf = (ref: TabRef): string => tab(ref).id

/** 单组、塞进几个页签：多数用例的起点 */
function withTabs(...refs: TabRef[]) {
  let docs = emptyDocs()
  for (const ref of refs) docs = openInGroup(docs, FIRST_GROUP, ref, AT)
  return docs
}

describe('emptyDocs / 读', () => {
  it('空库就是一组、没有页签，焦点也在它身上', () => {
    const docs = emptyDocs()
    expect(groupIdsOf(docs.layout)).toEqual([FIRST_GROUP])
    expect(allTabs(docs)).toEqual([])
    expect(focusedTab(docs)).toBeNull()
    expect(activeIdsOf(docs)).toEqual([])
  })

  it('allTabs 按布局顺序排（左格那一排在前面）', () => {
    let docs = withTabs(teach('a'), teach('b'), teach('c'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', idOf(teach('c')))
    expect(allTabs(docs).map((t) => t.id)).toEqual(['t:a', 't:b', 't:c'])
    // 焦点在新拆出来的那一格（用户接下来一定想在那里开点什么）
    expect(focusedTab(docs)?.id).toBe('t:c')
  })

  it('焦点指着一个不存在的组时退回第一组（state.json 被手改过也站得住）', () => {
    const docs = { ...withTabs(teach('a')), focus: 'nope' }
    expect(focusedGroup(docs).id).toBe(FIRST_GROUP)
  })
})

describe('openInGroup（打开与激活）', () => {
  it('在指定那一格末尾追加，并把它设为激活', () => {
    const docs = openInGroup(emptyDocs(), FIRST_GROUP, teach('a'), AT)
    expect(groupOf(docs, FIRST_GROUP)?.tabs.map((t) => t.id)).toEqual(['t:a'])
    expect(focusedTab(docs)?.id).toBe('t:a')
  })

  it('已经开着的页签不再开第二份，而是把焦点挪到它所在的那一格', () => {
    // 先把 b 拆到第二格去（拖页签分割的唯一方式就是带着一个页签）
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', 't:b')
    const second = docs.focus
    docs = openInGroup(docs, second, local('C:/x.md'), AT)
    docs = setFocus(docs, FIRST_GROUP)
    // 从第一格再开一次 a：不新增，焦点回到它所在的那一格
    const before = allTabs(docs).length
    docs = openInGroup(docs, second, teach('a'), AT)
    expect(allTabs(docs).length).toBe(before)
    expect(docs.focus).toBe(FIRST_GROUP)
    expect(focusedTab(docs)?.id).toBe('t:a')
  })

  it('指定的那一格已经不在了就退回焦点格', () => {
    const docs = openInGroup(emptyDocs(), 'ghost', teach('a'), AT)
    expect(groupIdOfTab(docs, 't:a')).toBe(FIRST_GROUP)
  })
})

describe('分割（splitWith）', () => {
  it('把拖来的页签放到新格里，并把它从原格摘掉', () => {
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', idOf(teach('b')))
    expect(groupIdsOf(docs.layout)).toHaveLength(2)
    expect(groupOf(docs, FIRST_GROUP)?.tabs.map((t) => t.id)).toEqual(['t:a'])
    expect(focusedTab(docs)?.id).toBe('t:b')
  })

  it('拖的是目标格仅有的那个页签：位置不变，只是换了一格装着它', () => {
    let docs = withTabs(teach('a'))
    const before = docs.layout
    docs = splitWith(docs, FIRST_GROUP, 'col', 'before', idOf(teach('a')))
    // 布局还是「一个叶子」，只是那个叶子的组 id 换了
    expect(docs.layout.kind).toBe('group')
    expect(docs.layout).not.toEqual(before)
    expect(groupIdsOf(docs.layout)).toHaveLength(1)
    expect(focusedTab(docs)?.id).toBe('t:a')
  })

  it('左右贴边是并排（row），上下贴边是叠放（col）', () => {
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'col', 'after', idOf(teach('b')))
    expect(docs.layout.kind).toBe('split')
    if (docs.layout.kind === 'split') {
      expect(docs.layout.dir).toBe('col')
      expect(docs.layout.sizes).toEqual([0.5, 0.5])
    }
  })

  it('同方向再分一次会摊平成兄弟，不会一层套一层', () => {
    let docs = withTabs(teach('a'), teach('b'), teach('c'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', idOf(teach('b')))
    const second = groupIdOfTab(docs, 't:b') as string
    docs = splitWith(docs, second, 'row', 'after', idOf(teach('c')))
    expect(docs.layout.kind).toBe('split')
    if (docs.layout.kind === 'split') {
      expect(docs.layout.children).toHaveLength(3)
      expect(groupIdsOf(docs.layout)).toHaveLength(3)
    }
  })

  it('找不到那个页签时原样返回：界面里不留空格子', () => {
    const docs = withTabs(teach('a'))
    // 拖动那一头同时被关掉了（或者 id 是旧的）：宁可不生效，也不拆出一个空分割区
    expect(splitWith(docs, FIRST_GROUP, 'row', 'after', 't:zzz')).toBe(docs)
    expect(splitWith(docs, 'ghost', 'row', 'after', 't:a')).toBe(docs)
    expect(groupIdsOf(docs.layout)).toHaveLength(1)
  })
})

describe('关页签（closeIn / closeIds）', () => {
  it('只剩一格时，关光了留着那个空格子（空态还有地方可放）', () => {
    const docs = closeIn(withTabs(teach('a')), FIRST_GROUP, 't:a', 'self')
    expect(groupIdsOf(docs.layout)).toEqual([FIRST_GROUP])
    expect(allTabs(docs)).toEqual([])
  })

  it('多于一格时，关空了的那一格当场消失，兄弟铺满', () => {
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', idOf(teach('b')))
    const second = docs.focus
    docs = closeIn(docs, second, 't:b', 'self')
    expect(groupIdsOf(docs.layout)).toEqual([FIRST_GROUP])
    expect(groupOf(docs, FIRST_GROUP)?.tabs.map((t) => t.id)).toEqual(['t:a'])
  })

  it('关掉的那一个是激活项时，落点按「往右找最近的一个」', () => {
    const docs = closeIn(withTabs(teach('a'), teach('b'), teach('c')), FIRST_GROUP, 't:b', 'self')
    expect(focusedTab(docs)?.id).toBe('t:c')
  })

  it('closeIds 一次关掉散在好几格里的页签（agent 删了一棵子树）', () => {
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', idOf(teach('b')))
    docs = closeIds(docs, ['t:a', 't:b'])
    // 两格都空了：留最后收剩下的那一格（不然屏幕上什么都没有了）
    expect(groupIdsOf(docs.layout)).toHaveLength(1)
    expect(allTabs(docs)).toEqual([])
  })

  it('关掉一半时只收掉空掉的那一格', () => {
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', idOf(teach('b')))
    docs = closeIds(docs, ['t:b'])
    expect(groupIdsOf(docs.layout)).toEqual([FIRST_GROUP])
    expect(groupOf(docs, FIRST_GROUP)?.tabs.map((t) => t.id)).toEqual(['t:a'])
  })
})

describe('落点接管（landingAfter）', () => {
  it('先往右找最近的一个，右边没有了才往左（与关页签同一条规则）', () => {
    const list = [tab(teach('a')), tab(teach('b')), tab(teach('c'))]
    const kept = [list[0], list[2]]
    expect(landingAfter(list, 't:b', kept)).toBe('t:c')
    expect(landingAfter(list, 't:c', kept)).toBe('t:a')
    expect(landingAfter(list, 't:a', kept)).toBe('t:c')
  })

  it('被拖走的正好是原格当前看的那一份：原格接上邻居，而不是变成空态', () => {
    let docs = withTabs(teach('a'), teach('b'), teach('c'))
    docs = activateIn(docs, FIRST_GROUP, 't:b')
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', 't:b')
    const src = groupOf(docs, FIRST_GROUP)
    expect(src?.tabs.map((t) => t.id)).toEqual(['t:a', 't:c'])
    expect(src?.active).toBe('t:c')
    // 被拖走的那一个在新格里是激活的
    expect(focusedTab(docs)?.id).toBe('t:b')
  })
})

describe('移动与重排', () => {
  it('跨格移动：原格空了就消失，目标格激活它', () => {
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', 't:b')
    const second = docs.focus
    docs = openInGroup(docs, second, local('C:/n.md'), AT)
    // 把第一格仅有的那个页签拖过去：那一格随之消失，只剩目标格
    docs = moveTab(docs, 't:a', second, null)
    expect(groupIdsOf(docs.layout)).toEqual([second])
    expect(groupOf(docs, second)?.tabs.map((t) => t.id)).toEqual(['t:b', 'l:C:/n.md', 't:a'])
    expect(focusedTab(docs)?.id).toBe('t:a')
  })

  it('跨格移动：原格还剩东西时留着，顺序按 index 插', () => {
    let docs = withTabs(teach('a'), teach('b'), teach('c'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', 't:c')
    const second = docs.focus
    docs = openInGroup(docs, second, local('C:/n.md'), AT)
    docs = moveTab(docs, 't:a', second, 0)
    expect(groupIdsOf(docs.layout)).toEqual([FIRST_GROUP, second])
    expect(groupOf(docs, FIRST_GROUP)?.tabs.map((t) => t.id)).toEqual(['t:b'])
    expect(groupOf(docs, second)?.tabs.map((t) => t.id)).toEqual(['t:a', 't:c', 'l:C:/n.md'])
  })

  it('栏内重排只动顺序，不动激活项', () => {
    const docs = reorderIn(withTabs(teach('a'), teach('b'), teach('c')), FIRST_GROUP, [
      't:c',
      't:a',
      't:b',
    ])
    expect(groupOf(docs, FIRST_GROUP)?.tabs.map((t) => t.id)).toEqual(['t:c', 't:a', 't:b'])
    // 激活的是最后打开的那一个（openInGroup 每次都会激活），顺序变了它没变
    expect(focusedTab(docs)?.id).toBe('t:c')
  })
})

describe('改名（renameTabRef）', () => {
  it('把页签本身与它所在那一格的激活项一起改名', () => {
    const docs = withTabs({ kind: 'note', nodeId: 'n1', note: '旧' })
    const next = renameTabRef(docs, { kind: 'note', nodeId: 'n1', note: '旧' }, { kind: 'note', nodeId: 'n1', note: '新' })
    expect(groupOf(next, FIRST_GROUP)?.tabs.map((t) => t.id)).toEqual(['n:n1:新'])
    expect(groupOf(next, FIRST_GROUP)?.active).toBe('n:n1:新')
  })
})

describe('分割线的占比', () => {
  it('resizePair 只动相邻两格，加起来仍然是原来的和', () => {
    const sizes = resizePair([0.2, 0.3, 0.5], 1, 0.1)
    expect(sizes[0]).toBeCloseTo(0.3)
    expect(sizes[1]).toBeCloseTo(0.2)
    expect(sizes[2]).toBeCloseTo(0.5)
  })

  it('两边各留下限：拖到 0 那一格就再也抓不回来了', () => {
    const sizes = resizePair([0.5, 0.5], 1, -10)
    expect(sizes[0]).toBeGreaterThan(0)
    expect(sizes[1]).toBeGreaterThan(0)
    expect(sizes[0] + sizes[1]).toBeCloseTo(1)
  })

  it('setSizes 归一之后写进那一层（按 id 找）', () => {
    let docs = withTabs(teach('a'), teach('b'))
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', idOf(teach('b')))
    const splitId = (docs.layout as { id: string }).id
    docs = setSizes(docs, splitId, [1, 3])
    const split = findSplit(docs.layout, splitId)
    expect(split?.sizes).toEqual([0.25, 0.75])
  })
})

describe('读盘（normalizeDocs）', () => {
  // 与 store 的 normalizeTab 同一条口径：认不出的 kind 一律丢掉（不是收下再说）
  const tabOf = (raw: unknown): LearnTab | null => {
    const ref = (raw as { ref?: TabRef } | null)?.ref
    if (!ref) return null
    return ref.kind === 'teach' || ref.kind === 'local' ? tab(ref) : null
  }

  it('旧版形状（顶层的 tabs + activeTab）折成单组', () => {
    const docs = normalizeDocs(undefined, { tabs: [{ ref: teach('a') }], activeTab: 't:a' }, tabOf)
    expect(groupIdsOf(docs.layout)).toEqual([FIRST_GROUP])
    expect(focusedTab(docs)?.id).toBe('t:a')
  })

  it('认不出的组、重复的页签、坏掉的树都丢掉', () => {
    const docs = normalizeDocs(
      {
        groups: [
          { id: 'g1', tabs: [{ ref: teach('a') }], active: 't:a' },
          { id: 'g1', tabs: [{ ref: teach('b') }], active: 't:b' },
          // g2：第一个页签与 g1 重复（丢掉）、第二个认不出（丢掉）、第三个才是它自己的
          {
            id: 'g2',
            tabs: [{ ref: teach('a') }, { ref: { kind: 'bogus' } }, { ref: local('C:/x.md') }],
            active: 'nope',
          },
        ],
        layout: { kind: 'split', id: 's1', dir: 'col', children: [{ kind: 'group', group: 'g9' }] },
        focus: 'g2',
      },
      {},
      tabOf,
    )
    expect(docs.groups.map((g) => g.id)).toEqual(['g1', 'g2'])
    // 树里认不出任何东西 → 退回第一组；g2 没被树提到 → 补到最右边
    expect(groupIdsOf(docs.layout)).toEqual(['g1', 'g2'])
    expect(groupOf(docs, 'g2')?.tabs.map((t) => t.id)).toEqual(['l:C:/x.md'])
    // 激活项指向一个不存在的页签 → 回落成这一格最后一个
    expect(groupOf(docs, 'g2')?.active).toBe('l:C:/x.md')
    expect(focusedGroup(docs).id).toBe('g2')
  })

  it('页签全部认不出时退回一个干净的空库', () => {
    const docs = normalizeDocs({ groups: [{ id: 'g1', tabs: [{}], active: null }] }, {}, tabOf)
    expect(docs.groups).toHaveLength(1)
    expect(allTabs(docs)).toEqual([])
  })

  it('往返：拆分出来的布局再读回来还是那个样子', () => {
    let docs = withTabs(teach('a'), teach('b'), local('C:/x.md'))
    docs = splitWith(docs, FIRST_GROUP, 'col', 'after', idOf(teach('b')))
    const raw = JSON.parse(JSON.stringify(docs)) as unknown
    const back = normalizeDocs(raw, {}, tabOf)
    expect(back.groups.map((g) => g.tabs.map((t) => t.id))).toEqual(
      docs.groups.map((g) => g.tabs.map((t) => t.id)),
    )
    expect(back.focus).toBe(docs.focus)
    expect((back.layout as { dir: string }).dir).toBe('col')
  })
})

describe('拖页签的落点（zoneAtPoint / splitSpecOf）', () => {
  const box = { left: 100, top: 50, width: 400, height: 300 }

  it('格子外面不算落点', () => {
    expect(zoneAtPoint(box, 99, 200)).toBeNull()
    expect(zoneAtPoint(box, 200, 49)).toBeNull()
    expect(zoneAtPoint(box, 501, 200)).toBeNull()
    expect(zoneAtPoint(box, 200, 351)).toBeNull()
  })

  it('四条边各认各的，正中间是「放进这一格」', () => {
    expect(zoneAtPoint(box, 110, 200)).toBe('left')
    expect(zoneAtPoint(box, 490, 200)).toBe('right')
    expect(zoneAtPoint(box, 300, 60)).toBe('top')
    expect(zoneAtPoint(box, 300, 340)).toBe('bottom')
    expect(zoneAtPoint(box, 300, 200)).toBe('center')
  })

  it('角落按最近的那一条边算（不是按先后顺序）', () => {
    // 贴着左上角但更靠上边
    expect(zoneAtPoint(box, 130, 55)).toBe('top')
    // 贴着右下角但更靠右边
    expect(zoneAtPoint(box, 495, 330)).toBe('right')
  })

  it('边界点也算在格子里（贴着格边松手不该落空）', () => {
    expect(zoneAtPoint(box, 100, 200)).toBe('left')
    expect(zoneAtPoint(box, 500, 200)).toBe('right')
  })

  it('落点 → 拆分方式：左右并排、上下叠放，且新格摆对那一侧', () => {
    expect(splitSpecOf('left')).toEqual({ dir: 'row', side: 'before' })
    expect(splitSpecOf('right')).toEqual({ dir: 'row', side: 'after' })
    expect(splitSpecOf('top')).toEqual({ dir: 'col', side: 'before' })
    expect(splitSpecOf('bottom')).toEqual({ dir: 'col', side: 'after' })
  })
})

describe('杂项', () => {
  it('findTab 找得到任何一格里的页签；groupOf / groupIdOfTab 对不存在的东西返回空', () => {
    const docs = withTabs(teach('a'))
    expect(findTab(docs, 't:a')?.id).toBe('t:a')
    expect(findTab(docs, 't:zzz')).toBeUndefined()
    expect(groupOf(docs, 'nope')).toBeUndefined()
    expect(groupIdOfTab(docs, 'nope')).toBeNull()
  })

  it('activateIn 只认那一格里真有的页签', () => {
    const docs = withTabs(teach('a'))
    expect(activateIn(docs, FIRST_GROUP, 't:zzz').focus).toBe(docs.focus)
    expect(activateIn(docs, 'ghost', 't:a')).toBe(docs)
  })
})
