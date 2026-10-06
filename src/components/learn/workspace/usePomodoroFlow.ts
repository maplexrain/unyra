/*
 * 这个文件负责：番茄钟的动作——开始、停止、暂停、恢复、到点收尾。
 *
 * 时钟本身在顶栏的 PomodoroDock 里每秒自己走（它只重渲染那一小块），
 * 这里只有「用户按下」「到点了」「守卫判离开/回来了」这几个时机碰 store。
 * tick 由 Dock 的 effect 调而不是 setTimeout：关掉应用再打开、机器睡一觉醒来，
 * 都靠它把状态补齐。暂停的语义见 learn/pomodoro 的文件头——它只属于守卫。
 */

import { useCallback } from 'react'
import type { LearnStore } from '../../../learn/types'
import {
  emptyPomodoro,
  pausePomodoro,
  restMsOf,
  resumePomodoro,
  startPomodoro,
  stopPomodoro,
  tickPomodoro,
  type PomodoroTick,
} from '../../../learn/pomodoro'
import { t } from '../../../i18n'

/** 番茄钟动作需要的宿主能力 */
export interface PomodoroFlowDeps {
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  onToast: (msg: string) => void
}

/** 番茄钟的全部动作：顶栏的 PomodoroDock、守卫运行时与快捷键各取所需。 */
export function usePomodoroFlow({ getLatest, set, onToast }: PomodoroFlowDeps) {
  /**
   * 开始一次专注。**只有用户点得动它**——agent 那边只有只读的 pomodoro.status，
   * 这条边界写在 learn/pomodoro 的文件头。
   */
  const startFocus = useCallback(
    (focusMinutes: number, groups: number) => {
      const s = getLatest()
      set({ ...s, pomodoro: startPomodoro(s.pomodoro ?? emptyPomodoro(), { focusMinutes, groups }).store })
    },
    [getLatest, set],
  )

  /** 停止：这一段作废（不记账）。用户手里没有暂停——暂停只属于守卫，要接着跑只能重新开始 */
  const stopFocus = useCallback(() => {
    const s = getLatest()
    set({ ...s, pomodoro: stopPomodoro(s.pomodoro ?? emptyPomodoro()) })
  }, [getLatest, set])

  /** 守卫判「人不在」：计时与这一段一起冻结（界面上没有按钮能触发它） */
  const pauseFocus = useCallback(() => {
    const s = getLatest()
    set({ ...s, pomodoro: pausePomodoro(s.pomodoro ?? emptyPomodoro()) })
  }, [getLatest, set])

  /** 回到屏幕前（守卫收到交互）：把暂停的时长从这一段里扣掉，接着走 */
  const resumeFocus = useCallback(() => {
    const s = getLatest()
    set({ ...s, pomodoro: resumePomodoro(s.pomodoro ?? emptyPomodoro()) })
  }, [getLatest, set])

  /**
   * 到点收尾：记下跑完的专注段、翻到休息或下一组、组数跑完就结束。
   *
   * 由顶栏那块每秒的钟发现「已经到点」时调用（见 PomodoroDock 的 effect），而不是 setTimeout：
   * 关掉应用再打开、机器睡一觉醒来，都靠它把状态补到与墙上时钟对齐（见 learn/pomodoro 的 tickPomodoro）。
   * 返回这次收尾的结果（finished / dropped），编排层据此决定要不要写专注报告。
   */
  const tickFocus = useCallback((): PomodoroTick => {
    const s = getLatest()
    const out = tickPomodoro(s.pomodoro ?? emptyPomodoro())
    // 没发生任何事时 tickPomodoro 原样返回同一个对象：那就一个字节都不写
    if (out.store !== s.pomodoro) set({ ...s, pomodoro: out.store })
    const last = out.records[0]
    if (last) {
      onToast(
        out.finished
          ? t('第 {0}/{1} 组专注结束——都跑完了，起来走两步', last.index, last.groups)
          : t('第 {0}/{1} 组专注结束——休息 {2} 分钟', last.index, last.groups, Math.round(restMsOf(last.minutes) / 60_000)),
      )
    } else if (out.dropped) {
      onToast(t('番茄钟停太久了（那段时间应用不在），这一次不算数'))
    }
    return out
  }, [getLatest, set, onToast])

  return { startFocus, stopFocus, pauseFocus, resumeFocus, tickFocus }
}
