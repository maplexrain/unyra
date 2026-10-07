/*
 * 这个文件负责：学习工作区与外界之间的两个契约——
 * 组件对外的 props 形状，以及几处「量」的常量（拖动阈值、补间时长、间距）。
 *
 * 常量集中在这里而不是散在组件里：它们中的每一个都同时被两个地方读
 * （界面的类名 / 内联样式、以及拖动时的换算），分开写迟早会有一处忘了改。
 * 每一项的「为什么是这个数」都写在它自己的注释里，改之前先读一遍。
 */

import type { SwitchRootResult } from '../../../lib/boot'
import type { User } from '../../../user/types'

export interface Props {
  /** 当前用户（含画像）：顶栏展示头像与昵称 */
  user: User | null
  /** 换用户数据目录（设置里的存储页用）：整份数据换一套，交给 App 重新载入 */
  onRootChanged: (dir?: string) => Promise<SwitchRootResult>
  onOpenUser: () => void
  onSignOut: () => void
  onToast: (msg: string) => void
  /** 打开更新确认弹窗（弹窗由 App 渲染，理由见 components/update/UpdateButton） */
  onOpenUpdate: () => void
}

/** 拖动读数离分隔线的距离：贴着那条线，又压不到它 */
export const RESIZE_HINT_GAP = 10

/**
 * 右侧栏收起之后，那颗开关离窗口右边的距离（px）。
 *
 * 它骑在分割线上时 right = --side-w（线在哪它在哪）；收起之后那格宽度是 0、线也藏了，
 * 若还按 0 算，按钮就会被推到窗口外面去一半。留这么一点边距 + 自身一半的位移，
 * 正好整颗落在窗口里（见那颗按钮上的 translate-x-1/2）。
 */
export const SIDE_TOGGLE_INSET = 14

/** 右侧栏收起 / 展开的补间时长（ms）：与那一格上的 lg:duration-300 对齐，多留一点余量 */
export const SIDE_ANIM_MS = 320

/**
 * 从页签栏里往外拖时，指针要越过栏的下边缘这么多像素，才认「在上边分割」。
 *
 * 差不多是一条页签栏的高度。页签栏就贴在正文上方，而正文的上边 30% 都算「上边」
 * （见 groups 的 zoneAtPoint）——不留这道余量的话，「想在栏内换顺序、手往下偏二十像素」
 * 会被判成分屏（用户反馈：拖页签十次里有几次变成了画面分割）。
 */
export const SPLIT_TOP_MARGIN = 28

/**
 * 源码视图那一格的滚动位置多带这个后缀。
 *
 * 同一份文档可以在源码视图里编辑、也可以在预览里阅读，两处的滚动位置是**两件事**
 * （在源码里改到一半切去预览，读到的该是上次读到的地方）。共用一格的话，
 * 两边会互相把对方拽走（见 learn/types 的 DocScroll）。
 */
export const SRC_SCROLL_SUFFIX = '#src'
