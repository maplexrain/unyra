/**
 * 双层投影与回执序列化层 (Projection)
 *
 * 职责：
 * 1. 严格区分思考/执行过程 (mind) 与面向人类的最终交付正文 (chat)。
 * 2. 将控制面静默回执 (Mailbox) 格式化为确定性前置文本块，拼入 Host 当轮 user 消息。
 */

import type { AgentPart } from '../types'
import type { WorkerReceipt, WorkerStatus } from './types'

/**
 * 提取面向人类沟通的正文（零拷贝直出/交付物）。
 *
 * 规则：
 * 1. 若存在工具调用，优先提取最后一个工具调用之后的纯文本段（即无工具调用的最终收口段）；
 * 2. 若末段无字（如纯工具执行），回退至该轮出现的全部正文拼接；
 * 3. 严格剔除思考内容 (thinking)、工具卡片 (tool)、跳标记 (hop) 与通知 (notice)。
 */
export function extractChatText(parts: AgentPart[]): string {
  if (!parts.length) return ''

  let lastToolIdx = -1
  parts.forEach((p, i) => {
    if (p.type === 'tool') lastToolIdx = i
  })

  // 如果有工具调用，先看末尾有没有直接收口文字
  if (lastToolIdx !== -1) {
    const trailingText = parts
      .slice(lastToolIdx + 1)
      .filter((p): p is Extract<AgentPart, { type: 'text' }> => p.type === 'text')
      .map((p) => p.text)
      .join('')
      .trim()
    if (trailingText) return trailingText
  }

  // 否则取整段历史中所有的 text 片段
  return parts
    .filter((p): p is Extract<AgentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('')
    .trim()
}

/**
 * 提取过程片段（供折叠面板展示或 Worker 活跃推理）。
 */
export function extractMindParts(parts: AgentPart[]): AgentPart[] {
  return parts.filter(
    (p) => p.type === 'thinking' || p.type === 'tool' || p.type === 'hop' || p.type === 'notice',
  )
}

/** 状态映射为中文标签 */
const STATUS_LABEL: Record<WorkerReceipt['status'], string> = {
  done: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
  waiting_input: '等待输入',
}

/**
 * 将积压的 WorkerReceipt[] 格式化为紧凑、确定性的提示头文本块。
 */
export function formatMailboxHeader(receipts: WorkerReceipt[]): string {
  if (!receipts.length) return ''

  const lines = receipts.map((r) => {
    const status = STATUS_LABEL[r.status] || r.status
    const arts = r.artifactIds.length ? ` [产物ID: ${r.artifactIds.join(', ')}]` : ''
    return `- [${status}] ${r.title} (ID: ${r.workerId}): ${r.summary}${arts}`
  })

  return `【后台工作回执（共 ${receipts.length} 项）】\n${lines.join('\n')}`
}

/**
 * 在触发 Host 的瞬间，把消费掉的 receipts 与极简活跃 Worker 清单拼接到本次 user 消息头部。
 *
 * 保证：
 * 1. 严格在当轮 user 消息中一次性拼合，不修改任何既往历史消息；
 * 2. 格式与换行确定，完全满足 KV Cache 前缀只增铁律。
 */
export function buildHostUserPayload(
  userText: string,
  receipts: WorkerReceipt[],
  activeWorkers: Array<{ id: string; title: string; status: WorkerStatus; goal: string }> = [],
): string {
  const blocks: string[] = []

  const mailboxBlock = formatMailboxHeader(receipts)
  if (mailboxBlock) {
    blocks.push(mailboxBlock)
  }

  const runningOrWaiting = activeWorkers.filter(
    (w) => w.status === 'running' || w.status === 'waiting_input',
  )
  if (runningOrWaiting.length) {
    const lines = runningOrWaiting.map(
      (w) => `- ${w.title} (ID: ${w.id}) [${w.status === 'running' ? '运行中' : '等待输入'}]: 目标「${w.goal}」`,
    )
    blocks.push(`【当前仍在运行的工单（共 ${runningOrWaiting.length} 个）】\n${lines.join('\n')}`)
  }

  blocks.push(userText)
  return blocks.join('\n\n')
}
