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
  attachCroppedAnswerImage,
  updateHandwrittenImage,
  examsOfNode,
  findAttempt,
  latestExam,
  nodeById,
  prereqIds,
  removeExam,
  shellExamOf,
  upsertExam,
  type GradePayload,
} from '../../../learn/graph'
import type { CreateExamPayload, ExamToolDeps } from '../../../agent/tools'
import type { MessageImage } from '../../../agent/types'
import { rememberImage } from '../../../learn/images'
import { t } from '../../../i18n'
import { figureSelfCheckNote, hasExamFigures, selfCheckExamFigures } from './examImageCheck'
import { native, type CropBoxInput } from '../../../lib/native'

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
 * 这一轮钉住的阅卷对象（工作流启动实参带来的 examId / attemptId，经 toolRig 的 wfParams 递进来）。
 *
 * 为什么要有它：判分是一轮几十秒的对话，中间学习者完全可能开另一份卷子、作答、交卷——
 * 「最新待判分」当场换了人。不钉住的话，`api.exam.read()` 回的是**新卷**、
 * `api.exam.grade()` 落到**新卷**的 attempt 上，判分与错题讲解全错位（判题错乱的事故现场）。
 * 钉住之后，这一轮的读、判、讲、裁全部只认这一份卷子；别的卷子由它自己的阅卷轮去管。
 */
export interface PinnedExam {
  examId?: string
  attemptId?: string
}

/**
 * 工作流启动实参 → 钉住的阅卷对象。实参是 Record<string, string | number>，字段类型不可信，
 * 在这里统一收窄；examId / attemptId 一个都没有（普通聊天轮）就不钉，保持原行为。
 */
