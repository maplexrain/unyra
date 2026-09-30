/**
 * 探针分组：间隔复习（learn/review + review.* api）。
 *
 * 钉住的是「模型照着提示词调用时拿到的到底是什么」：
 * - read 对「没计划 / 有计划到期」两种节点各回什么（到期档、候选、错误记忆的 fixed 标记）；
 * - record 的完成语义：最晚到期档记完成、更早没做的档自动并入、错法进错误记忆、
 *   检验时间线多一条 review、掌握度落账；重复落账被拒；
 * - merge 的同阶段校验与建组 / split 互逆；extend 的补充复习与它的 record 出口；
 * - 计划跟着节点落盘读回（与 meta.json 同一条往返链）。
 *
 * 共享 fixture（ok / NOW / baseStore / harness）见 ./harness。
 */
import { buildDocs, buildState, parseDocs } from '../../src/learn/files'
import { setNodeStatus } from '../../src/learn/graph'
import {
  createReviewPlan,
  REVIEW_DAY_MS,
  REVIEW_STAGES,
  reviewGroupOf,
} from '../../src/learn/review'
import type { LearnStore, ReviewPlan } from '../../src/learn/types'
import { baseStore, childId, harness, ok, rootId } from './harness'

const DAY = REVIEW_DAY_MS

/** 让 child「10 天前学完」：d1/d3/d7 已到期，d14/d30 未到——record 的主要靶子 */
function withDuePlan(s: LearnStore): LearnStore {
  return {
    ...s,
    nodes: s.nodes.map((n) => (n.id === childId && n.review ? { ...n, review: createReviewPlan(Date.now() - 10 * DAY) } : n)),
  }
}

const mastered = (s: LearnStore, id: string): LearnStore => setNodeStatus(s, id, 'mastered')

