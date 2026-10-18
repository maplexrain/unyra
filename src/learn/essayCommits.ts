/**
 * 随笔提交：把「这一段随笔」封成一份快照，交给 Agent 整理进知识树，再把整理结果记回来。
 *
 * 为什么要提交，而不是每次写完就让 Agent 整理：
 * - 随笔是**随手写**的，半句话、错别字、临时念头都有；一提交才算「这批可以归档了」；
 * - 提交要有一份**当时的原样**（snapshot）——之后随笔改了、删了，回看这次整理时
 *   仍然知道它当时读到了什么；
 * - 整理动了哪几份笔记**由宿主自己对比 store 得出**（noteFingerprint / diffNoteChanges），
 *   不靠模型自报：模型说改了 A、实际改的是 B 时，记录仍然可信。
 *
 * 落盘跟着随笔一起进 `{目标}/essay.json`（`{ version: 2, essays, commits }`）：
 * 提交与它封存的那批随笔必须同生共死，分两个文件只会在一次写盘失败时对不上。
 */

import { t } from '../i18n'
import { essaysOf } from './essays'
import type {
  EssayCommit,
  EssayCommitChange,
  EssayCommitStore,
  EssayEntry,
  KnowledgeNode,
  LearnStore,
} from './types'

/** 提交说明的上限：够写一句话，防手滑把整段随笔粘进来 */
export const ESSAY_COMMIT_MESSAGE_MAX = 200
/** 一条快照里保留的正文上限：与随笔本身的单条上限一致（见 essays 的 ESSAY_TEXT_MAX） */
const SNAPSHOT_TEXT_MAX = 20_000

/** 这个目标的提交记录（新的在前） */
export function commitsOf(store: LearnStore, goalId: string): EssayCommit[] {
  return store.essayCommits?.[goalId] ?? []
}

/** 最近一次提交的时刻；一次都没提交过就是 0（于是所有随笔都算「还没提交」） */
export function lastCommitAt(store: LearnStore, goalId: string): number {
  return commitsOf(store, goalId)[0]?.at ?? 0
}

/**
 * 还没提交的随笔：`updatedAt` 晚于最近一次提交的都算。
 *
 * 用时间而不是「id 有没有出现过」：一条旧随笔改了两个字也应该再次进整理，
 * 而「改过」这件事只有 updatedAt 说得清。
 */
export function pendingEssays(store: LearnStore, goalId: string): EssayEntry[] {
  const since = lastCommitAt(store, goalId)
  return essaysOf(store, goalId).filter((e) => e.updatedAt > since)
}

/** 换一份提交清单（保持「新的在前」） */
function withCommits(store: LearnStore, goalId: string, list: EssayCommit[]): LearnStore {
  const next: EssayCommitStore = { ...(store.essayCommits ?? {}) }
  if (list.length) next[goalId] = list
  else delete next[goalId]
  return { ...store, essayCommits: next }
}

/**
 * 提交一次：把「上次提交之后写/改过的」随笔封成快照，插到最前面。
 * 没有待提交内容时返回 null（空提交没有意义，也不该在历史里留一条空记录）。
 */
export function createEssayCommit(
  store: LearnStore,
  goalId: string,
  message: string,
  at: number,
): { store: LearnStore; commit: EssayCommit } | null {
  const pending = pendingEssays(store, goalId)
  if (!pending.length) return null
  const commit: EssayCommit = {
    id: crypto.randomUUID(),
    at,
    message: (message.trim() || t('随笔整理')).slice(0, ESSAY_COMMIT_MESSAGE_MAX),
    snapshot: pending.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      text: e.text.slice(0, SNAPSHOT_TEXT_MAX),
    })),
    status: 'running',
    changes: [],
  }
  return {
    store: withCommits(store, goalId, [commit, ...commitsOf(store, goalId)]),
    commit,
  }
}

/** 改一条提交记录（整理完成 / 失败 / 重试） */
export function updateEssayCommit(
  store: LearnStore,
  goalId: string,
  id: string,
  patch: Partial<Pick<EssayCommit, 'status' | 'changes' | 'error'>>,
): LearnStore {
  const list = commitsOf(store, goalId)
  if (!list.some((c) => c.id === id)) return store
  return withCommits(
    store,
    goalId,
    list.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  )
}

/** 快照文本的上限：提交是「这一批随笔」，但一轮对话放不下几万字——超出部分只留在快照里 */
const SNAPSHOT_FEED_MAX = 24_000
/** 增量喂法里，单条随笔正文的上限（一条随笔本身就已经到 20k 时会截断） */
const PER_ESSAY_FEED_MAX = 6_000
/** 历史里最多列最近几次提交：再往前的整理记录对「这次放哪儿」没有帮助 */
const HISTORY_MAX = 6

