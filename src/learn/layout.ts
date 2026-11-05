/** 这个文件负责什么：教学文档在磁盘上的布局——目录常量与目录树（nodeLayout）都归它，files 与 static 的共同下游（环就断在这里）。布局的完整说明见 files.ts 顶部。 */

import type { LearnStore } from './types'
import { allocate, sanitizeSegment } from './segments'

export const DOCS_DIR = 'docs'

/**
 * 目标目录里两个**放二进制**的子目录。
 *
 * 它们不参与文本通道的差异比对（见 diffDocs）：文件本体是二进制或用户的工作文件，
 * 由 learn/static、learn/images 与工作区直接写盘。因此改名/删目录时必须单独照顾，
 * 否则「旧目录整个删掉」会连它们一起销毁（见 assetMoves）。
 *
 * 目录名与清单名在这里定义、由 learn/static 反向引用：磁盘布局归这个模块说话。
 * 更要紧的是**别在顶层去读循环依赖那一侧的值**——files ↔ static 是互相 import 的，
 * 谁先求值取决于打包器与入口顺序，读到未初始化的绑定就是一次启动即崩的 TDZ。
 */
export const IMAGES_DIR = 'images'
export const STATIC_DIR = 'static'
export const FILES_DIR = 'files'
/** 节点目录里放**真实工作文件**的子目录（见 learn/workspace）：不进文档解析、随目录搬家 */
export const WORKSPACE_DIR = 'workspace'
export const MANIFEST_FILE = 'manifest.json'
export const ASSET_DIRS = [STATIC_DIR, IMAGES_DIR, WORKSPACE_DIR, FILES_DIR] as const

/** 一个节点落在磁盘上的位置 */
export interface NodeLayout {
  /** 目录分段（含目标那一层），如 ['微积分', '极限'] */
  dir: string[]
  /** 这个节点在该目录里的文件名前缀（= dir 的最后一段） */
  base: string
  goalId: string
}

/** 笔记目录的后缀：一个节点的笔记全在 `{节点}.notes/` 下 */
export const NOTES_SUFFIX = '.notes'

/**
 * 节点 → 磁盘位置。
 *
 * 单独抽出来是因为它有两个调用方：写盘（buildDocs）与「在资源管理器中打开节点」。
 * 两边各推导一遍的话，规则一改就会有一边指到不存在的路径上——用户点开的是
 * 一个「找不到文件」的提示框，而不是他刚写的那篇文档。
 */
export function nodeLayout(store: LearnStore): Map<string, NodeLayout> {
  const layout = new Map<string, NodeLayout>()
  const byId = new Map(store.nodes.map((n) => [n.id, n]))

  // 前置边按来源分组：from 依赖 to，也就是 from 的下一层是 to
  const prereqs = new Map<string, string[]>()
  for (const e of store.edges) {
    const pl = prereqs.get(e.from)
    if (pl) pl.push(e.to)
    else prereqs.set(e.from, [e.to])
  }

  for (const goal of store.goals) {
    const root = goal.rootNodeId ? byId.get(goal.rootNodeId) : undefined
    const goalSeg = sanitizeSegment(root?.title || goal.title || goal.question || '未命名目标')
    const goalNodes = store.nodes.filter((n) => n.goalId === goal.id)
    if (!goalNodes.length) continue

    // 目标命名空间下的预留文件与目录名
    const baseUsed = () =>
      new Set<string>([
        goalSeg.toLowerCase(),
        `${goalSeg.toLowerCase()}.node.json`,
        'chat.json',
        'goal.json',
        'tmp.json',
        'reading.json',
        'essay.json',
        'mind.json',
        'method.json',
        'workflow.json',
        'structure.json',
        'outlines.json',
        'video-nodes.json',
        'projects.json',
        'file-nodes.json',
        'detached.json',
        ...ASSET_DIRS,
      ])

    if (!root) {
      const used = baseUsed()
      for (const node of goalNodes) {
        const seg = allocate(node.title, used)
        layout.set(node.id, { dir: [goalSeg, seg], base: seg, goalId: goal.id })
      }
      continue
    }

    // 从根沿前置边 BFS：先到先得，保留确定且稳定的段名分配顺序
    const order: string[] = []
    const seen = new Set<string>([root.id])
    const queue: string[] = [root.id]
    /**
     * 下标游标，不是 queue.shift()：shift 每取一个都要把整条队列往前搬一格，
     * 整棵树遍历因此是 O(N²)——而每次保存都会走一遍这里（见 buildDocs）。
     * 队列只增不减（下面 push），`i < queue.length` 每轮重读长度，
     * 取出顺序与「同层先来后到」和 shift 版逐个一致。
     */
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]
      order.push(cur)
      for (const pid of prereqs.get(cur) ?? []) {
        if (seen.has(pid)) continue
        const pn = byId.get(pid)
        // 跨目标的依赖不进这棵树：目录只表达「这个目标里的层级」
        if (!pn || pn.goalId !== goal.id) continue
        seen.add(pid)
        queue.push(pid)
      }
    }
    // 从根走不到的节点（父节点被删过之类）：挂在目标目录下，别让它消失
    for (const orphan of store.nodes.filter((n) => n.goalId === goal.id && !seen.has(n.id))) {
      seen.add(orphan.id)
      order.push(orphan.id)
    }

    // 根节点落在目标目录下：dir: [goalSeg], base: goalSeg
    layout.set(root.id, { dir: [goalSeg], base: goalSeg, goalId: goal.id })

    // 其余所有非根节点全部平铺在目标目录下的一级子目录：
    // dir: [goalSeg, seg], base: seg
    // 解耦架构：拓扑图中节点间增删边或重构父子层级，节点物理目录永远在 docs/{goalSeg}/{seg}，不随图的拓扑深层嵌套改变
    const used = baseUsed()
    for (const id of order) {
      if (id === root.id) continue
      const node = byId.get(id)
      if (!node) continue
      const seg = allocate(node.title, used)
      layout.set(node.id, { dir: [goalSeg, seg], base: seg, goalId: goal.id })
    }
  }

  return layout
}