export async function reviewTests(): Promise<void> {
  /* ---------- 1. 钩子：首次 mastered 自动建计划，幂等 ---------- */
  {
    const s = mastered(baseStore(), childId)
    const plan = s.nodes.find((n) => n.id === childId)?.review
    ok(plan?.stages.length === 5 && plan.stages.map((x) => x.stage).join() === REVIEW_STAGES.join(), '状态首次变 mastered：五个阶段自动铺好', plan)
    ok(plan !== undefined && plan.stages[1]!.dueAt - plan.stages[0]!.dueAt === 2 * DAY, '阶段间隔是 +1/+3/+7/+14/+30（相邻差 2/4/7/16 天）', plan?.stages.map((x) => x.dueAt))
    const s2 = mastered(s, childId)
    ok(s2.nodes.find((n) => n.id === childId)?.review === plan, '重复置为 mastered 不重建计划（幂等）')
  }

  /* ---------- 2. read：到期档与候选 ---------- */
  {
    const h = harness(withDuePlan(mastered(baseStore(), childId)), childId)
    const r = await h.run('((api)=>{ return await api.review.read() })')
    ok(r.ok && r.content.includes('+7 天 · 应用') && r.content.includes('overdueDays'), 'read 给出到期档（10 天前学完 → +7）与逾期天数', r.content.slice(0, 300))
    ok(r.content.includes('candidates') === false || r.content.includes('"candidates":[]'), '没有其它同阶段节点时候选为空', r.content.slice(0, 200))

    // root 也变 mastered（同阶段 d1 进行中）：候选里出现它，关系是前后置
    const h2 = harness(mastered(mastered(baseStore(), childId), rootId), childId)
    const r2 = await h2.run('((api)=>{ return await api.review.read() })')
    ok(r2.ok && r2.content.includes('candidates') && r2.content.includes('微积分') && r2.content.includes('父子相邻'), '同阶段候选带标题与结构关系', r2.content.slice(0, 400))

    const h3 = harness(baseStore(), childId)
    const r3 = await h3.run('((api)=>{ return await api.review.read() })')
    ok(r3.ok && r3.content.includes('还没有复习计划'), '没计划时 read 说明「计划由系统建」而不是报错', r3.content.slice(0, 200))
  }

  /* ---------- 3. record：完成 / 并入 / 错法 / 修复 / 掌握度 ---------- */
  {
    const h = harness(withDuePlan(mastered(baseStore(), childId)), childId)
    const r1 = await h.run(
      '((api)=>{ return await api.review.record({ complete: true, items: 3, ' +
        'missed: ["没说为什么要有界"], mistakes: [{ pattern: "以为无序数组也能二分" }], ' +
        'fixed: ["边界写反"], mastery: 78, note: "老毛病补上了", question: "讲讲二分查找", answer: "（用户的复述）" }) })',
    )
    ok(r1.ok && r1.content.includes('已记为完成') && r1.content.includes('并入'), 'record 完成最晚到期档，并提示更早的档并入', r1.content.slice(0, 240))

    const node = h.store().nodes.find((n) => n.id === childId)
    const plan = node?.review
    ok(plan?.stages.find((x) => x.stage === 'd7')?.doneAt !== undefined, 'd7 记下 doneAt', plan?.stages.map((x) => [x.stage, x.doneAt]))
    ok(plan?.stages.filter((x) => x.mergedInto === 'd7').length === 2, 'd1/d3 并入这一次，不必补课', plan?.stages.map((x) => [x.stage, x.mergedInto]))
    ok(node?.learning?.checks?.some((c) => c.kind === 'review') === true, '检验时间线多一条 review', node?.learning?.checks?.map((c) => c.kind))
    ok(node?.learning?.mistakes?.some((m) => m.pattern === '以为无序数组也能二分') === true, '错法进错误记忆', node?.learning?.mistakes?.map((m) => m.pattern))
    ok(node?.learning?.mastery === 78 && node.learning.masteryNote === '老毛病补上了', '掌握度与理由按落账修正', node?.learning?.mastery)

    const r2 = await h.run('((api)=>{ return await api.review.record({ complete: true }) })')
    ok(!r2.ok && r2.content.includes('下一档'), '没有到期阶段时说清下一档（不静默成功）', r2.content.slice(0, 200))
    const r3 = await h.run('((api)=>{ return await api.review.record({ stage: "d7" }) })')
    ok(!r3.ok && r3.content.includes('已经完成'), '已完成的阶段拒绝重复落账', r3.content.slice(0, 160))
  }

  /* ---------- 4. merge：同阶段校验 / 建组 / split 互逆 ---------- */
  {
    const h = harness(mastered(mastered(baseStore(), childId), rootId), childId)
    const m1 = await h.run('((api)=>{ return await api.review.merge({ nodeIds: ["微积分"] }) })')
    ok(m1.ok && m1.content.includes('复习组'), '同阶段节点合并建组', m1.content)
    const s1 = h.store()
    ok(reviewGroupOf(s1, childId).length === 2 && s1.nodes.find((n) => n.id === rootId)?.review?.groupId === s1.nodes.find((n) => n.id === childId)?.review?.groupId, '组成员共享同一个 groupId')
    const sp = await h.run('((api)=>{ return await api.review.adjust({ action: "split" }) })')
    ok(sp.ok && h.store().nodes.find((n) => n.id === childId)?.review?.groupId === undefined, 'split 退出合并组（与 merge 互逆）', sp.content)

    const m2 = await h.run('((api)=>{ return await api.review.merge({ nodeIds: ["极限"] }) })')
    ok(!m2.ok && m2.content.includes('没有可并入'), '只写自己时拒绝（没什么可合并）', m2.content)
    const m3 = await h.run('((api)=>{ return await api.review.merge({}) })')
    ok(!m3.ok && m3.content.includes('nodeIds'), '缺 nodeIds 时说清参数', m3.content.slice(0, 160))

    // 跨阶段不能合并：child 的 d1 已完成（进行中 d3），root 还在 d1
    const split = createReviewPlan(Date.now())
    const childAhead = { ...split, stages: split.stages.map((x) => (x.stage === 'd1' ? { ...x, doneAt: Date.now() } : x)) }
    const s2: LearnStore = {
      ...mastered(mastered(baseStore(), childId), rootId),
      nodes: mastered(mastered(baseStore(), childId), rootId).nodes.map((n) =>
        n.id === childId && n.review ? { ...n, review: childAhead as ReviewPlan } : n,
      ),
    }
    const h2 = harness(s2, childId)
    const m4 = await h2.run('((api)=>{ return await api.review.merge({ nodeIds: ["微积分"] }) })')
    ok(!m4.ok && m4.content.includes('同一阶段'), '不同阶段的合并被拒并说明各自在哪一档', m4.content.slice(0, 220))
  }

  /* ---------- 5. extend / adjust.postpone：补充复习与顺延 ---------- */
  {
    const h = harness(mastered(baseStore(), childId), childId)
    const e1 = await h.run('((api)=>{ return await api.review.extend({ focus: "搞不清收敛与有界", days: 2 }) })')
    ok(e1.ok && e1.content.includes('补充复习'), 'extend 给薄弱点加补充复习', e1.content.slice(0, 200))
    const extraId = h.store().nodes.find((n) => n.id === childId)?.review?.extra?.[0]?.id
    ok(!!extraId, '补充任务落进计划', extraId)
    const e2 = await h.run('((api)=>{ return await api.review.record({ extraId: "' + extraId + '", complete: true, note: "这次说清了" }) })')
    ok(e2.ok && h.store().nodes.find((n) => n.id === childId)?.review?.extra?.[0]?.doneAt !== undefined, '补充复习用 extraId 落账完成', e2.content)
    const e3 = await h.run('((api)=>{ return await api.review.extend({}) })')
    ok(!e3.ok && e3.content.includes('focus'), '没有具体薄弱点就拒绝加补充复习', e3.content.slice(0, 160))

    const before = h.store().nodes.find((n) => n.id === childId)?.review?.stages.find((x) => x.stage === 'd3')?.dueAt ?? 0
    const p1 = await h.run('((api)=>{ return await api.review.adjust({ action: "postpone", stage: "d3", days: 5 }) })')
    const after = h.store().nodes.find((n) => n.id === childId)?.review?.stages.find((x) => x.stage === 'd3')?.dueAt ?? 0
    ok(p1.ok && after > before, 'postpone 把到期日往后推', p1.content)
    const p2 = await h.run('((api)=>{ return await api.review.adjust({ action: "随便" }) })')
    ok(!p2.ok && p2.content.includes('postpone'), 'adjust 的 action 认不出时报错并列出可选值', p2.content.slice(0, 160))
  }

  /* ---------- 6. 持久化：计划跟着节点落盘读回 ---------- */
  {
    const s = mastered(baseStore(), childId)
    const back = parseDocs(buildDocs(s), buildState(s))
    const plan = back?.nodes.find((n) => n.id === childId)?.review
    ok(plan?.stages.length === 5, 'buildDocs → parseDocs 往返后计划原样回来', plan)

    const broken: LearnStore = {
      ...s,
      nodes: s.nodes.map((n) => (n.id === childId ? { ...n, review: { oops: 1 } as unknown as ReviewPlan } : n)),
    }
    const back2 = parseDocs(buildDocs(broken), buildState(broken))
    ok(back2?.nodes.find((n) => n.id === childId)?.review === undefined, '盘上读不出形状的计划收成「没有」')
  }
}
