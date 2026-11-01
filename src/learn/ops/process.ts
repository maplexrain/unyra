/**
 * 学习过程那一组 ops 的宿主实现：上下文压缩。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：它们是「读事实 / 写账本」的
 * 纯 store 逻辑，与文档、资源那几组没有耦合，所以合成一处。
 */

import type { CompactOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import { buildSummary } from '../compact'

/** 回给模型的时间：ISO 前 16 位够读，也不用它解析毫秒 */
const stampOf = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

/** compact.*：写一份摘要（见 learn/compact），边界见函数内的说明。 */
export function createCompactOps(deps: AgentOpsDeps): CompactOps {
  return {
    write: (input) => {
      const store = deps.getLatest()
      const conv = store.conversations.find((c) => c.goalId === deps.goalId())
      if (!conv) return { error: '这一段对话还没落盘（没有会话可压）' }
      const out = buildSummary(input)
      if (!out.ok) return { error: out.error }
      const next = { ...conv, summary: out.summary, updatedAt: Date.now() }
      deps.set({ ...store, conversations: store.conversations.map((c) => (c.id === conv.id ? next : c)) })
      return {
        ok: true,
        at: stampOf(out.summary.at),
        tasks: out.summary.tasks.length,
        chars: out.summary.text.length,
        note:
          '摘要已记下。**本轮结束后**才生效：到那时这段对话里之前的消息全部失活，' +
          '只有这份摘要（与之后的新消息）继续进上下文。不要重复调用 compact，也不要把摘要复述给用户。',
      }
    },
  }
}

