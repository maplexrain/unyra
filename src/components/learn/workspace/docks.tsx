/*
 * 这个文件负责：顶栏「实用工具」与「日程」的数据接线（ToolsDock / ScheduleDock）。
 *
 * 它是个「自给自足的小块」：时钟只在这一块里走，不会把整个学习区（正文 + 对话栏）
 * 一起带上；数据仍然来自 store（它是唯一真相），这里只负责算成按钮要的形状。
 */

import { useMemo } from 'react'
import type { LearnStore } from '../../../learn/types'
import ScheduleButton from '../ScheduleButton'
import ToolsButton from '../../tools/ToolsButton'
import { todayItems, type ScheduleItem } from '../../../learn/schedule'
import { useClock } from '../../../lib/clock'

/**
 * 工具箱入口的数据接线（整合截图、日程与计算器）。
 */
export function ToolsDock({
  store,
  ringing,
  onOpenSchedule,
  onCompleteSchedule,
  onSnoozeSchedule,
  onScreenshot,
  onToast,
}: {
  store: LearnStore
  ringing: ScheduleItem | null
  onOpenSchedule: () => void
  onCompleteSchedule: (id: string) => void
  onSnoozeSchedule: (id: string, minutes: number) => void
  onScreenshot: () => void
  onToast?: (msg: string) => void
}) {
  const now = useClock(30_000)
  const today = useMemo(() => todayItems(store, now), [store, now])
  return (
    <ToolsButton
      onScreenshot={onScreenshot}
      onToast={onToast}
      schedule={{
        today,
        now,
        ringing,
        onOpen: onOpenSchedule,
        onComplete: onCompleteSchedule,
        onSnooze: onSnoozeSchedule,
      }}
    />
  )
}

/**
 * 日程入口的数据接线（保留向下兼容）。
 */
export function ScheduleDock({
  store,
  ringing,
  onOpen,
  onComplete,
  onSnooze,
}: {
  store: LearnStore
  ringing: ScheduleItem | null
  onOpen: () => void
  onComplete: (id: string) => void
  onSnooze: (id: string, minutes: number) => void
}) {
  const now = useClock(30_000)
  const today = useMemo(() => todayItems(store, now), [store, now])
  return (
    <ScheduleButton
      today={today}
      now={now}
      ringing={ringing}
      onOpen={onOpen}
      onComplete={onComplete}
      onSnooze={onSnooze}
    />
  )
}
