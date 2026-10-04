/**
 * 探针分组：出题与考试、持久化函数与工作流、学习者画像（原文件第 6 节的出题入参，以及 method+sdoc / wf / userInfo）。
 *
 * 这几段共用一类东西：一个假沙箱执行器 + 宿主侧的桩依赖，钉住「错了界面不会报错」的那些语义。
 * 共享 fixture（ok / NOW / childId / goalId / baseStore / harness / staticStore / fakeRunner）见 ./harness。
 */
import type { Exam, ExamAttempt } from '../../src/learn/exam'
import { examDeleteBlock, examReadPayload, normalizeQuestions, parseQuestions, questionsMix } from '../../src/learn/exam'
import { replaceQuestionImages } from '../../src/learn/graph'
import { newAttempt } from '../../src/learn/examRecords'
import { buildDocs, buildState, parseDocs } from '../../src/learn/files'
import { createAgentOps, makeExamTool } from '../../src/learn/agentOps'
import {
  compileBody,
  createExecuteTool,
  normalizeAskForm,
  normalizeBody,
  type ExamToolDeps,
} from '../../src/agent/tools'
import { writeSuperDoc } from '../../src/learn/superdocs'
import { upsertMethod } from '../../src/learn/methods'
import { builtinWorkflowRows, upsertWorkflow } from '../../src/learn/workflows'
import { normalizeProfile } from '../../src/user/profile'
import { emptyProfile, type UserProfile } from '../../src/user/types'
import { REAL_EXAM_QUESTIONS } from '../fixtures/exam-real-questions'
import {
  NOW,
  baseStore,
  childId,
  fakeRunner,
  goalId,
  harness,
  ok,
  staticStore,
} from './harness'

/* ---------- 6. 出题入参（exam.create）与 body 的编译检查 ---------- */

/**
 * 这一节钉的是同一次报障里的两个故障。
 *
 * 1. exam.create 对任何输入都回「题目格式不合法，请检查后重试」。根因不是校验写错，
 *    而是**题目写法从来没写在模型看得见的地方**：提示词里只有 exam.create({ title, kind, level, questions })，
 *    沙箱又没有 JSON Schema 级校验，模型只能猜（它猜了 55 次、19 种题型名、8 种选项写法）；
 *    而校验器把「题型不对」「缺字段」「答案对不上选项」等二十来种毛病压成同一句话，
 *    它连「该改哪里」都无从知道。fixtures/exam-real-questions.ts 就是那次的原始入参。
 * 2. 沙箱偶发报「await is only valid in async functions」。根因在括号计数：
 *    模型在函数体里写了注释 '// 1) 换节点…'，注释里那个 ) 被当成配对括号，
 *    「剥外层括号」于是放弃，补 async 的一步把 async 插到了整段最前面
 *    （'async ((api)=>{…})' 是「调用一个叫 async 的函数」，箭头自己仍是非 async），
 *    归一化整体作废、原文交给沙箱，报错行号还指向沙箱自己的包装代码——模型看不出该改什么。
 */
