/**
 * 工作流登记表（wf.*）这一组 ops 的宿主实现（见 learn/workflows）。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 wf.* 一组。
 */

import type { WorkflowOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import {
  findWorkflow,
  listWorkflowRows,
  removeWorkflow,
  renderWorkflowInstruction,
  upsertWorkflow,
} from '../workflows'

/**
 * wf.invoke 的 params：只收字符串与数字（其余丢掉）。
 * 这些值要填进 instruction 的 {{占位符}}，模型偶尔会传对象/数组进来——留着只会渲染成 [object Object]。
 */
function invokeParams(raw: unknown): Record<string, string | number> {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v
  }
  return out
}

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
          '工作流**不进系统提示词**：被触发时（用户在界面上点，或你用 wf.invoke 交出去），' +
          'instruction 才作为一条 user 消息整段进入你的上下文。' +
          '要独占一整轮的活（出卷、复习、大纲、压缩）用 wf.invoke(idOrName, { params }) 交出去，比你自己照着做更稳。',
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

    /**
     * 触发一条工作流（见 WorkflowOps.invoke 与 deps.invokeWorkflow）。
     *
     * **不当场跑**：工作流的指令要作为一条新的 user 消息进上下文，而调用它的这一轮
     * 还在跑——只能交给宿主排队，本轮收口后由宿主另起一轮。所以这里只做三件事：
     * 找出这条流程、把意图递上去、把「已排队」说成模型读得懂的话（它很容易顺手
     * 自己照着流程做一遍，那就成了双份）。
     */
    invoke: (ref, opts) => {
      const hit = findWorkflow(store0(), goal(), ref)
      if (!hit) {
        return { error: '没有叫「' + (ref || '（空）') + '」的工作流。用 wf.list() 核对 id 或名字。' }
      }
      const run = deps.invokeWorkflow
      if (!run) {
        return { error: '这个执行环境里触发不了工作流：只有导师自己的一轮对话里可以（超级文档的桥里不行）。' }
      }
      const params = invokeParams(opts.params)
      const queued = run(hit.id, Object.keys(params).length ? { params } : {})
      // 宿主可能拒掉（这一轮已经排了一条、链太长…）：它的理由比这里的套话准，原样回给模型
      if (queued && typeof queued === 'object' && typeof (queued as { error?: unknown }).error === 'string') {
        return queued
      }
      // 没给值的占位符会原样留在指令里（见 renderWorkflowInstruction），提前点破
      const left = [...new Set(renderWorkflowInstruction(hit.instruction, params).match(/{{w+}}/g) ?? [])]
      return {
        ok: true,
        workflow: hit.name,
        queued: true,
        note:
          '「' + hit.name + '」已经排队：**这一轮收口之后**，它的指令会作为一条 user 消息进入你的上下文，' +
          '你在那一轮里接着做。所以现在：① 不要重复调 wf.invoke；② 也不要自己照着这条流程先做一遍' +
          '（那就成两份了）；③ 收尾说清你把什么交了出去、用户接下来会看到什么。' +
          (left.length ? '注意：' + left.join('、') + ' 没有给值（params 里补上），指令里会原样留着。' : ''),
      }
    },
  }
}
