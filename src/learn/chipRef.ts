/**
 * 这个文件负责：把一份 chip 引用（#[{…}] 的 payload）还原成能打开的**页签身份**（TabRef）。
 *
 * 导师在交付里写的 chip 只带模型自然知道的东西（路径、名字、考试 id），打开时得查一遍
 * 数据树——路径是 nodeDocPath 的产物，这里做的就是那次反查：先信 chip 带来的 nodeId
 * （宿主自己拖出来的都带，路径对得上就直接用），没有或对不上再遍历全部节点比对路径。
 * 试卷原件没有页签形态（它是「开考」的入口，不是一份文档），这里返回 null，
 * 由 opener 分流到考试窗口。
 */

import type { ChipPayload } from '../lib/chipSyntax'
import { nodeDocPath } from './files/build'
import { DOCS_DIR, WORKSPACE_DIR } from './layout'
import { nodeById } from './graph/lookup'
import { normalizeKey, prereqIds } from './graph'
import { newWebKey } from './tabs'
import { wsJoin, wsRelOf } from './workspace'
import { notesOf, type KnowledgeNode, type LearnStore, type TabRef } from './types'
import { userAbsPath } from '../lib/storage'

/** 规整外来路径：反斜杠 → 斜杠、去掉开头的 ./（导师与文件管理器给的写法不统一） */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * ws chip 的 path → 「相对当前用户」的磁盘路径；两种写法都认，落点才是同一个文件：
 * - 宿主拖出来的：本来就是磁盘路径（`docs/…/workspace/…`），原样通过；
 * - 导师写的：workspace api 的「节点路径 + 文件段」口径（见 wsChipRel），对着数据树现查。
 * 解析不出返回 null（点开的人给一句「引用的东西不在了」）。
 */
export function wsChipUserRel(store: LearnStore, raw: string): string | null {
  const p = normPath(raw)
  if (!p) return null
  if (p.startsWith(DOCS_DIR + '/')) return p
  return wsChipRel(store, p)
}

/**
 * 导师写的 ws chip 路径 → 相对当前用户的磁盘路径。
 *
 * 导师手上 workspace api 的路径口径是「节点路径 + 文件段」（`极限/数据/实验.csv`、
 * `#节点id/报告.md`、常带上目标根标题的前缀）——这是它回执里的 label，它拿不到
 * `docs/…/workspace/…` 这种磁盘路径。这里对着数据树现查换算：节点链**严格**按
 * key/id 往下走，走到头剩下的全部当文件段（与 ops/workspace 的 resolveWs 同一条规矩；
 * 没有「当前节点」可锚——chip 是点击时才解释的，必须自包含）。解析不出返回 null。
 */
function wsChipRel(store: LearnStore, raw: string): string | null {
  const segments = raw.split('/').map((s) => s.trim()).filter(Boolean)
  if (!segments.length) return null
  let cursor: KnowledgeNode | undefined
  let i = 0
  const first = segments[0]
  if (first.startsWith('#')) {
    cursor = store.nodes.find((n) => n.id === first.slice(1).trim())
    i = 1
  } else {
    // 第一段：目标根标题 / 目标根 id / 任一节点的标题或 id（导师常把根标题写在前缀里）
    const root = store.goals
      .map((g) => nodeById(store, g.rootNodeId))
      .find((n): n is KnowledgeNode => !!n && (n.key === normalizeKey(first) || n.id === first))
    cursor = root ?? store.nodes.find((n) => n.key === normalizeKey(first) || n.id === first)
    if (cursor) i = 1
  }
  if (!cursor) return null
  const goalId = cursor.goalId
  for (; i < segments.length; i++) {
    const seg = segments[i]
    const cur: KnowledgeNode = cursor
    const child = prereqIds(store, cur.id)
      .map((id) => nodeById(store, id))
      .find((n): n is KnowledgeNode => !!n && n.goalId === goalId && (n.key === normalizeKey(seg) || n.id === seg))
    if (!child) break
    cursor = child
  }
  const base = wsRelOf(store, cursor.id)
  if (!base) return null
  // 「节点/workspace/文件」这种手写格式：workspace 这一段与 base 本身重复，吃掉一段再拼
  // （节点目录里不能再有同名子节点，所以文件段开头这个词只可能是它；真在 workspace 里
  // 又套了一层 workspace 的，写两层照样能到——只吃第一段）
  const rest = segments.slice(i)
  if (rest[0] === WORKSPACE_DIR) rest.shift()
  return wsJoin(base, rest)
}

