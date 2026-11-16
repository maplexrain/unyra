/**
 * useTerminalKeyNav: 集成终端键盘导航、Tab补全轮换、历史翻滚与行内光标联动 Hook。
 */

import { useRef, type Dispatch, type SetStateAction } from 'react'
import { computeTabCompletions } from './terminalPath'
import type { TerminalSession } from './TerminalTabPane'

interface UseTerminalKeyNavParams {
  activeSession: TerminalSession
  setSessions: Dispatch<SetStateAction<TerminalSession[]>>
  isWindows: boolean
  onExecute: (cmd: string) => void
  onInterrupt: () => void
  onClearScreen: () => void
}

export function useTerminalKeyNav({
  activeSession,
  setSessions,
  isWindows,
  onExecute,
  onInterrupt,
  onClearScreen,
}: UseTerminalKeyNavParams) {
  // Tab 补全循环状态跟踪
  const tabCycleRef = useRef<{
    tokenStart: number
    tokenEnd: number
    candidates: string[]
    candidateIdx: number
    originalInput: string
  } | null>(null)

  const resetTabCycle = () => {
    tabCycleRef.current = null
  }

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 若当前正在执行前台命令，仅允许 Ctrl+C 中断，屏蔽其余输入
    if (activeSession.runningPid) {
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        onInterrupt()
      }
      return
    }

    // Tab: 原生文件名与目录自动补全
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()

      // 若处于轮换补全状态中，继续向后/向前轮换候选
      if (tabCycleRef.current && tabCycleRef.current.candidates.length > 1) {
        const state = tabCycleRef.current
        const delta = e.shiftKey ? -1 : 1
        const nextIdx =
          (state.candidateIdx + delta + state.candidates.length) % state.candidates.length
        const cand = state.candidates[nextIdx]
        const newInput =
          state.originalInput.slice(0, state.tokenStart) +
          cand +
          state.originalInput.slice(state.tokenEnd)
        const nextCursor = state.tokenStart + cand.length
        state.candidateIdx = nextIdx
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id ? { ...s, inputVal: newInput, cursorPos: nextCursor } : s,
          ),
        )
        return
      }

      // 首次触发 Tab 补全
      const comp = await computeTabCompletions(
        activeSession.inputVal,
        activeSession.cursorPos,
        activeSession.cwd,
        isWindows,
      )

      if (comp && comp.candidates.length > 0) {
        const firstCand = comp.candidates[0]
        const newInput =
          activeSession.inputVal.slice(0, comp.tokenStart) +
          firstCand +
          activeSession.inputVal.slice(comp.tokenEnd)
        const nextCursor = comp.tokenStart + firstCand.length
        tabCycleRef.current = {
          tokenStart: comp.tokenStart,
          tokenEnd: comp.tokenEnd,
          candidates: comp.candidates,
          candidateIdx: 0,
          originalInput: activeSession.inputVal,
        }
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id ? { ...s, inputVal: newInput, cursorPos: nextCursor } : s,
          ),
        )
      }
      return
    }

    // 非 Tab 键清空当前补全轮换状态
    tabCycleRef.current = null

    // Ctrl+C: 如果页面有文字选区则放行复制；否则触发终端中断
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) {
        return
      }
      e.preventDefault()
      onInterrupt()
      return
    }

    // Ctrl+L: 清屏
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault()
      onClearScreen()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onExecute(activeSession.inputVal)
      return
    }

    // Up: 历史向前
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (activeSession.history.length === 0) return
      const nextIdx =
        activeSession.historyIdx < 0
          ? activeSession.history.length - 1
          : Math.max(0, activeSession.historyIdx - 1)
      const val = activeSession.history[nextIdx] || ''
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? { ...s, historyIdx: nextIdx, inputVal: val, cursorPos: val.length }
            : s,
        ),
      )
      return
    }

    // Down: 历史向后
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (activeSession.history.length === 0 || activeSession.historyIdx < 0) return
      const nextIdx = activeSession.historyIdx + 1
      if (nextIdx >= activeSession.history.length) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, historyIdx: -1, inputVal: '', cursorPos: 0 }
              : s,
          ),
        )
      } else {
        const val = activeSession.history[nextIdx] || ''
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeSession.id
              ? { ...s, historyIdx: nextIdx, inputVal: val, cursorPos: val.length }
              : s,
          ),
        )
      }
      return
    }

    // 左右键与 Home/End 实时同步行内光标
    if (e.key === 'ArrowLeft') {
      const nextPos = Math.max(0, activeSession.cursorPos - 1)
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, cursorPos: nextPos } : s)),
      )
      return
    }

    if (e.key === 'ArrowRight') {
      const nextPos = Math.min(activeSession.inputVal.length, activeSession.cursorPos + 1)
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, cursorPos: nextPos } : s)),
      )
      return
    }

    if (e.key === 'Home') {
      setSessions((prev) =>
        prev.map((s) => (s.id === activeSession.id ? { ...s, cursorPos: 0 } : s)),
      )
      return
    }

    if (e.key === 'End') {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id ? { ...s, cursorPos: s.inputVal.length } : s,
        ),
      )
      return
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (activeSession.runningPid) return
    tabCycleRef.current = null
    const val = e.target.value
    const pos = e.target.selectionStart
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, inputVal: val, cursorPos: pos } : s,
      ),
    )
  }

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (activeSession.runningPid) return
    const target = e.currentTarget
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeSession.id ? { ...s, cursorPos: target.selectionStart } : s,
      ),
    )
  }

  return {
    handleKeyDown,
    handleInputChange,
    handleSelect,
    resetTabCycle,
  }
}
