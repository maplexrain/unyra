import { GENDER_LABEL, GENDER_OPTIONS, type Gender, type UserProfile } from './types'
import { normalizeProfile } from './profile'

/**
 * 画像字段的清单、取值归一，以及「表单回答 → 画像」的那一步映射。
 *
 * 为什么单独成模块：画像现在有**两个写入口**——设置里用户自己改，以及导师代写
 * （api.userInfo.update，或 api.ask 里题目上标了 userInfo 的那种，提交即落库）。
 * 两个口必须落在同一份「哪些字段可写、每个字段收什么样的值」上，否则
 * 「大三」到底进 education 还是 role 就只能靠运气。
 *
 * 这里不碰存储、不碰 React：coerceProfileValue 与 patchFromAnswers 都是纯函数，
 * 越界年龄、认不出的性别、超长文本、留空答案这些边界由 tests/userFields.test.ts 钉住。
 */

/** 画像里可读写的字段：头像是纯展示的图片，不进这条通道 */
export type ProfileField = Exclude<keyof UserProfile, 'avatar'>

export const PROFILE_FIELDS: ProfileField[] = [
  'nickname',
  'age',
  'gender',
  'language',
  'education',
  'major',
  'role',
  'experience',
  'skills',
]

export const PROFILE_FIELD_LABEL: Record<ProfileField, string> = {
  nickname: '昵称',
  age: '年龄',
  gender: '性别',
  language: '讲解语言',
  education: '教育程度',
  major: '专业背景',
  role: '当前身份',
  experience: '工作经验',
  skills: '已掌握技能',
}

/**
 * 每个字段「拿来干什么」。这段话是写给导师看的（api.userInfo.get 的回执里带上）：
 * 只给字段名，模型会把画像当成一份要填满的表；说清用途，它才知道讲解该怎么用。
 */
export const PROFILE_FIELD_USE: Record<ProfileField, string> = {
  nickname: '称呼他时用',
  age: '只影响举例的语境，不要据此预设立场或限制学习范围',
  gender: '同上，不要据此预设立场',
  language: '**用这个语言撰写全部讲解与回复**',
  education: '决定术语密度与前置知识的补法',
  major: '决定例子与场景贴近哪个领域',
  role: '决定「学了用在哪儿」的说法',
  experience: '同上，越具体的经历越该被举成例子',
  skills: '已经会的部分不必从零讲起',
}

export function isProfileField(v: unknown): v is ProfileField {
  return typeof v === 'string' && (PROFILE_FIELDS as string[]).includes(v)
}

/** 供报错用：可写字段的「字段名（中文名）」清单 */
export function profileFieldList(): string {
  return PROFILE_FIELDS.map((f) => f + '（' + PROFILE_FIELD_LABEL[f] + '）').join('、')
}

/**
 * 交给模型的那份画像。
 *
 * **头像是绝不出去的**：它是一段 data URL，上限 256KB——进了回执就是几十万字符的
 * 上下文灾难，而模型看图也不该看头像。其余字段原样给出，未填的保持空串 / null
 * （不要拿「（未填写）」占位，那只会浪费上下文）。
 */
export interface ProfileForModel {
  nickname: string
  age: number | null
  /** 中文标签（写入时 male 与「男」两种写法都收，见 coerceProfileValue） */
  gender: string
  language: string
  education: string
  major: string
  role: string
  experience: string
  skills: string
  /** 已经有值的字段名 */
  filled: ProfileField[]
  /** 还没填的字段名——想补全就照它问，题目上写 userInfo: '<字段名>' */
  missing: ProfileField[]
  /** 字段名 → 用途（与 EXECUTE_GUIDE 的那一节能对上） */
  usage: Record<ProfileField, string>
  note: string
}

export function profileForModel(profile: UserProfile | null | undefined): ProfileForModel | null {
  if (!profile) return null
  const filled: ProfileField[] = []
  const missing: ProfileField[] = []
  for (const f of PROFILE_FIELDS) {
    const v = profile[f]
    const has = f === 'age' ? v !== null : f === 'gender' ? v !== 'undisclosed' : String(v ?? '').trim() !== ''
    ;(has ? filled : missing).push(f)
  }
  return {
    nickname: profile.nickname,
    age: profile.age,
    gender: profile.gender === 'undisclosed' ? '' : GENDER_LABEL[profile.gender],
    language: profile.language,
    education: profile.education,
    major: profile.major,
    role: profile.role,
    experience: profile.experience,
    skills: profile.skills,
    filled,
    missing,
    usage: PROFILE_FIELD_USE,
    note:
      '学习者画像**不在系统提示词里**，要看就用 api.userInfo.get() 现取（同一轮取一次就够，之后不必重复取）。' +
      '要补全缺失的字段：用 api.ask 问，题目上写 userInfo: \'字段名\'，用户提交的那一刻回答就直接写进画像，' +
      '不需要你再 update；一次可以问好几个字段（一道题一个字段）。已经问到答案、但没有走 ask 的（比如用户在对话里顺口说了），' +
      '用 api.userInfo.update({ 字段: 值 }) 增量写——只写你确认知道的，别把你推断的东西写进去。',
  }
}

/** 单字段归一的结果：写不进去就把原因说清楚，让模型能改（而不是悄悄丢掉） */
export type CoerceResult =
  | { ok: true; value: string | number; note?: string }
  | { ok: false; reason: string }

