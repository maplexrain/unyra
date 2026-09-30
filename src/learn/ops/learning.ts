/**
 * 学习状态（state.*）这一组 ops 的宿主实现：掌握度、自评、错题记忆与检验记录。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5），只负责 state.* 一组。
 */

import type { AgentToolResult } from '../../agent/types'
import type { LearningOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import { CHECK_KIND_LABEL, SELF_REPORT_LABEL, type KnowledgeNode, type LearningState, type SelfSource } from '../types'
import { addCheck, nodeById, nodeStructure, noteMistake, updateLearning } from '../graph'
import { clampMastery, masteryText, mistakeKey, parseCheck, selfReportOf, selfText } from '../learning'
import { nodePathOf } from '../paths'

/**
 * 学习状态那一组 api（沙箱里的 state.*）的宿主实现。
 *
 * 与 doc / node 两组最大的不同：它写的是**系统对这个人的判断**，不是他写下的内容。
 * 因此两条纪律：
 * 1. 值域先挡（四档只有四个值、掌握度只有 0~100），认不出就把可选项列出来——
 *    一个写不进去的乱值会让状态面板显示一个没人解释得了的数字；
 * 2. 读的时候把「没有」与「是空的」分开：没评估过就是没评估过，不要回一个 0 让人以为测过。
 */
export function createLearningOps(deps: AgentOpsDeps): LearningOps {
  const store0 = () => deps.getLatest()
  const nodeOf = (nodeId: string): KnowledgeNode | null => nodeById(store0(), nodeId) ?? null
  const missing = (): AgentToolResult => ({ ok: false, content: '这个节点已经不存在了（可能刚被删除）' })
  const stamp = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

  return {
    read: (nodeId) => {
      const s = store0()
      const n = nodeOf(nodeId)
      if (!n) return { error: '这个节点已经不存在了（可能刚被删除）' }
      const st = n.learning ?? {}
      const structure = nodeStructure(s, n.id)
      return {
        path: nodePathOf(s, deps.goalId(), n.id),
        id: n.id,
        // 旧口径的二值状态（学习中 / 已掌握）与新的掌握度并存，见 learn/types 的说明
        status: n.status,
        self: st.self ? SELF_REPORT_LABEL[st.self] : null,
        selfBy: st.self ? (st.selfBy === 'user' ? '学习者确认过' : '你推断的，学习者还没确认') : null,
        mastery: typeof st.mastery === 'number' ? st.mastery : null,
        masteryNote: st.masteryNote ?? null,
        structure: { depth: structure.depth, parents: structure.parents, prereqs: structure.prereqs },
        mistakes: (st.mistakes ?? []).map((m) => ({
          pattern: m.pattern,
          count: m.count,
          cause: m.cause ?? null,
          lastAt: stamp(m.lastAt),
        })),
        checks: [...(st.checks ?? [])].reverse().map((c) => ({
          kind: CHECK_KIND_LABEL[c.kind],
          at: stamp(c.at),
          score: typeof c.score === 'number' ? c.score : null,
          question: c.question ?? null,
          answer: c.answer ?? null,
          mentioned: c.mentioned ?? null,
          missed: c.missed ?? null,
          misconceptions: c.misconceptions ?? null,
          note: c.note ?? null,
        })),
        lastStudiedAt: st.lastStudiedAt ? stamp(st.lastStudiedAt) : null,
        visits: st.visits ?? 0,
        hint: !n.learning
          ? '这个知识点还没有任何学习状态：没评估过掌握度，也没有错题与检验记录。'
          : 'checks 按时间倒序（最近的在最前）。掌握度是 0~100 的数字；depth 是知识依赖层级，' +
            '不是学习者的水平，别拿它当「基础差」的证据。',
      }
    },

    update: (nodeId, patch) => {
      const s = store0()
      const n = nodeOf(nodeId)
      if (!n) return missing()
      const next: Partial<LearningState> = {}
      const done: string[] = []

      if (patch.self !== undefined && patch.self !== null && patch.self !== '') {
        const self = selfReportOf(patch.self)
        if (!self) {
          return {
            ok: false,
            content:
              'self 只认这四档：mastered（掌握）/ familiar（了解但不熟）/ unknown（不会）/ unsure（不确定），' +
              '收到「' + String(patch.self) + '」。学习者自己说的原话也可以照写，但这四档之外无法入库。',
          }
        }
        const byRaw = typeof patch.by === 'string' ? patch.by.trim().toLowerCase() : ''
        const by: SelfSource =
          byRaw === 'user' || byRaw === '用户' || byRaw === '学习者' || byRaw === '本人' ? 'user' : 'ai'
        next.self = self
        next.selfBy = by
        done.push(
          '自评记为「' +
            SELF_REPORT_LABEL[self] +
            '」（' +
            (by === 'user' ? '学习者确认' : '你的推断，等他确认') +
            '）',
        )
      }

      if (patch.mastery !== undefined && patch.mastery !== null && patch.mastery !== '') {
        const mastery = clampMastery(patch.mastery)
        if (mastery === null) {
          return { ok: false, content: 'mastery 要是 0~100 的数字，收到「' + String(patch.mastery) + '」' }
        }
        next.mastery = mastery
        done.push('掌握度改为 ' + mastery + '/100')
      }

      if (typeof patch.note === 'string' && patch.note.trim()) {
        next.masteryNote = patch.note.trim().slice(0, 300)
        done.push('记下这次修正的理由')
      }

      if (!done.length) {
        return { ok: false, content: '没有给出要改的字段（self / mastery / note），未做修改' }
      }
      deps.set(updateLearning(s, n.id, next))
      const after = nodeOf(n.id)?.learning
      return {
        ok: true,
        content:
          done.join('；') +
          '。它现在的学习状态是：掌握度 ' +
          masteryText(after?.mastery) +
          '、自评' +
          selfText(after) +
          '。',
      }
    },

    mistake: (nodeId, input) => {
      const s = store0()
      const n = nodeOf(nodeId)
      if (!n) return missing()
      const pattern = typeof input.pattern === 'string' ? input.pattern.trim() : ''
      if (!pattern) {
        return {
          ok: false,
          content:
            'pattern 要写「错成了什么样」（例如「漏乘内部导数」「把 Q 和 K 的角色搞反」），' +
            '不是「第 3 题错了」——同一种错法再犯时靠它累加次数。',
        }
      }
      const r = noteMistake(s, n.id, {
        pattern,
        cause: typeof input.cause === 'string' ? input.cause : undefined,
        count: typeof input.count === 'number' ? input.count : undefined,
      })
      if (!r) return missing()
      deps.set(r.store)
      const total = r.store.nodes.find((x) => x.id === n.id)?.learning?.mistakes?.length ?? 0
      return {
        ok: true,
        content:
          (r.fresh ? '已记下一种新的错误' : '这一类错误又出现了一次') +
          '：「' +
          r.record.pattern +
          '」累计 ' +
          r.record.count +
          ' 次' +
          (r.record.cause ? '（成因：' + r.record.cause + '）' : '') +
          '。这个知识点现在共有 ' +
          total +
          ' 类错误记忆' +
          (r.record.count >= 3 ? '；同一类错到 3 次以上，下次讲解要正面处理它，别再重复讲一遍同样的说法。' : '。'),
      }
    },

    forget: (nodeId, pattern) => {
      const s = store0()
      const n = nodeOf(nodeId)
      if (!n) return missing()
      const list = n.learning?.mistakes ?? []
      if (!list.length) return { ok: false, content: '这个知识点还没有错误记忆' }
      const key = mistakeKey(pattern)
      const kept = key ? list.filter((m) => mistakeKey(m.pattern) !== key) : []
      if (key && kept.length === list.length) {
        return {
          ok: false,
          content: '没有「' + pattern + '」这条错误记忆。现有的：' + list.map((m) => m.pattern + ' ×' + m.count).join('、'),
        }
      }
      deps.set(updateLearning(s, n.id, { mistakes: kept }))
      return {
        ok: true,
        content: key
          ? '已清掉「' + pattern + '」这条错误记忆（剩下的：' + (kept.map((m) => m.pattern).join('、') || '没有了') + '）。'
          : '已清空这个知识点的 ' + list.length + ' 类错误记忆。',
      }
    },

    check: (nodeId, input) => {
      const s = store0()
      const n = nodeOf(nodeId)
      if (!n) return missing()
      const parsed = parseCheck(input)
      if (!parsed.ok) return { ok: false, content: parsed.message }
      const c = parsed.check
      deps.set(addCheck(s, n.id, c))
      const bits: string[] = []
      if (typeof c.score === 'number') bits.push(c.score + ' 分')
      if (c.mentioned?.length) bits.push('讲到 ' + c.mentioned.join('、'))
      if (c.missed?.length) bits.push('漏了 ' + c.missed.join('、'))
      if (c.misconceptions?.length) bits.push('说错了 ' + c.misconceptions.join('、'))
      return {
        ok: true,
        content:
          '已记下一次' + CHECK_KIND_LABEL[c.kind] + (bits.length ? '：' + bits.join('；') : '') + '。' +
          '如果这次结果说明掌握度该动，再用 api.state.update({ mastery, note }) 改一次——' +
          '记检验与改掌握度是两件事，不要只做前一件。',
      }
    },
  }
}