const pad2 = (n: number): string => String(n).padStart(2, '0')
const dayOfTs = (ts: number): string => {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
const stampOfTs = (ts: number): string => {
  const d = new Date(ts)
  return dayOfTs(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/**
 * 一条「修改过的随笔」只给出改动处：取公共前后缀，中间那段就是新增 / 改写的内容。
 *
 * 为什么不做逐行 diff：随笔常常是一整段话，按行切只有一行，等于没切；
 * 而「接着往下写」是最常见的修改，公共前缀极长，取前后缀正好逮住新加的那几句。
 */
function deltaOf(prev: string, next: string): string {
  const max = Math.min(prev.length, next.length)
  let head = 0
  while (head < max && prev[head] === next[head]) head++
  let tail = 0
  while (tail < max - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++
  const before = prev.slice(Math.max(0, head - 40), head)
  const changed = next.slice(head, next.length - tail)
  const after = next.slice(next.length - tail, next.length - tail + 40)
  const body = changed.length > PER_ESSAY_FEED_MAX ? changed.slice(0, PER_ESSAY_FEED_MAX) + '…（改动过长，已截断）' : changed
  return (
    '…' + before + '\n' +
    '>>> 新增 / 改动：\n' + body + '\n' +
    '<<< ' + after + '…'
  )
}

/**
 * 交给 Agent 的「增量材料」：**提交历史 + 本次新增全文 + 本次修改的差异**。
 *
 * 这是「整理之后还能继续写、继续提交，Agent 按历史增量改」的关键——
 * 只喂当前快照的话，模型会把上次已经整理过的内容再写一遍，笔记越整理越重复。
 */
export function commitFeed(commits: EssayCommit[], current: EssayCommit): string {
  const older = commits.filter((c) => c.id !== current.id && c.at <= current.at).sort((a, b) => a.at - b.at)
  const lines: string[] = []
  lines.push(
    '这是随笔的第 ' + (older.length + 1) + ' 次提交（提交说明：' + current.message + '）。',
  )
  if (older.length) {
    lines.push('', '【已有整理记录】（这些内容已经整理进笔记，不要重复写入）')
    for (const c of older.slice(-HISTORY_MAX)) {
      const touched = c.changes.length
        ? c.changes
            .slice(0, 8)
            .map(
              (x) =>
                (x.kind === 'created' ? '新建' : '更新') +
                '「' + (x.nodeTitle || x.nodeId) + '」/ 笔记「' + x.noteName + '」',
            )
            .join('；') + (c.changes.length > 8 ? '；等 ' + c.changes.length + ' 份笔记' : '')
        : '没有改动任何笔记'
      lines.push('- ' + stampOfTs(c.at) + '「' + c.message + '」→ ' + touched)
    }
  }

  // 每条随笔「上一次提交时的样子」：从新往旧扫，第一次遇到的就是最后一次提交的版本
  const prevById = new Map<string, string>()
  for (const c of [...older].reverse()) {
    for (const s of c.snapshot) if (!prevById.has(s.id)) prevById.set(s.id, s.text)
  }
  const fresh: EssayCommit['snapshot'] = []
  const edited: Array<{ day: string; prev: string; next: string }> = []
  for (const s of current.snapshot) {
    const before = prevById.get(s.id)
    if (before === undefined) fresh.push(s)
    else if (before !== s.text) edited.push({ day: dayOfTs(s.createdAt), prev: before, next: s.text })
  }

  let budget = SNAPSHOT_FEED_MAX
  const take = (text: string): string => {
    if (budget <= 0) return '…（本次材料过长，后面的内容已省略；完整快照在提交记录里）'
    const body = text.slice(0, Math.min(text.length, budget))
    budget -= body.length
    return body
  }

  lines.push('', fresh.length ? '【本次新增的随笔】' : '【本次没有新增随笔】')
  for (const s of fresh) {
    lines.push('【' + dayOfTs(s.createdAt) + '】', take(s.text.slice(0, PER_ESSAY_FEED_MAX)))
  }
  lines.push('', edited.length ? '【本次修改的随笔（只给改动处）】' : '【本次没有修改随笔】')
  for (const e of edited) {
    lines.push('【' + e.day + '】', take(deltaOf(e.prev, e.next)))
  }
  return lines.join('\n')
}

/* ---------- 整理前后：笔记指纹与差异 ---------- */

interface NoteMark {
  nodeId: string
  nodeTitle: string
  noteName: string
  content: string
}

/**
 * 这个目标下所有笔记的「指纹」：节点 + 笔记名 → 正文。
 *
 * 只认**笔记**（node.notes），不认教学文档：随笔整理要落的地方是笔记，
 * 教学文档由「开讲」那一套工作流负责，混进来会把整理结果记到不相干的改动上。
 */
export function noteFingerprint(store: LearnStore, goalId: string): Map<string, NoteMark> {
  const out = new Map<string, NoteMark>()
  for (const node of store.nodes) {
    if (node.goalId !== goalId) continue
    for (const note of node.notes ?? []) {
      out.set(node.id + '\u0000' + note.name, {
        nodeId: node.id,
        nodeTitle: node.title,
        noteName: note.name,
        content: note.content,
      })
    }
  }
  return out
}

/** 对比两次指纹：新建 / 正文变了的笔记，就是这次整理动过的地方 */
export function diffNoteChanges(before: Map<string, NoteMark>, after: Map<string, NoteMark>): EssayCommitChange[] {
  const out: EssayCommitChange[] = []
  for (const [key, mark] of after) {
    const prev = before.get(key)
    if (!prev) {
      out.push({ nodeId: mark.nodeId, nodeTitle: mark.nodeTitle, noteName: mark.noteName, kind: 'created' })
    } else if (prev.content !== mark.content) {
      out.push({ nodeId: mark.nodeId, nodeTitle: mark.nodeTitle, noteName: mark.noteName, kind: 'updated' })
    }
  }
  return out.sort((a, b) => a.nodeTitle.localeCompare(b.nodeTitle) || a.noteName.localeCompare(b.noteName))
}

/** 给界面看的一句总结：「新建 2 份、更新 1 份笔记」 */
export function changesSummary(changes: EssayCommitChange[]): string {
  const created = changes.filter((c) => c.kind === 'created').length
  const updated = changes.length - created
  if (!changes.length) return t('没有改动任何笔记')
  if (!created) return t('更新了 {0} 份笔记', String(updated))
  if (!updated) return t('新建了 {0} 份笔记', String(created))
  return t('新建 {0} 份、更新 {1} 份笔记', String(created), String(updated))
}

/* ---------- 读盘归一化 ---------- */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * essay.json 里 commits 的归一化。
 *
 * 认不出的丢掉；**`running` 一律降成 `error`**：整理是渲染层发起的一轮对话，
 * 应用关掉 / 刷新之后那一轮已经不存在了，留一个「整理中」在界面上永远转圈才是骗人。
 * 用户点「重试」就能再跑一次。
 */
export function normalizeEssayCommits(raw: unknown, aliveGoals: Set<string>): EssayCommitStore {
  const out: EssayCommitStore = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [goalId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!goalId || !aliveGoals.has(goalId) || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const items: EssayCommit[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const id = typeof r.id === 'string' && r.id ? r.id : crypto.randomUUID()
      if (seen.has(id)) continue
      seen.add(id)
      const at = isNum(r.at) ? r.at : Date.now()
      const snapshot: EssayCommit['snapshot'] = []
      if (Array.isArray(r.snapshot)) {
        for (const s of r.snapshot) {
          if (!s || typeof s !== 'object') continue
          const e = s as Record<string, unknown>
          const text = typeof e.text === 'string' ? e.text.slice(0, SNAPSHOT_TEXT_MAX) : ''
          if (!text.trim()) continue
          snapshot.push({
            id: typeof e.id === 'string' && e.id ? e.id : crypto.randomUUID(),
            createdAt: isNum(e.createdAt) ? e.createdAt : at,
            text,
          })
        }
      }
      if (!snapshot.length) continue
      const changes: EssayCommitChange[] = []
      if (Array.isArray(r.changes)) {
        for (const c of r.changes) {
          if (!c || typeof c !== 'object') continue
          const v = c as Record<string, unknown>
          if (typeof v.nodeId !== 'string' || !v.nodeId) continue
          if (typeof v.noteName !== 'string' || !v.noteName) continue
          changes.push({
            nodeId: v.nodeId,
            nodeTitle: typeof v.nodeTitle === 'string' ? v.nodeTitle : '',
            noteName: v.noteName,
            kind: v.kind === 'created' ? 'created' : 'updated',
          })
        }
      }
      const status = r.status === 'done' || r.status === 'error' ? r.status : 'error'
      items.push({
        id,
        at,
        message: typeof r.message === 'string' ? r.message.slice(0, ESSAY_COMMIT_MESSAGE_MAX) : t('随笔整理'),
        snapshot,
        status,
        changes,
        ...(status === 'error'
          ? {
              error:
                typeof r.error === 'string' && r.error
                  ? r.error
                  : r.status === 'running'
                    ? t('上次整理没有跑完（应用关闭或中断），可以重试')
                    : t('整理失败，可以重试'),
            }
          : {}),
      })
    }
    if (!items.length) continue
    items.sort((a, b) => b.at - a.at)
    out[goalId] = items
  }
  return out
}

/** 一条提交里动过的节点 id（界面按它高亮 / 统计用） */
export function committedNodeIds(commit: EssayCommit): string[] {
  return [...new Set(commit.changes.map((c) => c.nodeId))]
}

/** 节点 id → 节点（当前 store 里还活着的）；找不到时返回 null，界面按「已删除」显示 */
export function liveNode(store: LearnStore, nodeId: string): KnowledgeNode | null {
  return store.nodes.find((n) => n.id === nodeId) ?? null
}
