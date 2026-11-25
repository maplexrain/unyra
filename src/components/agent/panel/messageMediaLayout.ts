/**
 * 消息附件的「媒体 / 文件」分界与宫格排布。
 *
 * 图片与视频是**看得见的内容**，排在气泡内侧底部；其余文件只是「一份东西」，
 * 挂在气泡外底侧（见 ChannelAttachments）。这里只做纯计算，组件在 MessageMedia.tsx。
 */
import type { MessageFile } from '../../../agent/types'

/** 一条消息最多显示九张媒体（3×3，与输入框的附件上限同数） */
export const MAX_MEDIA = 9

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv|ogg|avi|mkv)$/i

export function isVideoFileName(name: string): boolean {
  return VIDEO_EXT.test(name.trim())
}

export function isVideoFile(file: MessageFile): boolean {
  return isVideoFileName(file.name)
}

/**
 * 宫格规格：列数、以及前三张的特殊跨行。
 *
 * 参照 Telegram：1 张整幅；2 张并排；3 张首张占一整行、下面两张并排；
 * 4 张 2×2；5 张以上一律三列等宽。这样五张和九张都排得满，不会留下空半行。
 */
export function mediaGridSpec(count: number): {
  cols: 1 | 2 | 3
  /** 首张是否横跨整行（3 张时用） */
  firstWide: boolean
} {
  if (count <= 1) return { cols: 1, firstWide: false }
  if (count === 2) return { cols: 2, firstWide: false }
  if (count === 3) return { cols: 2, firstWide: true }
  if (count === 4) return { cols: 2, firstWide: false }
  return { cols: 3, firstWide: false }
}
