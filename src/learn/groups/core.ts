/** 这个文件负责：工作区级不可变更新的地基——按 id 找组、打补丁、每次收尾的 settle 与 setSizes（各模块都从这里取） */

import { FIRST_GROUP, attachMissing, emptyDocs, groupIdsOf, mapSplit, normalizeSizes, removeLeaf } from './layout'
import type { DocGroup, DocLayout, DocWorkspace } from './types'
import { isBlankTab, makeBlankTab } from '../tabs'

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
 *    只剩一格时若所有页签都关了，自动创建一枚空白页签作为保底（不再有无页签状态）。
 * 2. **有页签却没选中**（active 为 null）：那一格会显示空态，而它的页签栏明明有东西——
 *    看起来就像「文档丢了」。把最后一个页签当落点（关页签用的是更讲究的落点规则，
 *    见 closeTabs；这里只是兜底，正常路径不会走到）。
 *
 * 因为所有操作都过这一道，「页签还在、格子却空了」这种状态在数据层就构造不出来。
 */
export function settle(docs: DocWorkspace): DocWorkspace {
  if (!docs.groups.length) return emptyDocs()
  /*
   * 「一个页签栏有且只有一枚新页签」——在 settle 这一道拦下来，数据层就构造不出
   * 「一格两枚新页签」的状态。主路（用户点「新页签」）已经在 openInGroup 里处理好了
   * （已有的直接激活，见那里），但空白占位还会从别处冒出来：关闭时的落点要补一枚
   * （见 tabs 的 closeTabs），以后还会有别的新入口。保留**第一枚**（用户先看到的那个），
   * 多余的丢掉；被丢掉的那枚正好是 active 时，下面的 active 兜底会把它指回格子里的最后一个。
   */
  const deduped = docs.groups.some((g) => g.tabs.filter(isBlankTab).length > 1)
    ? {
        ...docs,
        groups: docs.groups.map((g) => {
          let seen = false
          const tabs = g.tabs.filter((t) => {
            if (!isBlankTab(t)) return true
            if (seen) return false
            seen = true
            return true
          })
          return tabs.length === g.tabs.length ? g : { ...g, tabs }
        }),
      }
    : docs
  const repaired = deduped.groups.some((g) => g.tabs.length > 0 && (!g.active || !g.tabs.some((t) => t.id === g.active)))
    ? {
        ...deduped,
        groups: deduped.groups.map((g) =>
          g.tabs.length && (!g.active || !g.tabs.some((t) => t.id === g.active))
            ? { ...g, active: g.tabs[g.tabs.length - 1].id }
            : g,
        ),
      }
    : deduped
  /*
   * 布局树里没提到的组：补到最右边。树与组脱节时宁可在界面上多出一格，
   * 也不能让那一格的页签凭空消失（它们是用户开着的文档）。
   */
  const inTree = new Set(groupIdsOf(repaired.layout))
  const grounded = repaired.groups.every((g) => inTree.has(g.id))
    ? repaired
    : withDocs(repaired, { layout: attachMissing(repaired.layout, repaired.groups.map((g) => g.id)) })
  if (grounded.groups.length <= 1) {
    if (!grounded.groups.length) return emptyDocs()
    const g = grounded.groups[0]
    if (g.tabs.length === 0) {
      const fallback = makeBlankTab()
      const filled = { ...g, tabs: [fallback], active: fallback.id }
      return withDocs(grounded, { groups: [filled], layout: { kind: 'group', group: filled.id } })
    }
    return grounded
  }
  const alive = grounded.groups.filter((g) => g.tabs.length > 0)
  /*
   * 全空了（agent 一次删掉了一整棵子树、或「全部关闭」）：留**焦点那一格**，
   * 自动创建空白页签作为保底，其余连同布局一起收掉。
   */
  if (!alive.length) {
    const keep = groupOf(grounded, grounded.focus) ?? grounded.groups[0]
    const fallback = makeBlankTab()
    const filled = { ...keep, tabs: [fallback], active: fallback.id }
    return withDocs(grounded, { groups: [filled], layout: { kind: 'group', group: filled.id } })
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
