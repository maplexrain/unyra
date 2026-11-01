/*
 * 这个文件负责：顶栏「今天还有什么」的数据接线（ScheduleDock）。
 *
 * 它是个「自给自足的小块」：时钟只在这一块里走，不会把整个学习区（正文 + 对话栏）
 * 一起带上；数据仍然来自 store（它是唯一真相），这里只负责算成按钮要的形状。
 */

import { useMemo } from 'react'
import type { LearnStore } from '../../../learn/types'
import ScheduleButton from '../ScheduleButton'
import { todayItems, type ScheduleItem } from '../../../learn/schedule'
import { useClock } from '../../../lib/clock'

/**
 * 日程入口的数据接线。
 *
 * 它是「自给自足的小块」：时钟只在这一块里走（30 秒一拍，够翻日界与
 * 把「已错过」算准），今日清单由 store 现算——store 变了（用户或 agent 排了一条）
 * 这块自然跟着重画，正文与对话栏不受影响。
 *
 * 正在响的那一条由工作区的提醒引擎传进来（它有自己的 1 秒节拍，见 useScheduleFlow）：
 * 这一块只负责画，不判断「该不该响」。
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
