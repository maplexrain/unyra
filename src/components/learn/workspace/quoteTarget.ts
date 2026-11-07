import type { LearnStore, ProjectNodeEntity, TabRef } from '../../../learn/types'
import { notesOf } from '../../../learn/types'
import { focusedTab } from '../../../learn/groups'
import { tabNodeId, fileNameOf as localFileNameOf } from '../../../learn/tabs'
import { wsRevealOfAbs, wsRefOfRel, wsRelOf } from '../../../learn/workspace'
import { resolveProjectRoot } from '../../../learn/projects'
import { readLocalFile } from '../../../lib/localFiles'
import { readUserText, userAbsPrefix } from '../../../lib/storage'
import { isElectron, native } from '../../../lib/native'

/** 引用块解析成功的那一份：正文 + 现场换算出的页签 */
export interface ResolvedQuoteTarget {
  content: string
  tabRef: TabRef
}

/**
 * 原文引用代码块（```quote）的统一解析：绝对路径 / 笔记挂件 / 节点工作区 / 项目目录 /
 * 用户数据目录 / 普通本地文件，六条路按序试，读到即返回（含换算好的页签）。
 */
export async function resolveQuoteTarget(
  s: LearnStore,
  rawPath: string,
): Promise<ResolvedQuoteTarget | null> {
  let cleanPath = (rawPath ?? '').trim().replace(/\\/g, '/')
  if (!cleanPath) return null

  let decodedPath = cleanPath
  try {
    if (cleanPath.includes('%')) {
      decodedPath = decodeURIComponent(cleanPath).replace(/\\/g, '/')
    }
  } catch {}

  const uPrefix = userAbsPrefix()?.replace(/\\/g, '/')
  const isAbs = (p: string) => /^[a-zA-Z]:[\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

  // 1. 尝试直接读取单条绝对路径
  const tryReadAbs = async (absP: string): Promise<ResolvedQuoteTarget | null> => {
    if (!absP) return null
    let content: string | null = null

    // 1.1 若落在用户数据根下，优先走 readUserText
    if (uPrefix && absP.startsWith(uPrefix)) {
      const rel = absP.slice(uPrefix.length).replace(/^[\/]+/, '')
      try {
        const res = await readUserText(rel)
        if (res !== null) content = res
      } catch {}
    }

    // 1.2 readLocalFile 外部文件读
    if (content === null) {
      try {
        const res = await readLocalFile(absP)
        if (res.ok && typeof res.content === 'string') content = res.content
      } catch {}
    }

    // 1.3 projectFs 读取
    if (content === null && isElectron()) {
      try {
        const allRoots = (s.projects ?? [])
          .map((pr) => resolveProjectRoot(s, pr))
          .filter((r): r is string => Boolean(r))
        if (allRoots.length > 0) {
          const r = await native().projectFs({ op: 'read', path: absP, roots: allRoots, encoding: 'utf8' })
          if (r.ok && r.op === 'read' && typeof r.content === 'string') content = r.content
        }
      } catch {}
    }

    if (content === null) return null

    // 构造有效 TabRef
    const reveal = wsRevealOfAbs(s, absP, uPrefix ?? null)
    if (reveal) {
      return { content, tabRef: { kind: 'ws', nodeId: reveal.nodeId, seg: reveal.rel } }
    }
    if (uPrefix && absP.startsWith(uPrefix)) {
      const rel = absP.slice(uPrefix.length).replace(/^[\/]+/, '')
      const wsRef = wsRefOfRel(s, rel)
      if (wsRef) {
        return { content, tabRef: wsRef }
      }
    }
    return {
      content,
      tabRef: { kind: 'local', path: absP, title: localFileNameOf(absP) },
    }
  }

  // 若传入的是绝对路径
  if (isAbs(cleanPath)) {
    const res = await tryReadAbs(cleanPath)
    if (res) return res
  }
  if (isAbs(decodedPath) && decodedPath !== cleanPath) {
    const res = await tryReadAbs(decodedPath)
    if (res) return res
  }

  // 收集相关节点
  const fRef = focusedTab(s.docArea)?.ref
  const currentViewingId = (fRef ? tabNodeId(fRef) : null) ?? s.activeNodeId
  const activeGoal = s.goals.find((g) => g.id === s.activeGoalId)
  const relevantNodeIds = new Set<string>()
  if (currentViewingId) relevantNodeIds.add(currentViewingId)
  if (s.activeNodeId) relevantNodeIds.add(s.activeNodeId)
  if (activeGoal?.rootNodeId) relevantNodeIds.add(activeGoal.rootNodeId)
  for (const n of s.nodes ?? []) {
    if (n.goalId === s.activeGoalId) relevantNodeIds.add(n.id)
  }

  const pathVariants = [cleanPath]
  if (decodedPath !== cleanPath) pathVariants.push(decodedPath)

  for (const variant of pathVariants) {
    // 2. 检查是否为笔记挂件
    const noteTarget = variant.replace(/^(?:note|notes|笔记)[\/:]/i, '').replace(/\.md$/i, '').trim()
    for (const nid of relevantNodeIds) {
      const n = s.nodes.find((item) => item.id === nid)
      if (!n) continue
      const notes = notesOf(n)
      const foundNote = notes.find((nt) => nt.name === noteTarget || nt.name === variant)
      if (foundNote && typeof foundNote.content === 'string') {
        return {
          content: foundNote.content,
          tabRef: { kind: 'note', nodeId: n.id, note: foundNote.name },
        }
      }
    }

    const relPath = variant.replace(/^\.\//, '')
    const relWithoutWs = relPath.startsWith('workspace/') ? relPath.slice('workspace/'.length) : relPath

    // 3. 检查节点工作区目录（workspace/）
    for (const nid of relevantNodeIds) {
      const wsRel = wsRelOf(s, nid)
      if (!wsRel) continue

      const candidateRels = [
        `${wsRel}/${relWithoutWs}`,
        `${wsRel.replace(/\/workspace$/, '')}/${relPath}`,
      ]
      for (const cr of candidateRels) {
        try {
          const txt = await readUserText(cr)
          if (txt !== null) {
            const wsRef = wsRefOfRel(s, cr) ?? { kind: 'ws', nodeId: nid, seg: relWithoutWs }
            return { content: txt, tabRef: wsRef }
          }
        } catch {}
        if (uPrefix) {
          const absP = `${uPrefix}/${cr}`
          const absRes = await tryReadAbs(absP)
          if (absRes) return absRes
        }
      }
    }

    // 4. 检查已声明的项目节点（Project Nodes）
    const candidateProjects: ProjectNodeEntity[] = []
    if (s.activeNodeId) {
      const downEdges = s.edges.filter((e) => e.from === s.activeNodeId)
      for (const e of downEdges) {
        const p = (s.projects ?? []).find((pr) => pr.id === e.to)
        if (p) candidateProjects.push(p)
      }
    }
    if (s.activeGoalId) {
      for (const pr of s.projects ?? []) {
        if (pr.goalId === s.activeGoalId && !candidateProjects.some((cp) => cp.id === pr.id)) {
          candidateProjects.push(pr)
        }
      }
    }
    for (const pr of s.projects ?? []) {
      if (!candidateProjects.some((cp) => cp.id === pr.id)) {
        candidateProjects.push(pr)
      }
    }

    for (const proj of candidateProjects) {
      const root = resolveProjectRoot(s, proj)
      if (!root) continue
      const full = root.replace(/[\\/]+$/, '') + '/' + relPath.replace(/^[\\/]+/, '')
      const absRes = await tryReadAbs(full)
      if (absRes) return absRes
    }

    // 5. 用户数据目录直接按相对路径读
    const directUserRels = [relPath, `docs/${relPath}`]
    for (const dur of directUserRels) {
      try {
        const txt = await readUserText(dur)
        if (txt !== null) {
          const wsRef = wsRefOfRel(s, dur)
          if (wsRef) return { content: txt, tabRef: wsRef }
          const absP = uPrefix ? `${uPrefix}/${dur}` : dur
          return { content: txt, tabRef: { kind: 'local', path: absP, title: localFileNameOf(absP) } }
        }
      } catch {}
    }

    // 6. 最后尝试普通本地文件路径读
    try {
      const r = await readLocalFile(relPath)
      if (r.ok && typeof r.content === 'string') {
        return {
          content: r.content,
          tabRef: { kind: 'local', path: relPath, title: localFileNameOf(relPath) },
        }
      }
    } catch {}
  }

  return null
}

/** 在文档源码里找这段 plot 围栏的 [start, end)：start 指向 ```plot 行首，end 越过收尾的 ``` */
export function findPlotFenceRange(content: string, raw: string): { start: number; end: number } | null {
  const body = raw.trim()
  if (!body) return null
  const marker = '```plot'
  let from = 0
  for (;;) {
    const start = content.indexOf(marker, from)
    if (start < 0) return null
    const lineEnd = content.indexOf('\n', start + marker.length)
    if (lineEnd < 0) return null
    const close = content.indexOf('```', lineEnd)
    if (close < 0) return null
    if (content.slice(lineEnd + 1, close).trim() === body) return { start, end: close + 3 }
    from = close + 3
  }
}
