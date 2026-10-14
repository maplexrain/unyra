/** 这个文件负责什么：上一次快照与新状态的差异——该写哪些、该删哪些（diffDocs），以及改名后资源目录要跟着搬的配对（assetMoves）。 */

/* ---------- 差异 ---------- */

import { parseJson, type MetaFile } from './meta'

export interface DocsDiff {
  /** 需要写（新增或内容变了）的路径 */
  writes: string[]
  /** 需要删除的路径：整个目录没了就给目录，只少了单个文件就给文件 */
  removes: string[]
}

/**
 * 上一次快照与新状态比对。
 *
 * 删除收敛到目录一级：改标题、删节点都会让一整个目录作废，
 * 逐个删文件会在磁盘上留下一堆空目录。
 */
export function diffDocs(prev: Map<string, string>, next: Map<string, string>): DocsDiff {
  const writes: string[] = []
  for (const [rel, text] of next) if (prev.get(rel) !== text) writes.push(rel)

  const stale = [...prev.keys()].filter((rel) => !next.has(rel))
  if (!stale.length) return { writes, removes: [] }

  const keep = [...next.keys()]
  const dirs = new Set<string>()
  for (const rel of stale) {
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  // 「目录里已经没有要留的文件」才是可删的目录
  const emptyDirs = new Set([...dirs].filter((d) => !keep.some((k) => k.startsWith(`${d}/`))))
  const parentOf = (d: string): string => d.slice(0, d.lastIndexOf('/'))
  // 只留最外层：父目录也在可删之列的话，删父目录就够了
  const doomed = [...emptyDirs]
    .filter((d) => !emptyDirs.has(parentOf(d)))
    .sort()

  const removes: string[] = [...doomed]
  for (const rel of stale) {
    if (!doomed.some((d) => rel.startsWith(`${d}/`))) removes.push(rel)
  }
  return { writes, removes }
}

/**
 * 「节点 id → 它所在的目录」：从整张文件表里挑出 `{base}.meta.json` 逐份解析。
 *
 * 结果按文件表缓存。为什么值得缓存：`prev` 就是上一次保存写出去的快照，同一个对象会被
 * 反复传进来（快照只在一次提交成功之后才换），而它没变时这份索引自然也没变。
 * 日志里这一项（对每一份 meta 做 parseJson）量到 6ms，缓存把其中一半直接省掉。
 *
 * 前提是调用方**不原地改**传进来的表——整个落盘链都是「换新 Map」，不是「改旧 Map」。
 */
const dirsCache = new WeakMap<Map<string, string>, Map<string, string>>()

function dirsOf(files: Map<string, string>): Map<string, string> {
  const hit = dirsCache.get(files)
  if (hit) return hit
  const out = new Map<string, string>()
  for (const [rel, text] of files) {
    const parts = rel.split('/')
    const base = parts[parts.length - 2]
    if (parts[parts.length - 1] !== `${base}.meta.json`) continue
    const meta = parseJson<MetaFile>(text)
    if (meta?.id) out.set(meta.id, parts.slice(0, -1).join('/'))
  }
  dirsCache.set(files, out)
  return out
}

/**
 * 目录改名后，哪些资源目录要跟着搬。
 *
 * 为什么必须单独算：diffDocs 只看得见文本文件。改名时它给出的是「旧目录整个删掉」，
 * 而主进程的删除是递归的——`static/`（以及旧的 `images/`）里的二进制不在 diff 的
 * 视野里，会跟着一起消失。而**改名是常态**：新建目标的第一次编排就是把根节点从
 * 占位标题改成正式标题（见 learn/workflows 的「学习大纲」内置工作流）。
 *
 * 配对的依据是 meta 里的节点 id：同一个 id 的目录从 from 挪到了 to。
 * 只处理目录改名，不动节点之间的层级关系。
 */
export function assetMoves(
  prev: Map<string, string>,
  next: Map<string, string>,
): Array<{ from: string; to: string }> {
  const before = dirsOf(prev)
  const after = dirsOf(next)
  const moves: Array<{ from: string; to: string }> = []
  for (const [nodeId, from] of before) {
    const to = after.get(nodeId)
    if (to && to !== from) moves.push({ from, to })
  }
  return moves
}