/** 性别的各种写法 → 内部值。中文标签、英文键、常见简写都收 */
const GENDER_ALIAS: Record<string, Gender> = {
  male: 'male',
  man: 'male',
  男: 'male',
  男性: 'male',
  female: 'female',
  woman: 'female',
  女: 'female',
  女性: 'female',
  other: 'other',
  其他: 'other',
  其它: 'other',
  undisclosed: 'undisclosed',
  不便透露: 'undisclosed',
  保密: 'undisclosed',
  不想说: 'undisclosed',
  不愿透露: 'undisclosed',
}

/**
 * 把一个外来值折成画像里能存的东西。
 *
 * 文本字段的长度上限**不在这里另写一份**：绕一圈 normalizeProfile 拿它切过的结果，
 * 存储层改了上限这里自动跟上（少一处会对不齐的常量）。切过了会在 note 里说明。
 */
export function coerceProfileValue(field: ProfileField, raw: unknown): CoerceResult {
  const label = PROFILE_FIELD_LABEL[field]
  if (raw === null || raw === undefined || typeof raw === 'object' || typeof raw === 'boolean') {
    return { ok: false, reason: label + '只收文本或数字' }
  }
  const text = String(raw).trim()
  if (!text) return { ok: false, reason: label + '是空的' }

  if (field === 'age') {
    const n = Number(text.replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(n)) return { ok: false, reason: '年龄要是数字，收到「' + text + '」' }
    const i = Math.round(n)
    if (i < 1 || i > 120) return { ok: false, reason: '年龄要在 1~120 之间，收到 ' + i }
    return { ok: true, value: i }
  }

  if (field === 'gender') {
    const g = GENDER_ALIAS[text.toLowerCase()] ?? GENDER_ALIAS[text]
    if (!g) {
      return {
        ok: false,
        reason: '性别认不出「' + text + '」；只认 ' + GENDER_OPTIONS.map((x) => x + '（' + GENDER_LABEL[x] + '）').join(' / '),
      }
    }
    return { ok: true, value: g }
  }

  // 文本字段：长度上限交给存储层那一份（normalizeProfile 里逐字段 slice）
  const capped = String(normalizeProfile({ [field]: text } as Partial<UserProfile>)[field] ?? '')
  if (!capped) return { ok: false, reason: label + '没能归一成一个可存的值' }
  return capped === text
    ? { ok: true, value: capped }
    : { ok: true, value: capped, note: label + '原文 ' + text.length + ' 字，超过上限，只存了前 ' + capped.length + ' 字' }
}

/* ---------- 表单回答 → 画像 ---------- */

/**
 * 这里只声明「用得到的那几个字段」，而不是 import agent/tools 的 AskQuestion：
 * 一来 user/ 不必反向依赖 agent/，二来这两条形状本来就是结构化兼容的
 * （ask 归一化后的题目与回答一定含这里的字段）。
 */
export interface AskFieldQuestion {
  id: string
  /** 这道题的答案要写进画像的哪个字段；没写就是普通问题，只是聊聊天 */
  userInfo?: string
}

export interface AskFieldAnswer {
  id: string
  type?: string
  /** 选中项的文字 */
  picked?: string[]
  /** 选了「其他」时用户补的原文 */
  other?: string
  /** 简答题的正文 */
  text?: string
}

export interface AnswerPatch {
  /** 直接可以交给 updateUser 的增量补丁 */
  patch: Partial<UserProfile>
  applied: Array<{ field: ProfileField; label: string; value: string | number }>
  skipped: Array<{ field: ProfileField; label: string; reason: string }>
}

/** 一道题的答案原文：简答取正文；选择题把选中项与「其他」的补充连起来 */
export function answerTextOf(a: AskFieldAnswer): string {
  if (a.type === 'short') return (a.text ?? '').trim()
  const parts = [...(a.picked ?? [])].map((x) => String(x).trim()).filter(Boolean)
  const other = (a.other ?? '').trim()
  if (other) parts.push(other)
  return parts.join('、')
}

/**
 * 把一次 ask 的答案里「标了 userInfo 的那些题」折成画像补丁。
 *
 * 留空不是错误（表单里从来没有必答题）：跳过并在 skipped 里说明，模型自己决定要不要再问。
 * 认不出的字段、写不进去的值同样进 skipped——**绝不因为一个字段不合法就把整张表单丢掉**。
 */
export function patchFromAnswers(questions: AskFieldQuestion[], answers: AskFieldAnswer[]): AnswerPatch {
  const out: AnswerPatch = { patch: {}, applied: [], skipped: [] }
  const byId = new Map(answers.map((a) => [a.id, a]))
  for (const q of questions) {
    const field = q.userInfo
    if (!field) continue
    if (!isProfileField(field)) {
      out.skipped.push({ field: 'nickname', label: String(field), reason: '认不出的字段名「' + field + '」' })
      continue
    }
    const label = PROFILE_FIELD_LABEL[field]
    const a = byId.get(q.id)
    const text = a ? answerTextOf(a) : ''
    if (!text) {
      out.skipped.push({ field, label, reason: '用户留空了这道题' })
      continue
    }
    const c = coerceProfileValue(field, text)
    if (!c.ok) {
      out.skipped.push({ field, label, reason: c.reason })
      continue
    }
    out.patch[field] = c.value as never
    out.applied.push({ field, label, value: c.value })
  }
  return out
}
