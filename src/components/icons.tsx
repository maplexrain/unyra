/**
 * 手画的 inline SVG 图标：只收「在好几个组件里都要用、且图标库里没有合适的」那几颗。
 *
 * 为什么不用 lucide：这三个动作（打开本地文件 / 新建学习目标 / 新建对话）在图标库里
 * 的现成货要么加号小得缩到 15px 就糊（message-square-plus 的加号只占 24 坐标系的四分之一），
 * 要么语义对不上。自己画可以控制加号与留白的比例，缩到小尺寸仍然清楚。
 * 全部走 stroke 1.9~2、圆角端点，与 lucide 的视觉语言一致，混排不违和。
 */

interface IconProps {
  size?: number
  strokeWidth?: number
  className?: string
}

const base = (size: number, stroke: number, className?: string) => ({
  viewBox: '0 0 24 24',
  width: size,
  height: size,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: stroke,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  className,
})

/**
 * 打开本地文件：一只文件夹，一支向内的箭头（把外面的文件「收进来」）。
 *
 * 箭头画在文件夹内部、悬在开口之下——「文件进来」的方向感靠它，
 * 与「新建文件夹」（folder-plus，加号在外）区分开。
 */
export function OpenLocalIcon({ size = 16, strokeWidth = 1.9, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, className)}>
      {/* 文件夹：后板带一个折角，前板从左侧兜过来 */}
      <path d="M3.7 7.6a1.9 1.9 0 0 1 1.9-1.9h3.2l2.1 2.2h7.5a1.9 1.9 0 0 1 1.9 1.9v7.5a1.9 1.9 0 0 1-1.9 1.9H5.6a1.9 1.9 0 0 1-1.9-1.9z" />
      {/* 收进来的箭头：竖杆 + 尖角，落在前板上方一点的位置 */}
      <path d="M12 10.6v5.2" />
      <path d="M9.6 13.5 12 15.9l2.4-2.4" />
    </svg>
  )
}

/**
 * 新建学习目标：一只靶心，右上角带一颗加号。
 *
 * 靶心是「学习目标」的既有符号（应用里的 Bullseye 同一意象），加号说明「新建」；
 * 两者错开放（加号在右上角的空白处），缩到 14px 仍互不粘连。
 */
export function NewGoalIcon({ size = 16, strokeWidth = 1.9, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, className)}>
      {/* 靶心：外圈 + 内圈，中心留白 */}
      <circle cx="10.6" cy="13.4" r="7.1" />
      <circle cx="10.6" cy="13.4" r="3" />
      {/* 新建：右上角的加号，两笔各 4 个单位 */}
      <path d="M18.6 3.4v4" />
      <path d="M16.6 5.4h4" />
    </svg>
  )
}

/**
 * 新建对话：一只对话气泡，中间一颗加号。
 *
 * 相比图标库的 message-square-plus，加号放大到 6.4 个单位（约占气泡高度的一半），
 * 尾巴从左下角自然伸出；缩到 15px 时加号与气泡壁之间仍留得住空隙。
 */
export function NewChatIcon({ size = 16, strokeWidth = 1.9, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, className)}>
      {/* 气泡：三只圆角 + 左下角的尖角，尾巴从中伸出 */}
      <path d="M3.6 7.1a3 3 0 0 1 3-3h10.8a3 3 0 0 1 3 3v6.6a3 3 0 0 1-3 3H8.2l-4.6 3.2z" />
      {/* 加号：横竖各 6.4 个单位，四周的留白一样宽 */}
      <path d="M12 7.2v6.4" />
      <path d="M8.8 10.4h6.4" />
    </svg>
  )
}

/**
 * 导出：托盘上方一支**向上离开**的箭头。
 *
 * 图标库的 Download 是「箭头向下扎进托盘」——读作下载/导入，与「把文档拿走」正好相反。
 * 这里把方向反过来：箭头从托盘里向上射出去，意即「送出应用」。
 */
export function ExportIcon({ size = 16, strokeWidth = 1.9, className }: IconProps) {
  return (
    <svg {...base(size, strokeWidth, className)}>
      {/* 箭头：杆在中间，尖朝上——方向就是语义 */}
      <path d="M12 14.8V4.6" />
      <path d="M7.8 8.6 12 4.4l4.2 4.2" />
      {/* 托盘：开口朝上，接住「放出去」的底部 */}
      <path d="M4.6 14.2v3.2a1.9 1.9 0 0 0 1.9 1.9h11a1.9 1.9 0 0 0 1.9-1.9v-3.2" />
    </svg>
  )
}
