/**
 * 分组与分割的**不变量**：一组随机操作下来，布局与组之间不许脱节。
 *
 * 手写的用例只能覆盖想得到的那几条路，而这里要钉的是「无论怎么点都不该出现」的两件事：
 * 1. 布局里不许有**找不到对应组**的格子——那会画出一个空页签栏 + 空态，
 *    而它在 groups 里根本不存在，谁也收拾不掉（截图里那块「空分割区」就是这么来的）；
 * 2. 多于一格时不许有**空格子**与非空格子并存——空的那一格该当场消失。
 *
 * 用的是真函数、真序列（含跨格拖动、拖到边上分割、关页签、删节点式的批量关闭），
 * 每一步之后都验一遍。
 */
import { describe, expect, it } from 'vitest'

import type { TabRef } from '../src/learn/types'
import {
  FIRST_GROUP,
  activateIn,
  allTabs,
  closeIds,
  closeIn,
  emptyDocs,
  groupIdOfTab,
  groupIdsOf,
  groupOf,
  moveTab,
  openInGroup,
  reorderIn,
  setFocus,
  splitSpecOf,
  splitWith,
  type DocWorkspace,
  type DropZoneKind,
} from '../src/learn/groups'

const AT = 1700000000000
const teach = (id: string): TabRef => ({ kind: 'teach', nodeId: id })

/** 布局里的每个叶子都要有对应的组，且组与叶子一一对应 */
function leaves(docs: DocWorkspace): string[] {
  return groupIdsOf(docs.layout)
}

function check(docs: DocWorkspace, label: string): void {
  const ids = new Set(docs.groups.map((g) => g.id))
  // 有页签却没选中：那一格会显示「没有打开的文档」，而它的页签栏里明明有东西
  for (const g of docs.groups) {
    if (g.tabs.length) {
      expect(g.active, label + '：' + g.id + ' 有页签却没选中').not.toBeNull()
    }
  }
  for (const leaf of leaves(docs)) {
    expect(ids.has(leaf), label + '：布局里的格子 ' + leaf + ' 没有对应的组').toBe(true)
  }
  // 反过来：组也必须都在布局里（不在树上的组是渲染不出来的幽灵）
  for (const g of docs.groups) {
    expect(leaves(docs).includes(g.id), label + '：组 ' + g.id + ' 不在布局里').toBe(true)
  }
  if (docs.groups.length > 1) {
    for (const g of docs.groups) {
      expect(g.tabs.length, label + '：多于一格时不该有空格子 ' + g.id).toBeGreaterThan(0)
    }
  }
  // 焦点必须落在真实存在的组上
  expect(ids.has(docs.focus), label + '：焦点组不存在 ' + docs.focus).toBe(true)
  // 每个页签只能属于一个组
  const seen = new Set<string>()
  for (const g of docs.groups) {
    for (const t of g.tabs) {
      expect(seen.has(t.id), label + '：页签 ' + t.id + ' 同时属于两格').toBe(false)
      seen.add(t.id)
    }
  }
}

/** 极简伪随机：用例要可复现，别用 Math.random */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('分割的不变量（随机序列）', () => {
  it('连着做 400 步随机操作，布局与组始终对得上', () => {
    const rand = rng(20240924)
    const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)]
    let docs = emptyDocs()
    for (let i = 0; i < 12; i++) docs = openInGroup(docs, FIRST_GROUP, teach('n' + i), AT + i)
    check(docs, '起点')

    const zones: Exclude<DropZoneKind, 'center'>[] = ['left', 'right', 'top', 'bottom']
    for (let step = 0; step < 400; step++) {
      const groups = docs.groups
      const tabs = allTabs(docs)
      const op = Math.floor(rand() * 6)
      const label = '第 ' + step + ' 步'
      if (op === 0 || !tabs.length) {
        // 开一个页签（可能已经开着）
        docs = openInGroup(docs, pick(groups).id, teach('n' + Math.floor(rand() * 4)), AT + step)
      } else if (op === 1) {
        // 把一个页签拖到某一格的边上（= 拖拽分割）
        const zone = pick(zones)
        const spec = splitSpecOf(zone)
        docs = splitWith(docs, pick(groups).id, spec.dir, spec.side, pick(tabs).id)
      } else if (op === 2) {
        // 把一个页签拖进另一格
        docs = moveTab(docs, pick(tabs).id, pick(groups).id, rand() < 0.5 ? null : 0)
      } else if (op === 3) {
        // 关一个页签（四种关法）
        const id = pick(tabs).id
        const g = groupIdOfTab(docs, id) as string
        docs = closeIn(docs, g, id, pick(['self', 'left', 'right', 'others', 'all'] as const))
      } else if (op === 4) {
        // 批量关掉（agent 删节点那条路）
        const ids = tabs.filter(() => rand() < 0.3).map((t) => t.id)
        docs = closeIds(docs, ids)
      } else {
        const g = pick(groups)
        docs =
          rand() < 0.5
            ? reorderIn(docs, g.id, [...g.tabs.map((t) => t.id)].reverse())
            : rand() < 0.5
              ? activateIn(docs, g.id, pick(g.tabs.length ? g.tabs : tabs).id)
              : setFocus(docs, pick(groups).id)
      }
      check(docs, label)
    }
    // 收尾：全关掉之后仍然只剩一格（空态得有地方放）
    docs = closeIds(docs, allTabs(docs).map((t) => t.id))
    check(docs, '全关掉')
    expect(groupIdsOf(docs.layout)).toHaveLength(1)
  })

  it('把一格里仅有的页签拖到边上去：不留下空的原格', () => {
    let docs = openInGroup(emptyDocs(), FIRST_GROUP, teach('a'), AT)
    docs = splitWith(docs, FIRST_GROUP, 'row', 'after', 't:a')
    check(docs, 'takeOver')
    expect(allTabs(docs).map((t) => t.id)).toEqual(['t:a'])
  })

  it('拖出去的页签原本是激活项：原格要有新的落点，不能空着', () => {
    const rand = rng(7)
    let docs = emptyDocs()
    for (const id of ['a', 'b', 'c']) docs = openInGroup(docs, FIRST_GROUP, teach(id), AT)
    docs = activateIn(docs, FIRST_GROUP, 't:b')
    docs = splitWith(docs, FIRST_GROUP, 'col', 'after', 't:b')
    const src = groupOf(docs, FIRST_GROUP)
    expect(src?.tabs.map((t) => t.id)).toEqual(['t:a', 't:c'])
    // 被拖走的是激活项，原格必须自己挑一个（不能变成「有页签却什么都没选中」）
    expect(src?.active).not.toBeNull()
    expect(rand() >= 0).toBe(true)
  })
})
