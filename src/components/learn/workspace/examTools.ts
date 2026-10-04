/*
 * 这个文件负责：注入给 Agent 的考试工具（api.exam.*）——出卷、读卷、删卷、判分、错题讲解。
 *
 * 工具在对话过程中被调用，因此每次都以 getLatest() 现取 store，绝不持有旧快照；
 * 「哪些话该由代码说死」（比如考过的卷子 Agent 删不掉、时限的下限）也都在这一层挡住，
 * 不指望模型自觉——每条硬规矩旁边都写着它防的是哪一次真实的跑偏。
 *
 * examNeedingWork 同时被宿主拿去派生「等着收尾」的徽标（pendingWork），所以单独导出。
 */

import type { LearnStore, TabRef } from '../../../learn/types'
import type { Exam, ExamAttempt } from '../../../learn/exam'
import {
  EXAM_KIND_LABEL,
  examDeleteBlock,
  examPhase,
  examReadPayload,
  examTotalPoints,
  normalizeKind,
  normalizeLevel,
  parseQuestions,
  questionsMix,
  resolveExamMinutes,
} from '../../../learn/exam'
import {
  applyExplanation,
  applyGradeResult,
  examsOfNode,
  findAttempt,
  latestExam,
  nodeById,
  prereqIds,
  removeExam,
  upsertExam,
  type GradePayload,
} from '../../../learn/graph'
import type { CreateExamPayload, ExamToolDeps } from '../../../agent/tools'
import { t } from '../../../i18n'
import { figureSelfCheckNote, hasExamFigures, selfCheckExamFigures } from './examImageCheck'

/** 宿主交给考试工具的能力（见 LearnWorkspace 里 openTabRef 为什么是 ref 而不是函数） */
export interface ExamToolHost {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
  /** 打开页签的晚绑定把手：这一份 deps 是调用时才现造的，ref 拿到的永远是当次那一份 */
  openTabRef: { current: (ref: TabRef) => void }
  setCreating: (v: boolean) => void
}

/**
 * 找这一次「等着收尾」的考试：**待判分**优先，其次是**判完还缺错题讲解**的那一次。
 *
 * 判分与讲解是一套工作流的两步（见内置工作流「阅卷」），中间那个状态必须能表达：
 * 导师判了一半断了、或上一轮只写了分数，这里要能把同一套流程重新推起来——
 * 「判过了但还没讲解」不等于「没活可干」。
 */
export function examNeedingWork(s: LearnStore, nodeId: string): { exam: Exam; attempt: ExamAttempt } | null {
  const list = examsOfNode(s, nodeId)
  for (let i = list.length - 1; i >= 0; i--) {
    const exam = list[i]
    for (let j = exam.attempts.length - 1; j >= 0; j--) {
      const attempt = exam.attempts[j]
      if (attempt.status === 'submitted') return { exam, attempt }
      if (attempt.status === 'graded' && !attempt.explanation) return { exam, attempt }
    }
  }
  return null
}

/**
 * 构造注入给 Agent 的考试工具。
 * 工具在对话过程中被调用，因此每次都用 getLatest() 取最新 store。
 */
