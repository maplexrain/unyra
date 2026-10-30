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
import { nodePathOf } from './paths'
import { DOCS_DIR, WORKSPACE_DIR } from './layout'
import { nodeById } from './graph/lookup'
import { normalizeKey, prereqIds } from './graph'
import { newWebKey } from './tabs'
import { wsJoin, wsRefOfRel, wsRelOf } from './workspace'
import { notesOf, type KnowledgeNode, type LearnStore, type TabRef } from './types'
import type { Exam, ExamAttempt } from './exam'

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

export function findExamFromChip(store: LearnStore, p: ChipPayload): Exam | undefined {
  if (p.examId) {
    const found = store.exams.find((e) => e.id === p.examId)
    if (found) return found
  }
  if (p.attemptId) {
    const found = store.exams.find((e) => e.attempts.some((a: ExamAttempt) => a.id === p.attemptId))
    if (found) return found
  }
  if (p.nodeId) {
    const found = store.exams.filter((e) => e.nodeId === p.nodeId).sort((a, b) => b.createdAt - a.createdAt)[0]
    if (found) return found
  }
  if (p.path) {
    const wanted = p.path.replace(/\/(教学|讲义|笔记|大纲|试卷|考试|考试记录|试卷记录)$/, '').replace(/\\/g, '/').trim().replace(/\/+$/, '')
    const targetGoalId = p.goalId || store.activeGoalId
    const candidateNodes = targetGoalId
      ? [
          ...store.nodes.filter((n) => n.goalId === targetGoalId),
          ...store.nodes.filter((n) => n.goalId !== targetGoalId),
        ]
      : store.nodes
    const targetNode =
      candidateNodes.find((n) => !!n.goalId && nodePathOf(store, n.goalId, n.id).toLowerCase() === wanted.toLowerCase()) ??
      candidateNodes.find((n) => n.title.toLowerCase() === wanted.toLowerCase() || n.key === normalizeKey(wanted)) ??
      candidateNodes.find((n) => wanted.toLowerCase().endsWith(n.title.toLowerCase()))
    if (targetNode) {
      const found = store.exams.filter((e) => e.nodeId === targetNode.id).sort((a, b) => b.createdAt - a.createdAt)[0]
      if (found) return found
    }
  }
  return undefined
}

