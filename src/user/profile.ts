import {
  AVATAR_MAX_BYTES,
  GENDER_LABEL,
  GENDER_OPTIONS,
  emptyProfile,
  type Gender,
  type UserProfile,
} from './types'

/**
 * 用户画像的纯函数：解析、展示用派生值、以及一段写给模型看的画像说明。
 *
 * 这里不碰存储也不碰 React，便于单测——尤其是 profilePromptBlock 的边界
 * （空画像不污染提示词、未填写的字段不出现、语言单独强调）。
 *
 * 注意 profilePromptBlock **不再是导师主提示词的一部分**（2026-09 改）：导师改成主动取
 * （api.userInfo.get，见 user/fields 的 profileForModel）。这条路现在只服务「了解」那种
 * 没有工具的一次性释义（它取不到画像，而它唯一要画像的地方就是语言）。
 */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 头像只接受 data:image/... 的 data URL：避免存进远程地址或 javascript: 之类的值 */
export function normalizeAvatar(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  if (!s.startsWith('data:image/')) return ''
  // 约按 base64 膨胀 4/3 估算，超出上限就丢弃。
  // 头像会随画像写进 user.yaml，也在每次读写时进出内存，不该动辄几百 KB。
  if (s.length > AVATAR_MAX_BYTES * 1.4) return ''
  return s
}

function normalizeAge(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.round(n)
  if (i < 1 || i > 120) return null
  return i
}

/** 逐字段校验：任何非法输入都退回空值，绝不抛异常 */
export function normalizeProfile(raw: unknown): UserProfile {
  if (!raw || typeof raw !== 'object') return emptyProfile()
  const r = raw as Record<string, unknown>
  return {
    avatar: normalizeAvatar(r.avatar),
    nickname: str(r.nickname).slice(0, 40),
    age: normalizeAge(r.age),
    gender: GENDER_OPTIONS.includes(r.gender as Gender) ? (r.gender as Gender) : 'undisclosed',
    language: str(r.language).slice(0, 40),
    education: str(r.education).slice(0, 40),
    major: str(r.major).slice(0, 80),
    role: str(r.role).slice(0, 60),
    experience: str(r.experience).slice(0, 600),
    skills: str(r.skills).slice(0, 400),
  }
}

/** 界面上的称呼：昵称 → 兜底 */
export function displayName(profile: UserProfile, fallback = '未命名用户'): string {
  return profile.nickname || fallback
}

/** 文字头像用的首字（中文取第一个字，英文取首字母大写） */
export function initials(profile: UserProfile): string {
  const s = displayName(profile, '')
  if (!s) return '？'
  const ch = Array.from(s)[0] ?? '？'
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch
}

/** 从稳定的字符串派生一个头像底色（同一用户每次颜色一致） */
const AVATAR_COLORS = ['#a8432f', '#2f6f4f', '#3a5a8c', '#8c6b2f', '#6b3a8c', '#2f7f8c']
export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

/**
 * 画像里是否有任何会进入提示词的信息。
 * 头像是纯展示的图片，不计入。
 */
export function hasTeachingProfile(profile: UserProfile): boolean {
  return !!(
    profile.nickname ||
    profile.language ||
    profile.education ||
    profile.major ||
    profile.role ||
    profile.experience ||
    profile.skills ||
    profile.age !== null ||
    profile.gender !== 'undisclosed'
  )
}

/**
 * 组装一段写给模型看的画像说明（现在只服务「了解」那一次一次性请求）。
 *
 * 除头像外的每一项信息都会进来（昵称也在内）——画像的用途就是让讲解贴合本人。
 * 空画像返回 ''（调用方据此跳过），未填写的字段不列出，
 * 不要用「（未填写）」占位，那只会浪费上下文并干扰模型。
 */
export function profilePromptBlock(profile: UserProfile | undefined | null, fallbackName = ''): string {
  if (!profile) return ''
  const rows: string[] = []
  const who = profile.nickname || fallbackName
  if (who) rows.push(`- 称呼：${who}`)
  if (profile.age !== null) rows.push(`- 年龄：${profile.age}`)
  if (profile.gender !== 'undisclosed') rows.push(`- 性别：${GENDER_LABEL[profile.gender]}`)
  if (profile.education) rows.push(`- 教育程度：${profile.education}`)
  if (profile.major) rows.push(`- 专业背景：${profile.major}`)
  if (profile.role) rows.push(`- 当前身份：${profile.role}`)
  if (profile.experience) rows.push(`- 工作经验：${profile.experience}`)
  if (profile.skills) rows.push(`- 已掌握技能：${profile.skills}`)

  if (!rows.length && !profile.language) return ''

  const parts = ['学习者画像（据此定制讲解，不要生硬复述，也不要臆断未填写的信息）：']
  if (profile.language) {
    parts.push(`- 讲解语言：${profile.language}。**请用${profile.language}撰写全部讲解与回复。**`)
  }
  parts.push(...rows)
  parts.push(
    '',
    '据此调整：',
    '- 讲解深度、术语密度与节奏要匹配其教育程度与专业背景；基础薄弱处先补前置知识，',
    '  有相关基础的地方不必从零讲起。',
    '- 优先用贴近其专业背景、当前身份与工作经验的例子和场景。',
    '- 不要根据年龄、性别等预设立场或限制其学习范围。',
  )
  return parts.join('\n')
}
