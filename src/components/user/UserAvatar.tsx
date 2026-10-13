import { useEffect, useState } from 'react'
import { avatarColor, displayName, initials } from '../../user/profile'
import { resolveAvatarSrc } from '../../user/avatar'
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
 *
 * 画像里的头像现在是一个 **URL**，不是图片本身（见 user/types 的 avatar 字段）。
 * 外链直接交给 `<img>`；内置的 `asset:…` 指向 `{user}/assets/` 里的文件，得**现读**
 * 成 data URL 才能给 `<img>` 用——异步那一下要有个状态，读不到（文件被删了、
 * 数据目录搬走了）就退回文字头像，而不是留一个破图。
 */
export default function UserAvatar({ profile, size = 28, seed, className = '' }: Props) {
  const px = `${size}px`
  const base = 'shrink-0 overflow-hidden rounded-full select-none'
  const url = profile.avatar

  /**
   * 解析结果连同**它是哪个地址解析出来的**一起存。
   *
   * 这样「换了头像要立刻丢掉上一张的脸」就是一条纯判断（`resolved.url === url`），
   * 不必在 effect 里先同步 setState 清一次——同步 setState 会多触发一轮渲染，
   * 而且那种写法很难说清「清空」与「读回来」谁后到。
   */
  const [resolved, setResolved] = useState<{ url: string; src: string | null } | null>(null)

  useEffect(() => {
    if (!url) return
    let alive = true
    void resolveAvatarSrc(url).then((src) => {
      if (alive) setResolved({ url, src })
    })
    return () => {
      alive = false
    }
  }, [url])

  // 只认当前这个地址的那一份结果；旧的、还没读回来的，一律当作没有
  const src = resolved && resolved.url === url ? resolved.src : null

  if (src) {
    return (
      <img
        src={src}
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
