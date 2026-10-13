/**
 * 本文件负责：思维导图里「看着某个节点」的那两件事——**镜头落在哪**与**连线通向哪**。
 *
 * 为什么单独一个文件而不是写在 MindmapView 里：
 *
 * 1. **不制造「组件文件导出非组件」**（oxlint 的 react/only-export-components）。
 *    这个规矩在这个仓库里是当真的——explorer/types.ts 与 outline/mindmapTint.ts
 *    都是为它单独拆出来的文件。
 * 2. 它是**能单测的算术**，而且是用户点名要的两条行为（相机 100% 居中、
 *    点线跳到另一端）。钉在 tests/outlineMindmap.test.ts 里，
 *    以后谁「顺手再优化一下」把它改回去了，测试会拦下来。
 *
 * 两件事都不碰 React，只吃数字与 id。
 */

/** 画布视口尺寸（容器量出来的那一块） */
export interface ViewSize {
  width: number
  height: number
}

/**
 * 选中一个节点时相机缩放到的倍数（需求：「选中时的相机缩放加到一百二」）。
 *
 * 比 100% 略大一档：选中的那个是「现在要读的」，放大一点看得清；同时又还留得住
 * 左右邻居的一角，不至于像放到 200% 那样满屏只剩一张卡片、反而弄丢了自己在图上的位置。
 *
 * 和 centerPanFor 住在一起：缩放与「居中要多少平移」是同一件事的两半，
 * 分成两个文件放迟早会出现「这边改成 1.2、那边还按 1 算」——那正是图像偏掉的经典成因。
 */
export const SELECT_ZOOM = 1.2

/**
 * 把一块矩形摆到视口**正中**所需要的平移量。
 *
 * 需求原文：「选中节点的调节镜头改一下，改为 100% 缩放，节点显示在垂直和水平居中位置」，
 * 后来又改成「选中时的相机缩放加到一百二」——所以缩放是个参数，调用方给 1.2。
 *
 * 算式只有一条：「矩形的中心点」与「视口的中心点」重合。缩放的参与方式是
 * **先缩放再平移**（元素在 `scale(z)` 之下，世界坐标乘 z 才是屏幕坐标），
 * 于是目标的中心在屏幕上落在 `中心*z + pan`，让它等于视口中心即得：
 *
 *   pan = 视口中心 - 目标中心 * z
 *
 * 忘了乘这个 z，放大之后就会明显偏（z=1 时恰好看不出来，是最容易蒙混过关的一档）。
 */
export function centerPanFor(
  box: { x: number; y: number; width: number; height: number },
  view: ViewSize,
  zoom = 1,
): { x: number; y: number } {
  return {
    x: view.width / 2 - (box.x + box.width / 2) * zoom,
    y: view.height / 2 - (box.y + box.height / 2) * zoom,
  }
}

/**
 * 点一条连线该跳到**哪一端**。
 *
 * 需求原文：「如果点击当前节点连接的线段，会自动跳到线段的另一端」。于是同一条线
 * 在两个方向上给出两个结果：选中父节点时点它 → 去子节点（顺着路线往下走），
 * 选中子节点时点它 → 回父节点（往上退一层）。点线即「沿这条线走一步」。
 *
 * 没有选中任何节点、或这条线跟选中的那个不相连时，一律往**下游**走：线长在父与子之间，
 * 而读路线的主方向是往下展开。
 *
 * 这个判断同时被 click 与 tooltip 用（tooltip 上先把答案说了，用户不必点一下才知道去哪儿），
 * 所以它必须是同一个函数——两处各写一遍，改一处漏一处的时候就该出现
 * 「写着去 A、点了去 B」。
 */
export function edgeOtherEnd(edge: { from: string; to: string }, selectedId: string | null): string {
  if (selectedId === edge.from) return edge.to
  if (selectedId === edge.to) return edge.from
  return edge.to
}