export async function examTests() {
  /* 1) 真实那份入参必须全部认下来 */
  const real = parseQuestions(REAL_EXAM_QUESTIONS)
  ok(real.ok, '真实运行里那份入参现在能解析（旧实现一律回「题目格式不合法」）', real.ok ? '' : real.message)
  if (real.ok) {
    const qs = real.questions
    const first = REAL_EXAM_QUESTIONS[0] as { analysis: string }
    ok(qs.length === 10, '10 道题一道不少', qs.length)
    ok(qs[0].type === 'single' && qs[0].stem.startsWith('关于「中心化账本」'), '题干取自 question 字段（不是 stem）', qs[0].stem)
    ok(qs[0].options?.map((o) => o.id).join('') === 'ABCD', '字符串选项按 A/B/C/D 编出 id', qs[0].options)
    ok(qs[0].answer?.join() === 'B', 'answer:"B" 认成一个选项 id', qs[0].answer)
    ok(qs[0].rubric === first.analysis, 'analysis 并进 rubric（阅卷的模型要看它）', qs[0].rubric)
    ok(qs[1].answer?.join() === 'A,B,C,D', 'answer:"A,B,C,D" 拆成四个 id', qs[1].answer)
    ok(qs[2].type === 'truefalse' && qs[2].answer?.join() === 'false', 'type:judge + answer:"错误" → 对错题 false', [qs[2].type, qs[2].answer])
    ok(qs[2].options?.length === 2, '对错题的选项由系统补上两项', qs[2].options)
    ok(qs[9].type === 'short' && (qs[9].answer?.length ?? 0) > 0, '简答题的参考答案没被丢掉（readExam 要拿它给阅卷的模型）', qs[9].answer)
    ok(qs.every((q) => q.points >= 1 && q.stem.length > 0), '每题都有题干与分值')
    ok(
      questionsMix(qs) === '单选题 5 / 多选题 2 / 对错题 2 / 简答题 1',
      '出题回执里的题型分布把 judge 显示成对错题',
      questionsMix(qs),
    )
  }

  /* 2) 驳回时必须点明「第几题、哪个字段、该写成什么」——这是那次故障的核心 */
  const bad: Array<[string, unknown]> = [
    ['没给 questions', undefined],
    ['空数组', []],
    ['给了一段文本', '第一题：区块链是什么？'],
    ['题目不是对象', [null]],
    ['题型不认识', [{ type: 'essay_question', stem: 'x' }]],
    ['题型给了数字', [{ type: 1, stem: 'x' }]],
    ['没有题干', [{ type: 'single', options: ['a', 'b'], answer: 'A' }]],
    ['单选没给选项', [{ type: 'single', stem: 'x', answer: 'A' }]],
    ['选项只有一个', [{ type: 'single', stem: 'x', options: ['a'], answer: 'A' }]],
    ['没给答案', [{ type: 'single', stem: 'x', options: ['a', 'b'] }]],
    ['答案是数字', [{ type: 'single', stem: 'x', options: ['a', 'b'], answer: 0 }]],
    ['答案对不上选项', [{ type: 'single', stem: 'x', options: ['a', 'b'], answer: 'C' }]],
    ['单选给了两个答案', [{ type: 'single', stem: 'x', options: ['a', 'b'], answer: ['A', 'B'] }]],
    ['答案对错题写错', [{ type: 'truefalse', stem: 'x', answer: '嗯' }]],
  ]
  const messages: string[] = []
  for (const [label, input] of bad) {
    const r = parseQuestions(input)
    ok(!r.ok, label + '：应当被驳回', r)
    if (!r.ok) messages.push(r.message)
    ok(normalizeQuestions(input) === null, label + '：旧签名仍返回 null（老调用方不受影响）')
  }
  const heads = messages.map((m) => m.slice(0, 16))
  ok(new Set(heads).size >= 11, '十四种毛病给出的是不同的话，不是同一句兜底', heads)
  ok(messages.every((m) => m.includes('正确写法：')), '每条驳回都附上规范写法', messages[0])
  ok(messages.every((m) => !m.includes('请检查后重试')), '不再有「请检查后重试」这种没有信息量的兜底')
  ok(
    messages.filter((m) => m.startsWith('第 1 题')).length >= 8,
    '题目级的错误都指明是第几题',
    messages.filter((m) => !m.startsWith('第 1 题')),
  )

  /* 3) 意图唯一的写法一律认下来（不逼模型改） */
  const t1 = parseQuestions([{ type: '单选题', question: 'x', options: ['A. 甲', 'B. 乙'], answer: '甲' }])
  ok(
    t1.ok && t1.questions[0].type === 'single' && t1.questions[0].answer?.join() === 'A' && t1.questions[0].options?.[0].text === '甲',
    '中文题型 + "A. " 前缀 + 答案写选项原文',
    t1,
  )
  const t2 = parseQuestions([{ type: 'tf', stem: 'x', answer: true }])
  ok(t2.ok && t2.questions[0].type === 'truefalse' && t2.questions[0].answer?.join() === 'true', 'type:tf + answer:true', t2)
  const t3 = parseQuestions([{ stem: 'x', options: [{ label: 'A', text: '甲' }, { label: 'B', text: '乙' }], answer: '甲' }])
  ok(t3.ok && t3.questions[0].type === 'single' && t3.questions[0].options?.[0].id === 'A', '省略 type → 按字段推断为单选', t3)
  const t4 = parseQuestions([{ type: 'choice', stem: 'x', options: [{ text: '甲', correct: true }, { text: '乙', correct: false }] }])
  ok(t4.ok && t4.questions[0].answer?.join() === 'A', '选项上标了 correct:true 时答案从标记里取', t4)
  const t5 = parseQuestions(JSON.stringify([{ type: 'fill', stem: 'x', answer: '1,5' }]))
  ok(t5.ok && t5.questions[0].answer?.join() === '1,5', 'questions 是 JSON 文本也认；填空答案不按逗号拆', t5)
  const t6 = parseQuestions({ questions: [{ type: 'short', stem: 'x' }] })
  ok(t6.ok && t6.questions.length === 1, '{questions:[…]} 包一层也认', t6)
  const t7 = parseQuestions({ type: 'short', stem: 'x' })
  ok(t7.ok && t7.questions.length === 1, '整个 questions 就是一道题也认', t7)
  const t8 = parseQuestions([{ type: 'multiple', stem: 'x', options: [{ key: 'A', value: '甲' }, { key: 'B', value: '乙' }], answer: ['A', 'B'] }])
  ok(t8.ok && t8.questions[0].options?.[1].text === '乙', '{key,value} 选项', t8)
  const t9 = parseQuestions([{ type: 'multiple', stem: 'x', options: ['甲', '乙', '丙'], answer: 'A、B' }])
  ok(t9.ok && t9.questions[0].answer?.join() === 'A,B', '多选答案用顿号连写也认', t9)

  /* 3.5) 带图的题：image 是完整 SVG 源码，入库前消毒（script / 事件属性 / foreignObject 剥掉） */
  const fig = parseQuestions([
    {
      type: 'single',
      stem: '下图函数 $f(x)=x^2-2$ 的零点个数是？',
      image:
        '```svg\n<svg viewBox="0 0 200 120" onload="alert(1)"><script>alert(2)</script>' +
        '<circle cx="60" cy="60" r="40" fill="none" stroke="black"/><foreignObject><body>x</body></foreignObject></svg>\n```',
      options: ['1 个', '2 个'],
      answer: 'A',
    },
  ])
  ok(fig.ok, '带 SVG 配图的题能解析（image 认围栏包裹）', fig.ok ? '' : fig.message)
  if (fig.ok) {
    const img = fig.questions[0].image ?? ''
    ok(img.startsWith('<svg'), '只保留 svg 根（外面的围栏与说明不要）', img.slice(0, 40))
    ok(!img.includes('<script') && !img.includes('onload'), 'script 与事件属性被剥掉', img)
    ok(!img.includes('foreignObject'), 'foreignObject 整棵剪掉', img)
    ok(img.includes('<circle'), '图形本体保留', img)
  }
  const badFig = parseQuestions([{ type: 'single', stem: 'x', image: '<div>不是 svg</div>', options: ['a', 'b'], answer: 'A' }])
  ok(!badFig.ok, 'image 里没有 <svg> 要驳回并指路', badFig.ok ? '' : badFig.message)

  /* 3.6) 插图自检的修复写回（graph/exams 的 replaceQuestionImages）：只动指定试卷的指定题 */
  const examWithQuestion = (qid: string): Exam => ({
    id: 'ex-fix',
    nodeId: childId,
    goalId,
    title: 't',
    kind: 'quiz',
    level: 'easy',
    minutes: 0,
    questions: [{ id: qid, type: 'single', stem: 's', points: 1 }],
    createdAt: 0,
    attempts: [],
  })
  const fixed = replaceQuestionImages({ ...baseStore(), exams: [examWithQuestion('q1')] }, 'ex-fix', {
    q1: '<svg viewBox="0 0 1 1"></svg>',
  })
  ok(fixed.exams[0]?.questions[0]?.image !== undefined, 'replaceQuestionImages 把修复写回对应题目', fixed.exams[0]?.questions[0])
  ok(
    replaceQuestionImages({ ...baseStore(), exams: [examWithQuestion('q1')] }, 'ex-missing', { q1: '<svg/>' }).exams[0]?.questions[0]?.image === undefined,
    '找不到试卷时不动任何东西',
  )

  /* 4) 工具层：直接把数组当入参传给 exam.create，不能被 asRecord 悄悄变成「没有 questions」 */
  const captured: Array<Record<string, unknown>> = []
  const stub = createExecuteTool({
    nodeId: () => childId,
    resolveNode: (path) => ({ ok: true, ref: { id: childId, title: '极限', label: path || '极限' } }),
    resolveDoc: (path) => ({ ok: true, ref: { id: childId, title: '极限', label: path || '极限', kind: 'teaching', docLabel: '极限' } }),
    docOps: {
      read: () => '',
      write: () => ({ ok: true, content: 'ok' }),
      replace: () => ({ ok: true, content: 'ok' }),
      append: () => ({ ok: true, content: 'ok' }),
    },
    nodeOps: {
      list: () => ({ count: 1, nodes: [] }),
      read: () => ({}),
      create: () => ({ ok: true, content: 'ok' }),
      update: () => ({ ok: true, content: 'ok' }),
      remove: () => ({ ok: true, content: 'ok' }),
    },
    tmp: () => ({ nodeId: childId, entries: {}, onChange: () => {} }),
    exam: {
      create: (payload) => {
        // 与工作区里那一段同构：题目格式不过关就是 ok:false + 一句话，不抛异常，
        // 而且**什么都不落下**（所以被驳回的那一份连宿主都到不了）
        const parsed = parseQuestions(payload.questions)
        if (!parsed.ok) return { ok: false, content: parsed.message }
        captured.push(payload)
        return { ok: true, content: '已生成' }
      },
      read: (attemptId?: string) => ({ ok: true, content: '（卷子' + (attemptId ? ':' + attemptId : '') + '）' }),
      grade: () => ({ ok: true, content: '已记录' }),
      explain: () => ({ ok: true, content: '已讲解' }),
      remove: (payload) => ({ ok: true, content: '已删除' + (typeof payload.id === 'string' ? payload.id : '最新那份') }),
    },
    runSandbox: fakeRunner,
  })
  const bare = await stub.run(
    { description: '出题', body: '((api)=>{ return await api.exam.create([' + '{ type: "single", stem: "x", options: ["a", "b"], answer: "A" }' + ']) })' },
    { nodeId: childId, goalId },
  )
  ok(captured.length === 1 && Array.isArray(captured[0].questions), 'exam.create 直接收到数组时按 questions 理解', captured)
  ok(bare.ok, '这一路真的走通了', bare.content.slice(0, 160))

  /* 4b) 读永远是读：没有卷子也是一种答案，不该进「没有生效」那份清单 */
  const readOk = await stub.run(
    { description: '看卷', body: '((api)=>{ return await api.exam.read() })' },
    { nodeId: childId, goalId },
  )
  ok(readOk.ok && !readOk.content.includes('没有生效'), 'exam.read 拿到内容时不算失败', readOk.content.slice(0, 160))

  /* 4c) 写失败：结果最前面必须写清「哪个 api + 为什么」，模型才不用猜 */
  const badCreate = await stub.run(
    { description: '出题', body: '((api)=>{ return await api.exam.create([' + '{ type: "truefalse", stem: "x", answer: "嗯" }' + ']) })' },
    { nodeId: childId, goalId },
  )
  ok(!badCreate.ok, '写操作没落地时工具级失败（界面上是红的）', badCreate.ok)
  ok(badCreate.content.startsWith('⛔'), '清单顶在结果最前面，不用模型去 result 里翻', badCreate.content.slice(0, 60))
  ok(badCreate.content.includes('exam.create'), '清单里点名是哪个 api', badCreate.content.slice(0, 160))
  ok(badCreate.content.includes('对错题只认 true / false'), '清单里带上「为什么」，一句话就能照着改', badCreate.content.slice(0, 240))
  ok(badCreate.content.includes('不要用 try/catch'), '明说写失败不抛异常：别拿 try/catch 判断成败', badCreate.content.slice(0, 400))
  ok(!captured.some((p) => JSON.stringify(p).includes('嗯')), '被驳回的那一份根本没有进到宿主（不会留下半份卷子）')

  /* 4d) exam.delete：作废走宿主；能不能删的判据在 examDeleteBlock */
  const del = await stub.run({ description: '删除', body: '((api)=>{ return await api.exam.delete() })' }, { nodeId: childId, goalId })
  ok(del.ok && del.content.includes('已删除'), 'exam.delete 走到宿主', del.content.slice(0, 160))
  const delId = await stub.run({ description: '删除', body: '((api)=>{ return await api.exam.delete({ id: "e9" }) })' }, { nodeId: childId, goalId })
  ok(delId.ok && delId.content.includes('e9'), 'exam.delete 能指名 id', delId.content.slice(0, 160))
  const explainCall = await stub.run(
    { description: '讲解', body: '((api)=>{ return await api.exam.explain({ content: "错在把无穷小当成 0" }) })' },
    { nodeId: childId, goalId },
  )
  ok(explainCall.ok && explainCall.content.includes('已讲解'), 'exam.explain 走到宿主', explainCall.content.slice(0, 160))

  /*
   * 4e) 什么样的一份试卷能被 **Agent** 删掉——判据是「一次都没考过」。
   *
   * 考过的卷子不是题目，而是学习记录（作答、输入顺序、单题耗时、切屏、判分、错题讲解），
   * 该不该连坐由用户在试卷列表里决定（那里有警告与二次确认）。这条判据被抽成纯函数
   * 就是为了能在这里一条条钉住：它是「不许删用户的东西」那条规矩，靠提示词提醒模型是不够的。
   */
  const draft: Exam = {
    id: 'e1', nodeId: childId, goalId, title: '临时卷', kind: 'quiz', level: 'easy', minutes: 0,
    questions: [{ id: 'q1', type: 'truefalse', stem: 'x', points: 1, answer: ['true'] }],
    createdAt: NOW, attempts: [],
  }
  ok(examDeleteBlock(draft) === null, '一次都没考过的卷子可以删（出错了的废稿也一样）', examDeleteBlock(draft))
  const ongoingAttempt: ExamAttempt = {
    ...newAttempt('a1', NOW, false),
  }
  ok(
    examDeleteBlock({ ...draft, attempts: [ongoingAttempt] })?.includes('正在考') === true,
    '正在考的那一份删不掉',
    examDeleteBlock({ ...draft, attempts: [ongoingAttempt] }),
  )
  const doneAttempt: ExamAttempt = { ...ongoingAttempt, status: 'graded', answers: [{ questionId: 'q1', value: ['true'] }] }
  const blocked = examDeleteBlock({ ...draft, attempts: [doneAttempt] })
  ok(
    !!blocked && blocked.includes('1 次考试记录') && blocked.includes('二次确认'),
    '考过的卷子 Agent 删不掉：让它去用户那边删（那里列清连带后果）',
    blocked,
  )

  /*
   * 4f) exam.read 的负载：六种状态各说什么话
   * （none / unattempted / ongoing / submitted / graded / abandoned）。
   * 「一份都没有」这一支正是原来被判成调用失败的那一支——它必须是一条正经答案。
   */
  const nonePayload = JSON.parse(examReadPayload({ exams: [], childNodes: [] }))
  ok(
    nonePayload.status === 'none' && String(nonePayload.note).includes('exam.create'),
    '一份卷子都没有时：说清「还没有卷」，并指出要出题就直接 create',
    nonePayload,
  )
  const freshPayload = JSON.parse(
    examReadPayload({ exams: [draft], childNodes: [{ title: '子节点', description: '描述' }] }),
  )
  ok(
    freshPayload.status === 'unattempted' && String(freshPayload.note).includes('不要替学习者开考'),
    '出好了还没考：明确说「别替他开考」',
    freshPayload.note,
  )
  ok(
    freshPayload.paper.minutes === 0 && freshPayload.paper.kind === 'quiz' && freshPayload.paper.totalPoints === 1,
    'paper 里带上类型 / 难度 / 时限 / 满分',
    freshPayload.paper,
  )
  ok(
    freshPayload.totalPapers === 1 && freshPayload.childNodes.length === 1 && freshPayload.questions.length === 1,
    '负载里带上试卷总数、下级知识与题目全文',
    [freshPayload.totalPapers, freshPayload.childNodes.length, freshPayload.questions.length],
  )
  ok(freshPayload.questions[0].userAnswer === undefined, '还没考过就不给作答（那是空的，不是「答了空」）')
  ok(freshPayload.gradingNote === undefined, '还没交卷就不给「逐题讲解」那套要求')

  const running: ExamAttempt = {
    ...newAttempt('a1', NOW, true),
    answers: [{ questionId: 'q1', value: ['true'] }],
    inputs: [{ questionId: 'q1', value: ['true'], at: NOW + 30_000 }],
  }
  const runningPayload = JSON.parse(
    examReadPayload({ exams: [{ ...draft, attempts: [running] }], childNodes: [], now: NOW + 60_000 }),
  )
  ok(
    runningPayload.status === 'ongoing' && String(runningPayload.note).includes('正在进行'),
    '正在考：明说别判分、别讲解，等交卷',
    runningPayload.note,
  )
  ok(
    runningPayload.attempt.forceSubmit === true && runningPayload.attempt.answered === 1 && runningPayload.attempt.durationMs === 60_000,
    'attempt 给出这一次考试的梗概（含「到点强制交卷」与用时）',
    runningPayload.attempt,
  )

  const submitted: ExamAttempt = {
    ...running,
    status: 'submitted',
    endedAt: NOW + 90_000,
    // 最终答案与流水同源（真跑的时候由 recordInput 一起维护，这里手写也要保持一致）
    answers: [{ questionId: 'q1', value: ['false'] }],
    // 超时 30 秒、切出去一次 12 秒、最后那一笔是超时后答的
    overtimeMs: 30_000,
    blurs: [{ start: NOW + 10_000, ms: 12_000 }],
    inputs: [
      { questionId: 'q1', value: ['true'], at: NOW + 20_000 },
      { questionId: 'q1', value: ['false'], at: NOW + 90_000, overtime: true },
    ],
  }
  const submittedPayload = JSON.parse(
    examReadPayload({ exams: [{ ...draft, attempts: [submitted] }], childNodes: [], now: NOW + 120_000 }),
  )
  ok(
    submittedPayload.status === 'submitted' &&
      String(submittedPayload.gradingNote).includes('exam.explain') &&
      String(submittedPayload.gradingNote).includes('history'),
    '待判分：把两步活说清楚——先判分，再看历史写讲解',
    submittedPayload.gradingNote,
  )
  ok(
    submittedPayload.questions[0].userAnswer.value[0] === 'false' && submittedPayload.questions[0].answeredAfterTimeUp === true,
    '带上学习者的作答，并标出这一题是超时之后答的',
    submittedPayload.questions[0],
  )
  ok(
    submittedPayload.attempt.overtimeMs === 30_000 &&
      submittedPayload.attempt.blurCount === 1 &&
      submittedPayload.attempt.overtimeInputs === 1,
    '超时、切屏、超时作答的笔数都进负载（导师据此判断「是犹豫还是不会」）',
    submittedPayload.attempt,
  )

  const gradedAttempt: ExamAttempt = {
    ...submitted,
    status: 'graded',
    results: [
      { questionId: 'q1', correct: false, score: 0, maxScore: 1, comment: '无穷小不是 0', by: 'system' },
    ],
    summary: '概念清楚，但把无穷小当成 0 了。',
    passed: false,
    explanation: '第 1 题错在把「趋于 0」当成「等于 0」。',
  }
  const gradedPayload = JSON.parse(
    examReadPayload({
      exams: [{ ...draft, id: 'e1', attempts: [gradedAttempt] }],
      childNodes: [],
    }),
  )
  ok(
    gradedPayload.status === 'graded' && gradedPayload.passed === false && gradedPayload.score === '0/1',
    '已判分：说清判过了，并把分数与结论带上（不再要求判分）',
    { status: gradedPayload.status, score: gradedPayload.score, passed: gradedPayload.passed },
  )
  ok(String(gradedPayload.note).includes('讲解'), '已判分且已经写过讲解时，说明这一场收尾了', gradedPayload.note)
  ok(gradedPayload.gradingNote === undefined, '已判分的卷子不再要求判分')
  ok(
    gradedPayload.history[0].status === 'graded' &&
      gradedPayload.history[0].score === '0/1' &&
      Array.isArray(gradedPayload.history[0].weak) &&
      gradedPayload.history[0].weak[0].includes('x'),
    'history 里带上「那次考错的题」——讲解要找的薄弱项就在这里',
    gradedPayload.history[0],
  )

  const abandonedPayload = JSON.parse(
    examReadPayload({
      exams: [{ ...draft, attempts: [{ ...submitted, status: 'abandoned', endedAt: NOW + 40_000 }] }],
      childNodes: [],
    }),
  )
  ok(
    abandonedPayload.status === 'abandoned' && String(abandonedPayload.note).includes('放弃'),
    '放弃的那一次：记 0 分、不判分也不讲解，并说明这是用户的选择',
    abandonedPayload.note,
  )
  ok(abandonedPayload.score === '0/1', '放弃就是 0 分', abandonedPayload.score)

  /*
   * 4g) 阶段的翻译层（makeExamTool）：**读永远成功、写才看阶段**。
   * 这一层原先内联在 useAgent 里，Node 探针够不着——而「看看有没有卷子」被判成
   * 一次调用失败的事故正出在这里。抽出来就是为了能这样一条条钉住。
   */
  const seen: string[] = []
  const examDeps = (stage: 'idle' | 'grading'): ExamToolDeps => ({
    stage: () => stage,
    createExam: () => { seen.push('create'); return { ok: true, message: '建好了' } },
    readExam: (attemptId?: string) => { seen.push('read:' + (attemptId ?? '-')); return '（卷子）' },
    gradeExam: () => { seen.push('grade'); return { ok: true, message: '判好了' } },
    explainExam: () => { seen.push('explain'); return { ok: true, message: '讲解写好了' } },
    deleteExam: () => { seen.push('delete'); return { ok: true, message: '删好了' } },
  })
  const idle = makeExamTool(examDeps('idle'))
  const idleRead = idle.read()
  ok(idleRead.ok === true && idleRead.content === '（卷子）', '没人交卷时也能读卷（读不看阶段）', idleRead)
  ok(idle.create({ kind: 'quiz', questions: [] }).ok, '闲置阶段能出题')
  ok(idle.remove({}).ok, '闲置阶段能删没考过的卷子')
  const idleExplain = idle.explain({ content: 'x' })
  ok(
    idleExplain.ok === false && String(idleExplain.content).includes('exam.read'),
    '没有等着讲解的考试时，讲解被拒并指出先读卷看清楚',
    idleExplain,
  )
  const grading = makeExamTool(examDeps('grading'))
  ok(grading.read('a9').ok === true && seen.includes('read:a9'), '读卷可以指名某一次考试', seen)
  const gradingCreate = grading.create({ questions: [] })
  ok(
    gradingCreate.ok === false && String(gradingCreate.content).includes('收尾'),
    '有考试等着收尾时出题被拒，并说清为什么',
    gradingCreate,
  )
  ok(grading.grade({}).ok, '待判分阶段能判分')
  ok(grading.explain({ content: 'x' }).ok, '判完接着写讲解：两步同属那个阶段，不该被自己拦下来', seen)
  ok(grading.remove({}).ok === false, '有待收尾的考试时不让人删卷子（先做完）')
  ok(seen.includes('create'), '被放行的动作真的走到了宿主', seen)

  /* 5) body 的编译检查：注释里的括号骗不过括号计数 */
  const withComment =
    '((api)=>{\n' +
    '  // 1) 换节点再试一次（上级目标根）\n' +
    '  const x = await api.tmp.list()\n' +
    '  return x.items.length\n' +
    '})'
  const normalized = normalizeBody(withComment)
  ok(normalized.startsWith('async (api)'), '注释里的 ) 不再让「剥外层括号」放弃，async 插在函数头之前', normalized.slice(0, 30))
  const compiled = compileBody(withComment)
  ok(compiled.ok && compiled.body.startsWith('async (api)'), '带注释括号的 body 现在能编译', compiled.ok ? '' : compiled.content)
  const arrowInComment = '((api)=>{\n  // 值 => 显示\n  return 1\n})'
  ok(normalizeBody(arrowInComment).startsWith('async (api)'), '注释里的 => 不再被当成函数头')
  ok(compileBody('((api)=>{ return 1 })();').ok, '结尾的分号与自调用括号被摘掉')
  ok(compileBody('((api)=>{ return 1 })(api)').ok, '(api) 自调用也摘掉——留着它沙箱会给模型函数传 undefined')
  ok(normalizeBody('async (api) => { return 1 }') === 'async (api) => { return 1 }', '已经写了 async 的原样不动')
  const stmt = compileBody('const x = 1; return x')
  ok(!stmt.ok && stmt.content.includes('匿名函数'), '语句片段在宿主就被挡住，并说清该写成什么样', stmt.content)
  const inner = compileBody('((api)=>{ const f = () => { return await api.doc.read() }; return f })')
  ok(!inner.ok && inner.content.includes('await') && inner.content.includes('非 async'), '内层非 async 函数里的 await 被点出来（旧实现只在沙箱里报一句无指向的语法错）', inner.content)

  /* 6) 端到端：那条真实触发过语法错的写法，现在必须跑通 */
  const run = await stub.run(
    { description: '换上级节点再试一次', body: withComment },
    { nodeId: childId, goalId },
  )
  ok(run.ok && !run.content.includes('await is only valid'), '带注释括号 + await 的编排真的跑起来了', run.content.slice(0, 160))
}

