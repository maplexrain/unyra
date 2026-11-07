/*
 * 本文件负责：考试期间的**切屏监听**——window 的 blur / focus 两个事件。
 *
 * 记录语义（敏感区）：只有 `running`（正在考试）期间的失焦与回焦才算切屏，每次都把
 * 时间戳原样 emit 回主窗口（blurStart / blurEnd）落盘；次数与时长都由主窗口那边
 * 记录、留给导师看——这一侧不汇总、不下结论、也不打扰用户。intro（还没开考）与
 * settled（已收尾）阶段的焦点变化不记录。
 *
 * 原样搬自 ExamWindow.tsx 的「切屏监听」区块（注释一并带走），按本仓库惯例收成
 * XxxDeps 单对象的逻辑 hook；宿主（useExamSession）把桥与 running 传进来。
 */
import { useEffect, useRef } from 'react'
import type { NativeBridge } from '../../lib/native'

/** 切屏守卫需要宿主提供的最小能力 */
export interface ExamGuardDeps {
  /** 考试窗口那一侧的桥：blurStart / blurEnd 从这里 emit 回主窗口 */
  guest: NativeBridge['examGuest'] | null
  /** 是否正在考试（只有 running 期间的焦点变化才算切屏） */
  running: boolean
}

/* ---------- 切屏监听 ---------- */

export function useExamGuard({ guest, running }: ExamGuardDeps): void {
  const focusedRef = useRef(true)

  useEffect(() => {
    const onBlur = (): void => {
      focusedRef.current = false
      if (running) guest?.emit({ type: 'blurStart', at: Date.now() })
    }
    const onFocus = (): void => {
      focusedRef.current = true
      if (running) guest?.emit({ type: 'blurEnd', at: Date.now() })
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [guest, running])
}
