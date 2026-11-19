/**
 * 共享外置黑板 (Blackboard Store & Index)
 *
 * 职责：
 * 1. 结构化沉淀所有 Worker 的元数据索引、目标、执行摘要与产物指针。
 * 2. 提供跨会话/跨 Worker 的轻量级关键词与多标签加权检索（供 Host 与 Worker 引用）。
 * 3. 产物全局检索与跨任务引用桥接。
 */

import type { ArtifactRecord, BlackboardEntry, SuperAgentState, WorkerSession } from './types'

/**
 * 将 Worker 的最新执行情况同步入黑板索引列表。
 */
export function upsertBlackboardEntry(
  entries: BlackboardEntry[],
  worker: WorkerSession,
  summaryOverride?: string,
  tags: string[] = [],
): BlackboardEntry[] {
  const summary =
    summaryOverride ||
    (worker.chatText.length > 200 ? worker.chatText.slice(0, 200) + '…' : worker.chatText) ||
    '无摘要说明'

  const artifactIds = worker.artifacts.map((a) => a.id)

  const existingIdx = entries.findIndex((e) => e.workerId === worker.id)
  const entry: BlackboardEntry = {
    workerId: worker.id,
    title: worker.title,
    goal: worker.goal,
    status: worker.status,
    summary,
    artifactIds,
    tags: Array.from(new Set([...(existingIdx >= 0 ? entries[existingIdx].tags : []), ...tags])),
    updatedAt: Date.now(),
  }

  if (existingIdx >= 0) {
    const next = [...entries]
    next[existingIdx] = entry
    return next
  }

  return [...entries, entry]
}

/**
 * 搜索黑板索引（多关键词加权匹配）。
 *
 * 加权规则：
 * - 标题完全匹配或包含 (+10)
 * - 标签匹配 (+8)
 * - 目标匹配 (+5)
 * - 摘要匹配 (+2)
 */
export function searchBlackboard(
  entries: BlackboardEntry[],
  query: string,
  limit = 5,
): BlackboardEntry[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) {
    return [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean)

  const scored: Array<{ entry: BlackboardEntry; score: number }> = []

  for (const entry of entries) {
    let score = 0
    const titleLower = entry.title.toLowerCase()
    const goalLower = entry.goal.toLowerCase()
    const summaryLower = entry.summary.toLowerCase()
    const tagsLower = entry.tags.map((t) => t.toLowerCase())

    for (const token of tokens) {
      if (titleLower.includes(token)) score += 10
      if (tagsLower.some((t) => t.includes(token))) score += 8
      if (goalLower.includes(token)) score += 5
      if (summaryLower.includes(token)) score += 2
    }

    if (score > 0) {
      scored.push({ entry, score })
    }
  }

  scored.sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
  return scored.slice(0, limit).map((s) => s.entry)
}

/**
 * 跨 Worker 寻找指定产物记录。
 */
export function findArtifact(
  state: SuperAgentState,
  artifactId: string,
): ArtifactRecord | null {
  for (const worker of Object.values(state.workers)) {
    const found = worker.artifacts.find((a) => a.id === artifactId)
    if (found) return found
  }
  return null
}

/**
 * 列出当前活跃（运行中或等待输入）的黑板条目。
 */
export function listActiveEntries(entries: BlackboardEntry[]): BlackboardEntry[] {
  return entries.filter((e) => e.status === 'running' || e.status === 'waiting_input')
}
