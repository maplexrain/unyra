/** 本文件负责：出题入参的容错解析——把模型写出来的题型 / 选项 / 答案的各种写法归一化成 ExamQuestion（解析的两条原则见本文件末尾 parseQuestions 上方的长注释）。 */

import type { ExamOption, ExamQuestion, ExamQuestionType } from './types'
import { sanitizeExamSvg } from './svg'

/* ---------- 出题入参：能认就认，认不出就说清楚是哪里 ---------- */

/** 解析结果：失败时的 message 直接回给模型看，所以它必须是「改哪里、改成什么」而不是一句结论 */
export type QuestionsParse = { ok: true; questions: ExamQuestion[] } | { ok: false; message: string }

/**
 * 规范写法。工具说明、出题指令与错误信息共用这一句——改的时候只有这一处。
 *
 * 为什么必须写在模型看得见的地方：沙箱没有 JSON Schema 级校验（见 agent/tools 开头），
 * 一次真实运行里模型手上没有任何 schema 可依，只能猜——它猜了 55 次、19 种题型名、
 * 8 种选项写法，每次都只拿到同一句「题目格式不合法」，最后交白卷
 * （事故与回归用例见 scripts/agent-ops.test.ts 的「出题入参」一节）。
 */
export const EXAM_SHAPE_HINT =
  '{ title:"试卷标题", kind:"quiz"|"test"|"exam", level:"easy"|"medium"|"hard"|"extreme", ' +
  'questions:[{ type:"single"|"multiple"|"truefalse"|"fill"|"short", stem:"题干", ' +
  'image:"<svg>…</svg>", options:[{ id:"A", text:"选项文字" }, { id:"B", text:"…" }], answer:["A"], rubric:"解析", points:2 }] }' +
  '　—— 对错题不用给 options（选项固定是「正确 / 错误」），answer 写 ["true"] 或 ["false"]；' +
  '填空 / 简答把参考答案写在 answer 里，可以不给 options；' +
  'stem / options 里的数学公式一律写 LaTeX（行内 $…$、独立公式 $$…$$），不要用 Unicode 上下标或纯文本近似；' +
  '需要配图的题给 image 字段：值是**完整的 SVG 源码**（以 <svg 开头、</svg> 结尾，含 viewBox），' +
  '不要用 canvas（存不下来）或图片链接。'

const TYPE_LIST = 'single（单选）/ multiple（多选）/ truefalse（对错）/ fill（填空）/ short（简答）'

/** 题型同义词：模型看不见 schema，写出来的是「英语常识 + 中文直译」，意图唯一就认下来 */
const TYPE_ALIASES: Record<string, ExamQuestionType> = {
  single: 'single',
  singlechoice: 'single',
  onechoice: 'single',
  choice: 'single',
  radio: 'single',
  '单选': 'single',
  '单选题': 'single',
  '单项选择题': 'single',
  multiple: 'multiple',
  multiplechoice: 'multiple',
  multichoice: 'multiple',
  multi: 'multiple',
  checkbox: 'multiple',
  '多选': 'multiple',
  '多选题': 'multiple',
  '多项选择题': 'multiple',
  truefalse: 'truefalse',
  boolean: 'truefalse',
  bool: 'truefalse',
  judge: 'truefalse',
  tf: 'truefalse',
  yesno: 'truefalse',
  '判断': 'truefalse',
  '判断题': 'truefalse',
  '对错': 'truefalse',
  '是非题': 'truefalse',
  fill: 'fill',
  blank: 'fill',
  '填空': 'fill',
  '填空题': 'fill',
  short: 'short',
  shortanswer: 'short',
  essay: 'short',
  qa: 'short',
  '简答': 'short',
  '简答题': 'short',
  '问答': 'short',
}

/** single_choice / true-false / 判断题 这类写法先揉成一个键再查表 */
const aliasKey = (s: string) => s.toLowerCase().replace(/[\s_\-·]/g, '')

