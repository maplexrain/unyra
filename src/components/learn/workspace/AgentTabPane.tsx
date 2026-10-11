/*
 * 这个文件负责：**一枚常驻的导师页签面板**（memo 化的 Agent 面板宿主容器）。
 *
 * 为什么要 memo 化：文档区切换页签时会更新顶层 store，若不隔离，
 * 所有处于后台隐藏状态（hidden）以及当前未发生对话变动的 AgentPanel
 * 都会被迫触发全量重渲染（重新解析消息 Markdown、KaTeX 公式与定位条测量）。
 * 通过自定义 sameAgentTabPane 对比，将导师栏重渲染彻底与文档区页签切换隔离。
 */

import { memo, type ComponentProps } from 'react'
import AgentPanel from '../../agent/AgentPanel'

export type AgentPanelProps = ComponentProps<typeof AgentPanel>

export interface AgentTabPaneProps extends AgentPanelProps {
  tabKey: string
}

function sameAgentTabPane(prev: AgentTabPaneProps, next: AgentTabPaneProps): boolean {
  // 1. 激活状态或页签 key 改变时必须重渲染
  if (prev.active !== next.active || prev.tabKey !== next.tabKey) return false

  // 2. 隐藏（!next.active）的页签：只在影响后台运行的核心状态变动时才重绘
  if (!next.active) {
    return (
      prev.running === next.running &&
      prev.streaming === next.streaming &&
      prev.conversation === next.conversation &&
      prev.compacting === next.compacting
    )
  }

  // 3. 处于激活状态（next.active）的页签：
  // 当且仅当其核心数据或配置发生变化时才重渲染，避免文档区 Tab 切换等无关顶层重渲染传导进来
  return (
    prev.conversation === next.conversation &&
    prev.streaming === next.streaming &&
    prev.streamingMessageId === next.streamingMessageId &&
    prev.running === next.running &&
    prev.nodeTitle === next.nodeTitle &&
    prev.compacting === next.compacting &&
    prev.hasKey === next.hasKey &&
    prev.providerLabel === next.providerLabel &&
    prev.vision === next.vision &&
    prev.effort === next.effort &&
    prev.persona === next.persona &&
    prev.compactThreshold === next.compactThreshold &&
    prev.tps === next.tps &&
    prev.liveUsage === next.liveUsage &&
    prev.ask === next.ask &&
    prev.sub === next.sub &&
    prev.viewSubId === next.viewSubId
  )
}

export const AgentTabPane = memo(function AgentTabPane({
  tabKey,
  ...panelProps
}: AgentTabPaneProps) {
  return (
    <div
      key={tabKey}
      {...(panelProps.active ? { className: 'absolute inset-0' } : { hidden: true })}
    >
      <AgentPanel {...panelProps} />
    </div>
  )
}, sameAgentTabPane)
