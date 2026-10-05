/**
 * 这个文件负责什么：工作区目录——每个节点目录里那个**真实存在**的
 * `workspace/` 子目录（`users/{uid}/docs/{目标}/{节点}/workspace/…`；目标根节点就是
 * `docs/{目标}/workspace/`）与知识树的对应关系（纯路径计算；磁盘 IO 在界面层与 ops 里）。
 *
 * 为什么要有它：资源管理器里的笔记 / 试卷 / 超级文档是应用自己管的账（store 序列化出来的），
 * 而「工作区」是用户与导师都能直接碰的**真实文件**——在系统资源管理器里看得见、
 * 可以自己放任何东西进去。目录跟着节点走（nodeLayout 的同名分段，最后一段固定是
 * `workspace/`），于是「这个节点的工作区在哪」不用存任何字段，永远从布局现推。
 *
 * 工作区在 docs 树**里面**，靠 ASSET_DIRS 那套规矩自保（见 learn/layout）：
 * 启动时不进文档解析（isAssetBinary 跳过）、节点目录改名时跟着搬（assetMoves）、
 * 子节点不能再占「workspace」这个名字（nodeLayout 的 used 集）。
 * 删除节点会连工作区一起删——右键菜单那句「含它的全部文件」说的就是它。
 * 老版本（未发布）放在 users/{uid}/workspace/ 下的文件不在保护范围，留着不动。
 */

import type { LearnStore } from './types'
import { DOCS_DIR, WORKSPACE_DIR, nodeLayout } from './layout'

/** 一个节点的工作区目录（相对当前用户，如 docs/微积分/极限/workspace）；节点没进任何目标目录时 null */
export function wsRelOf(store: LearnStore, nodeId: string): string | null {
  const layout = nodeLayout(store).get(nodeId)
  if (!layout) return null
  return [DOCS_DIR, ...layout.dir, WORKSPACE_DIR].join('/')
}

/**
 * 反查：磁盘上的一份文件落在**哪个节点的工作区里**（资源管理器的页签定位用）。
 * userPrefix 是用户目录的公共前缀（{root}/users/{uid}，见 lib/storage 的 userAbsPath）——
 * 剥掉它剩下的才与 docs 布局同一种「相对当前用户」的口径；不落进任何节点工作区时 null。
 * 一次布局现推、整表对着比，不逐节点重算 nodeLayout（那会摊成平方）。
 */
export function wsRevealOfAbs(
  store: LearnStore,
  abs: string,
  userPrefix: string | null,
): { nodeId: string; rel: string } | null {
  if (!userPrefix) return null
  const norm = abs.replace(/\\/g, '/')
  if (!norm.startsWith(userPrefix + '/')) return null
  const rest = norm.slice(userPrefix.length + 1)
  const layouts = nodeLayout(store)
  for (const n of store.nodes) {
    const layout = layouts.get(n.id)
    if (!layout) continue
    const base = [DOCS_DIR, ...layout.dir, WORKSPACE_DIR].join('/')
    if (rest.startsWith(base + '/')) return { nodeId: n.id, rel: rest }
  }
  return null
}

/**
 * 在节点的工作区目录下拼一个子路径（文件或子目录）。
 * 逐段挡掉空的、「.」「..」与带斜杠/反斜杠的段——主进程的 resolveInside 还会再挡一道，
 * 这里先挡是为了把错误说成人话，而不是让一句「路径不合法」飘回去。
 */
export function wsJoin(base: string, segments: readonly string[]): string | null {
  for (const raw of segments) {
    const seg = raw.trim()
    if (!seg || seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\')) return null
  }
  return [base, ...segments.map((s) => s.trim())].join('/')
}

/** 一个文件 / 目录名能不能落在磁盘上（不能是空的、点、两点，不能带斜杠或反斜杠） */
export function wsNameOk(name: string): boolean {
  const s = name.trim()
  return !!s && s !== '.' && s !== '..' && !s.includes('/') && !s.includes('\\')
}

/**
 * 在 taken（同目录下已有的名字）里避开撞名：无后缀直接加序号，有后缀的插在后缀前
 * （新建文件 2.md）。与 Windows 资源管理器同一套习惯，新建连点几次也不会互相覆盖。
 */
export function wsAllocateName(want: string, taken: ReadonlySet<string>): string {
  if (!taken.has(want)) return want
  const dot = want.lastIndexOf('.')
  const stem = dot > 0 ? want.slice(0, dot) : want
  const ext = dot > 0 ? want.slice(dot) : ''
  for (let i = 2; i < 100; i++) {
    const next = stem + ' ' + i + ext
    if (!taken.has(next)) return next
  }
  return want + ' ' + Date.now()
}

/**
 * 工作区**内部**移动 / 复制的拖拽 MIME（payload 是 JSON：{rel, dir}）。
 *
 * 与 CHIP_MIME 故意分开：同一枚文件拖出去带两份数据——落在文档区 / 输入框上是
 * 「打开 / 引用」（消费 CHIP_MIME），落在工作区目录行上是「移动 / Ctrl=复制」
 * （消费这一份）。两类落点各自只认自己的 MIME，互不误触。
 */
export const WS_MOVE_MIME = 'application/x-moji-ws-move'
