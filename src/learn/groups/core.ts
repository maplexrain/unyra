/** 这个文件负责：工作区级不可变更新的地基——按 id 找组、打补丁、每次收尾的 settle 与 setSizes（各模块都从这里取） */

import { FIRST_GROUP, attachMissing, groupIdsOf, mapSplit, normalizeSizes, removeLeaf } from './layout'
import type { DocGroup, DocLayout, DocWorkspace } from './types'

export function groupOf(docs: DocWorkspace, id: string): DocGroup | undefined {
  return docs.groups.find((g) => g.id === id)
}

/* ---------- 写：基础 ---------- */

/** 换掉 groups / focus / layout 里的某一项：顺手把焦点兜回一个真的存在的组 */
export function withDocs(docs: DocWorkspace, patch: Partial<DocWorkspace>): DocWorkspace {
  const next = { ...docs, ...patch }
  return { ...next, focus: groupOf(next, next.focus) ? next.focus : (next.groups[0]?.id ?? FIRST_GROUP) }
}

export function withGroup(docs: DocWorkspace, id: string, fn: (g: DocGroup) => DocGroup): DocWorkspace {
  return withDocs(docs, { groups: docs.groups.map((g) => (g.id === id ? fn(g) : g)) })
}

/**
 * 把工作区**收拾干净**：每个操作的最后一步都走这里。
 *
 * 两件事，都是「无论怎么点都不该出现」的状态：
 *
 * 1. **空格子**：多于一格时它只是一块空白（页签栏空着、正文写着「没有打开的文档」），
 *    而用户在那一格里什么也做不了——收掉它，兄弟那一格自然铺满。
 *    只剩一格时**留着**：那是「一个文档都没开」的那一屏，空态总得有地方放。
 * 2. **有页签却没选中**（active 为 null）：那一格会显示空态，而它的页签栏明明有东西——
 *    看起来就像「文档丢了」。把最后一个页签当落点（关页签用的是更讲究的落点规则，
 *    见 closeTabs；这里只是兜底，正常路径不会走到）。
 *
 * 因为所有操作都过这一道，「页签还在、格子却空了」这种状态在数据层就构造不出来。
 */
export function settle(docs: DocWorkspace): DocWorkspace {
  const repaired = docs.groups.some((g) => g.tabs.length > 0 && !g.active)
    ? {
        ...docs,
        groups: docs.groups.map((g) =>
          g.tabs.length && !g.active ? { ...g, active: g.tabs[g.tabs.length - 1].id } : g,
        ),
      }
    : docs
  /*
   * 布局树里没提到的组：补到最右边。树与组脱节时宁可在界面上多出一格，
   * 也不能让那一格的页签凭空消失（它们是用户开着的文档）。
   */
  const inTree = new Set(groupIdsOf(repaired.layout))
  const grounded = repaired.groups.every((g) => inTree.has(g.id))
    ? repaired
    : withDocs(repaired, { layout: attachMissing(repaired.layout, repaired.groups.map((g) => g.id)) })
  if (grounded.groups.length <= 1) return grounded
  const alive = grounded.groups.filter((g) => g.tabs.length > 0)
  /*
   * 全空了（agent 一次删掉了一整棵子树、或「全部关闭」）：留**焦点那一格**，
   * 其余连同布局一起收掉——那正是「只剩一格」的样子，空态也出现在用户刚才待的地方。
   */
  if (!alive.length) {
    const keep = groupOf(grounded, grounded.focus) ?? grounded.groups[0]
    return withDocs(grounded, { groups: [keep], layout: { kind: 'group', group: keep.id } })
  }
  if (alive.length === grounded.groups.length) return grounded
  let layout: DocLayout | null = grounded.layout
  for (const g of grounded.groups) {
    if (g.tabs.length) continue
    layout = layout ? removeLeaf(layout, g.id) : null
  }
  return withDocs(grounded, { groups: alive, layout: layout ?? { kind: 'group', group: alive[0].id } })
}

/** 拖动分割线之后的新占比（按 id 找那一层分割） */
export function setSizes(docs: DocWorkspace, splitId: string, sizes: number[]): DocWorkspace {
  return settle(withDocs(docs, { layout: mapSplit(docs.layout, splitId, (s) => ({ ...s, sizes: normalizeSizes(sizes) })) }))
}
