/**
 * 全局统一智能体语义状态定义 (agentStatusMeta)
 *
 * 铁律：
 * 全界面只保留 5 种一眼可辨的语义状态：
 * 1. waiting_input: 琥珀色闪烁点 + 「等你回复」 (最高优先级)
 * 2. host_running: 蓝色脉冲点 + 「回复中」
 * 3. worker_running: 绿色脉冲点 + 「执行中 (N)」
 * 4. error: 红色静点 + 「异常」
 * 5. idle: 浅灰静点 (空闲无多余文字)
 */

import type { AgentViewSnapshot } from '../../../learn/superAgent/useAgentTeam'
import { t } from '../../../i18n'

export type AgentStatusKind = 'waiting_input' | 'host_running' | 'worker_running' | 'error' | 'idle'

export interface AgentStatusMeta {
  kind: AgentStatusKind
  label: string
  badgeText?: string
  dotClass: string
  pillClass: string
}

export function deriveAgentStatus(agent?: AgentViewSnapshot | null): AgentStatusMeta {
  if (!agent) {
    return {
      kind: 'idle',
      label: t('待命'),
      dotClass: 'bg-ink-faint/40',
      pillClass: 'bg-line/40 text-ink-faint',
    }
  }

  // 1. 最高优先级：有工单挂起等待人类输入
  if (agent.waitingWorkersCount > 0) {
    return {
      kind: 'waiting_input',
      label: t('等你回复'),
      badgeText: '?',
      dotClass: 'bg-amber-500 animate-ping',
      pillClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30',
    }
  }

  // 2. Host 主控正在规划调度中
  if (agent.hostRunning) {
    return {
      kind: 'host_running',
      label: t('回复中'),
      dotClass: 'bg-sky-500 animate-pulse',
      pillClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30',
    }
  }

  // 3. 后台工单正在执行中
  if (agent.runningWorkersCount > 0) {
    return {
      kind: 'worker_running',
      label: t('执行中 ({0})', agent.runningWorkersCount),
      badgeText: String(agent.runningWorkersCount),
      dotClass: 'bg-emerald-500 animate-pulse',
      pillClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30',
    }
  }

  // 4. 空闲待命（若有未消费回执，可作为轻量辅助数字，但状态本身归为 idle）
  return {
    kind: 'idle',
    label: t('待命'),
    badgeText: agent.mailboxCount > 0 ? String(agent.mailboxCount) : undefined,
    dotClass: 'bg-ink-faint/40',
    pillClass: 'bg-line/60 text-ink-faint',
  }
}
