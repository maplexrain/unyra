import { useCallback, useEffect, useRef, useState } from 'react'
import type { LearnStore } from '../../../learn/types'
import { native } from '../../../lib/native'

/** 轨迹窗需要的宿主能力 */
export interface TraceWindowDeps {
  store: LearnStore
}

/**
 * 上下文轨迹：**独立的 Electron 窗口**（与考试窗口同一套结构，见 electron/app/traceWindow）。
 * 主窗口是数据拥有者：打开时把当前激活会话整份递过去，开着期间随数据变化持续 push；
 * 窗口关掉（onClosed）就停。轨迹是只读的，那边没有任何回发通道。
 */
export function useTraceWindow({ store }: TraceWindowDeps) {
  const [traceWinOpen, setTraceWinOpen] = useState(false)
  const storeConvRef = useRef(store)
  storeConvRef.current = store
  const openContextTrace = useCallback(() => {
    const s = storeConvRef.current
    const conv = s.conversations.find((c) => c.id === s.activeConversationId) ?? null
    void native()
      .traceHost.open(conv)
      .then((r) => {
        if (r.ok) setTraceWinOpen(true)
      })
      .catch(() => {})
  }, [])
  // 窗口开着：会话数据一变就推一份（activate 会话切换、流式里程碑落库都会走到）
  useEffect(() => {
    if (!traceWinOpen) return
    const s = storeConvRef.current
    native()
      .traceHost.push(s.conversations.find((c) => c.id === s.activeConversationId) ?? null)
    // 依赖里不放 store 整体（每次轮转都换引用）——只盯 conversations 与激活会话两个字段
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceWinOpen, store.conversations, store.activeConversationId])
  useEffect(() => native().traceHost.onClosed(() => setTraceWinOpen(false)), [])

  return { traceWinOpen, openContextTrace }
}
