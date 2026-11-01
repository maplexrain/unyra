import type { ConversationMessage } from './types'
import { t } from '../i18n'
import type { UserProfile } from '../user/types'
import { profileForModel } from '../user/fields'

/**
 * 学习者画像信息消息（属于客观信息，不属于提示词）。
 *
 * 排序与注入纪律：
 * 1. 用户画像属于信息，不属于提示词；
 * 2. 在首轮进行注入；
 * 3. 严格排在导师人格（Persona）和文档格式（DocFormat）之后；
 * 4. 采用 inject: 'prompt' 与 hidden: true，在界面过程中可折叠展开查看，不抢占主对话焦点。
 */
export function userInfoMessage(
  profile: UserProfile | null | undefined,
  at: number,
  uuid: string,
): ConversationMessage {
  const p = profileForModel(profile)
  const lines: string[] = ['【当前学习者画像与背景信息（客观信息，供因材施教参考）】']
  if (p && p.filled.length > 0) {
    if (p.nickname) lines.push(`- 昵称：${p.nickname}`)
    if (p.age !== null && p.age !== undefined) lines.push(`- 年龄：${p.age}`)
    if (p.gender) lines.push(`- 性别：${p.gender}`)
    if (p.education) lines.push(`- 学历 / 阶段：${p.education}`)
    if (p.major) lines.push(`- 专业：${p.major}`)
    if (p.role) lines.push(`- 身份 / 职业：${p.role}`)
    if (p.experience) lines.push(`- 经验背景：${p.experience}`)
    if (p.skills) lines.push(`- 技能储备：${p.skills}`)
    if (p.language) lines.push(`- 偏好语言：${p.language}`)
    if (p.missing.length > 0) {
      lines.push(`- 尚未填写的画像字段：${p.missing.join('、')}（教学需要时可适时通过 api.ask 询问并补充）`)
    }
  } else {
    lines.push('（学习者尚未填写个人画像，默认按通用基础水平因材施教，遇到需要时可通过 api.ask 询问并补充）')
  }

  return {
    id: uuid,
    role: 'assistant',
    parts: [{ type: 'text', text: lines.join('\n') }],
    ts: at,
    hidden: true,
    mark: t('学习者画像'),
    userInfo: true,
    inject: 'prompt',
  }
}

/**
 * 这一段对话里，学习者画像交代过了没有（首轮注入判据）。
 * 只认活着的消息；压缩后或新会话时为 false。
 */
export function needsUserInfoAnnounce(messages: ConversationMessage[]): boolean {
  return !messages.some((m) => !m.retired && m.userInfo)
}
