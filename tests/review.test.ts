/**
 * 复习计划的纯函数与往返（learn/review）。
 *
 * 计划挂在节点上（KnowledgeNode.review），这一组钉住四件事：
 * 1. 五个默认阶段的排期与「到了期不自动顺延」的判定；
 * 2. 完成更靠后阶段时更早未完成阶段的「并入」；
 * 3. 合并复习组的建立 / 查询 / 拆散（互逆）与同阶段候选；
 * 4. 持久化往返：buildDocs → parseDocs 后计划原样回来，读不出形状的收成「没有」。
 */
import { describe, expect, it } from 'vitest'
import { buildDocs, buildState, parseDocs } from '../src/learn/files'
import { emptyDocs } from '../src/learn/groups'
import { setNodeStatus, updateLearning } from '../src/learn/graph'
import { withMistake } from '../src/learn/learning'
import {
  completeStagePlan,
  createReviewPlan,
  dueExtraOf,
  dueStageOf,
  ensureReviewPlan,
  extendPlan,
  mergeCandidatesOf,
  mergePlansAt,
  normalizeReviewPlan,
  pendingStageOf,
  planHasDue,
  planIsComplete,
  postponeStage,
  REVIEW_DAY_MS,
  REVIEW_STAGES,
  reviewGroupOf,
  splitPlanFromGroup,
} from '../src/learn/review'
import type { KnowledgeNode, LearnStore, ReviewPlan } from '../src/learn/types'

const DAY = REVIEW_DAY_MS

const makeNode = (id: string, patch: Partial<KnowledgeNode> = {}): KnowledgeNode => ({
  id,
  title: id,
  key: id,
  description: '',
  docs: { teaching: id + ' 的正文' },
  notes: [],
  annotations: [],
  status: 'learning',
  origin: 'user',
  goalId: 'g1',
  createdAt: 0,
  updatedAt: 0,
  ...patch,
})

const makeStore = (nodes: KnowledgeNode[]): LearnStore => ({
  version: 2,
  nodes,
  edges: [],
  goals: [{ id: 'g1', rootNodeId: nodes[0].id, question: 'q', createdAt: 0, updatedAt: 0 }],
  conversations: [],
  exams: [],
  tmp: {},
  resources: {},
  docArea: emptyDocs(),
  drafts: {},
  docScroll: {},
  localFiles: [],
  activeGoalId: 'g1',
  activeNodeId: nodes[0].id,
  activeConversationId: '',
})

const NOW = 1_750_000_000_000

describe('复习计划的排期', () => {
  it('五个阶段按 +1/+3/+7/+14/+30 天铺好，顺序固定', () => {
    const plan = createReviewPlan(NOW)
    expect(plan.stages.map((s) => s.stage)).toEqual([...REVIEW_STAGES])
    expect(plan.stages.map((s) => s.dueAt - NOW)).toEqual([1, 3, 7, 14, 30].map((d) => d * DAY))
  })

  it('到期判定取「最晚的到期未完成档」；没到期回 null', () => {
    const learnedAt = NOW - 10 * DAY
    const plan = createReviewPlan(learnedAt)
    // 到期按**本地日**比较：学习当天连 +1 都不算到期
    expect(dueStageOf(plan, learnedAt)).toBeNull()
    const due = dueStageOf(plan, NOW)
    expect(due?.stage).toBe('d7')
    // +7 档在 3 天前就到期了
    expect(due?.overdueDays).toBe(3)
    // 刚过 +1 天：只该是 d1
    expect(dueStageOf(plan, learnedAt + DAY + 60_000)?.stage).toBe('d1')
  })

  it('完成最晚档时，更早未完成的阶段并入这一次；下一档顺延为 pending', () => {
    const plan = createReviewPlan(NOW - 10 * DAY)
    const done = completeStagePlan(plan, 'd7', { at: NOW, items: 3, missed: 1 })
    expect(done.stages.find((s) => s.stage === 'd7')?.doneAt).toBe(NOW)
    expect(done.stages.filter((s) => s.mergedInto === 'd7').map((s) => s.stage)).toEqual(['d1', 'd3'])
    expect(dueStageOf(done, NOW)).toBeNull()
    expect(pendingStageOf(done)?.stage).toBe('d14')
    // 已并入的档不算「未完成」：重复完成不改变它们
    const again = completeStagePlan(done, 'd14', { at: NOW + 1, items: 2, missed: 0 })
    expect(again.stages.find((s) => s.stage === 'd1')?.mergedInto).toBe('d7')
  })

  it('阶段历史只留最近 3 条', () => {
    let plan = createReviewPlan(NOW)
    for (let i = 0; i < 5; i++) plan = completeStagePlan(plan, 'd1', { at: NOW + i, items: 1, missed: 0, note: '第 ' + i + ' 次' })
    const history = plan.stages.find((s) => s.stage === 'd1')?.history ?? []
    expect(history).toHaveLength(3)
    expect(history[2]?.note).toBe('第 4 次')
  })
})

