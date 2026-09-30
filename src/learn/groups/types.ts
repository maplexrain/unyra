/** 这个文件负责：文档区的**形状**——布局树、每格的页签、焦点与拖动落点；只有类型，没有一行逻辑 */

import type { LearnTab } from '../types'

/** 一组页签：自己一条页签栏、自己一个激活项 */
export interface DocGroup {
  id: string
  /** 这一组开着的页签，顺序就是页签栏上的顺序 */
  tabs: LearnTab[]
  /** 这一组当前激活的那一个；null = 这一组里没有页签（刚拆出来的空格子） */
  active: string | null
}

/**
 * 分割方向。
 *
 * 取的是 flex-direction 的名字，不是「横着分 / 竖着分」：后者在中文里天然有两种读法
 * （横着切一刀，得到的是上下两半），而 'row' / 'col' 与最终那条 CSS 一一对应，不会歧义。
 * 'row' = 左右并排（分割线是竖的），'col' = 上下叠放（分割线是横的）。
 */
export type SplitDir = 'row' | 'col'

/** 一次分割（布局树的内部节点）；拖动那条线改的就是它的 sizes */
export type DocSplit = Extract<DocLayout, { kind: 'split' }>

/** 布局树：叶子是一组页签，内部节点是一次分割 */
export type DocLayout =
  | { kind: 'group'; group: string }
  | {
      kind: 'split'
      id: string
      dir: SplitDir
      /** 至少两个孩子；同方向的插入会摊平成兄弟，见 insertBeside */
      children: DocLayout[]
      /** 与 children 一一对应的占比（和为 1）；拖动分割线改的就是它 */
      sizes: number[]
    }

/**
 * 文档区的全部界面状态：布局 + 各组页签 + 焦点。
 *
 * 为什么焦点组要单独记：拖页签分割之后，新拆出来的那一格自动拿到焦点（用户接下来一定是
 * 想在那一格里开点什么），而「焦点在哪」还会被下一页签落在哪、关页签关掉谁、大纲跳转
 * 落到哪一格读到——它不能靠「最后渲染的是谁」推出来。
 */
export interface DocWorkspace {
  layout: DocLayout
  groups: DocGroup[]
  focus: string
}

/**
 * 拖页签的落点：哪一格 + 哪一条边。
 *
 * 'center' = 放进这一格（只挪不拆），四条边 = 在那一侧拆出新的一格。
 * 它单独活在 groups 里（而不是长在组件的坐标计算里）是因为这套判定**纯得可以单测**：
 * 「拖到右边变成并排、拖到下边变成叠放」错了，用户看到的是「我想分屏，它把文档挪走了」。
 */
export interface DropZone {
  group: string
  zone: DropZoneKind
  /**
   * 落到那一格的**第几个位置**（只在 zone 为 'center' 时有意义；null = 末尾）。
   * 拖到别的页签栏上时要按指针落在哪两个页签之间插进去，而不是一律排到最后。
   */
  index?: number | null
}

export type DropZoneKind = 'center' | 'left' | 'right' | 'top' | 'bottom'