export function tabRefFromChip(store: LearnStore, p: ChipPayload): TabRef | null {
  // 网页：网址就是身份，现场开一枚新页签（key 是开签那一刻的身份，见 learn/tabs）
  if (p.type === 'web') return p.url ? { kind: 'web', url: p.url, key: newWebKey() } : null
  // 外部文件：路径就是身份
  if (p.type === 'local') return p.path ? { kind: 'local', path: p.path } : null
  // 工作区文件：两种写法都接（见 wsChipUserRel），落点必须是同一个文件
  //（解析不解析看后缀，见 learn/tabs 的 viewOf）；目录没有页签形态——跳到所属节点
  if (p.type === 'ws') {
    if (p.dir) return p.nodeId ? { kind: 'teach', nodeId: p.nodeId } : null
    const rel = p.path ? wsChipUserRel(store, p.path) : null
    if (!rel) return null
    const abs = userAbsPath(rel)
    return abs ? { kind: 'local', path: abs } : null
  }
  // 考试：只有「某一次的副本」能开成页签；原件返回 null（opener 走考试窗口）
  if (p.type === 'exam') {
    const exam = p.examId ? store.exams.find((e) => e.id === p.examId) : undefined
    if (!exam || !p.attemptId) return null
    return { kind: 'exam', nodeId: exam.nodeId, examId: exam.id, attemptId: p.attemptId }
  }

  const want = p.path ? normPath(p.path) : null
  /** 这条路径是不是正指着它（chip 没给路径时只信 nodeId） */
  const matches = (rel: string | null): boolean => !!rel && (!want || normPath(rel) === want)

  // 先按带出来的 nodeId 对号：宿主拖出来的 chip 都带，一次查表就够
  const node = p.nodeId ? nodeById(store, p.nodeId) : undefined
  if (node) {
    const rel =
      p.type === 'note'
        ? nodeDocPath(store, node.id, { kind: 'note', note: p.note ?? '' })
        : p.type === 'outline'
          ? nodeDocPath(store, node.id, { kind: 'outline' })
          : nodeDocPath(store, node.id, { kind: 'teaching' })
    if (p.type === 'doc' && matches(rel)) return { kind: 'teach', nodeId: node.id }
    if (p.type === 'note' && p.note && matches(rel)) return { kind: 'note', nodeId: node.id, note: p.note }
    if (p.type === 'outline' && matches(rel)) return { kind: 'outline', nodeId: node.id }
    if (p.type === 'super' && p.name && matches(rel)) return { kind: 'super', nodeId: node.id, name: p.name }
  }

  // 反查：遍历全部节点，谁的哪份文档路径正好是它。节点量级几十个，点击时跑一次无所谓
  if (want) {
    for (const n of store.nodes) {
      const teachRel = nodeDocPath(store, n.id, { kind: 'teaching' })
      if (p.type === 'super' && p.name) {
        // 超级文档没有自己的文件（存在节点数据里）：按「节点教学文档路径 + 名字」认
        if (teachRel && normPath(teachRel) === want) return { kind: 'super', nodeId: n.id, name: p.name }
        continue
      }
      if (p.type === 'doc' && teachRel && normPath(teachRel) === want) return { kind: 'teach', nodeId: n.id }
      if (p.type === 'outline' && nodeDocPath(store, n.id, { kind: 'outline' }) === want) {
        return { kind: 'outline', nodeId: n.id }
      }
      for (const note of notesOf(n)) {
        if (nodeDocPath(store, n.id, { kind: 'note', note: note.name }) === want) {
          return { kind: 'note', nodeId: n.id, note: note.name }
        }
      }
    }
  }
  return null
}
