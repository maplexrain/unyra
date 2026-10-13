/**
 * 用户与用户画像。
 *
 * 目前是纯本地（见 store.ts），但类型与仓储接口（api.ts）刻意做成与
 * 存储无关：将来接账号体系时，只需换一个 UserRepo 实现，上层不用改。
 *
 * 画像字段分两类：
 * - 展示类（头像）：只用于界面，**永不进模型上下文**（它现在只是一个几十字符的 URL，
 *   但语义没变：导师不需要知道你长什么样）。
 * - 其余全部（昵称/年龄/性别/语言/教育程度/专业背景/当前身份/工作经验/技能）：
 *   导师**需要时自己取**——api.userInfo.get()（见 user/fields 的 profileForModel）。
 *   它们不再被拼进系统提示词：画像一改，那段前缀就整段作废，而多数轮次根本用不到画像。
 */

export type Gender = 'male' | 'female' | 'other' | 'undisclosed'

export interface UserProfile {
  /**
   * 头像：一个**URL**（见下），空串表示用昵称首字生成的文字头像。
   *
   * 两种形态：
   * - `asset:头像文件.png` —— 上传的图片落在 `{user}/assets/` 里，字段只记这一个名字
   *   （见 user/assets 与 user/avatar）；显示时由 UserAvatar 现读成 data URL。
   * - `https://…` —— 外链头像，直接交给 `<img src>`。
   *
   * **这里绝不放 base64**：一段 256KB 的 data URL 会让 user.yaml 每次启动都要整份解析，
   * 而且头像本身是纯展示的东西，没有理由把字节塞进画像（需求原文：「不再使用base64，
   * 因为太过庞大，用户头像字段只能使用url」）。normalizeAvatar 会把 data: 一律丢掉，
   * 长度也卡在 AVATAR_MAX_URL 以内——这是同一条纪律的两道闸。
   */
  avatar: string
  nickname: string
  /** 未填写为 null，避免用 0 或 '' 假装有值 */
  age: number | null
  gender: Gender
  /** 主要语言：决定 AI 用什么语言讲解 */
  language: string
  /** 教育程度，如「本科」「硕士」 */
  education: string
  /** 专业背景，如「计算机科学」 */
  major: string
  /** 当前身份，如「在校学生」「后端工程师」 */
  role: string
  /** 工作经验：自由描述 */
  experience: string
  /** 技能：自由描述，逗号分隔 */
  skills: string
}

export interface User {
  id: string
  profile: UserProfile
  createdAt: number
  updatedAt: number
}

export const GENDER_LABEL: Record<Gender, string> = {
  male: '男',
  female: '女',
  other: '其他',
  undisclosed: '不便透露',
}

export const GENDER_OPTIONS: Gender[] = ['male', 'female', 'other', 'undisclosed']

/** 教育程度候选：用 datalist 提供，允许自由填写 */
export const EDUCATION_OPTIONS = ['初中及以下', '高中', '中专/技校', '大专', '本科', '硕士', '博士']

/** 当前身份候选：用 datalist 提供，允许自由填写 */
export const ROLE_OPTIONS = [
  '在校学生',
  '应届毕业生',
  '教师',
  '研究人员',
  '工程师',
  '产品经理',
  '设计师',
  '管理者',
  '自由职业',
  '转行学习中',
]

/** 语言候选：用 datalist 提供，允许自由填写 */
export const LANGUAGE_OPTIONS = ['中文', 'English', '日本語', '한국어', 'Français', 'Deutsch', 'Español']

/**
 * 头像图片压缩后的体积上限（写进 `assets/` 的那个文件）。
 *
 * 它限制的是**磁盘上的图片**，与画像字段无关——字段里只有一个几十字符的 URL。
 */
export const AVATAR_MAX_BYTES = 256 * 1024

/**
 * 头像字段的长度上限（字符）。
 *
 * 255 是个熟悉的上限（数据库里的 varchar(255)），对 URL 也足够宽裕：
 * 内置形态 `asset:avatar-1730000000000.png` 三十来字符，长的外链也放得下。
 * 它更实际的用途是**兜住 base64**：一段 256KB 的头像 base64 有三十多万字符，
 * 卡在 255 就从长度上先挡掉一次（`data:` 前缀另有专门的一道闸，见 normalizeAvatar）。
 */
export const AVATAR_MAX_URL = 255

export function emptyProfile(): UserProfile {
  return {
    avatar: '',
    nickname: '',
    age: null,
    gender: 'undisclosed',
    language: '',
    education: '',
    major: '',
    role: '',
    experience: '',
    skills: '',
  }
}

export function makeUser(profile?: Partial<UserProfile>, id?: string): User {
  const now = Date.now()
  return {
    id: id ?? crypto.randomUUID(),
    profile: { ...emptyProfile(), ...profile },
    createdAt: now,
    updatedAt: now,
  }
}
