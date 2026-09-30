import { avatarColor, displayName, initials } from '../../user/profile'
import type { UserProfile } from '../../user/types'
import { t } from '../../i18n'

interface Props {
  profile: UserProfile
  /** 边长（像素） */
  size?: number
  /** 颜色派生用的稳定种子（通常传用户 id），保证同一用户颜色一致 */
  seed?: string
  className?: string
}

/**
 * 用户头像：有图片显示图片，否则用昵称/姓名首字生成文字头像。
 * 底色由 seed 派生，同一用户始终同色。
 */
export default function UserAvatar({ profile, size = 28, seed, className = '' }: Props) {
  const px = `${size}px`
  const base = 'shrink-0 overflow-hidden rounded-full select-none'

  if (profile.avatar) {
    return (
      <img
        src={profile.avatar}
        alt={t(displayName(profile, '用户'))}
        width={size}
        height={size}
        style={{ width: px, height: px }}
        className={`${base} object-cover ${className}`}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      title={t(displayName(profile, '用户'))}
      style={{
        width: px,
        height: px,
        backgroundColor: avatarColor(seed || displayName(profile, 'moji')),
        fontSize: Math.max(10, Math.round(size * 0.42)),
      }}
      className={`${base} flex items-center justify-center font-medium text-white ${className}`}
    >
      {initials(profile)}
    </span>
  )
}
