/**
 * 结构画布的**纯逻辑**门面（facade）。
 *
 * 实现拆在同目录的 structureView/ 下（纯搬运重构，原文件级说明随 deriveCanvas
 * 搬进了 structureView/derive.ts 的文件头）：
 * - cardMetrics.ts：卡片尺寸常量与「内容算高度」的高度公式；
 * - viewModel.ts：CardView 等视图模型类型；
 * - palette.ts：七种节点色板、目标项/连线锚与文本输入位判断；
 * - derive.ts：deriveCanvas——从 store 派生一张能画的图（v2 的心脏）；
 * - geometry.ts：连线几何与点选（hitTest / edgeCurve / 直角路由 A* / edgeAt 等）。
 *
 * 全部导出在这里**原名转发**，调用方（组件与 tests/structureView.test.ts 等）
 * 一律从本文件导入，不直接进子模块。
 */

export {
  OUTLINE_HEAD,
  SLOT_ROW,
  NOTE_ROW,
  CARD_FRAME_H,
  CARD_PAD_B,
  DOC_LINE_H,
  DOC_LINES,
  DOC_BODY_H,
  examCardHeight,
  EMPTY_OUTLINE_H,
  outlineCardHeight,
} from './structureView/cardMetrics'

export type {
  OutlineSlotView,
  CardView,
  ExamAttemptRow,
  CanvasEdge,
  CanvasView,
} from './structureView/viewModel'

export {
  KIND_TONE,
  KIND_BADGE,
  SLOT_ACCENT,
  EDGE_ANCHOR_Y,
  slotAnchorY,
  isTextEntryTarget,
} from './structureView/palette'

export { deriveCanvas } from './structureView/derive'

export {
  EDGE_CLEARANCE,
  EDGE_STUB,
  hitTest,
  edgeCurve,
  edgeElbow,
  edgeRoute,
  edgePathD,
  edgePointAt,
  edgeAt,
  edgeDots,
  edgeDotAt,
  type Point,
} from './structureView/geometry'
