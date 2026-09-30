/** 这个文件负责：布局树本身——id 与空工作区、树的查找、拆分与合并、占比 sizes 与落点怎么拆 */

import type { DocLayout, DocSplit, DocWorkspace, DropZoneKind, SplitDir } from './types'

/** 第一组的固定 id：空库与旧数据迁移都用它，界面上没有第二处依赖这个名字 */
export const FIRST_GROUP = 'g0'

/**
 * 新 id（组与分割节点共用一套）。
 *
 * 时间戳 + 自增序号：同一个会话里连着拆两次也各不相同（同一毫秒内也会 +1）。
 * 它只活在内存与 state.json 里，不需要全局唯一——真撞上了也只是布局里少一格。
 */
let seq = 0
export function newId(prefix: string): string {
  seq += 1
  return prefix + Date.now().toString(36) + '-' + seq.toString(36)
}

/** 一个干净的工作区：一组、没有页签 */
export function emptyDocs(): DocWorkspace {
  return {
    layout: { kind: 'group', group: FIRST_GROUP },
    groups: [{ id: FIRST_GROUP, tabs: [], active: null }],
    focus: FIRST_GROUP,
  }
}

/** 布局树里的全部组 id，深度优先 = 屏幕上的阅读顺序（从左到右、从上到下） */
export function groupIdsOf(layout: DocLayout): string[] {
  if (layout.kind === 'group') return [layout.group]
  return layout.children.flatMap(groupIdsOf)
}

/* ---------- 布局树的小工具 ---------- */

/** 占比归一：全是正数、和为 1。拆出来的两半因此天然各占一半 */
export function normalizeSizes(sizes: number[]): number[] {
  const safe = sizes.map((s) => (Number.isFinite(s) && s > 0 ? s : 1))
  const total = safe.reduce((a, b) => a + b, 0)
  return safe.map((s) => s / total)
}

/** 把某个叶子换成另一棵树；这棵树里没有它时原样返回 */
export function replaceLeaf(node: DocLayout, groupId: string, next: DocLayout): DocLayout {
  if (node.kind === 'group') return node.group === groupId ? next : node
  let hit = false
  const children = node.children.map((c) => {
    const r = replaceLeaf(c, groupId, next)
    if (r !== c) hit = true
    return r
  })
  return hit ? { ...node, children } : node
}

/**
 * 从树里摘掉一个叶子，并把只剩一个孩子的分割一起收起来——
 * 留着它会在那一层多出一道没有意义的边距与一条拖不动的分割线。
 * 整棵树都被摘空时返回 null（调用方兜底成单组）。
 */
export function removeLeaf(node: DocLayout, groupId: string): DocLayout | null {
  if (node.kind === 'group') return node.group === groupId ? null : node
  const children: DocLayout[] = []
  const sizes: number[] = []
  node.children.forEach((c, i) => {
    const r = removeLeaf(c, groupId)
    if (!r) return
    children.push(r)
    sizes.push(node.sizes[i] ?? 1)
  })
  if (children.length === node.children.length) return node
  if (!children.length) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normalizeSizes(sizes) }
}

/** 在某个叶子旁边插进一棵新的子树；同方向时摊平成兄弟，免得一层套一层 */
export function insertBeside(
  node: DocLayout,
  target: string,
  side: 'before' | 'after',
  leaf: DocLayout,
  splitId: string,
  dir: SplitDir,
): DocLayout {
  if (node.kind === 'group') {
    if (node.group !== target) return node
    return {
      kind: 'split',
      id: splitId,
      dir,
      children: side === 'before' ? [leaf, node] : [node, leaf],
      sizes: [0.5, 0.5],
    }
  }
  const idx = node.children.findIndex((c) => groupIdsOf(c).includes(target))
  if (idx < 0) return node
  const child = node.children[idx]
  // 同方向、且目标就是这一格的直接孩子：插成兄弟（多出来的那一层嵌套没有意义）
  if (node.dir === dir && child.kind === 'group' && child.group === target) {
    const at = side === 'before' ? idx : idx + 1
    const children = [...node.children]
    const sizes = [...node.sizes]
    children.splice(at, 0, leaf)
    sizes.splice(at, 0, 1)
    return { ...node, children, sizes: normalizeSizes(sizes) }
  }
  const children = [...node.children]
  children[idx] = insertBeside(child, target, side, leaf, splitId, dir)
  return { ...node, children }
}

/** 按 id 改某一层分割 */
export function mapSplit(
  node: DocLayout,
  splitId: string,
  fn: (s: Extract<DocLayout, { kind: 'split' }>) => DocLayout,
): DocLayout {
  if (node.kind === 'group') return node
  if (node.id === splitId) return fn(node)
  return { ...node, children: node.children.map((c) => mapSplit(c, splitId, fn)) }
}

/** 树里没提到的组补到最右边（一行并排），见 normalizeDocs */
export function attachMissing(layout: DocLayout, ids: string[]): DocLayout {
  const present = new Set(groupIdsOf(layout))
  const missing = ids.filter((id) => !present.has(id))
  if (!missing.length) return layout
  const children: DocLayout[] = [layout, ...missing.map((id) => ({ kind: 'group' as const, group: id }))]
  return { kind: 'split', id: newId('s'), dir: 'row', children, sizes: normalizeSizes(children.map(() => 1)) }
}

/** 按 id 找那一层分割（拖动分割线时要知道自己改的是谁） */
export function findSplit(layout: DocLayout, splitId: string): DocSplit | null {
  if (layout.kind === 'group') return null
  if (layout.id === splitId) return layout
  for (const c of layout.children) {
    const hit = findSplit(c, splitId)
    if (hit) return hit
  }
  return null
}

/**
 * 某一格两边各占多少（分割线 index 挪了 frac 之后）。
 *
 * frac 是**占总长的比例**（指针位移 / 容器长度），只影响 index 两侧那两格：
 * 一个变多，另一个同步变少，整层加起来仍然是 1（别的层因此纹丝不动）。
 * 两边各留 MIN_SPLIT_FRAC 的下限——拖到 0 的话那一格就再也抓不回来了
 * （线贴着边，指针已经没有可落的地方）。
 */
export const MIN_SPLIT_FRAC = 0.08

export function resizePair(sizes: number[], index: number, frac: number): number[] {
  const out = [...sizes]
  const a = index - 1
  const b = index
  if (a < 0 || b >= out.length) return out
  const sum = (out[a] ?? 0) + (out[b] ?? 0)
  const lo = Math.min(MIN_SPLIT_FRAC, sum / 2)
  const next = Math.min(Math.max((out[a] ?? 0) + frac, lo), sum - lo)
  out[a] = next
  out[b] = sum - next
  return out
}

/**
 * 落点 → 怎么拆：左右贴边 = 并排（'row'，分割线是竖的），上下贴边 = 叠放（'col'）。
 * side 指新格摆在哪一侧（before = 左 / 上），拖到「后边」时它排在原格之后。
 */
export function splitSpecOf(zone: Exclude<DropZoneKind, 'center'>): {
  dir: SplitDir
  side: 'before' | 'after'
} {
  const dir: SplitDir = zone === 'left' || zone === 'right' ? 'row' : 'col'
  return { dir, side: zone === 'left' || zone === 'top' ? 'before' : 'after' }
}
