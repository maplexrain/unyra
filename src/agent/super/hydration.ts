/**
 * SuperAgent 状态持久化反序列化与冷启动崩溃恢复
 *
 * 职责：
 * 1. 扫描 workers：将残留处于 'running' 状态的 Worker 归一化为 'failed'，附带 '应用重启，任务被中断'；
 * 2. 清洗可能残缺的字段（确保数组和对象均不为 null/undefined）；
 * 3. 重置残留的 prefixGate 缓存键。
 */

import { resetPrefixGate } from '../prefixGate'
import type { SuperAgentState, WorkerSession } from './types'

export const DEFAULT_HOST_SYSTEM = `你是 Frontline Host（前台总调度助手）。
你的职责是作为用户的唯一接待前台，倾听学习者的需求：
1. 简单问答、概念解释、闲聊或确认性提问：直接作答，言简意赅，不要创建 Worker；
2. 复杂任务、需要资料检索、讲义编写、试卷编排或数据实验的长任务：调用 spawn_worker 委派给后台隔离工坊去执行；
3. 需要修正或补充后台任务：调用 steer_worker；取消任务调用 cancel_worker；查看历史或索引调用 query_blackboard / inspect_worker；
4. 你自身没有长耗时沙箱，严格禁止假装已经完成了复杂产出；委派任务后即刻向用户汇报已派出专员即可。`

export const DEFAULT_WORKER_SYSTEM = `你是专职执行工单的后台 Worker。
请聚焦完成被指派的目标，产出清晰、严谨、面向学习者的内容。
在收口时直接输出完整的高质量成果正文。`

export function hydrateSuperAgentState(raw: unknown): SuperAgentState {
  if (!raw || typeof raw !== 'object') {
    return {
      id: crypto.randomUUID(),
      hostSystemPrompt: DEFAULT_HOST_SYSTEM,
      hostMessages: [],
      workers: {},
      mailbox: [],
      blackboard: [],
    }
  }

  const s = raw as Partial<SuperAgentState>
  const id = typeof s.id === 'string' && s.id ? s.id : crypto.randomUUID()
  const hostSystemPrompt =
    typeof s.hostSystemPrompt === 'string' && s.hostSystemPrompt.trim()
      ? s.hostSystemPrompt
      : DEFAULT_HOST_SYSTEM
  const hostMessages = Array.isArray(s.hostMessages) ? s.hostMessages : []
  const mailbox = Array.isArray(s.mailbox) ? s.mailbox : []
  const blackboard = Array.isArray(s.blackboard) ? s.blackboard : []

  const rawWorkers = s.workers && typeof s.workers === 'object' ? s.workers : {}
  const workers: Record<string, WorkerSession> = {}

  for (const [wid, w] of Object.entries(rawWorkers)) {
    if (!w || typeof w !== 'object') continue
    const session = { ...w } as WorkerSession
    // 恢复时将未完成的 running 状态归一化为 failed
    if (session.status === 'running') {
      session.status = 'failed'
      session.error = '应用重启，任务被中断'
      session.updatedAt = Date.now()
    }
    // 确保数组属性完整
    if (!Array.isArray(session.messages)) session.messages = []
    if (!Array.isArray(session.artifacts)) session.artifacts = []
    if (typeof session.chatText !== 'string') session.chatText = ''

    workers[wid] = session
    resetPrefixGate('super:worker:' + wid)
  }

  resetPrefixGate('super:host:' + id)

  return {
    id,
    hostSystemPrompt,
    hostMessages,
    workers,
    mailbox,
    blackboard,
  }
}
