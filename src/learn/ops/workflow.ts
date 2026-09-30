/**
 * 工作流登记表（wf.*）这一组 ops 的宿主实现（见 learn/workflows）。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 wf.* 一组。
 */

import type { WorkflowOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import { listWorkflowRows, removeWorkflow, upsertWorkflow } from '../workflows'

/**
 * 工作流登记表（wf.*）的宿主实现（见 learn/workflows）。
 *
 * 视角按当前目标裁剪：list 给「内置 + 全局 + 当前目标」三段；create 缺省落目标级，
 * tier: 'global' 才跨目标。内置条目一并列出（带完整指令）——模型得知道有哪些
 * 现成的流程、触发时用户消息里会出现什么，才不会自己再编一套重复的。
 */
export function createWorkflowOps(deps: AgentOpsDeps): WorkflowOps {
  const store0 = () => deps.getLatest()
  const goal = () => deps.goalId()

  return {
    list: () => {
      const rows = listWorkflowRows(store0(), goal())
      return {
        count: rows.length,
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          tier: r.tier,
          description: r.description,
          chars: r.instruction.length,
          instruction: r.instruction,
        })),
        note:
          'tier: builtin=内置（随应用提供、不可删）/ global=所有目标可用 / goal=仅当前目标。' +
          '工作流**不进系统提示词**：被触发（用户在界面上点）时，instruction 才作为一条 user 消息整段进入你的上下文。',
      }
    },

    create: (input) => {
      const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
      const tier = rec.tier === 'global' ? ('global' as const) : ('goal' as const)
      const r = upsertWorkflow(store0(), tier, goal(), rec, Date.now())
      if (!r.ok) return { error: r.error }
      deps.set(r.store)
      return {
        ok: true,
        id: r.entry.id,
        name: r.entry.name,
        tier,
        ...(r.updated ? { updated: true } : { created: true }),
        note:
          (r.updated ? '已覆盖更新工作流「' + r.entry.name + '」' : '已登记工作流「' + r.entry.name + '」（' + (tier === 'global' ? '全局' : '目标级') + '）') +
          '。它不会进系统提示词——用户在工作流列表里触发它时，instruction 会以 user 消息出现。用 wf.list() 能看到。',
      }
    },

    remove: (ref) => {
      const s = store0()
      const key = ref.trim().toLowerCase()
      const hit = listWorkflowRows(s, goal()).find((r) => r.id.toLowerCase() === key || r.name.toLowerCase() === key)
      if (!hit) {
        return { error: '没有这个工作流：' + (ref || '（空）') + '。用 wf.list() 核对 id 或名字。' }
      }
      if (hit.tier === 'builtin') {
        return { error: '「' + hit.name + '」是内置工作流，删不掉。' }
      }
      deps.set(removeWorkflow(s, hit.id))
      return { ok: true, deleted: hit.name, note: '已删除。设置里的工作流列表也会同步消失。' }
    },
  }
}