/** 错误信息要回显「你给的是什么」——模型看不到自己的入参，只有这句话能帮它定位 */
function describeValue(v: unknown): string {
  if (v === undefined) return '没给'
  if (v === null) return 'null'
  if (Array.isArray(v)) return '数组（' + v.length + ' 项）'
  if (typeof v === 'string') return '字符串 ' + JSON.stringify(v.length > 20 ? v.slice(0, 20) + '…' : v)
  if (typeof v === 'object') return '对象'
  return typeof v + ' ' + String(v)
}

function pickString(r: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** 自动选项 id：A、B、C…（超过 26 个就 O27）。判分只认 id，所以每个选项都必须有稳定的 id */
const optionLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : 'O' + (i + 1))

/**
 * 选项归一化。这些写法在一次真实运行里全都出现过，不能只认规范的那一种：
 * ['甲','乙']、[{id,text}]、[{key,value}]、[{label,text}]、[{text,correct:true}]、
 * 带 "A. " 前缀的字符串、以及被写成一整段文字的字符串。
 * 前缀里的字母会被剥下来当 id——模型在 answer 里写的正是那个字母。
 */
function parseOptions(
  raw: unknown,
): { ok: true; options: ExamOption[]; correct: string[] } | { ok: false; message: string } {
  let items: unknown[]
  if (Array.isArray(raw)) items = raw
  else if (typeof raw === 'string') {
    items = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (items.length < 2) return { ok: false, message: 'options 写成了整段字符串，请改成一个选项一项的数组' }
  } else {
    return { ok: false, message: 'options 应是数组，收到 ' + describeValue(raw) }
  }

  const options: ExamOption[] = []
  const correct: string[] = []
  const used = new Set<string>()
  const nextId = () => {
    let i = options.length
    while (used.has(optionLetter(i))) i++
    return optionLetter(i)
  }
  const push = (id: string, text: string) => {
    const finalId = id && !used.has(id) ? id : nextId()
    used.add(finalId)
    options.push({ id: finalId, text })
    return finalId
  }

  for (const item of items) {
    if (typeof item === 'string') {
      const m = item.match(/^\s*([A-Za-z])\s*[.、)）:：]\s*(.+)$/)
      push(m ? m[1].toUpperCase() : '', m ? m[2].trim() : item.trim())
      continue
    }
    if (!item || typeof item !== 'object') {
      return { ok: false, message: '选项里有 ' + describeValue(item) + '，只认字符串或 { id, text } 对象' }
    }
    const o = item as Record<string, unknown>
    const id = pickString(o, ['id', 'key', 'letter', 'name'])
    const text = pickString(o, ['text', 'value', 'content'])
    const label = pickString(o, ['label'])
    const body = text || label
    if (!body) return { ok: false, message: '有个选项没有文字：要写 { id:"A", text:"…" }，或直接写字符串' }
    // {label:'A', text:'甲'} 里 label 是 id；{label:'甲'} 里 label 是文字
    const finalId = push(text ? id || label : id, body)
    if (o.correct === true || o.isCorrect === true || o.answer === true) correct.push(finalId)
  }
  return { ok: true, options, correct }
}

/** 答案里的一项对到哪个选项 id；对不上返回 null（由调用方给出「该写什么」的提示） */
function matchOption(token: string, type: ExamQuestionType, options: ExamOption[]): string | null {
  const lower = token.toLowerCase()
  if (type === 'truefalse') {
    if (['true', 't', 'yes', 'y', '1', '正确', '对', '是', '√'].includes(lower)) return 'true'
    if (['false', 'f', 'no', 'n', '0', '错误', '错', '否', '×', 'x'].includes(lower)) return 'false'
    return null
  }
  const byId = options.find((o) => o.id.toLowerCase() === lower)
  if (byId) return byId.id
  // 答案写成选项原文也认——这比 id 更不容易错，没理由不接受
  return options.find((o) => o.text === token)?.id ?? null
}

