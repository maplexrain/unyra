/**
 * 这个文件负责什么：ask（结构化表单）入参的归一化与校验——模型给的自由对象 → AskFormPayload，
 * 以及把结果说给模型听时的 safeJson。校验规则全在这里：认不出就回一句能改的错。
 */
import { isProfileField, profileFieldList, type ProfileField } from '../../user/fields'
import { asRecord, asText } from './refs'
import type { AskFormPayload, AskOption, AskQuestion } from './types'

/* ---------- ask 表单的归一化 ---------- *//** 表单的规模上限：题目超过一屏没人会答完，选项超过一排就该换简答 */
const ASK_MAX_QUESTIONS = 8
const ASK_MAX_OPTIONS = 8

/**
 * 把模型给的 ask 入参归一化成确定形状。没有 JSON Schema 可靠（execute 的参数是
 * 自由对象），所以校验全在这里：认不出就回一句能改的错——与 exam 的 parseQuestions
 * 同一条经验，报错要写到「第几题、哪个字段、该写成什么」。
 */
export function normalizeAskForm(raw: unknown): { ok: true; form: AskFormPayload } | { ok: false; content: string } {
  const src = asRecord(raw)
  const rawQuestions = src.questions
  if (!Array.isArray(rawQuestions) || !rawQuestions.length) {
    return { ok: false, content: 'ask 需要 questions 数组（至少一道题）：api.ask({ title?, questions: [...] })' }
  }
  if (rawQuestions.length > ASK_MAX_QUESTIONS) {
    return { ok: false, content: `ask 一次最多 ${ASK_MAX_QUESTIONS} 道题（收到 ${rawQuestions.length} 道）；拆成几次问更容易得到回答` }
  }
  const title = asText(src.title).trim().slice(0, 120)
  const questions: AskQuestion[] = []
  /** 已出现的题目 id：when 只能引用**前面**的题（后面的答案还没发生） */
  const knownIds = new Set<string>()
  for (const [i, rawQ] of rawQuestions.entries()) {
    const q = asRecord(rawQ)
    const n = i + 1
    const type = q.type === 'single' || q.type === 'multiple' || q.type === 'short' ? q.type : null
    if (!type) {
      return {
        ok: false,
        content: `第 ${n} 题的 type 只认 'single'（单选）/ 'multiple'（多选）/ 'short'（简答），收到「${String(q.type ?? '（没给）')}」`,
      }
    }
    const prompt = asText(q.prompt).trim()
    if (!prompt) return { ok: false, content: `第 ${n} 题（${type}）没有题干 prompt；要问什么得写清楚` }
    const options: AskOption[] = []
    if (type !== 'short') {
      const rawOptions = Array.isArray(q.options) ? q.options : []
      if (rawOptions.length < 2) {
        return { ok: false, content: `第 ${n} 题（${type}）的 options 至少要 2 项；收到 ${rawOptions.length} 项。简答请用 type: 'short'` }
      }
      if (rawOptions.length > ASK_MAX_OPTIONS) {
        return { ok: false, content: `第 ${n} 题的 options 最多 ${ASK_MAX_OPTIONS} 项（收到 ${rawOptions.length} 项）` }
      }
      rawOptions.forEach((rawOpt, j) => {
        // 两种写法都收：'选项文字' 与 { id, label }；id 没给就按 A/B/C 配
        const label = typeof rawOpt === 'string' ? rawOpt.trim() : asText(asRecord(rawOpt).label).trim()
        const givenId = typeof rawOpt === 'string' ? '' : asText(asRecord(rawOpt).id).trim()
        const id = (givenId || String.fromCharCode(65 + j)).slice(0, 8)
        if (label) options.push({ id, label })
      })
      if (options.length < 2) {
        return { ok: false, content: `第 ${n} 题的 options 里没有可用的选项文字（label 不能全为空）` }
      }
    }
    let when: AskQuestion['when'] = null
    const rawWhen = asRecord(q.when)
    if (rawWhen.id || rawWhen.oneOf) {
      const refId = asText(rawWhen.id)
      const oneOf = Array.isArray(rawWhen.oneOf) ? rawWhen.oneOf.map((x) => asText(x)).filter(Boolean) : []
      if (!refId || !oneOf.length) {
        return { ok: false, content: `第 ${n} 题的 when 需要 { id: '前面某题的 id', oneOf: ['触发的选项'] }` }
      }
      if (!knownIds.has(refId)) {
        return { ok: false, content: `第 ${n} 题的 when 引用了「${refId}」，但没有这道更早的题（when 只能引用排在它前面的题目 id）` }
      }
      when = { id: refId, oneOf }
    }
    const givenId = asText(q.id).trim()
    const id = (givenId || 'q' + n).slice(0, 32)
    if (knownIds.has(id)) return { ok: false, content: `第 ${n} 题的 id「${id}」与前面的题目重复了；每道题的 id 要唯一` }
    knownIds.add(id)
    // userInfo：这一题的答案提交时直接写进画像（见 user/fields）。字段名写错就当场拒——
    // 悄悄忽略的后果更糟：导师以为问到了，画像里其实一直是空的。
    let userInfo: ProfileField | undefined
    const rawField = asText(q.userInfo).trim()
    if (rawField) {
      if (!isProfileField(rawField)) {
        return { ok: false, content: `第 ${n} 题的 userInfo「${rawField}」不是画像字段；可写的只有：${profileFieldList()}` }
      }
      userInfo = rawField
    }
    // required 字段已废：模型给了也忽略——用户想答哪题答哪题，留空不是错误
    questions.push({ id, type, prompt: prompt.slice(0, 300), options, when, ...(userInfo ? { userInfo } : {}) })
  }
  return { ok: true, form: { title, questions } }
}

export function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}