/**
 * review.*：间隔复习的沙箱 api（计划账在 learn/review，工作流是内置的「复习」）。
 *
 * 分工是硬的：**计划归系统**（节点首次变「已掌握」时自动建，这里没有「建计划」的口子）；
 * 导师做的是 read（看清这次复习）、record（落账）、merge / extend / adjust（用户同意后的调整）。
 * record 的 complete 判「交互做完了吗」，答对答错不算数——错的东西进错误记忆，
 * 答对了的旧薄弱项标「已修复」。所有副作用都走现有的 state 通道（noteMistake / addCheck /
 * updateLearning），复习不另立账本。
 */
import type { CheckRecord, KnowledgeNode, LearnStore, ReviewPlan } from '../types'
import type { AgentOpsDeps } from './deps'
import type { ReviewOps } from '../../agent/sandbox/types'
import { addCheck, nodeById, noteMistake, parentIds, prereqIds, replaceNode, updateLearning } from '../graph'
import { nodePathOf, resolveNode, type PathScope } from '../paths'
import { checkLine, clampMastery, mistakeKey, parseCheck } from '../learning'
import {
  REVIEW_STAGE_GOAL,
  REVIEW_STAGE_LABEL,
  activeStageOf,
  completeStagePlan,
  dueExtraOf,
  dueStageOf,
  extendPlan,
  mergeCandidatesOf,
  mergePlansAt,
  newExtraId,
  pendingStageOf,
  postponeStage,
  reviewGroupOf,
  reviewStageOf,
  splitPlanFromGroup,
} from '../review'

const stamp = (at: number): string => new Date(at).toISOString().slice(0, 16).replace('T', ' ')
const dayLabel = (at: number): string => {
  const d = new Date(at)
  return d.getMonth() + 1 + ' 月 ' + d.getDate() + ' 日'
}
/** 模型给的数字：clamp 进 [min, max]，认不出就用缺省 */
const intIn = (v: unknown, min: number, max: number, dflt: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt
  return Math.max(min, Math.min(max, Math.round(v)))
}