export function pinnedExamOf(wfParams?: Record<string, string | number>): PinnedExam | undefined {
  if (!wfParams) return undefined
  const examId = typeof wfParams.examId === 'string' && wfParams.examId ? wfParams.examId : undefined
  const attemptId = typeof wfParams.attemptId === 'string' && wfParams.attemptId ? wfParams.attemptId : undefined
  if (!examId && !attemptId) return undefined
  return { ...(examId ? { examId } : {}), ...(attemptId ? { attemptId } : {}) }
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
 * pinned 是这一轮工作流钉住的阅卷对象（交卷触发的阅卷轮带着 examId / attemptId）。
 */
export function makeExamDeps(host: ExamToolHost, nodeId: string, pinned?: PinnedExam): ExamToolDeps {
  const { getLatest, set, onToast, openTabRef, setCreating } = host

  /** 一份试卷里「该收尾的那一次作答」：待判分优先，其次判完缺讲解，最后退回最新一次 */
  const attemptOfExam = (exam: Exam): ExamAttempt | undefined => {
    for (let j = exam.attempts.length - 1; j >= 0; j--) {
      if (exam.attempts[j].status === 'submitted') return exam.attempts[j]
    }
    for (let j = exam.attempts.length - 1; j >= 0; j--) {
      const a = exam.attempts[j]
      if (a.status === 'graded' && !a.explanation) return a
    }
    return exam.attempts[exam.attempts.length - 1]
  }

  /**
   * 要判分 / 讲解的那一次：给了 attemptId 按它；**钉住了只认钉的那份卷子**
   * （找不到就空手而回，绝不漂到「最新」——那正是判题错乱的根源）；
   * 都没给才取等着收尾的那一次，再退回最新一次。
   */
  const pick = (s: LearnStore, attemptId?: string): { exam: Exam; attempt: ExamAttempt } | null => {
    if (attemptId) {
      const exam = examsOfNode(s, nodeId).find((e) => e.attempts.some((a) => a.id === attemptId))
      const attempt = exam ? findAttempt(s, exam.id, attemptId) : undefined
      return exam && attempt ? { exam, attempt } : null
    }
    if (pinned?.examId || pinned?.attemptId) {
      const list = examsOfNode(s, nodeId)
      const exam =
        (pinned.examId ? list.find((e) => e.id === pinned.examId) : undefined) ??
        (pinned.attemptId ? list.find((e) => e.attempts.some((a) => a.id === pinned.attemptId)) : undefined)
      if (!exam) return null
      const attempt = pinned.attemptId
        ? (exam.attempts.find((a) => a.id === pinned.attemptId) ?? attemptOfExam(exam))
        : attemptOfExam(exam)
      return attempt ? { exam, attempt } : null
    }
    const pending = examNeedingWork(s, nodeId)
    if (pending) return pending
    const last = latestExam(s, nodeId)
    const attempt = last?.attempts[last.attempts.length - 1]
    return last && attempt ? { exam: last, attempt } : null
  }

  return {
    // 有待判分、或判完还缺讲解的 → grading：出卷被挡（先把这一场收尾），判分与讲解放行。
    // 钉住的轮次只看钉的那一次：它还等着收尾就是 grading；它做完了，别的卷子再忙也不归这一轮管。
    stage: () => {
      const s = getLatest()
      if (pinned?.examId || pinned?.attemptId) return pick(s) ? 'grading' : 'idle'
      return examNeedingWork(s, nodeId) ? 'grading' : 'idle'
    },

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
      /*
       * 空壳吸收（实体先行模型）：画布上拖出的空试卷卡是一份真实实体（0 题 0 考的壳），
       * 出题时沿用它的 id 与创建时间落库——卡原位变实，坐标、连线、页签引用都不用动。
       * 对模型完全透明：它只管照常 exam.create，宿主这一层保证壳被吸收而不是多出一份。
       */
      const shell = shellExamOf(s, nodeId)
      const exam: Exam = {
        id: shell?.id ?? crypto.randomUUID(),
        nodeId,
        goalId: node.goalId,
        title,
        kind,
        level,
        minutes: mins.minutes,
        questions,
        createdAt: shell?.createdAt ?? Date.now(),
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
      /*
       * 钉住的轮次缺省读钉住的那一次：判分进行中学习者又交了别的卷子时，
       * 模型不带 attemptId 的 exam.read() 看到的必须是它正在阅的那份（否则读到新卷，
       * 拿新卷的题与答案去判旧卷——判题错乱的另一半现场）。
       */
      const effective = attemptId ?? ((pinned?.examId || pinned?.attemptId) ? pick(s)?.attempt.id : undefined)
      // 负载怎么拼、每种状态说什么话，都在 learn/exam 的 examReadPayload 里（纯函数，有测试）
      return examReadPayload({ exams: list, childNodes, ...(effective ? { attemptId: effective } : {}) })
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
    /**
     * 顺时针旋转整张手写答卷：若拍摄角度横置或颠倒，在裁切前将其转正
     */
    rotateSheet: async (payload: unknown) => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as {
        attemptId?: string
        sheetIndex?: number
        degrees?: number
      }
      const sheetIndex = typeof p.sheetIndex === 'number' ? Math.max(0, Math.floor(p.sheetIndex)) : 0
      const degrees = typeof p.degrees === 'number' ? p.degrees : 90

      const s = getLatest()
      const found = pick(s, p.attemptId)
      if (!found) {
        return { ok: false, message: '找不到对应的考试记录' }
      }

      const images = found.attempt.handwrittenImages ?? []
      if (!images.length || sheetIndex >= images.length) {
        return {
          ok: false,
          message: `未找到第 ${sheetIndex + 1} 张手写答卷（当前共有 ${images.length} 张）`,
        }
      }

      const src = images[sheetIndex]
      const bridge = native().examHost
      if (!bridge?.rotateSheet) {
        return { ok: false, message: '当前运行环境不支持图片旋转功能' }
      }

      const res = await bridge.rotateSheet({ imagePath: src, degrees })
      if (!res.ok || (!res.rotatedPath && !res.dataUrl)) {
        return { ok: false, message: '旋转答卷失败: ' + (res.error || '未知错误') }
      }

      const newSrc = res.rotatedPath || res.dataUrl!
      const nextStore = updateHandwrittenImage(
        getLatest(),
        found.exam.id,
        found.attempt.id,
        sheetIndex,
        newSrc,
      )
      set(nextStore)
      onToast(t('已顺时针旋转第 {0} 页答卷 {1}°', sheetIndex + 1, degrees))

      // 注册到 MessageImage 缓存，以便作为视觉附件返回给模型
      const imgId = 'rotated_sheet_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
      const rel = `exam-crops/${imgId}.png`
      if (res.dataUrl) {
        const comma = res.dataUrl.indexOf(',')
        rememberImage(rel, {
          mime: 'image/png',
          data: res.dataUrl.slice(comma + 1),
          url: res.dataUrl,
        })
      }

      const messageImage: MessageImage = {
        id: imgId,
        rel,
        name: `rotated_sheet_${sheetIndex + 1}.png`,
        mime: 'image/png',
        bytes: res.dataUrl ? Math.round(res.dataUrl.length * 0.75) : 1024,
      }

      return {
        ok: true,
        message: `已成功将第 ${sheetIndex + 1} 张答卷顺时针旋转 ${degrees}° 并保存。转正后的答卷已附带在下方，请确认方向是否摆正。`,
        sheetIndex,
        degrees,
        images: [messageImage],
      }
    },

    /**
     * 裁切定位预检：在答卷上绘制红框并回传给模型审查，以验证裁切范围是否精准
     */
    previewCrop: async (payload: unknown) => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as {
        attemptId?: string
        questionId?: string
        sourceImage?: string | number
        box?: CropBoxInput
        rotate?: number
        sheetRotate?: number
      }
      if (!p.questionId) {
        return { ok: false, message: '必须指定题目 id (questionId)' }
      }
      if (!p.box) {
        return {
          ok: false,
          message: '必须指定拟裁切区域 box: [ymin, xmin, ymax, xmax]（0~1000 范围，如 [120, 50, 480, 950]）',
        }
      }

      const s = getLatest()
      const found = pick(s, p.attemptId)
      if (!found) {
        return { ok: false, message: '找不到对应的考试记录' }
      }

      let src: string | undefined
      if (typeof p.sourceImage === 'number') {
        src = found.attempt.handwrittenImages?.[p.sourceImage]
      } else if (typeof p.sourceImage === 'string') {
        src = p.sourceImage
      }
      if (!src) {
        const ans = found.attempt.answers.find((a) => a.questionId === p.questionId)
        src = ans?.rawImage || ans?.image || found.attempt.handwrittenImages?.[0]
      }
      if (!src) {
        return {
          ok: false,
          message: '未找到手写原图，请确认学习者已上传答题图片，或在 sourceImage 中指定图片路径',
        }
      }

      const bridge = native().examHost
      if (!bridge?.previewCrop) {
        return { ok: false, message: '当前运行环境不支持裁切预检功能' }
      }

      const res = await bridge.previewCrop({
        imagePath: src,
        box: p.box,
        rotate: p.rotate,
        sheetRotate: p.sheetRotate,
      })
      if (!res.ok || (!res.previewPath && !res.dataUrl)) {
        return { ok: false, message: '生成裁切预检图失败: ' + (res.error || '未知错误') }
      }

      // 注册到 MessageImage 缓存，附带交回给模型进行视觉审查
      const imgId = 'preview_crop_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
      const rel = `exam-crops/${imgId}.png`
      if (res.dataUrl) {
        const comma = res.dataUrl.indexOf(',')
        rememberImage(rel, {
          mime: 'image/png',
          data: res.dataUrl.slice(comma + 1),
          url: res.dataUrl,
        })
      }

      const messageImage: MessageImage = {
        id: imgId,
        rel,
        name: `preview_crop_${p.questionId}.png`,
        mime: 'image/png',
        bytes: res.dataUrl ? Math.round(res.dataUrl.length * 0.75) : 1024,
      }

      return {
        ok: true,
        message:
          `已为题目 ${p.questionId} 生成红框裁切预检图（当前 box: ${JSON.stringify(res.box ?? p.box)}）。\n` +
          '【视觉审查要点】：请仔细审查附带的红框预检图：\n' +
          '1. 该题目的解答是否被完整框在红框内部？\n' +
          '2. 上/下/左/右是否有手写公式、文字被红框截断？\n' +
          '3. 是否多截了上一题或下一题的无关内容？\n' +
          '👉 若存在截断或偏差，请调整 box 的 [ymin, xmin, ymax, xmax] 坐标并再次调用 previewCrop；\n' +
          '👉 若范围完美无误，请调用 api.exam.cropAnswer 正式裁切并贴在试卷上。',
        questionId: p.questionId,
        box: res.box,
        rect: res.rect,
        images: [messageImage],
      }
    },

    /**
     * 裁切手写答案：将整张答卷或草稿纸照片中的对应解答区域裁切下来，贴在对应题目上
     */
    cropAnswer: async (payload: unknown) => {
      const p = (payload && typeof payload === 'object' ? payload : {}) as {
        attemptId?: string
        questionId?: string
        sourceImage?: string | number
        box?: CropBoxInput
        rotate?: number
        sheetRotate?: number
      }
      if (!p.questionId) {
        return { ok: false, message: '必须指定题目 id (questionId)' }
      }
      if (!p.box) {
        return {
          ok: false,
          message: '必须指定裁切区域 box: [ymin, xmin, ymax, xmax]（0~1000 范围）或 { x, y, width, height }',
        }
      }

      const s = getLatest()
      const found = pick(s, p.attemptId)
      if (!found) {
        return { ok: false, message: '找不到对应的考试记录' }
      }

      let src: string | undefined
      if (typeof p.sourceImage === 'number') {
        src = found.attempt.handwrittenImages?.[p.sourceImage]
      } else if (typeof p.sourceImage === 'string') {
        src = p.sourceImage
      }
      if (!src) {
        const ans = found.attempt.answers.find((a) => a.questionId === p.questionId)
        src = ans?.rawImage || ans?.image || found.attempt.handwrittenImages?.[0]
      }
      if (!src) {
        return {
          ok: false,
          message: '未找到手写原图，请确认学习者已上传答题图片，或在 sourceImage 中指定图片路径',
        }
      }

      const bridge = native().examHost
      if (!bridge?.cropImage) {
        return { ok: false, message: '当前运行环境不支持图片裁剪功能' }
      }

      const res = await bridge.cropImage({
        imagePath: src,
        box: p.box,
        rotate: p.rotate,
        sheetRotate: p.sheetRotate,
      })
      if (!res.ok || !res.croppedPath) {
        return { ok: false, message: '裁切失败: ' + (res.error || '未知错误') }
      }

      const nextStore = attachCroppedAnswerImage(
        getLatest(),
        found.exam.id,
        found.attempt.id,
        p.questionId,
        res.croppedPath,
      )
      set(nextStore)
      onToast(t('已为题目裁切出手写答案并贴在试卷上'))

      return {
        ok: true,
        message: '已成功裁切出答案部分并贴在题目 ' + p.questionId + ' 上。',
        croppedPath: res.croppedPath,
      }
    },

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
