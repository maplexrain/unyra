/**
 * 页签常驻：切页签不重建正文，靠的就是把 DOM 留着。
 *
 * 为什么值得这么做（实测，见 tests/markdownPerf.test.ts）：切页签时真正贵的是
 * 「把 markdown 产出的那几千个元素重新塞进 DOM + 四类 hydrate 各扫一遍 + 几处强制排版」。
 * 解析本身早就不要钱了——renderNote 按源文缓存，切回来是 0.00 ms（见 lib/markdown）。
 * 换句话说是：**贵在 DOM，不在解析**，而 DOM 只有留着才省得下来。
 *
 * 为什么必须有上限：一篇教学文档的正文 DOM 是几千个元素（3.9 KB 的文档 → 5122 个），
 * 每片都常驻就是几十 MB 内存。所以只留最近用过的几片，其余照旧卸载重挂——
 * 收益的大头（来回切的那几片）拿到了，内存有界。
 *
 * 三条规则：
 * 1. **每一格**当前显示的那一片永远常驻（它们就在眼前，卸载等于每次切回来都重建）；
 * 2. 其余按「最近激活过」排，最新的优先；
 * 3. 已经关掉的页签立刻不再常驻——列表里不留幽灵。
 *
 * 这里全是纯函数，规则可以单独验（见 tests/resident.test.ts）。
 */

import { useSyncExternalStore } from 'react'

/** 常驻几片。四片够覆盖「一边看文档一边对着另一个节点问」这类来回切，再多就是白占内存 */
export const RESIDENT_MAX = 4

/** 记一次激活：最新的排最前，去重，超出上限的丢掉 */
export function markActive(recent: readonly string[], id: string, cap: number = RESIDENT_MAX): string[] {
  if (cap <= 0 || !id) return []
  const next = [id, ...recent.filter((x) => x !== id)]
  return next.slice(0, cap)
}

/**
 * 这一轮该常驻哪几片。
 *
 * 返回的是**页签栏顺序**（不是优先级顺序）：DOM 里的位置因此不会随着「最近用过谁」跳来跳去，
 * React 也不用为了换个顺序搬节点。
 */
export function residentIds(
  openIds: readonly string[],
  activeIds: readonly string[],
  recent: readonly string[],
  cap: number = RESIDENT_MAX,
): string[] {
  const open = new Set(openIds)
  /*
   * 每一格当前显示的那一片都常驻（文档区能分割之后，同一时刻可能有好几片在眼前），
   * 已经关掉的那些跳过——切换的那一帧会短暂出现，谁都不常驻，等 store 落定就好。
   */
  const keep = new Set(activeIds.filter((id) => open.has(id)))
  if (!keep.size || cap <= 0) return []
  for (const id of recent) {
    if (keep.size >= cap) break
    if (open.has(id)) keep.add(id)
  }
  return openIds.filter((id) => keep.has(id))
}

/* ---------- 「最近激活过谁」这一小份状态放哪 ---------- */

/**
 * 为什么不放在组件的 state 里、用一个 effect 去记：那正是「effect 里 setState」——
 * 每次切页签都要多渲染一轮，React 的规则也不允许（本仓库开了 react-compiler 的检查）。
 * 记「最近用过谁」本来也不是渲染的事，它是**外部状态**：由正文那一层在它真的显示出来时
 * 登记（见 LearnWorkspace 的 DocPane），界面再订回来。与阅读脉搏、时钟是同一个写法
 * （见 lib/readingPulse.ts、lib/clock.ts）。
 */
let recent: readonly string[] = []
let snapshot: readonly string[] = []
const listeners = new Set<() => void>()

/** 登记一次「这一片现在在眼前」。值没变就不通知，避免白渲染 */
export function touchRecent(id: string, cap: number = RESIDENT_MAX): void {
  const next = markActive(recent, id, cap)
  if (next.length === recent.length && next.every((v, i) => v === recent[i])) return
  recent = next
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribeRecent(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function readRecent(): readonly string[] {
  return snapshot
}

/** 最近激活过的页签（新的在前）；只有常驻名单这一处读它 */
export function useRecentTabs(): readonly string[] {
  return useSyncExternalStore(subscribeRecent, readRecent)
}