/**
 * 答案归一化。收字符串、字符串数组、布尔（对错题）、选项原文、以及 "A,B,C" 这种连写。
 * **不收数字**：0 起算还是 1 起算分不清，猜错会直接把用户判错，宁可让它改成 answer:["A"]。
 */
function parseAnswer(
  raw: unknown,
  type: ExamQuestionType,
  options: ExamOption[],
): { ok: true; answer: string[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, answer: [] }
  const items = Array.isArray(raw) ? raw : [raw]
  const tokens: string[] = []
  for (const item of items) {
    if (item === undefined || item === null) continue
    if (typeof item === 'boolean') {
      if (type !== 'truefalse') return { ok: false, message: 'answer 是布尔值，只有对错题能这么写' }
      tokens.push(item ? 'true' : 'false')
      continue
    }
    if (typeof item === 'number') {
      return {
        ok: false,
        message:
          'answer 里有数字 ' + item + '：0 起算还是 1 起算分不清，请写选项 id，例如 answer:["' +
          (options[0]?.id ?? 'A') + '"]',
      }
    }
    if (typeof item !== 'string') {
      return { ok: false, message: 'answer 里有 ' + describeValue(item) + '，只认字符串' }
    }
    if (type === 'fill' || type === 'short') {
      // 填空与简答的答案是一段话，逗号句号都可能是答案的一部分，整段收下不拆。
      // 简答虽然交给 Agent 判分，但这份参考答案要原样留着（readExam 会把它交给阅卷的模型）
      if (item.trim()) tokens.push(item.trim())
      continue
    }
    for (const piece of item.split(/[,，、;；/|]+/)) {
      if (piece.trim()) tokens.push(piece.trim())
    }
  }
  if (type === 'fill' || type === 'short') return { ok: true, answer: tokens }

  const answer: string[] = []
  for (const token of tokens) {
    const id = matchOption(token, type, options)
    if (!id) {
      return {
        ok: false,
        message:
          type === 'truefalse'
            ? 'answer 是 ' +
              JSON.stringify(token) +
              '：对错题只认 true / false（写「正确」「错误」也认）。**对错题不用给 options**——' +
              '它的两个选项固定是「正确」「错误」，界面上照这个显示。一句完整的对错题长这样：' +
              '\n    { type: ' + JSON.stringify('truefalse') + ', stem: ' + JSON.stringify('极限存在则唯一') +
              ', answer: [' + JSON.stringify('true') + '], rubric: ' + JSON.stringify('解析') + ', points: 1 }'
            : 'answer 里的 ' + JSON.stringify(token) + ' 对不上任何选项。这道题的选项 id 是 [' +
              options.map((o) => o.id).join(', ') + ']，请写 id，例如 answer:["' +
              (options[0]?.id ?? 'A') + '"]',
      }
    }
    if (!answer.includes(id)) answer.push(id)
  }
  return { ok: true, answer }
}

/**
 * 单题归一化。
 * 顺序：题型（认同义词，没写就按字段推断）→ 题干（认同义词）→ 选项（认各种写法）
 * → 答案（认 id / 原文 / 布尔）→ 解析与分值。
 */