export function makeExamDeps(host: ExamToolHost, nodeId: string): ExamToolDeps {
  const { getLatest, set, onToast, openTabRef, setCreating } = host

  /** 要判分 / 讲解的那一次：给了 attemptId 按它，没给就取等着收尾的那一次，再退回最新一次 */
  const pick = (s: LearnStore, attemptId?: string): { exam: Exam; attempt: ExamAttempt } | null => {
    if (attemptId) {
      const exam = examsOfNode(s, nodeId).find((e) => e.attempts.some((a) => a.id === attemptId))
      const attempt = exam ? findAttempt(s, exam.id, attemptId) : undefined
      return exam && attempt ? { exam, attempt } : null
    }
    const pending = examNeedingWork(s, nodeId)
    if (pending) return pending
    const last = latestExam(s, nodeId)
    const attempt = last?.attempts[last.attempts.length - 1]
    return last && attempt ? { exam: last, attempt } : null
  }

  return {
    // 有待判分、或判完还缺讲解的 → grading：出卷被挡（先把这一场收尾），判分与讲解放行
    stage: () => (examNeedingWork(getLatest(), nodeId) ? 'grading' : 'idle'),

    createExam: (payload: CreateExamPayload) => {
      // 失败原因要原样带给模型：它只能靠这句话改对（旧实现一律回「题目格式不合法」，
      // 一次真实运行里模型据此猜了 55 次也没猜出来，见 learn/exam 的 parseQuestions）
      const parsed = parseQuestions(payload.questions)
      if (!parsed.ok) return { ok: false, message: parsed.message }
      const questions = parsed.questions
      const s = getLatest()
      const node = nodeById(s, nodeId)
      if (!node) return { ok: false, message: '节点不存在' }
      const kind = normalizeKind(payload.kind)
      const level = normalizeLevel(payload.level)
      /*
       * 时限：小测不限时（0），其余不得低于**题目数 × 2**。
       * 下限由 learn/exam 的 resolveExamMinutes 强制——它只是地板，Agent 该按题量与难度
       * 往上给；而「Agent 说了算」这件事必须由代码兜底，不能只写在提示词里。
       */
      const mins = resolveExamMinutes(payload.minutes, kind, questions.length)
      if (!mins.ok) return { ok: false, message: mins.message }
      const title =
        typeof payload.title === 'string' && payload.title.trim()
          ? payload.title.trim()
          : `${node.title} · ${EXAM_KIND_LABEL[kind]}`
      const exam: Exam = {
        id: crypto.randomUUID(),
        nodeId,
        goalId: node.goalId,
        title,
        kind,
        level,
        minutes: mins.minutes,
        questions,
        createdAt: Date.now(),
        attempts: [],
      }
      /*
       * 不再顺手把 activeNodeId 拨到这个节点上：出题现在可能来自**独立窗口**
       * （试卷窗口钉在某个知识点上），从那个窗口出的卷子不该把主窗口正在看的文档换掉。
       * 卷子归属由 exam.nodeId 说了算，与「此刻在看哪个节点」是两件事。
       */
      set(upsertExam(s, exam))
      // 出题完成要让人看到试卷：收起目标创建页，避免面板被它挡住
      setCreating(false)
      onToast(t('已生成「{0}」，共 {1} 题', title, questions.length))
      /*
       * 带图的题：宿主在后台跑一轮视觉自检（渲染成位图交给模型看，坏图自动重画修复）。
       * 跑在出卷之后而不是 exam.create 里面——沙箱一次 execute 只有 15 秒，两跳视觉
       * 请求等不起（见 examImageCheck 顶部说明）。这里只负责点火 + 在回执里交代一声。
       */
      const figureNote = figureSelfCheckNote(questions)
      if (hasExamFigures(questions)) void selfCheckExamFigures({ getLatest, set, onToast }, exam.id, questions)
      // 回执里带上题型分布：模型据此确认自己写的题型被认成了什么（写 judge 会被算成对错题）
      const mix = questionsMix(questions)
      const limit = mins.minutes > 0 ? '时限 ' + mins.minutes + ' 分钟' : '不限时'
      return {
        ok: true,
        message:
          `已生成《${title}》，共 ${questions.length} 题（${mix}），${limit}，满分 ${examTotalPoints(exam)}。` +
          '学习者会在文档区右侧的试卷列表里点「考试」进考试窗口作答——**你不要替他开考**，' +
          '也不要在这里重复列出题目。' +
          (figureNote ? '\n' + figureNote : ''),
      }
    },

    /**
     * 读卷：**任何时候都能调**，回这个知识点最新那一份试卷与它的状态。
     *
     * 为什么不是「只回待阅卷的那一份」：出完题回头核对一下题目写对没有，是最自然的
     * 下一步；而原先那种写法在这时会回一句「当前没有待阅卷的试卷」——它既答非所问，
     * 又被外层算成一次调用失败。一次真实运行里模型因此又追了一轮才确认卷子建没建成。
     * 没有卷子也是一种答案，一律走正常返回（ok:true）。
     */
    readExam: (attemptId) => {
      const s = getLatest()
      const list = examsOfNode(s, nodeId)
      const childNodes = prereqIds(s, nodeId)
        .map((id) => nodeById(s, id))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .map((n) => ({ title: n.title, description: n.description }))
      // 负载怎么拼、每种状态说什么话，都在 learn/exam 的 examReadPayload 里（纯函数，有测试）
      return examReadPayload({ exams: list, childNodes, ...(attemptId ? { attemptId } : {}) })
    },

    /**
     * 删一份试卷。**考过的 Agent 删不掉**：
     * 那是学习记录（作答、输入顺序、单题耗时、切屏、判分、错题讲解），该不该连坐由用户决定——
     * 他在试卷列表里能看到「会连带删掉什么」并二次确认。没考过的空卷子（含出错的废稿）
     * 照旧由模型随手清理。判据放在 learn/exam 的 examDeleteBlock（纯函数，探针钉得住）：
     * 「别删用户的东西」这件事必须在代码里挡住，不能指望模型自觉。
     */
    deleteExam: (examId?: string) => {
      const s = getLatest()
      const list = examsOfNode(s, nodeId)
      if (!list.length) return { ok: false, message: '这个知识点没有试卷可删。' }
      const target = examId ? list.find((e) => e.id === examId) : list[list.length - 1]
      if (!target) {
        return {
          ok: false,
          message:
            '没有 id 为「' +
            examId +
            '」的试卷。现有的：' +
            list.map((e) => e.title + '（' + e.id + '，' + examPhase(e) + '）').join('；'),
        }
      }
      const blocked = examDeleteBlock(target)
      if (blocked) {
        return { ok: false, message: '《' + target.title + '》' + blocked + '。' }
      }
      set(removeExam(s, target.id))
      return {
        ok: true,
        message:
          '已删除《' + target.title + '》（' + target.questions.length + ' 题，还没考过）。现在可以重新出一份。',
      }
    },

    gradeExam: (payload: unknown) => {
      const s = getLatest()
      const p = payload as GradePayload & { attemptId?: unknown }
      const attemptId = typeof p.attemptId === 'string' ? p.attemptId : undefined
      const found = pick(s, attemptId)
      if (!found) return { ok: false, message: '这个知识点还没有可以判分的考试。' }
      const r = applyGradeResult(s, found.exam.id, found.attempt.id, p)
      if (!r.ok) return { ok: false, message: r.message }
      set(r.store)
      const passed = p.passed === true
      onToast(passed ? t('AI 判定已完全掌握，节点已标记为已掌握') : t('AI 已判分，接着写错题讲解'))
      // 回执里点名下一次调用要带哪个 attemptId：同一份卷子可能考过好几次
      return {
        ok: true,
        message:
          r.message +
          '（这一次的 attemptId 是 ' + found.attempt.id + '，写错题讲解时带上它）' +
          '下一步：看 api.exam.read() 里的 history 找反复错的点，然后 api.exam.explain({ content, attemptId }) 写讲解。',
      }
    },

    /**
     * 写错题讲解：判分之后的第二步，落在同一次考试上。
     * 副标题允许几种写法（content / markdown / text），因为模型对字段名的猜测从来不止一种。
     */
    explainExam: (payload: unknown) => {
      const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
      const raw = typeof p.content === 'string' ? p.content : typeof p.markdown === 'string' ? p.markdown : typeof p.text === 'string' ? p.text : ''
      if (!raw.trim()) {
        return { ok: false, message: '没给讲解正文：api.exam.explain({ content: "…markdown…", attemptId? })' }
      }
      const s = getLatest()
      const attemptId = typeof p.attemptId === 'string' ? p.attemptId : undefined
      const found = pick(s, attemptId)
      if (!found) return { ok: false, message: '这个知识点还没有可以讲解的考试。' }
      const r = applyExplanation(s, found.exam.id, found.attempt.id, raw)
      if (!r.ok) return { ok: false, message: r.message }
      set(r.store)
      /*
       * 批改完（判分 + 讲解都齐）**自动打开那一次的试卷副本**：用户等着的就是错题解析，
       * 让他自己去试卷列表里翻出那一次，等于把刚做好的东西又藏起来。
       * 走 openTabRef（而不是直接调 openTab）：这一份 deps 是调用时才现造的，
       * 而页签入口是渲染期定的——ref 拿到的永远是当次那一份。
       */
      openTabRef.current({ kind: 'exam', nodeId, examId: found.exam.id, attemptId: found.attempt.id })
      onToast(t('已写入错题讲解，试卷副本已经打开'))
      return { ok: true, message: r.message }
    },
  }
}