/**
 * method.* 与 sdoc.* 的行为（名单检查在 apiNameTests 里，这里钉语义）：
 * - method：create 建的函数能被 call 执行（且函数体里真的拿得到 api）、同名覆盖、
 *   编译不过当场被拒、delete 之后 call 明确报「没有这个函数」；
 * - sdoc：write 建、同名覆盖、read 取回原文、delete 删掉。
 * 这些都是「错了不报错、只是用户点按钮没反应」的事，必须钉住。
 */
export async function methodAndSdocTests() {
  const h = harness(baseStore(), childId)
  // 先写一篇已知的文档，method 函数读它来算句号——结果可预言（3 个「。」）
  const seed = await h.run("((api)=>{ return await api.doc.write('', '一。二。三。') })")
  ok(seed.ok, '前置：教学文档写入已知内容', seed.content.slice(0, 120))

  const code = '((api, path) => { const d = await api.doc.read(path); return (d.content.match(/。/g) ?? []).length })'
  const created = await h.run('((api)=>{ return await api.method.create({ name: "数句号", code: ' + JSON.stringify(code) + ' }) })')
  ok(created.ok && created.content.includes('数句号'), 'method.create 建一个函数（语法先过编译）', created.content.slice(0, 160))

  const called = await h.run('((api)=>{ return { n: await api.method.call("数句号", "") } })')
  ok(called.ok && called.content.includes('"n":3'), 'method.call 执行函数并注入了 api（数出 3 个句号）', called.content.slice(0, 160))

  const listed = await h.run('((api)=>{ return await api.method.list() })')
  ok(listed.ok && listed.content.includes('数句号'), 'method.list 列出函数名', listed.content.slice(0, 160))

  const bad = await h.run('((api)=>{ return await api.method.create({ name: "坏的", code: "((api) => { await api.doc" }) })')
  ok(!bad.ok && bad.content.includes('编译'), '编译不过的函数当场被拒', bad.content.slice(0, 160))

  const twice = await h.run('((api)=>{ return await api.method.create({ name: "数句号", code: "((api) => 42)" }) })')
  ok(twice.ok && twice.content.includes('覆盖'), '同名 create 是覆盖（更新函数）', twice.content.slice(0, 160))
  const after = await h.run('((api)=>{ return await api.method.call("数句号") })')
  ok(after.ok && after.content.includes('42'), '覆盖之后 call 到的是新版本', after.content.slice(0, 160))

  const gone = await h.run('((api)=>{ return await api.method.delete("数句号") })')
  ok(gone.ok, 'method.delete 删掉一个函数', gone.content.slice(0, 120))
  const missing = await h.run('((api)=>{ return await api.method.call("数句号") })')
  ok(!missing.ok && missing.content.includes('没有叫'), '删掉之后 call 明确说没有这个函数', missing.content.slice(0, 160))

  const doc = '<button id="b">数一数</button><script>void api</script>'
  const wrote = await h.run('((api)=>{ return await api.sdoc.write("", "句号器", ' + JSON.stringify(doc) + ') })')
  ok(wrote.ok && wrote.content.includes('句号器'), 'sdoc.write 新建一份超级文档', wrote.content.slice(0, 160))
  const read = await h.run('((api)=>{ return await api.sdoc.read("", "句号器") })')
  ok(read.ok && read.content.includes('<button'), 'sdoc.read 取回 HTML 原文', read.content.slice(0, 160))
  const overwrite = await h.run('((api)=>{ return await api.sdoc.write("", "句号器", "<p>第二版</p>") })')
  ok(overwrite.ok && overwrite.content.includes('更新'), 'sdoc.write 同名是覆盖', overwrite.content.slice(0, 160))
  const list = await h.run('((api)=>{ return await api.sdoc.list("") })')
  ok(list.ok && list.content.includes('句号器'), 'sdoc.list 列出该节点的超级文档', list.content.slice(0, 160))
  const count = h.store().nodes.find((n) => n.id === childId)?.superdocs?.length ?? -1
  ok(count === 1, '同名覆盖不会留两份', count)
  const del = await h.run('((api)=>{ return await api.sdoc.delete("", "句号器") })')
  ok(del.ok && (h.store().nodes.find((n) => n.id === childId)?.superdocs?.length ?? 1) === 0, 'sdoc.delete 删掉一份', del.content.slice(0, 120))

  /* 落盘往返：超级文档进节点 meta、method 进目标目录的 method.json，重启后都得还在 */
  const roundTrip = await (async () => {
    let s = h.store()
    const w = writeSuperDoc(s, childId, '往返件', '<p>rt</p>')
    if (!w) return null
    s = w
    const m = upsertMethod(s, goalId, { name: '往返函数', code: '((api) => 7)' }, Date.now())
    if (!m.ok) return null
    s = m.store
    return parseDocs(buildDocs(s), buildState(s))
  })()
  ok(
    !!roundTrip && roundTrip.nodes.find((n) => n.id === childId)?.superdocs?.[0]?.html === '<p>rt</p>',
    '超级文档随 meta.json 落盘并读回',
    roundTrip?.nodes.find((n) => n.id === childId)?.superdocs,
  )
  ok(
    !!roundTrip && roundTrip.methods?.[goalId]?.[0]?.name === '往返函数',
    'method 随 method.json 落盘并读回',
    roundTrip?.methods?.[goalId],
  )
}