export function createReviewOps(deps: AgentOpsDeps): ReviewOps {
  const store0 = () => deps.getLatest()
  const scope = (): PathScope => ({ goalId: deps.goalId(), currentNodeId: deps.nodeId() })

  const nodeByPath = (path: unknown): KnowledgeNode | { error: string } => {
    const r = resolveNode(store0(), scope(), typeof path === 'string' ? path.trim() : '')
    return r.ok ? r.value : { error: r.message }
  }

  /** 把一份计划写回节点（节点找不到就原样返回——调用方都在刚解析过节点后调它） */
  const withPlan = (store: LearnStore, nodeId: string, plan: ReviewPlan): LearnStore => {
    const node = nodeById(store, nodeId)
    if (!node) return store
    return replaceNode(store, { ...node, review: plan, updatedAt: Date.now() })
  }

  /** 两个节点的结构关系（合并候选的「相关性」提示；最终判断由导师结合内容做） */
  const relationOf = (store: LearnStore, a: string, b: string): string => {
    // 边是「from 依赖 to」：prereqIds 是下级（前置），parentIds 是上级——相邻的父子最强
    if (prereqIds(store, a).includes(b) || prereqIds(store, b).includes(a)) return '父子相邻（一个是另一个的下级）'
    if (parentIds(store, a).includes(b) || parentIds(store, b).includes(a)) return '同一父节点的兄弟'
    return '同一目标下的节点（相关性请你结合内容判断）'
  }

  /** 落账的副作用（阶段与补充复习共用）：记错法、标修复、检验时间线 + 掌握度 */
  const applySideEffects = (
    store: LearnStore,
    nodeId: string,
    fx: {
      mistakes: Array<{ pattern: string; cause?: string }>
      fixed: string[]
      mastery: number | null
      note: string
      check: CheckRecord | null
    },
  ): LearnStore => {
    let next = store
    for (const m of fx.mistakes) {
      const r = noteMistake(next, nodeId, { pattern: m.pattern, cause: m.cause })
      if (r) next = r.store
    }
    if (fx.fixed.length) {
      // 标「已修复」的判定按归一化键对（与错误记忆同一条去重口径），再犯时 withMistake 会清掉它
      const keys = new Set(fx.fixed.map(mistakeKey))
      const list = (nodeById(next, nodeId)?.learning?.mistakes ?? []).map((m) =>
        keys.has(mistakeKey(m.pattern)) && !m.fixedAt ? { ...m, fixedAt: Date.now() } : m,
      )
      next = updateLearning(next, nodeId, { mistakes: list })
    }
    if (fx.check) {
      next = addCheck(
        next,
        nodeId,
        fx.check,
        fx.mastery !== null ? { mastery: fx.mastery, ...(fx.note ? { masteryNote: fx.note } : {}) } : undefined,
      )
    }
    return next
  }

  const collectMistakes = (raw: unknown): Array<{ pattern: string; cause?: string }> => {
    if (!Array.isArray(raw)) return []
    const out: Array<{ pattern: string; cause?: string }> = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const m = item as Record<string, unknown>
      const pattern = typeof m.pattern === 'string' ? m.pattern.trim() : ''
      if (!pattern) continue
      const cause = typeof m.cause === 'string' && m.cause.trim() ? m.cause.trim().slice(0, 200) : undefined
      out.push({ pattern: pattern.slice(0, 120), ...(cause ? { cause } : {}) })
    }
    return out.slice(0, 10)
  }

  const collectFixed = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .map((x) => x.trim().slice(0, 120))
      .slice(0, 10)
  }

  return {
    read: (path) => {
      const s = store0()
      const now = Date.now()
      const node = nodeByPath(path)
      if ('error' in node) return { error: node.error }
      const plan = node.review
      const st = node.learning
      if (!plan) {
        return {
          nodeId: node.id,
          path: nodePathOf(s, deps.goalId(), node.id),
          title: node.title,
          planned: false,
          note:
            '这个节点还没有复习计划（状态还没到「已掌握」，或它是较早创建的节点）。计划由系统建——' +
            '界面上的复习面板有「补建计划」，不要用别的 api 代替它建。',
        }
      }
      const due = dueStageOf(plan, now)
      const pending = pendingStageOf(plan)
      const extraDue = dueExtraOf(plan, now)
      const memberIds = reviewGroupOf(s, node.id)
      const candidates = mergeCandidatesOf(s, node.id, now).map((c) => {
        const target = nodeById(s, c.nodeId)
        return {
          nodeId: c.nodeId,
          title: target?.title ?? c.nodeId,
          stage: REVIEW_STAGE_LABEL[c.stage],
          dueAt: stamp(c.dueAt),
          relation: relationOf(s, node.id, c.nodeId),
        }
      })
      return {
        nodeId: node.id,
        path: nodePathOf(s, deps.goalId(), node.id),
        title: node.title,
        planned: true,
        complete: !pending && (plan.extra ?? []).every((t) => !!t.doneAt),
        due: due
          ? {
              stage: due.stage,
              label: REVIEW_STAGE_LABEL[due.stage],
              focus: REVIEW_STAGE_GOAL[due.stage],
              dueAt: stamp(due.dueAt),
              overdueDays: due.overdueDays,
            }
          : null,
        extraDue: extraDue ? { id: extraDue.id, focus: extraDue.focus, dueAt: stamp(extraDue.dueAt) } : null,
        next: pending
          ? { stage: pending.stage, label: REVIEW_STAGE_LABEL[pending.stage], dueAt: stamp(pending.dueAt) }
          : null,
        group:
          plan.groupId && memberIds.length > 1
            ? {
                groupId: plan.groupId,
                members: memberIds.map((id) => {
                  const m = nodeById(s, id)
                  const mp = m?.review
                  const ms = mp ? activeStageOf(mp, now) : null
                  return {
                    nodeId: id,
                    title: m?.title ?? id,
                    stage: ms ? REVIEW_STAGE_LABEL[ms.stage] : null,
                  }
                }),
              }
            : null,
        candidates,
        stages: plan.stages.map((x) => ({
          stage: x.stage,
          label: REVIEW_STAGE_LABEL[x.stage],
          dueAt: stamp(x.dueAt),
          ...(x.doneAt ? { doneAt: stamp(x.doneAt) } : {}),
          ...(x.mergedInto ? { mergedInto: REVIEW_STAGE_LABEL[x.mergedInto] } : {}),
          ...(x.history?.length ? { history: x.history } : {}),
        })),
        extra: (plan.extra ?? []).map((t) => ({
          id: t.id,
          focus: t.focus,
          dueAt: stamp(t.dueAt),
          ...(t.doneAt ? { doneAt: stamp(t.doneAt) } : {}),
        })),
        mastery: typeof st?.mastery === 'number' ? st.mastery : null,
        mistakes: (st?.mistakes ?? []).map((m) => ({
          pattern: m.pattern,
          count: m.count,
          ...(m.cause ? { cause: m.cause } : {}),
          fixed: !!m.fixedAt,
        })),
        recentChecks: [...(st?.checks ?? [])].reverse().slice(0, 3).map(checkLine),
        note:
          '完成判定：交互做完就算完成（complete），答对答错都一样——错的东西写进 mistakes，' +
          '答对了的旧薄弱项（mistakes 里 fixed: false 的）写进 fixed。合并候选要先经 api.ask ' +
          '征得用户同意再 review.merge；合并组里每个成员各自 record（node 参数指名）。' +
          'record 会把更早没做的阶段自动并入这一次，不要为补课重复调用。',
      }
    },

    record: (input) => {
      const s0 = store0()
      const now = Date.now()
      const node = nodeByPath(typeof input.node === 'string' ? input.node : '')
      if ('error' in node) return { error: node.error }
      const plan = node.review
      if (!plan) return { error: '「' + node.title + '」还没有复习计划，没有账可落' }

      const complete = input.complete !== false
      const note = typeof input.note === 'string' ? input.note.trim().slice(0, 300) : ''
      const mastery = clampMastery(input.mastery)
      const mistakes = collectMistakes(input.mistakes)
      const fixed = collectFixed(input.fixed)
      const mentioned = Array.isArray(input.mentioned) ? input.mentioned.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 12) : []
      const missed = Array.isArray(input.missed) ? input.missed.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 12) : []
      const misconceptions = Array.isArray(input.misconceptions) ? input.misconceptions.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 12) : []
      const question = typeof input.question === 'string' ? input.question.trim().slice(0, 300) : ''
      const answer = typeof input.answer === 'string' ? input.answer.trim().slice(0, 600) : ''
      const fx = { mistakes, fixed, mastery, note, check: null as CheckRecord | null }

      // —— 补充复习的完成 ——
      const extraId = typeof input.extraId === 'string' ? input.extraId.trim() : ''
      if (extraId) {
        const task = (plan.extra ?? []).find((x) => x.id === extraId)
        if (!task) return { error: '没有 id 为「' + extraId + '」的补充复习（review.read() 的 extra 里有清单）' }
        if (task.doneAt) return { error: '这条补充复习已经完成过了，不要重复落账' }
        let next = withPlan(s0, node.id, {
          ...plan,
          extra: (plan.extra ?? []).map((x) => (x.id === extraId ? { ...x, doneAt: now, ...(note ? { note } : {}) } : x)),
        })
        const check = parseCheck({ kind: 'review', at: now, question, answer, mentioned, missed, misconceptions, note })
        if (check.ok) fx.check = check.check
        next = applySideEffects(next, node.id, fx)
        deps.set(next)
        return {
          ok: true,
          content:
            '补充复习「' + task.focus + '」已记完' + (mistakes.length ? '；记下 ' + mistakes.length + ' 类错法' : '') +
            (fixed.length ? '；' + fixed.length + ' 条旧薄弱项标为已修复' : '') + '。',
        }
      }

      // —— 阶段完成 ——
      const stageIn = reviewStageOf(input.stage)
      const due = dueStageOf(plan, now)
      const stage = stageIn ?? due?.stage ?? null
      if (!stage) {
        const pending = pendingStageOf(plan)
        return {
          error: pending
            ? '现在没有到期的复习阶段；下一档是「' + REVIEW_STAGE_LABEL[pending.stage] + '」（' + dayLabel(pending.dueAt) +
              '到期）。要提前复习就在参数里写明 stage。'
            : '这个节点的复习阶段已经全部完成',
        }
      }
      const target = plan.stages.find((x) => x.stage === stage)
      if (!target || target.doneAt || target.mergedInto) {
        return { error: '「' + REVIEW_STAGE_LABEL[stage] + '」已经完成（或并入过），不要重复落账' }
      }
      const items = intIn(input.items, 1, 50, Math.max(1, mentioned.length + missed.length + misconceptions.length))
      let next = withPlan(s0, node.id, completeStagePlan(plan, stage, { at: now, items, missed: missed.length, ...(note ? { note } : {}) }))
      const check = parseCheck({ kind: 'review', at: now, question, answer, mentioned, missed, misconceptions, note })
      if (check.ok) fx.check = check.check
      next = applySideEffects(next, node.id, fx)

      const completedPlan = nodeById(next, node.id)?.review
      const mergedCount = completedPlan?.stages.filter((x) => x.mergedInto === stage).length ?? 0
      const nextStage = completedPlan ? pendingStageOf(completedPlan) : null
      deps.set(next)
      return {
        ok: true,
        content:
          '「' + REVIEW_STAGE_LABEL[stage] + '」' + (complete ? '已记为完成' : '记为未完成（留待下次）') +
          (mergedCount ? '；更早没做的 ' + mergedCount + ' 个阶段并入这一次，不必补做' : '') +
          (mistakes.length ? '；记下 ' + mistakes.length + ' 类错法（再犯会累加次数）' : '') +
          (fixed.length ? '；' + fixed.length + ' 条旧薄弱项标为已修复' : '') +
          (mastery !== null ? '；掌握度更新为 ' + mastery + '/100' : '') +
          (complete && nextStage ? '。下次复习：「' + REVIEW_STAGE_LABEL[nextStage.stage] + '」，' + dayLabel(nextStage.dueAt) + '到期' : '') +
          '。',
      }
    },

    merge: (input) => {
      const s0 = store0()
      const now = Date.now()
      const node = nodeByPath(typeof input.node === 'string' ? input.node : '')
      if ('error' in node) return { error: node.error }
      const rawIds = Array.isArray(input.nodeIds) ? input.nodeIds : []
      if (!rawIds.length) {
        return { error: 'review.merge 需要 nodeIds（要并入的节点，标题 / 路径 / #id 的清单）。合并前必须已经过 api.ask 征得用户同意' }
      }
      const plan = node.review
      if (!plan) return { error: '「' + node.title + '」还没有复习计划，没法合并' }
      const selfStage = activeStageOf(plan, now)
      if (!selfStage) return { error: '「' + node.title + '」的复习已经全部完成，没有可合并的阶段' }
      const ids = new Set<string>([node.id])
      const titles: string[] = [node.title]
      for (const raw of rawIds) {
        const r = nodeByPath(typeof raw === 'string' ? raw : '')
        if ('error' in r) return { error: r.error }
        if (r.goalId !== node.goalId) return { error: '「' + r.title + '」在另一个学习目标里，不能跨目标合并' }
        if (r.id === node.id) continue
        if (!r.review) return { error: '「' + r.title + '」还没有复习计划' }
        const st = activeStageOf(r.review, now)
        if (!st) return { error: '「' + r.title + '」的复习已全部完成，不参与合并' }
        if (st.stage !== selfStage.stage) {
          return {
            error:
              '「' + r.title + '」当前在「' + REVIEW_STAGE_LABEL[st.stage] + '」，与「' + node.title + '」的「' +
              REVIEW_STAGE_LABEL[selfStage.stage] + '」不是同一阶段——只有处于同一阶段的复习才能合并',
          }
        }
        ids.add(r.id)
        titles.push(r.title)
      }
      if (ids.size < 2) return { error: 'nodeIds 里没有可并入的其它节点（只写了自己是不用合并的）' }
      const groupId = plan.groupId ?? 'rg_' + now.toString(36) + Math.random().toString(36).slice(2, 6)
      deps.set(mergePlansAt(s0, [...ids], groupId, now))
      return {
        ok: true,
        content:
          '已合并为复习组（' + titles.join('、') + '），后续阶段整组一起复习。这次复习按整组做，' +
          '落账时每个成员各自 review.record（node 参数写该节点的标题或 #id）；要拆组用 review.adjust({ action: "split" })。',
      }
    },

    extend: (input) => {
      const s0 = store0()
      const now = Date.now()
      const node = nodeByPath(typeof input.node === 'string' ? input.node : '')
      if ('error' in node) return { error: node.error }
      const plan = node.review
      if (!plan) return { error: '「' + node.title + '」还没有复习计划' }
      const focus = typeof input.focus === 'string' ? input.focus.trim() : ''
      if (!focus) {
        return { error: 'extend 需要 focus（针对哪个薄弱点，一句话，与错误记忆的说法对齐）——没有具体薄弱点就不要加补充复习' }
      }
      const days = intIn(input.days, 1, 60, 3)
      const task = { id: newExtraId(now), focus: focus.slice(0, 200), dueAt: now + days * 86_400_000 }
      deps.set(withPlan(s0, node.id, extendPlan(plan, task)))
      return {
        ok: true,
        content:
          '已为「' + node.title + '」加一条补充复习：「' + task.focus + '」，' + days + ' 天后（' + dayLabel(task.dueAt) +
          '）到期，会出现在复习面板里。完成时 review.record({ extraId: "' + task.id + '", ... })。',
      }
    },

    adjust: (input) => {
      const s0 = store0()
      const now = Date.now()
      const node = nodeByPath(typeof input.node === 'string' ? input.node : '')
      if ('error' in node) return { error: node.error }
      const plan = node.review
      if (!plan) return { error: '「' + node.title + '」还没有复习计划' }
      const action = input.action
      if (action === 'split') {
        if (!plan.groupId) return { error: '「' + node.title + '」不在任何合并组里' }
        deps.set(splitPlanFromGroup(s0, node.id, now))
        return { ok: true, content: '「' + node.title + '」已退出合并组，此后它的复习单独进行。' }
      }
      if (action === 'postpone') {
        const days = intIn(input.days, 1, 30, 1)
        const stage = reviewStageOf(input.stage) ?? dueStageOf(plan, now)?.stage ?? pendingStageOf(plan)?.stage ?? null
        if (!stage) return { error: '这个节点的复习阶段已经全部完成，没有可顺延的阶段' }
        const target = plan.stages.find((x) => x.stage === stage)
        if (!target || target.doneAt || target.mergedInto) {
          return { error: '「' + REVIEW_STAGE_LABEL[stage] + '」已完成，不能顺延' }
        }
        deps.set(withPlan(s0, node.id, postponeStage(plan, stage, days, now)))
        const after = nodeById(store0(), node.id)?.review?.stages.find((x) => x.stage === stage)
        return {
          ok: true,
          content:
            '「' + REVIEW_STAGE_LABEL[stage] + '」已顺延 ' + days + ' 天' +
            (after ? '，新的到期日是 ' + dayLabel(after.dueAt) : '') + '。',
        }
      }
      return { error: "action 只认 'postpone'（顺延到期日）或 'split'（退出合并组），收到「" + String(action ?? '') + '」' }
    },
  }
}
