/**
 * 画布的呈现常量与两个纯函数：七种节点的色板（KIND_TONE / KIND_BADGE）、
 * 目标项强调色、连线锚（EDGE_ANCHOR_Y / slotAnchorY）、
 * 以及「事件目标是不是文本输入位」。从 structureView.ts 拆出（纯搬运，逻辑与注释原样）。
 */

import type { GNodeKind } from '../../../../learn/nodeKinds'
import { OUTLINE_HEAD, SLOT_ROW } from './cardMetrics'

/* ---------- 色板（七种节点） ---------- */

export const KIND_TONE: Record<GNodeKind, string> = {
  entry: 'border-rose-500/35 bg-rose-500/[0.06]',
  outline: 'border-seal/35 bg-seal/[0.06]',
  doc: 'border-sky-500/30 bg-sky-500/[0.06]',
  note: 'border-emerald-500/30 bg-emerald-500/[0.06]',
  exam: 'border-amber-500/30 bg-amber-500/[0.06]',
  superdoc: 'border-violet-500/30 bg-violet-500/[0.06]',
  video: 'border-pink-500/30 bg-pink-500/[0.06]',
  project: 'border-teal-500/30 bg-teal-500/[0.06]',
  file: 'border-blue-500/30 bg-blue-500/[0.06]',
}

export const KIND_BADGE: Record<GNodeKind, string> = {
  entry: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  outline: 'bg-seal/15 text-seal-deep',
  doc: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  note: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  exam: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  superdoc: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  video: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  project: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  file: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
}

/** 目标项圆点与它的连线只用这一个颜色：颜色在图上只承载一个含义「来自某条目标项」 */
export const SLOT_ACCENT = 'var(--color-seal, #a8432f)'

/** 连线从卡片**顶部往下多少**出线（固定值：线落在一条齐平的横带上） */
export const EDGE_ANCHOR_Y = 34

/** 某条目标项在卡片里的中心 y（连线的大纲那一端要对准这一行） */
export function slotAnchorY(index: number): number {
  return OUTLINE_HEAD + index * SLOT_ROW + SLOT_ROW / 2
}

/**
 * 事件目标是不是文本输入位（输入框 / 多行框 / 可编辑区）。
 * 画布把 Delete、Ctrl+Z 这类键接在容器上，不先认出「正在打字」，注释里按个退格就会删掉节点。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true)
}
