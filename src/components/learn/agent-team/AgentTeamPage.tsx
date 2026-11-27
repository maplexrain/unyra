/**
 * 智能体团队页签（AgentPanel 的 Tab 页宿主）
 *
 * 直接承载原版 AgentSlot（页签条 + 保活 AgentTabPane），替代原本的右侧栏，
 * 所有工作流、快速提问与单导师对话统一收口于此。
 */

import { useEffect } from 'react'
import { AgentSlot, type AgentSlotDeps } from '../workspace/AgentSlot'
import AgentBrowserDock from './AgentBrowserDock'

export interface AgentTeamPageProps {
  active?: boolean
  focused?: boolean
  goalId?: string
  /** 是否持久化左侧列表/右侧历史栏的折叠状态（在 `:side` / `:fixside` 中传入 false，避免串扰原页签） */
  persistLayout?: boolean
  agentSlotDeps: AgentSlotDeps
}

export default function AgentTeamPage({
  active,
  focused,
  goalId,
  persistLayout,
  agentSlotDeps,
}: AgentTeamPageProps) {
  const isFocused = focused ?? active ?? true

  // 清除任何可能残留的 Browse Vim 虚拟平滑光标与拖尾
  useEffect(() => {
    if (!isFocused) return
    const clearVimCursors = () => {
      document
        .querySelectorAll(
          '.moji-browse-virtual-cursor, .moji-browse-cursor-trail, .moji-browse-speed-line',
        )
        .forEach((el) => el.remove())
    }
    clearVimCursors()
    const timer = setTimeout(clearVimCursors, 60)
    return () => {
      clearTimeout(timer)
    }
  }, [isFocused])

  return (
    <div
      data-agent-team-page={isFocused ? 'true' : undefined}
      className="relative flex h-full w-full flex-col overflow-hidden bg-paper select-text"
    >
      <AgentSlot
        deps={{
          ...agentSlotDeps,
          tabActive: active ?? true,
          ...(goalId ? { tabGoalId: goalId } : {}),
          ...(persistLayout !== undefined ? { persistLayout } : {}),
        }}
      />
      <AgentBrowserDock goalId={goalId} focused={isFocused} />
    </div>
  )
}