/**
 * wf.* 的行为（名单检查在 apiNameTests 里，这里钉语义）：
 * - create 登记（缺省目标级，tier:'global' 落全局）、list 三级都能看到、同名覆盖、
 *   删掉之后明确报「没有」、内置的删不掉；
 * - 落盘往返：目标级随 workflow.json、全局随 state.json，重启读回都得还在。
 * 与 method.* 一样，这些都是「错了界面不会报错」的事——agent 建的工作流悄悄丢了，
 * 用户下次触发只会一头雾水。
 */
export async function workflowTests() {
  const builtins = builtinWorkflowRows()
  ok(builtins.length >= 7, '内置工作流成建制地在（开讲/大纲/回忆/探针/出卷/阅卷/超级实验室）', builtins.length)
  ok(
    new Set(builtins.map((b) => b.id)).size === builtins.length && builtins.every((b) => b.instruction.trim()),
    '内置工作流 id 不重复、指令都不为空',
    builtins.map((b) => b.id).join(','),
  )

  const h = harness(baseStore(), childId)
  const created = await h.run('((api)=>{ return await api.wf.create({ name: "课前摸底", instruction: "第一步：ask；第二步：写文档" }) })')
  ok(created.ok && created.content.includes('课前摸底') && created.content.includes('goal'), 'wf.create 缺省落目标级', created.content.slice(0, 200))
  const listed = await h.run('((api)=>{ return await api.wf.list() })')
  ok(listed.ok && listed.content.includes('课前摸底') && listed.content.includes('builtin'), 'wf.list 三级都能看到（含内置）', listed.content.slice(0, 200))
  const again = await h.run('((api)=>{ return await api.wf.create({ name: "课前摸底", instruction: "第二步：只写文档" }) })')
  ok(again.ok && again.content.includes('覆盖'), '同名 create 是覆盖（更新工作流）', again.content.slice(0, 160))
  const empty = await h.run('((api)=>{ return await api.wf.create({ name: "没指令的" }) })')
  ok(!empty.ok && empty.content.includes('instruction'), '缺 instruction 当场被拒', empty.content.slice(0, 160))
  const globalOne = await h.run('((api)=>{ return await api.wf.create({ name: "全局流程", instruction: "第一步", tier: "global" }) })')
  ok(globalOne.ok && globalOne.content.includes('global'), 'tier: global 登记到全局层', globalOne.content.slice(0, 160))
  const builtinDel = await h.run('((api)=>{ return await api.wf.remove("开讲") })')
  ok(!builtinDel.ok && builtinDel.content.includes('内置'), '内置工作流删不掉', builtinDel.content.slice(0, 160))
  const del = await h.run('((api)=>{ return await api.wf.remove("课前摸底") })')
  ok(del.ok, 'wf.remove 按 id 或名字删掉一条', del.content.slice(0, 120))
  const missing = await h.run('((api)=>{ return await api.wf.remove("课前摸底") })')
  ok(!missing.ok && missing.content.includes('没有这个工作流'), '删掉之后明确说没有', missing.content.slice(0, 160))

  /* 落盘往返：目标级进目标目录 workflow.json、全局进 state.json，两层各自读回 */
  const roundTrip = (() => {
    let s = baseStore()
    const a = upsertWorkflow(s, 'goal', goalId, { name: '目标级流程', instruction: '第一步' }, Date.now())
    if (!a.ok) return null
    s = a.store
    const b = upsertWorkflow(s, 'global', goalId, { name: '全局流程', instruction: '第二步' }, Date.now())
    if (!b.ok) return null
    s = b.store
    return parseDocs(buildDocs(s), buildState(s))
  })()
  ok(
    !!roundTrip && roundTrip.workflows?.byGoal?.[goalId]?.[0]?.name === '目标级流程',
    '目标级工作流随 workflow.json 落盘并读回',
    roundTrip?.workflows?.byGoal,
  )
  ok(
    !!roundTrip && roundTrip.workflows?.global?.[0]?.name === '全局流程',
    '全局工作流随 state.json 落盘并读回',
    roundTrip?.workflows?.global,
  )
}