export function tabRefFromChip(store: LearnStore, p: ChipPayload): TabRef | null {
  // 网页：网址就是身份，现场开一枚新页签（key 是开签那一刻的身份，见 learn/tabs）
  if (p.type === 'web') return p.url ? { kind: 'web', url: p.url, key: newWebKey() } : null
  // 外部文件：路径就是身份
  if (p.type === 'local') return p.path ? { kind: 'local', path: p.path } : null
  // 工作区文件：两种写法都接（见 wsChipUserRel），落点必须是同一个文件。
  // 落点是**内部文件**页签（ws，挂在它工作区所属的节点上——打开时过目标的组）；
  // 解析不解析看后缀（见 learn/tabs 的 viewOf）；目录没有页签形态——跳到所属节点
  if (p.type === 'ws') {
    if (p.dir) return p.nodeId ? { kind: 'teach', nodeId: p.nodeId } : null
    const rel = p.path ? wsChipUserRel(store, p.path) : null
    return rel ? wsRefOfRel(store, rel) : null
  }
  // 考试：只有「某一次的副本」能开成页签。attempt 型（拖考试副本进输入框、exam.read
  // 回执里给的）与带 attemptId 的 exam 型是同一个落点；attemptId 必须真在 attempts 里——
  // 放过去只会开出一张「这份试卷已经被删了」的空页签，宁可打不开。
  // 原件（exam 不带 attemptId）返回 null，opener 分流到考试窗口。
  if (p.type === 'exam' || p.type === 'attempt') {
    const exam = findExamFromChip(store, p)
    if (!exam) return null
    const attemptId = p.attemptId ?? (p.type === 'attempt' && exam.attempts.length > 0 ? exam.attempts[exam.attempts.length - 1].id : undefined)
    if (!attemptId) return null
    if (!exam.attempts.some((a) => a.id === attemptId)) return null
    return {
      kind: 'exam',
      nodeId: exam.nodeId,
      examId: exam.id,
      attemptId,
      }
  }

  const want = p.path ? normPath(p.path) : null

  /**
   * 先按带出来的 nodeId 对号：宿主拖出来的 chip 都带，一次查表就够。
   *
   * **这里不再拿路径去核对**：节点内容合并成一个 `.node.json` 之后，正文/大纲/笔记
   * 的路径全都指向同一个文件，路径已经没有区分能力；而且老会话里的 chip 存的是
   * 旧布局的路径（`{节点}.md`），拿它对号只会让一批历史引用点不开。
   * 于是判据换成「nodeId 在 + 那份东西还在」——路径退化成没有 nodeId 时的兜底。
   */
  const node = p.nodeId ? nodeById(store, p.nodeId) : undefined
  if (node) {
    if (p.type === 'doc') return { kind: 'teach', nodeId: node.id }
    if (p.type === 'outline') return { kind: 'outline', nodeId: node.id }
    if (p.type === 'note' && p.note) {
      return notesOf(node).some((n) => n.name === p.note)
        ? { kind: 'note', nodeId: node.id, note: p.note }
        : null
    }
    if (p.type === 'super' && p.name) {
      return (node.superdocs ?? []).some((s) => s.name === p.name)
        ? { kind: 'super', nodeId: node.id, name: p.name }
        : null
    }
  }

  // 兜底：chip 没带 nodeId，只有一条路径。节点量级几十个，点击时跑一次无所谓
  if (want) {
    const targetGoalId = p.goalId || store.activeGoalId
    const orderedNodes = targetGoalId
      ? [
          ...store.nodes.filter((n) => n.goalId === targetGoalId),
          ...store.nodes.filter((n) => n.goalId !== targetGoalId),
        ]
      : store.nodes
    for (const n of orderedNodes) {
      const rel = nodeDocPath(store, n.id, { kind: 'teaching' })
      if (!rel || normPath(rel) !== want) continue
      if (p.type === 'doc') return { kind: 'teach', nodeId: n.id }
      if (p.type === 'outline') return { kind: 'outline', nodeId: n.id }
      if (p.type === 'note' && p.note) {
        if (notesOf(n).some((x) => x.name === p.note)) return { kind: 'note', nodeId: n.id, note: p.note }
      }
      if (p.type === 'super' && p.name) {
        if ((n.superdocs ?? []).some((s) => s.name === p.name)) return { kind: 'super', nodeId: n.id, name: p.name }
      }
    }
  }
  return null
}

/**
 * 一颗 payload 能不能定位到真东西：能回 null，不能回一句人话。
 *
 * 与 tabRefFromChip（opener 的打开逻辑）**同源**——这里能过，点击就打得开；
 * chip.build 的生成前校验与 chip.check 的交付前自查都走它，定位规则只写这一份。
 * （exam 原件没有页签形态——opener 对它走考试窗口——所以在这里单独判存在性，
 * 不经过 tabRefFromChip。）
 */
export function chipResolveProblem(store: LearnStore, p: ChipPayload): string | null {
  if (p.type === 'web') {
    if (!p.url) return '缺 url（完整网址）'
    try {
      const u = new URL(p.url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'url 只认 http/https'
    } catch {
      return 'url 解析不开（要完整网址，如 https://…）'
    }
    return null
  }
  if (p.type === 'local') return p.path ? null : '缺 path（本地文件的完整绝对路径）'
  if (p.type === 'ws') {
    if (p.dir) return p.nodeId && nodeById(store, p.nodeId) ? null : '目录 chip 要带所属节点的 nodeId'
    return p.path && wsChipUserRel(store, p.path)
      ? null
      : '工作区路径定位不到（path 要用 workspace api 回执里的 rel，原样抄）'
  }
  if (p.type === 'exam' || p.type === 'attempt') {
    const exam = findExamFromChip(store, p)
    if (!exam) return '没有这份试卷（examId 要从 exam.read 的回执里抄，或带 attemptId）'
    if (p.type === 'attempt') {
      const attemptId = p.attemptId ?? (exam.attempts.length > 0 ? exam.attempts[exam.attempts.length - 1].id : undefined)
      if (!attemptId) return '这份试卷还没有任何考试记录'
      if (!exam.attempts.some((a: ExamAttempt) => a.id === attemptId)) {
        return '这份试卷里没有这一次考试（attemptId 从 exam.read 的 history 里抄）'
      }
    }
    return null
  }
  return tabRefFromChip(store, p) ? null : '定位不到这份引用（path 要是数据树里的真实文档路径——用 chip.build 生成，不要手写）'
}
