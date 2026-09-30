/**
 * 探针分组：跟随滚动与学习状态（原文件第 5 节与第 9 节）。
 *
 * - scrollTests：跟随最新 / 脱离自动滚动的折算与两个阈值（错了就是「读着读着被拽回底部」）；
 * - learningStateTests：自评 / 掌握度 / 错误记忆 / 检验，以及沙箱里 state.* 的行为。
 *
 * 共享 fixture（ok / NOW / baseStore / childId / rootId / harness）见 ./harness。
 */
import type { Exam } from '../../src/learn/exam'
import { buildDocs, parseDocs } from '../../src/learn/files'
import {
  clampMastery,
  learningLine,
  normalizeLearning,
  parseCheck,
  selfReportOf,
  withMistake,
  withVisit,
} from '../../src/learn/learning'
import {
  abandonAttempt,
  addCheck,
  applyExplanation,
  applyGradeResult,
  knowledgeDepth,
  noteMistake,
  startAttempt,
  submitAttempt,
  updateLearning,
  upsertExam,
} from '../../src/learn/graph'
import { recordInput } from '../../src/learn/examRecords'
import { MAX_CHECKS, MAX_MISTAKES } from '../../src/learn/types'
import { bottomGap, isAtBottom, isUserScrollUp, shouldDetachByWheel, wheelPixels } from '../../src/lib/scrollFollow'
import { NOW, baseStore, childId, goalId, harness, ok, rootId } from './harness'

/**
 * 5. 跟随最新 / 脱离自动滚动的判据。
 *
 * 这些阈值与折算靠肉眼审不出来（一个数字写错就是「读着读着被拽回底部」或「怎么滚都不脱离」），
 * 而它们又和模型输出速度纠缠在一起，很难手动复现，所以把边界一条条钉住。
 */
export function scrollTests() {
  // deltaMode 折算：像素原样、行按 16px、页按一屏高
  ok(wheelPixels({ deltaY: 100, deltaMode: 0 }, 800) === 100, '像素模式原样')
  ok(wheelPixels({ deltaY: 3, deltaMode: 1 }, 800) === 48, '行模式按 16px 折算')
  ok(wheelPixels({ deltaY: 1, deltaMode: 2 }, 800) === 800, '页模式按一屏高折算')

  // 累计与时间窗
  const t0 = 1_000_000
  const latch = { last: 0, up: 0 }
  ok(!shouldDetachByWheel(latch, { deltaY: -100, deltaMode: 0 }, t0, 800), '一格滚轮（100px）还不脱离')
  ok(shouldDetachByWheel(latch, { deltaY: -100, deltaMode: 0 }, t0 + 50, 800), '窗口内累计到 200px → 脱离')
  const latch2 = { last: 0, up: 0 }
  ok(!shouldDetachByWheel(latch2, { deltaY: -130, deltaMode: 0 }, t0, 800), '130px 差一点点，不脱离')
  ok(shouldDetachByWheel(latch2, { deltaY: -20, deltaMode: 0 }, t0 + 30, 800), '再过 20px 就跨过阈值')
  const latch3 = { last: 0, up: 0 }
  shouldDetachByWheel(latch3, { deltaY: -120, deltaMode: 0 }, t0, 800)
  ok(!shouldDetachByWheel(latch3, { deltaY: -120, deltaMode: 0 }, t0 + 2000, 800), '隔了 2 秒：窗口重置，重新累计')
  const latch4 = { last: 0, up: 0 }
  shouldDetachByWheel(latch4, { deltaY: -120, deltaMode: 0 }, t0, 800)
  ok(!shouldDetachByWheel(latch4, { deltaY: 60, deltaMode: 0 }, t0 + 30, 800), '中间往下滚过：不脱离')
  ok(latch4.up === 0, '往下滚会把累计清零', latch4.up)

  // 离底部的距离与「是否已回到最新」
  ok(bottomGap({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 }) === 100, 'bottomGap 正常值')
  ok(bottomGap({ scrollHeight: 1000, scrollTop: 700, clientHeight: 400 }) === 0, '回弹给的负值按 0 算')
  ok(isAtBottom(0) && isAtBottom(32) && !isAtBottom(33), 'isAtBottom 的边界就是 REPIN_PX')

  // 谁把位置往上挪的
  ok(isUserScrollUp(400, 500, 5000), '往上走且不是刚滚过滚轮 → 是用户干的')
  ok(!isUserScrollUp(400, 500, 10), '刚滚过滚轮：留给滚轮那套累计判据')
  ok(!isUserScrollUp(500, 400, 5000), '往下走不算')
  ok(!isUserScrollUp(500, 501, 5000), '1px 的抖动不算')
}