function parseOneQuestion(
  raw: unknown,
  no: number,
): { ok: true; question: ExamQuestion } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      message: '不是题目对象（收到 ' + describeValue(raw) + '）：每道题都要写成 { type, stem, … }',
    }
  }
  const r = raw as Record<string, unknown>

  const rawType = r.type ?? r.questionType ?? r.kind
  let type: ExamQuestionType | undefined
  const explicit = typeof rawType === 'string' && !!rawType.trim()
  if (explicit) {
    type = TYPE_ALIASES[aliasKey(rawType as string)]
    if (!type) {
      return { ok: false, message: 'type 是 ' + JSON.stringify(rawType) + '，不是合法题型。可用：' + TYPE_LIST }
    }
  } else if (rawType !== undefined && rawType !== null && rawType !== '') {
    return { ok: false, message: 'type 是 ' + describeValue(rawType) + '，应为字符串。可用：' + TYPE_LIST }
  }

  const stem = pickString(r, ['stem', 'question', 'content', 'title', 'text', 'prompt', 'q'])
  if (!stem) return { ok: false, message: '没有题干：要写 stem（question / content / title 也认）' }

  // 配图（image / svg / figure 都认）：必须能抠出一段 <svg>…</svg>，入库前消毒（见 ./svg）。
  // 认不出不硬吞——错误信息回给模型，它改一次就对（与题型/答案的容错同一原则）。
  const rawImage = r.image ?? r.svg ?? r.figure ?? r.illustration
  let image: string | undefined
  if (rawImage !== undefined && rawImage !== null && rawImage !== '') {
    const cleaned = sanitizeExamSvg(rawImage)
    if (!cleaned) {
      return {
        ok: false,
        message:
          'image 里没有可用的 <svg>…</svg>：配图要给**完整的 SVG 源码**（以 <svg 开头、</svg> 结尾，含 viewBox；' +
          '收到的是 ' + describeValue(rawImage) + '）。canvas 保存不了——把同样的图用 SVG 画出来。',
      }
    }
    image = cleaned
  }

  const rawOptions = r.options ?? r.choices ?? r.opts
  let options: ExamOption[] | undefined
  let correct: string[] = []
  if (type === 'truefalse') {
    // 对错题的选项是固定的两项，模型不用（也不该）自己给
    options = [
      { id: 'true', text: '正确' },
      { id: 'false', text: '错误' },
    ]
  } else if (rawOptions !== undefined && rawOptions !== null) {
    const parsed = parseOptions(rawOptions)
    if (!parsed.ok) return { ok: false, message: parsed.message }
    options = parsed.options
    correct = parsed.correct
  }

  if (!type) {
    // 没写题型就按字段推断：有选项=单选（标了多个 correct 就是多选），有答案无选项=填空，都没有=简答
    if (options?.length) type = correct.length > 1 ? 'multiple' : 'single'
    else if (r.answer !== undefined || r.reference !== undefined) type = 'fill'
    else type = 'short'
  }
  if ((type === 'single' || type === 'multiple') && !options?.length) {
    return {
      ok: false,
      message: '是单选/多选但没有 options：要写 options:["选项文字", …]，或 options:[{ id:"A", text:"…" }]',
    }
  }
  if ((type === 'single' || type === 'multiple') && options && options.length < 2) {
    return { ok: false, message: '只有 ' + options.length + ' 个选项：单选/多选至少要 2 个' }
  }

  const rawAnswer = r.answer ?? r.answers ?? r.reference ?? r.referenceAnswer ?? r.correctAnswer
  const parsedAnswer = parseAnswer(rawAnswer, type, options ?? [])
  if (!parsedAnswer.ok) return { ok: false, message: parsedAnswer.message }
  let answer = parsedAnswer.answer
  // 没给答案、但选项上标了 correct:true —— 意图唯一，收下
  if (!answer.length && correct.length) answer = correct
  // 没写题型、答案却有好几个：那是多选，不是「单选给了多个答案」
  if (!explicit && type === 'single' && answer.length > 1) type = 'multiple'
  // 「没给」要排在「给多了」前面，否则缺答案时会得到「answer 给了 0 个」这种废话
  if ((type === 'single' || type === 'multiple' || type === 'truefalse') && !answer.length) {
    return {
      ok: false,
      message:
        '缺少 answer：单选/多选/对错必须给答案，否则系统判不了分。写选项 id 数组，例如 answer:["' +
        (options?.[0]?.id ?? 'A') + '"]',
    }
  }
  if (type === 'single' && answer.length !== 1) {
    return {
      ok: false,
      message: 'answer 给了 ' + answer.length + ' 个（' + answer.join('/') + '）：单选题只能有一个答案',
    }
  }
  if (type === 'truefalse' && answer.length !== 1) {
    return { ok: false, message: 'answer 要给一个真值（true 或 false，「正确」「错误」也认）' }
  }

  const points = typeof r.points === 'number' && r.points > 0 ? Math.round(r.points) : 1
  const rawId = r.id ?? r.number
  const question: ExamQuestion = {
    id: rawId !== undefined && rawId !== null && String(rawId).trim() ? String(rawId).trim() : 'q' + no,
    type,
    stem,
    points,
  }
  if (options) question.options = options
  if (answer.length) question.answer = answer
  const rubric = pickString(r, ['rubric', 'analysis', 'explanation', 'explain', 'comment', 'note'])
  if (rubric) question.rubric = rubric
  if (image) question.image = image
  return { ok: true, question }
}

