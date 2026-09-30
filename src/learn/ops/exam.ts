/**
 * 考试（exam.*）这一组：把工作区给的考试能力装配成沙箱要的那一组（SandboxOptions 的 exam）。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：拆开之后，「读永远成功、写才看阶段」
 * 这条口径与它周围的说明仍然贴在同一处。
 */

import { EXAM_ACTIONS, type ExamToolDeps, type SandboxOptions } from '../../agent/tools'

/**
 * 把工作区给的考试能力装配成沙箱要的那一组（SandboxOptions 的 exam）。
 *
 * 抽出来是为了能被 Node 探针钉住——这一层只做「允不允许 + 把返回值翻成 ok/content」的翻译，
 * 但它正是「读被当成写拦掉」那个事故的现场：exam.read 原先要过阶段检查，
 * 没有待阅卷的试卷时回一句 {ok:false}，于是「看看有没有卷子」被判成一次调用失败。
 * 现在口径写死在这里：**读永远成功，写才看阶段**。
 *
 * 阶段在装配那一刻取一次（与原来一致）：一轮对话里阶段不会变——要变也得等这一轮结束、
 * 学习者交卷之后。**判分与错题讲解同属 grading 阶段**：它们是同一套工作流的两步，
 * 第二步紧随第一步，中间不该被自己拦下来。
 */
export function makeExamTool(deps: ExamToolDeps): NonNullable<SandboxOptions['exam']> {
  const allow = EXAM_ACTIONS[deps.stage()]
  return {
    create: (payload) => {
      if (!allow.includes('create')) {
        return {
          ok: false,
          content:
            '现在不能出题：这个知识点有一次考试正等着收尾（判分或错题讲解）。' +
            '先 api.exam.read() 看那一次，api.exam.grade(...) 判分、api.exam.explain(...) 写讲解，再想出新的。',
        }
      }
      const r = deps.createExam({
        title: payload.title,
        kind: payload.kind,
        level: payload.level,
        minutes: payload.minutes,
        questions: payload.questions,
      })
      return { ok: r.ok, content: r.message }
    },
    // 读不看阶段：没有卷子是一种答案，不是一次失败（见上面那段说明）
    read: (attemptId) => ({ ok: true, content: deps.readExam(attemptId) }),
    grade: (payload) => {
      if (!allow.includes('grade')) {
        return {
          ok: false,
          content: '现在没有待判分的考试——判分要先有学习者交上来的卷子。想看当前有什么，用 api.exam.read()。',
        }
      }
      const r = deps.gradeExam(payload)
      return { ok: r.ok, content: r.message }
    },
    explain: (payload) => {
      if (!allow.includes('explain')) {
        return {
          ok: false,
          content:
            '现在没有需要讲解的考试——错题讲解只针对刚判完、还缺讲解的那一次。' +
            '先 api.exam.read() 看清楚是哪一次。',
        }
      }
      const r = deps.explainExam(payload)
      return { ok: r.ok, content: r.message }
    },
    remove: (payload) => {
      if (!allow.includes('delete')) {
        return { ok: false, content: '有一次考试正等着收尾（判分或讲解），先把它做完再动别的卷子。' }
      }
      const r = deps.deleteExam(typeof payload.id === 'string' ? payload.id : undefined)
      return { ok: r.ok, content: r.message }
    },
  }
}
