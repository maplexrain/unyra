/**
 * 卡片尺寸常量与「内容算高度」的高度公式：大纲卡 / 文档卡 / 试卷卡各多高，
 * 全部由内容行数算出来。从 structureView.ts 拆出（纯搬运，逻辑与注释原样）。
 */

import { CARD_H } from '../../../../learn/structure'

/* ---------- 卡片尺寸常量（内容算高度，不进数据） ---------- */

/** 大纲卡片的标题行高度（含上下 padding） */
export const OUTLINE_HEAD = 44
/** 每一行目标项的高度 */
export const SLOT_ROW = 22
/** 卡片底部那条注释标签的高度 */
export const NOTE_ROW = 20
/** 卡片上下边框的合计厚度（卡片是 border-box，算内容时先还回去） */
export const CARD_FRAME_H = 2
/** 卡片内容与下边框之间的留白（与组件里的 padding 保持一致） */
export const CARD_PAD_B = 8
/** 摘要每行的行高（显式钉住，比例值会带小数、与整数卡片高度对不上） */
export const DOC_LINE_H = 15
/** 有正文的文档卡固定两行摘要 */
export const DOC_LINES = 2
/** 有正文的文档卡：边框 + 标题行 + 两行摘要 + 底部内边距 */
export const DOC_BODY_H = CARD_FRAME_H + OUTLINE_HEAD + DOC_LINES * DOC_LINE_H + CARD_PAD_B

/** 带总结的笔记卡：250 是**最大高度**不是固定高度——真实渲染高度由 CSS 决定
 *  （内容自然长高、maxHeight 封顶、超出卡内滚动）；这个估算只喂自动排布的碰撞检测 */
export const NOTE_SUMMARY_CARD_H = 250

export function noteCardHeight(hasSummary: boolean, summaryChars = 0): number {
  if (!hasSummary) return CARD_H
  // 标题行 + 内边距 + 按 ~22 字/行估的总结行数（宁高勿低：排布多留空隙好过卡片重叠）
  const lines = Math.max(1, Math.ceil(summaryChars / 22))
  return Math.min(NOTE_SUMMARY_CARD_H, OUTLINE_HEAD + 14 + lines * 14 + CARD_FRAME_H)
}

/** 试卷卡有多高：边框 + 标题行 + 头部考试按钮行 + 每条考试记录一行 + 内边距（没有记录就是标准高度） */
export function examCardHeight(rows: number): number {
  if (!rows) return CARD_H
  return Math.max(CARD_FRAME_H + OUTLINE_HEAD + (rows + 1) * SLOT_ROW + CARD_PAD_B, CARD_H)
}

/** 空大纲卡的高度：边框 + 标题行 + 生成总览行(24) + gap(4) + 底部添加目标项(22) + 内边距(8) */
export const EMPTY_OUTLINE_H = CARD_FRAME_H + OUTLINE_HEAD + 24 + 4 + SLOT_ROW + CARD_PAD_B // 104

/** 大纲卡有多高：边框 + 标题行 + 每条目标项一行 + 底部「＋ 添加目标项」一行 + 内边距 */
export function outlineCardHeight(count: number): number {
  if (!count) return EMPTY_OUTLINE_H
  return Math.max(CARD_FRAME_H + OUTLINE_HEAD + (count + 1) * SLOT_ROW + CARD_PAD_B, CARD_H)
}