/* ---------- 9. 学习状态：自评 / 掌握度 / 错误记忆 / 检验 ---------- */

/**
 * 这一段守的是「系统对这个人的了解」。它坏掉的方式很安静：
 * 错法记成了「第 3 题错了」于是永远累加不上、掌握度被一个越界的数字写坏、
 * 检验记录无限增长把 meta.json 撑大、没评估过的节点被当成 0 分……
 * 界面上都不会报错，只会让状态面板里的数字慢慢变得没人信。
 */
export async function learningStateTests() {
  const node = baseStore().nodes.find((n) => n.id === childId)!

  /* 1) 错误记忆：同一类错法只累加，不是记成两条 */
  const m1 = withMistake(node, { pattern: '漏乘内部导数' })
  ok(m1.fresh && m1.record.count === 1, '第一次记下一个错法', m1.record)
  const m2 = withMistake(m1.node, { pattern: ' 漏乘 内部导数 ' })
  ok(!m2.fresh && m2.record.count === 2, '同一类错法（只差空白）累加次数而不是新增一条', m2.node.learning?.mistakes)
  ok(m2.node.learning?.mistakes?.length === 1, '归一化之后只剩一条', m2.node.learning?.mistakes)
  const m3 = withMistake(m2.node, { pattern: '移项没变号', cause: '把等式变形当成恒等变形' })
  ok(m3.node.learning?.mistakes?.length === 2, '换一种错法才是新的一条', m3.node.learning?.mistakes)
  ok(m3.record.cause === '把等式变形当成恒等变形', '成因跟着记下来', m3.record)
  const m4 = withMistake(m3.node, { pattern: '漏乘内部导数', cause: '后来补的成因' })
  ok(m4.record.count === 3 && m4.record.cause === '后来补的成因', '再犯时刷新次数与成因', m4.record)

  /* 2) 学习行为：最近学习按天记，次数照加 */
  const t0 = new Date('2026-05-01T09:00:00').getTime()
  const t1 = new Date('2026-05-01T21:00:00').getTime()
  const t2 = new Date('2026-05-03T09:00:00').getTime()
  const v1 = withVisit(node, t0)
  const v2 = withVisit(v1, t1)
  ok(v1.learning?.lastStudiedAt === t0 && v2.learning?.lastStudiedAt === t0, '同一天再打开不刷新「最近学习」', v2.learning)
  ok(v2.learning?.visits === 2, '但学习次数照加', v2.learning?.visits)
  ok(withVisit(v2, t2).learning?.lastStudiedAt === t2, '隔天打开才刷新', withVisit(v2, t2).learning)

  /* 3) 值域：写不进去的值必须挡住，而不是塞进状态里 */
  ok(clampMastery(150) === 100 && clampMastery(-5) === 0, '掌握度夹在 0~100', [clampMastery(150), clampMastery(-5)])
  ok(clampMastery(62.4) === 62, '取整（面板上不显示小数）', clampMastery(62.4))
  ok(clampMastery('62') === null && clampMastery(Number.NaN) === null, '字符串与 NaN 一律不收', clampMastery('62'))
  ok(selfReportOf('了解但不熟') === 'familiar' && selfReportOf('mastered') === 'mastered', '自评认中文说法与英文 key')
  ok(selfReportOf('半懂') === null, '认不出的自评回 null（调用方据此报错）', selfReportOf('半懂'))

  /* 4) 读盘时的规范化：乱值丢弃、上限裁剪、没有就是没有 */
  const dirty = normalizeLearning({ self: '还好', mastery: 999, selfBy: 'user', checks: [{ kind: '乱写' }], mistakes: [{ count: 3 }] })
  ok(dirty?.self === undefined && dirty?.mistakes === undefined, '认不出的自评与空说法的错题都丢掉', dirty)
  ok(dirty?.mastery === 100 && dirty?.selfBy === undefined, '越界的掌握度夹住；没有自评时 selfBy 不该留着', dirty)
  ok(normalizeLearning({}) === undefined && normalizeLearning(null) === undefined, '空对象 = 没有状态，不是空状态')
  const many = normalizeLearning({
    checks: Array.from({ length: MAX_CHECKS + 5 }, (_, i) => ({ kind: 'probe', at: i + 1, score: i })),
    mistakes: Array.from({ length: MAX_MISTAKES + 5 }, (_, i) => ({ pattern: '错法' + i, count: 1, lastAt: i + 1 })),
  })
  ok(many?.checks?.length === MAX_CHECKS, '检验记录只留最近 ' + MAX_CHECKS + ' 条', many?.checks?.length)
  ok(many?.checks?.[0].at === 6, '丢掉的是最旧的那几条', many?.checks?.[0])
  ok(many?.mistakes?.length === MAX_MISTAKES, '错误记忆也有上限', many?.mistakes?.length)

  /* 5) parseCheck：kind 不认时必须报错，不能默认成探针 */
  const badKind = parseCheck({ kind: '考试一下' })
  ok(!badKind.ok && badKind.message.includes('probe'), 'kind 认不出时报错并列出可选项', badKind)
  const goodKind = parseCheck({ kind: '主动回忆', mentioned: ['导数定义'], missed: ['隐函数求导'], misconceptions: ['把导数当成增加的量'] })
  ok(goodKind.ok && goodKind.check.kind === 'recall', '中文「主动回忆」认得出', goodKind)

  /* 6) 落盘往返：学习状态跟着 meta.json 走，没评估过的节点不留这个键 */
  let s = updateLearning(baseStore(), childId, { self: 'unsure', selfBy: 'user', mastery: 62, masteryNote: '探针答对大半，漏了内外函数' })
  s = noteMistake(s, childId, { pattern: '漏乘内部导数', cause: '内外函数的概念不稳' })!.store
  s = addCheck(s, childId, {
    kind: 'recall',
    at: NOW + 2000,
    mentioned: ['导数定义', '几何意义'],
    missed: ['隐函数求导'],
    misconceptions: ['把导数当成「函数增加的量」'],
  })
  const round = parseDocs(buildDocs(s), {})
  const child = round?.nodes.find((n) => n.id === childId)
  ok(child?.learning?.mastery === 62 && child?.learning?.self === 'unsure' && child?.learning?.selfBy === 'user', '自评与掌握度逐字往返', child?.learning)
  ok(child?.learning?.masteryNote === '探针答对大半，漏了内外函数', '给分依据也落盘', child?.learning?.masteryNote)
  ok(child?.learning?.mistakes?.[0].pattern === '漏乘内部导数' && child?.learning?.mistakes?.[0].cause === '内外函数的概念不稳', '错误记忆往返', child?.learning?.mistakes)
  ok(child?.learning?.checks?.[0].kind === 'recall' && child?.learning?.checks?.[0].missed?.[0] === '隐函数求导', '回忆的三分类往返', child?.learning?.checks)
  ok(round?.nodes.find((n) => n.id === rootId)?.learning === undefined, '没评估过的节点读回来仍然没有 learning 这一项', round?.nodes.find((n) => n.id === rootId)?.learning)
  ok(!buildDocs(baseStore()).get('docs/微积分/极限/极限.meta.json')!.includes('"learning":'), '没评估过就不写这一项（不留空壳）')
  ok(learningLine(child!).includes('掌握度 62/100') && learningLine(child!).includes('错过的：'), 'learningLine 把状态压成一行给提示词', learningLine(child!))

  /* 7) 知识深度是图的层数，不是人的水平（design 第六节） */
  ok(knowledgeDepth(s, rootId) === 0 && knowledgeDepth(s, childId) === 1, '目标是第 0 层，它的下级是第 1 层', [knowledgeDepth(s, rootId), knowledgeDepth(s, childId)])
  const deeper = upsertExam(s, { id: 'x', nodeId: childId, goalId, title: 'x', kind: 'quiz', level: 'easy', minutes: 0, questions: [], createdAt: NOW, attempts: [] })
  ok(knowledgeDepth(deeper, '不存在的节点') === 0, '节点不存在时回 0，不抛异常')

  /* 8) 判分完成自动落一条检验记录：成绩是系统算的，不该指望模型记得写回来 */
  const exam: Exam = {
    id: 'e1', nodeId: childId, goalId, title: '极限 · 随堂小测', kind: 'quiz', level: 'medium', minutes: 0,
    questions: [
      { id: 'q1', type: 'truefalse', stem: '极限存在则唯一', points: 2, answer: ['true'] },
      { id: 'q2', type: 'truefalse', stem: '无穷小就是 0', points: 2, answer: ['false'] },
    ],
    createdAt: NOW, attempts: [],
  }
  // 开考 → 作答（走记录那一层，与考试窗口同一条路）→ 交卷：答案与 inputs 由 recordInput 一起维护
  let live = startAttempt(upsertExam(baseStore(), exam), 'e1', 'a1', NOW, false)
  const attempt0 = live.exams[0].attempts[0]
  live = upsertExam(live, { ...live.exams[0], attempts: [recordInput(attempt0, live.exams[0], { questionId: 'q1', value: ['true'], at: NOW + 1000 })] })
  const afterFirst = live.exams[0].attempts[0]
  live = upsertExam(live, { ...live.exams[0], attempts: [recordInput(afterFirst, live.exams[0], { questionId: 'q2', value: ['true'], at: NOW + 2000 })] })
  ok(live.exams[0].attempts[0].answers.length === 2, '作答与输入流水一起维护（两题都记下了）', live.exams[0].attempts[0].answers)
  const submitted = submitAttempt(live, 'e1', 'a1', NOW + 3000)
  ok(
    submitted.exams[0].attempts[0].status === 'submitted' && (submitted.exams[0].attempts[0].results ?? []).length === 2,
    '交卷即完成客观题本地判分',
    submitted.exams[0].attempts[0].status,
  )
  const graded = applyGradeResult(submitted, 'e1', 'a1', { passed: false, summary: '第二题错了，再想想无穷小的定义。' })
  const examCheck = graded.store.nodes.find((n) => n.id === childId)?.learning?.checks?.[0]
  ok(examCheck?.kind === 'exam' && examCheck.score === 50, '判分后自动记一条考试检验（2 题对 1 题 = 50 分）', examCheck)
  ok(examCheck?.note?.includes('2/4') === true, '记录里带上得分与总分', examCheck?.note)
  const again = applyGradeResult(graded.store, 'e1', 'a1', { passed: false, summary: '重复提交' })
  ok(again.store.nodes.find((n) => n.id === childId)?.learning?.checks?.length === 1, '重复判分不会在时间线上留两条', again.store.nodes.find((n) => n.id === childId)?.learning?.checks)
  const explained = applyExplanation(graded.store, 'e1', 'a1', '第 2 题错在把无穷小当成 0。')
  ok(
    explained.ok && explained.store.exams[0].attempts[0].explanation?.includes('无穷小'),
    '错题讲解写进那一次考试（副本页签里显示的就是它）',
    explained.store.exams[0].attempts[0].explanation,
  )
  const abandoned = abandonAttempt(live, 'e1', 'a1', NOW + 4000)
  ok(
    abandoned.exams[0].attempts[0].status === 'abandoned' && abandoned.exams[0].attempts[0].results === undefined,
    '放弃：判 0 分，连客观题都不判（用户明确要的语义）',
    abandoned.exams[0].attempts[0].status,
  )
  ok(
    applyExplanation(abandoned, 'e1', 'a1', 'x').ok === false,
    '放弃的那一次不接受错题讲解（不判分也不讲解）',
  )

  /* 9) 沙箱里的 state.* 真的能用（名单与实现一致由 apiNameTests 管，这里管行为） */
  const h = harness(baseStore(), childId)
  const r1 = await h.run('((api)=>{ return await api.state.read() })')
  ok(r1.ok && r1.content.includes('"mastery":null') && r1.content.includes('还没有任何学习状态'), 'state.read 对没评估过的节点回 null 而不是 0', r1.content.slice(0, 200))
  const r2 = await h.run('((api)=>{ return await api.state.update({ mastery: 58, note: "刚讲完，还没测" }) })')
  ok(r2.ok && h.store().nodes.find((n) => n.id === childId)?.learning?.mastery === 58, 'state.update 写进掌握度', r2.content)
  const r3 = await h.run('((api)=>{ return await api.state.update({ self: "不确定", by: "user" }) })')
  ok(r3.ok && h.store().nodes.find((n) => n.id === childId)?.learning?.selfBy === 'user', '学习者确认过的自评记成 by:user', r3.content)
  const r4 = await h.run('((api)=>{ return await api.state.update({ self: "半懂" }) })')
  ok(!r4.ok && r4.content.includes('mastered'), '自评写错时报错并列出四档', r4.content.slice(0, 200))
  const r5 = await h.run('((api)=>{ return await api.state.update({ mastery: 200 }) })')
  ok(r5.ok && h.store().nodes.find((n) => n.id === childId)?.learning?.mastery === 100, '越界的掌握度被夹住', r5.content)
  const r6 = await h.run('((api)=>{ return await api.state.mistake({ pattern: "把 Q 和 K 的角色搞反", cause: "没抓住「谁查谁」" }) })')
  ok(r6.ok && r6.content.includes('新的错误'), 'state.mistake 记下一条新错法', r6.content)
  const r7 = await h.run('((api)=>{ return await api.state.mistake({ pattern: "把 Q 和 K 的角色搞反" }) })')
  ok(r7.ok && r7.content.includes('累计 2 次'), '同类错法再犯只累加', r7.content)
  const r8 = await h.run('((api)=>{ return await api.state.check({ kind: "probe", question: "为什么…", answer: "因为…", score: 70 }) })')
  ok(r8.ok && r8.content.includes('探针'), 'state.check 记下一次探针', r8.content)
  ok(h.store().nodes.find((n) => n.id === childId)?.learning?.checks?.length === 1, '记录真的落到 store', h.store().nodes.find((n) => n.id === childId)?.learning?.checks)
  const r9 = await h.run('((api)=>{ return await api.state.check({ kind: "随便" }) })')
  ok(!r9.ok && r9.content.includes('probe'), 'kind 认不出时给出可选项', r9.content.slice(0, 200))
  const r10 = await h.run('((api)=>{ return await api.state.forget("把 Q 和 K 的角色搞反") })')
  ok(r10.ok && (h.store().nodes.find((n) => n.id === childId)?.learning?.mistakes?.length ?? -1) === 0, 'state.forget 清掉指定的那条', r10.content)
  const r11 = await h.run('((api)=>{ return await api.state.forget("根本没有这条") })')
  ok(!r11.ok && r11.content.includes('错误记忆'), '没有可清的错误记忆时说清楚（而不是假装清掉了）', r11.content.slice(0, 200))
  const r12 = await h.run('((api)=>{ return await api.state.read("根本没有的节点") })')
  ok(!r12.ok && r12.content.includes('没有'), 'path 找不到时给出可读原因', r12.content.slice(0, 200))
  const r13 = await h.run('((api)=>{ return await api.state.update("微积分", { mastery: 80 }) })')
  ok(h.store().nodes.find((n) => n.id === rootId)?.learning?.mastery === 80, 'state.update 支持 path 指名别的节点', r13.content)
  const r14 = await h.run('((api)=>{ return await api.state.read("微积分") })')
  ok(r14.ok && r14.content.includes('80'), 'state.read(path) 读的是那一个节点', r14.content.slice(0, 200))
}
