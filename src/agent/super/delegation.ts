/**
 * 跨专家协作委派追踪器 (DelegationTracker)
 *
 * 职责：
 * 1. 追踪从外部进入的跨 Agent 委派任务（DelegatedTaskInput）；
 * 2. 关联 Host 在处理该委派时通过 spawn_worker 产生的 1~N 个内部 Worker；
 * 3. 单层结算：若 Host 仅作直答并未派生 Worker，Host 轮末立即以正文结算；
 * 4. 双层结算：若 Host 派生了 Worker，监听这批 Worker 全部达到终态后聚合产物与摘要触发结算；
 * 5. 向上暴露当前活跃委派上下文（供 teamTools 读取 chain 与 hopCount 做防环与跳数硬拦截）。
 */

import type {
  DelegatedTaskInput,
  DelegationOutcome,
  WorkerSession,
} from './types'

interface ActiveDelegationRecord {
  input: DelegatedTaskInput
  spawnedWorkerIds: string[]
  hostChatText: string
  hostFinished: boolean
  resolve: (outcome: DelegationOutcome) => void
  reject: (err: unknown) => void
}

export class DelegationTracker {
  private activeDelegations = new Map<string, ActiveDelegationRecord>()
  private currentDelegationId: string | null = null

  /**
   * 开启一次委派追踪（在 Host 串行任务启动前调用）
   */
  public startDelegation(
    input: DelegatedTaskInput,
    resolve: (outcome: DelegationOutcome) => void,
    reject: (err: unknown) => void,
  ): void {
    this.currentDelegationId = input.delegationId
    this.activeDelegations.set(input.delegationId, {
      input,
      spawnedWorkerIds: [],
      hostChatText: '',
      hostFinished: false,
      resolve,
      reject,
    })
  }

  /**
   * 获取当前 Host 正在处理的委派单上下文（若当前是由用户直发消息驱动则返回 null）
   */
  public getCurrentDelegation(): DelegatedTaskInput | null {
    if (!this.currentDelegationId) return null
    return this.activeDelegations.get(this.currentDelegationId)?.input ?? null
  }

  /**
   * 记录 Host 在当前委派轮次中派生的内部 Worker
   */
  public recordSpawnedWorker(workerId: string): void {
    if (!this.currentDelegationId) return
    const rec = this.activeDelegations.get(this.currentDelegationId)
    if (rec) {
      rec.spawnedWorkerIds.push(workerId)
    }
  }

  /**
   * Host 单轮执行完毕后的通知
   */
  public hostTurnFinished(
    delegationId: string,
    hostChatText: string,
    getWorkerSession: (id: string) => WorkerSession | undefined,
  ): void {
    if (this.currentDelegationId === delegationId) {
      this.currentDelegationId = null
    }

    const rec = this.activeDelegations.get(delegationId)
    if (!rec) return
    rec.hostFinished = true
    rec.hostChatText = hostChatText

    if (rec.spawnedWorkerIds.length === 0) {
      // 单层闭环：Host 未派发 Worker，直接以 Host 正文结算
      this.settle(delegationId, {
        delegationId,
        status: 'done',
        summary: hostChatText || '任务已答复处理',
        artifactIds: [],
        chatText: hostChatText,
      })
    } else {
      // 双层闭环：检查所有 Worker 是否已先行终态
      this.checkWorkersSettled(delegationId, getWorkerSession)
    }
  }

  /**
   * Host 调度异常中断通知
   */
  public hostTurnFailed(delegationId: string, error: unknown): void {
    if (this.currentDelegationId === delegationId) {
      this.currentDelegationId = null
    }

    const rec = this.activeDelegations.get(delegationId)
    if (!rec) return
    this.settle(delegationId, {
      delegationId,
      status: 'failed',
      summary: error instanceof Error ? error.message : String(error),
      artifactIds: [],
    })
  }

  /**
   * 任意 Worker 达到终态（done / failed / cancelled）时的检查入口
   */
  public onWorkerTerminal(
    workerId: string,
    getWorkerSession: (id: string) => WorkerSession | undefined,
  ): void {
    for (const [delId, rec] of this.activeDelegations.entries()) {
      if (rec.spawnedWorkerIds.includes(workerId)) {
        if (rec.hostFinished) {
          this.checkWorkersSettled(delId, getWorkerSession)
        }
      }
    }
  }

  /**
   * 检查指定委派的所有关联 Worker 是否全部处于终态
   */
  private checkWorkersSettled(
    delegationId: string,
    getWorkerSession: (id: string) => WorkerSession | undefined,
  ): void {
    const rec = this.activeDelegations.get(delegationId)
    if (!rec || !rec.hostFinished) return

    const sessions = rec.spawnedWorkerIds
      .map((id) => getWorkerSession(id))
      .filter((s): s is WorkerSession => Boolean(s))

    const allTerminal =
      sessions.length === rec.spawnedWorkerIds.length &&
      sessions.every((s) => s.status === 'done' || s.status === 'failed' || s.status === 'cancelled')

    if (!allTerminal) return

    const hasDone = sessions.some((s) => s.status === 'done')
    const allCancelled = sessions.every((s) => s.status === 'cancelled')
    const allFailed = sessions.every((s) => s.status === 'failed')

    let status: 'done' | 'failed' | 'cancelled' = 'done'
    if (allCancelled) {
      status = 'cancelled'
    } else if (allFailed || !hasDone) {
      status = 'failed'
    }

    const artifactIds = Array.from(
      new Set(sessions.flatMap((s) => s.artifacts.map((a) => a.id))),
    )

    const summaries = sessions
      .map((s) => `[${s.title}]: ${s.chatText || (s.error ? `错误: ${s.error}` : '已完成')}`)
      .join('; ')

    this.settle(delegationId, {
      delegationId,
      status,
      summary: summaries || rec.hostChatText || '已完成委派任务',
      artifactIds,
      chatText: rec.hostChatText || summaries,
    })
  }

  private settle(delegationId: string, outcome: DelegationOutcome): void {
    const rec = this.activeDelegations.get(delegationId)
    if (!rec) return
    this.activeDelegations.delete(delegationId)
    rec.resolve(outcome)
  }
}