/**
 * 学习者画像（userInfo.*）的行为。
 *
 * 这一段守的是三件**界面看不出来**的事：
 * 1. 头像绝不出去——它是一条 data URL，漏一次就是几十万字符的上下文，而且模型也不该看它；
 * 2. update 是增量的：写 education 不能把 nickname 抹掉（那是「整份重写」的经典事故）；
 * 3. 写不进去的值要说清楚，且**不因为一个字段不合法就整单丢掉**——
 *    导师看到 skipped 才知道换个问法，否则它会以为画像已经补齐了。
 */
export async function userInfoTests() {
  let profile: UserProfile = {
    ...emptyProfile(),
    nickname: '本机用户',
    avatar: 'data:image/png;base64,AAAABBBBCCCC',
    education: '',
  }
  const writes: Array<Partial<UserProfile>> = []
  const mk = (withUser: boolean) => {
    const ops = createAgentOps({
      getLatest: () => staticStore(),
      set: () => {},
      nodeId: () => childId,
      goalId: () => goalId,
      ...(withUser
        ? {
            userInfo: {
              read: () => profile,
              update: async (patch: Partial<UserProfile>) => {
                writes.push(patch)
                profile = { ...emptyProfile(), ...normalizeProfile({ ...profile, ...patch }) }
                return profile
              },
            },
          }
        : {}),
    })
    return createExecuteTool({ ...ops, runSandbox: fakeRunner })
  }
  const tool = mk(true)
  const run = (body: string) => tool.run({ description: '画像', body }, { nodeId: childId, goalId })

  // 1) get：给模型的那份不含头像，缺什么也说得明白
  const g = await run('((api)=>{ return await api.userInfo.get() })')
  ok(g.ok && g.content.includes('本机用户'), 'userInfo.get() 读得到画像', g.content.slice(0, 160))
  ok(!g.content.includes('data:image') && !g.content.includes('avatar'), '头像不出门（data URL 不进上下文）')
  ok(g.content.includes('"missing"') && g.content.includes('education'), 'get 里点出了还没填的字段')

  // 2) update：增量 + 归一
  const u1 = await run("((api)=>{ return await api.userInfo.update({ education: '本科', age: '35' }) })")
  ok(profile.education === '本科' && profile.age === 35, 'update 写进了两个字段（年龄折成数字）', { e: profile.education, a: profile.age })
  ok(profile.nickname === '本机用户', '没提到的字段原样保留（不是整份重写）')
  ok(u1.content.includes('本科') && !u1.content.includes('data:image'), 'update 的回执里也没有头像')

  // 3) 半对半错：能写的照写，写不进去的逐条说明
  const u2 = await run("((api)=>{ return await api.userInfo.update({ gender: '保密', skills: 'Python', 身高: 180 }) })")
  ok(u2.ok && profile.gender === 'undisclosed', "性别「保密」折成 undisclosed", profile.gender)
  ok(profile.skills === 'Python', '同一单里合法的字段照写不误')
  ok(u2.content.includes('身高') && u2.content.includes('认不出的字段名'), '认不出的字段名单独回报（不是整单失败）', u2.content.slice(0, 200))

  // 4) 越界与全错：一个都写不进去时才算失败，且要说清可写字段
  const u3 = await run('((api)=>{ return await api.userInfo.update({ age: 500 }) })')
  ok(!u3.ok && profile.age === 35, '越界年龄被拒，原值不动', profile.age)
  const u4 = await run('((api)=>{ return await api.userInfo.update({}) })')
  ok(!u4.ok && u4.content.includes('nickname'), '空补丁被拒，并列出可写字段', u4.content.slice(0, 200))
  ok(writes.length === 2, '被拒的那两次一个字节都没写盘', writes.length)

  // 5) 超长文本：截断要说明（上限只有存储层那一份，这里不另抄一份常量）
  const long = 'x'.repeat(500)
  const u5 = await run('((api)=>{ return await api.userInfo.update({ skills: "' + long + '" }) })')
  ok(u5.ok && profile.skills.length === 400, '超长文本按存储层的上限截断', profile.skills.length)
  ok(u5.content.includes('400'), '截断这件事在回执里说清楚了', u5.content.slice(0, 240))

  // 6) 题目上标 userInfo：字段名当场校验。写错就必须当场拒——
  //    悄悄忽略的后果是「导师以为问到了，画像里一直是空的」，下一轮还会再问一遍
  const good = normalizeAskForm({ questions: [{ type: 'short', prompt: '你的专业是什么？', userInfo: 'major' }] })
  ok(good.ok && good.form.questions[0]?.userInfo === 'major', 'ask 题目上的 userInfo 被保留下来')
  const plain = normalizeAskForm({ questions: [{ type: 'short', prompt: '随便聊聊' }] })
  ok(plain.ok && plain.form.questions[0]?.userInfo === undefined, '没标 userInfo 的题不带这个字段')
  const typo = normalizeAskForm({ questions: [{ type: 'short', prompt: '身高多少？', userInfo: '身高' }] })
  ok(!typo.ok && typo.content.includes('education'), 'userInfo 写了不存在的字段：当场拒绝并列出可写字段', typo.ok ? '' : typo.content.slice(0, 200))

  // 7) 没注入就没有这一组——与 exam / tmp 同一条规矩
  const bare = mk(false)
  const r = await bare.run({ description: '画像', body: '((api)=>{ return await api.userInfo.get() })' }, { nodeId: childId, goalId })
  ok(r.content.includes('沙箱里没有这个 api'), '没注入 userInfo 时它确实不存在', r.content.slice(0, 120))
}