describe('计划的建立钩子与完成判定', () => {
  it('ensureReviewPlan：mastered 才建；重复调用幂等；有进行中的计划不覆盖', () => {
    const learned = makeNode('a', { status: 'learning' })
    // 还在学习中：不建
    expect(ensureReviewPlan(makeStore([learned]), 'a', NOW).nodes[0]?.review).toBeUndefined()
    // 变 mastered：建
    const after = ensureReviewPlan(makeStore([makeNode('a', { status: 'mastered' })]), 'a', NOW)
    const plan = after.nodes[0]?.review
    expect(plan?.stages).toHaveLength(5)
    // 再调一次（节点已有计划）：原计划原样保留（对象身份不变）
    const twice = ensureReviewPlan(after, 'a', NOW + 1)
    expect(twice.nodes[0]?.review).toBe(plan)
  })

  it('上一轮全部完成后状态再次变 mastered：重启一轮新计划', () => {
    const old = createReviewPlan(NOW - 40 * DAY)
    const finished: ReviewPlan = {
      ...old,
      stages: old.stages.map((s) => ({ ...s, doneAt: NOW - 5 * DAY })),
    }
    const node = makeNode('a', { status: 'mastered', review: finished })
    const next = ensureReviewPlan(makeStore([node]), 'a', NOW)
    const fresh = next.nodes[0]?.review
    expect(fresh).not.toBe(finished)
    expect(fresh?.stages.every((s) => !s.doneAt)).toBe(true)
  })

  it('planIsComplete / planHasDue：补充复习也计入', () => {
    const plan = createReviewPlan(NOW)
    expect(planIsComplete(plan)).toBe(false)
    const withExtra = extendPlan(plan, { id: 're_1', focus: '边界条件', dueAt: NOW - DAY })
    expect(planHasDue(withExtra, NOW)).toBe(true)
    expect(dueExtraOf(withExtra, NOW)?.id).toBe('re_1')
    const doneExtra = { ...withExtra, extra: withExtra.extra?.map((t) => ({ ...t, doneAt: NOW })) }
    expect(dueExtraOf(doneExtra, NOW)).toBeNull()
  })

  it('postponeStage 只动未完成的指定档，至少顺延一天', () => {
    const plan = createReviewPlan(NOW)
    const moved = postponeStage(plan, 'd3', 0, NOW)
    const before = plan.stages.find((s) => s.stage === 'd3')?.dueAt ?? 0
    const after = moved.stages.find((s) => s.stage === 'd3')?.dueAt ?? 0
    expect(after).toBeGreaterThan(before)
    // 已完成的档不动
    const done = completeStagePlan(plan, 'd3', { at: NOW, items: 1, missed: 0 })
    expect(postponeStage(done, 'd3', 5, NOW).stages.find((s) => s.stage === 'd3')?.doneAt).toBe(NOW)
  })
})

describe('合并复习组', () => {
  it('同目标的同阶段节点是候选；跨阶段 / 同组的不算', () => {
    const at = NOW - 10 * DAY
    const a = makeNode('a', { status: 'mastered', review: createReviewPlan(at) })
    const b = makeNode('b', { status: 'mastered', review: createReviewPlan(at) })
    // c 一路做到 +7 完成（d1/d3 并入）：进行中的是 +14，与 a（+7）不同档
    const c = makeNode('c', {
      status: 'mastered',
      review: completeStagePlan(createReviewPlan(at), 'd7', { at, items: 1, missed: 0 }),
    })
    const store = makeStore([a, b, c])
    expect(mergeCandidatesOf(store, 'a', NOW).map((x) => x.nodeId)).toEqual(['b'])
  })

  it('mergePlansAt 打同一个 groupId；reviewGroupOf 查全组；splitPlanFromGroup 互逆', () => {
    const a = makeNode('a', { status: 'mastered', review: createReviewPlan(NOW) })
    const b = makeNode('b', { status: 'mastered', review: createReviewPlan(NOW) })
    const store = makeStore([a, b])
    const merged = mergePlansAt(store, ['a', 'b'], 'rg_x', NOW)
    expect(reviewGroupOf(merged, 'a')).toEqual(['a', 'b'])
    const split = splitPlanFromGroup(merged, 'a', NOW)
    expect(split.nodes[0]?.review?.groupId).toBeUndefined()
    expect(split.nodes[1]?.review?.groupId).toBe('rg_x')
    // 没进组的节点查组只有自己
    expect(reviewGroupOf(store, 'a')).toEqual(['a'])
  })
})