/** questions 认得的几种容器：数组、被 JSON.stringify 过的数组、{questions|items:[]}、单个题目对象 */
function collectQuestions(raw: unknown): { ok: true; items: unknown[] } | { ok: false; message: string } {
  if (Array.isArray(raw)) {
    if (!raw.length) return { ok: false, message: 'questions 是空数组：一份试卷至少要有一道题' }
    return { ok: true, items: raw }
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) return collectQuestions(parsed)
    } catch {
      // 不是 JSON：落到下面统一报错
    }
    return { ok: false, message: 'questions 是字符串：它必须是题目对象数组，不能是 JSON 文本或整段题目文字' }
  }
  if (raw && typeof raw === 'object') {
    const wrap = raw as Record<string, unknown>
    for (const k of ['questions', 'items', 'list', 'data']) {
      if (Array.isArray(wrap[k])) return collectQuestions(wrap[k])
    }
    if (['type', 'stem', 'question', 'options', 'answer'].some((k) => k in wrap)) {
      return { ok: true, items: [wrap] }
    }
    return {
      ok: false,
      message: 'questions 是对象但不是题目：应当是数组，例如 questions:[{ type:"single", stem:"…" }]',
    }
  }
  return { ok: false, message: 'questions 缺失或类型不对（收到 ' + describeValue(raw) + '）' }
}

/**
 * 解析 Agent 给的题目。
 *
 * 为什么不再是「能/不能」的布尔：一次真实运行里模型写对了全部 10 道题，
 * 只是字段名与系统不同（type:'judge'、question 而不是 stem、options 是字符串数组、
 * answer:'B' 连写），系统一律回「题目格式不合法，请检查后重试」——它据此猜了 55 次也没猜到，
 * 最后整份卷没出成。校验器把二十来种不同的毛病压成一句话，等于没给任何信息。
 *
 * 所以这里两条原则：
 * 1. **能认就认**：意图唯一的写法一律归一化，不逼模型改（它拿到的报错越具体，下一轮越省 token）；
 * 2. **认不出就点明**：第几题、哪个字段、收到了什么、该写成什么——这是模型唯一的修正依据。
 */
export function parseQuestions(raw: unknown): QuestionsParse {
  const list = collectQuestions(raw)
  if (!list.ok) return { ok: false, message: list.message + '\n正确写法：' + EXAM_SHAPE_HINT }
  const questions: ExamQuestion[] = []
  for (let i = 0; i < list.items.length; i++) {
    const parsed = parseOneQuestion(list.items[i], i + 1)
    if (!parsed.ok) {
      return { ok: false, message: '第 ' + (i + 1) + ' 题：' + parsed.message + '\n正确写法：' + EXAM_SHAPE_HINT }
    }
    questions.push(parsed.question)
  }
  return { ok: true, questions }
}

/**
 * 旧签名：认不出来给 null。
 * 落盘数据读回（store.ts）与老调用方还在用它；它现在也走容错解析，
 * 而规范写法解析后是恒等的，所以磁盘上的历史试卷不会因此变形。
 */
export function normalizeQuestions(raw: unknown): ExamQuestion[] | null {
  const r = parseQuestions(raw)
  return r.ok ? r.questions : null
}
