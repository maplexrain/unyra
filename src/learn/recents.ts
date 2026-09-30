import type { KnowledgeNode, LearnStore, MasteryStatus } from './types'
import { nodeById, pathToRoot } from './graph'

/**
 * 「最近打开」：把**跨类型**的最近动作并成一条列表（左侧栏那个区用它）。
 *
 * 为什么值得单独一个区：知识节点与本地文件各有自己的区，那两个区回答的是「我有什么」；
 * 「我刚才在看什么」是另一件事——它可能是一个节点、也可能是一张磁盘上的文件，用户脑子里
 * 没有这个分类，找东西时也不该先想它属于哪一类。
 *
 * 数据是现成的，不另存一份：
 * - 节点：node.learning.lastStudiedAt。打开节点、它的笔记、它的超级文档都会刷新它
 *   （入口只有 openTab 一个，见 graph 的 touchNode）。**粒度是天**：同一天里重复打开
 *   不刷新时间戳（见 learning 的 withVisit——不然每点一下节点都要重写 meta.json），
 *   所以同一天打开过的几个节点之间，顺序是「这天里第一次打开」的先后，不是最后一次的先后。
 * - 本地文件：file.openedAt，每次打开都刷新（见 localfiles 的 addLocalFile）。
 *
 * 上限 RECENT_LIMIT：这是「接着看」的入口，不是收藏夹。
 */
export const RECENT_LIMIT = 12

export interface RecentOpen {
  /** node = 知识节点（含它的笔记/超级文档）；local = 磁盘上拖进来的文件 */
  kind: 'node' | 'local'
  /** 节点 id，或本地文件的路径 */
  id: string
  title: string
  /** 节点的掌握状态：列表里那枚小圆点与节点树同一套写法 */
  status?: MasteryStatus
  /** 「在什么里面」：节点的直属上级 / 文件所在的目录名。空串表示没有（顶层 / 根目录） */
  hint: string
  /** 悬停时的完整说明：节点的整条路径 / 文件的完整路径 */
  tip: string
  at: number
}

/** 按最近打开倒序，取前 limit 条 */
export function recentOpens(store: LearnStore, limit = RECENT_LIMIT): RecentOpen[] {
  /**
   * 分两步：先只收「谁、什么时候打开过」，hint / tip 等**截断之后**再补。
   *
   * 为什么值得分开：这两个字段每算一个节点都要扫一遍全图——parentTitle 扫全部依赖边、
   * trail 走一遍 pathToRoot（它每层又各扫一遍边）。对每个打开过的节点都算，
   * 整份列表就是 O(节点数 × 边数)，而这个区只显示前 RECENT_LIMIT 条。
   *
   * 为什么输出不变：排序只读 at（比较函数一个字没动，sort 本身是稳定的），
   * 而 hint / tip 只由那一个节点与 store 决定，与它排在列表第几、旁边是谁都无关。
   * 于是「先排后补」与「先补后排」逐字段相同，少的只是那些根本显示不到的节点的计算。
   */
  const pending: Array<{ open: RecentOpen; node: KnowledgeNode | null }> = []
  for (const node of store.nodes) {
    const at = node.learning?.lastStudiedAt ?? 0
    // 没打开过的（只有 AI 建出来的那种）不进这个列表：它回答的是「我最近在学什么」
    if (!at) continue
    pending.push({
      node,
      // hint / tip 先留空，等下面截断之后再补
      open: {
        kind: 'node',
        id: node.id,
        title: node.title || '未命名',
        status: node.status,
        hint: '',
        tip: '',
        at,
      },
    })
  }
  for (const f of store.localFiles ?? []) {
    // 本地文件这两个字段只是路径切片，本来就不要钱，照旧当场算
    pending.push({
      node: null,
      open: { kind: 'local', id: f.path, title: f.name, hint: dirName(f.path), tip: f.path, at: f.openedAt },
    })
  }
  const top = pending.sort((a, b) => b.open.at - a.open.at).slice(0, limit)
  for (const { open, node } of top) {
    if (!node) continue
    open.hint = parentTitle(store, node)
    open.tip = trail(store, node, open.title)
  }
  return top.map(({ open }) => open)
}

/** 从根到本节点的标题链（含自己）：列表里那一行悬停时给人看 */
function trail(store: LearnStore, node: KnowledgeNode, title: string): string {
  const goal = store.goals.find((g) => g.id === node.goalId)
  const chain = goal ? pathToRoot(store, goal.rootNodeId, node.id) : null
  const titles = (chain ?? [])
    .slice(0, -1)
    .map((id) => nodeById(store, id)?.title)
    .filter((t): t is string => !!t)
  return [...titles, title].join(' / ')
}

/** 直属上级的标题；根节点（学习目标本身）没有上级 */
function parentTitle(store: LearnStore, node: KnowledgeNode): string {
  const parent = store.edges
    .filter((e) => e.to === node.id)
    .map((e) => nodeById(store, e.from))
    .find((n): n is KnowledgeNode => !!n)
  return parent?.title ?? ''
}

/** 路径里最后一级目录名（Windows 与 POSIX 两种分隔符都认） */
function dirName(p: string): string {
  const at = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (at <= 0) return ''
  const dir = p.slice(0, at)
  return dir.slice(Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\')) + 1)
}
