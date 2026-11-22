/**
 * 智能体头像的可视渲染（目录与解析在 agentAvatars.tsx，组件单独成文件——
 * fast-refresh 规矩：组件文件只出组件）：
 * 龟龟图片画 <img>（imgSize/imgClassName 定尺寸与圆角），图标头像画 lucide 图标。
 */

import { createElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import { agentAvatarIcon, agentAvatarImage } from './agentAvatars'

export function AgentAvatarGlyph({
  avatarId,
  fallback,
  size = 17,
  imgSize,
  imgClassName = 'h-10 w-10 rounded-2xl',
  iconClassName,
}: {
  avatarId?: string
  fallback: LucideIcon
  /** 图标头像的线宽尺寸（lucide size） */
  size?: number
  /** 图片头像的边长（px）；缺省跟 size */
  imgSize?: number
  /** 图片的样式（尺寸与圆角由调用方定，默认撑满 40px 圆角框） */
  imgClassName?: string
  /** 图标的透传样式 */
  iconClassName?: string
}) {
  const src = agentAvatarImage(avatarId)
  if (src) {
    const px = imgSize ?? size
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={px}
        height={px}
        className={'shrink-0 select-none object-cover ' + imgClassName}
      />
    )
  }
  // 运行期挑图标类型走 createElement（react-compiler 的 static-components 规则不认渲染期选组件）
  return createElement(agentAvatarIcon(avatarId, fallback), { size, className: iconClassName })
}
