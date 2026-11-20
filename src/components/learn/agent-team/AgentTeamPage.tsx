/**
 * 智能体团队页签（AgentPanel 的 Tab 页宿主）
 *
 * 直接承载原版 AgentSlot（页签条 + 保活 AgentTabPane），替代原本的右侧栏，
 * 所有工作流、快速提问与单导师对话统一收口于此。
 */

import { useEffect } from 'react'
import { AgentSlot, type AgentSlotDeps } from '../workspace/AgentSlot'

export interface AgentTeamPageProps {
  active?: boolean
  focused?: boolean
  agentSlotDeps: AgentSlotDeps
}

export default function AgentTeamPage({
  active,
  focused,
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
      className="flex h-full w-full flex-col overflow-hidden bg-paper select-text"
    >
      <AgentSlot deps={{ ...agentSlotDeps, tabActive: active ?? true }} />
    </div>
  )
}
