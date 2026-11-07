/**
 * 结构画布的共享类型与常量：各拆分模块（指针 hook、镜头 hook、渲染件）都要认的公共口径。
 * 这里只放「跨模块共享」的类型（手势、右键菜单、统一通道回执）与指针/镜头/连线粗筛用的
 * 常量；渲染件自用的常量（图标笔画、缩略图窗口尺寸）跟着渲染件走。
 */

import type { GNodeKind } from '../../../learn/nodeKinds'

/** 统一通道的回执形状（与 NodeResult 同构；拒绝必须带一句人话） */
export type ChannelResult = { ok: true; note?: string } | { error: string }

/**
 * 左侧列表：挂件 + 视频节点。实体先行：拖到空白处就走统一通道建真实空实体，
 * 卡从落位那刻起就由 store 派生。入口、文档与大纲不在列表里——入口由目标绑定
 * 派生，子文档点大纲目标项，前置知识大纲走文档卡右键菜单。
 */
export const PALETTE: GNodeKind[] = ['doc', 'outline', 'note', 'exam', 'superdoc', 'video', 'project', 'file']

/** 网格背景的点距（世界坐标 px）：平移/缩放时按相机换算，见画布根的 backgroundImage */
export const GRID_PX = 28

/** 双击节点聚焦的落点与缩放：节点停在屏幕高的 40% 处、水平居中，放大到 140% */
export const FOCUS_ZOOM = 1.4
export const FOCUS_VERTICAL = 0.4

/**
 * 连线粗筛的外扩余量（世界坐标 px）。
 *
 * 粗筛用的是「两端卡片矩形的并集」，而实际走线是贝塞尔/折线，可能鼓到矩形外面去。
 * 这个余量要盖住那一段弧度：太小会在大图上看到线在视口边缘凭空断掉，太大就白裁。
 * 120 对现在的绕行半径（见 structureView 的 routeOf）是够的。
 */
export const EDGE_CULL_PAD = 120

export type Gesture =
  | { mode: 'pan'; startX: number; startY: number; camX: number; camY: number }
  | {
      mode: 'node'
      id: string
      grabX: number
      grabY: number
      origX: number
      origY: number
      moved: boolean
      /** 按下的是标题：没拖动的话松手就打开它 */
      openTitle: boolean
      /** 多选整组拖：这批卡按下时的原位置（含按下的这张）；单选拖没有它 */
      group?: Array<{ id: string; x: number; y: number }>
    }
  | { mode: 'link'; from: string; fromKind: GNodeKind; slotKey?: string; moved?: boolean }
  | {
      mode: 'palette'
      kind: GNodeKind
      /** 指针是否离开过列表：没离开过就松手 = 把它放回去了，不建节点 */
      leftList?: boolean
    }
  | { mode: 'marquee'; startX: number; startY: number }
  | null

/** 工具组图标的公共笔画：24×24、描边 2、圆角端点——与 KindIcon 同一套笔画语言 */
export const ICON_STROKE = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
} as const

/** 右键菜单：贴指针弹出，作用在某个节点上 */
export interface MenuState {
  x: number
  y: number
  uuid: string
  slotKey?: string
  mode: 'actions' | 'note' | 'rename' | 'projectPath' | 'fileEdit'
}
