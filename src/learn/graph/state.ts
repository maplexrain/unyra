/**
 * 本文件负责：节点状态的写入（学习中 / 已掌握）。
 *
 * 这里原先还有学习状态（自评、掌握度、错题、检验时间线）的写入；那套功能已经移除，
 * 节点上只留 `status` 与 `lastStudiedAt`（后者见 graph/nodes 的 touchNode）。
 */
import type { LearnStore, MasteryStatus } from '../types'
import { updateNode } from './nodes'

export function setNodeStatus(store: LearnStore, id: string, status: MasteryStatus): LearnStore {
  return updateNode(store, id, { status })
}