describe('读盘的规范化', () => {
  it('JSON 往返后计划逐字段保留', () => {
    let plan = createReviewPlan(NOW)
    plan = completeStagePlan(plan, 'd1', { at: NOW + DAY, items: 2, missed: 1, note: '漏了要点' })
    plan = mergePlansAt(makeStore([makeNode('a', { review: plan })]), ['a'], 'rg_rt', NOW).nodes[0]!.review!
    plan = extendPlan(plan, { id: 're_9', focus: '变式题总错', dueAt: NOW + 2 * DAY })
    const back = normalizeReviewPlan(JSON.parse(JSON.stringify(plan)))
    expect(back).toEqual(plan)
  })

  it('读不出的形状收成 undefined；缺了的阶段按默认间隔补齐', () => {
    expect(normalizeReviewPlan('not a plan')).toBeUndefined()
    expect(normalizeReviewPlan({ stages: 'nope' })).toBeUndefined()
    const patched = normalizeReviewPlan({ stages: [{ stage: 'd30', dueAt: NOW }] })
    expect(patched?.stages).toHaveLength(5)
    expect(patched?.stages.map((s) => s.stage)).toEqual([...REVIEW_STAGES])
    // 写了的档保留原值；缺的档按默认间隔从**当下**补起
    expect(patched?.stages.find((s) => s.stage === 'd30')?.dueAt).toBe(NOW)
    expect(patched?.stages.find((s) => s.stage === 'd1')?.dueAt).toBeGreaterThan(Date.now())
  })
})

describe('与图和持久化的接线', () => {
  it('setNodeStatus 首次变 mastered 时自动建计划；learning 不建', () => {
    const store = makeStore([makeNode('a'), makeNode('b', { status: 'mastered' })])
    const learned = setNodeStatus(store, 'a', 'learning')
    expect(learned.nodes[0]?.review).toBeUndefined()
    const mastered = setNodeStatus(store, 'a', 'mastered')
    expect(mastered.nodes[0]?.review?.stages).toHaveLength(5)
  })

  it('buildDocs → parseDocs 往返后计划跟着节点回来', () => {
    const store = setNodeStatus(makeStore([makeNode('a')]), 'a', 'mastered')
    const files = buildDocs(store)
    const back = parseDocs(files, buildState(store))
    const plan = back?.nodes.find((n) => n.id === 'a')?.review
    expect(plan?.stages).toHaveLength(5)
    expect(plan?.stages.map((s) => s.stage)).toEqual([...REVIEW_STAGES])
  })

  it('盘上的垃圾形状被 normalize 收成「没有计划」', () => {
    const broken = makeStore([makeNode('a', { status: 'mastered', review: { oops: 1 } as unknown as ReviewPlan })])
    const back = parseDocs(buildDocs(broken), buildState(broken))
    expect(back?.nodes.find((n) => n.id === 'a')?.review).toBeUndefined()
  })

  it('withMistake：已修复的错法再犯时清掉 fixedAt', () => {
    const r1 = withMistake(makeNode('a'), { pattern: '漏乘内部导数' })
    const marked = updateLearning(r1.node && makeStore([r1.node]), 'a', {
      mistakes: r1.node.learning?.mistakes?.map((m) => ({ ...m, fixedAt: 123 })),
    })
    const node = marked.nodes.find((n) => n.id === 'a')!
    expect(node.learning?.mistakes?.[0]?.fixedAt).toBe(123)
    const r2 = withMistake(node, { pattern: '漏乘内部导数' })
    expect(r2.node.learning?.mistakes?.[0]?.fixedAt).toBeUndefined()
    expect(r2.node.learning?.mistakes?.[0]?.count).toBe(2)
    expect(r2.fresh).toBe(false)
  })
})
