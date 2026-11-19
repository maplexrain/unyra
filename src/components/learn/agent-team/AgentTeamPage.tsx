import { useState, useEffect, useCallback, useRef } from 'react'
import type { TeamAgent, TeamChatSelection, TeamMessage } from './types'
import {
  loadTeamAgents,
  saveTeamAgents,
  loadTeamMessages,
  saveTeamMessages,
  PRESET_SIMULATION_MESSAGES,
} from './agentTeamData'
import { AgentTeamRoster } from './AgentTeamRoster'
import { AgentTeamChat } from './AgentTeamChat'

export interface AgentTeamPageProps {
  goalId?: string
  goals?: Array<{ id: string; title?: string }>
  activeGoalId?: string | null
}

export default function AgentTeamPage({ goalId, goals, activeGoalId }: AgentTeamPageProps) {
  const activeGoal = goals?.find((g) => g.id === (goalId || activeGoalId))
  const goalTitle = activeGoal?.title

  const [agents, setAgents] = useState<TeamAgent[]>(() => loadTeamAgents(goalId))
  const [messages, setMessages] = useState<TeamMessage[]>(() => loadTeamMessages(goalId))
  const [selected, setSelected] = useState<TeamChatSelection>('group')
  const [isSimulating, setIsSimulating] = useState(false)
  const simulationTimeoutRef = useRef<number | null>(null)

  // 当 goalId 变化时重新加载数据
  useEffect(() => {
    setAgents(loadTeamAgents(goalId))
    setMessages(loadTeamMessages(goalId))
    setSelected('group')
  }, [goalId])

  // 持久化保存
  const handleUpdateAgents = useCallback(
    (newAgents: TeamAgent[]) => {
      setAgents(newAgents)
      saveTeamAgents(newAgents, goalId)
    },
    [goalId],
  )

  const handleUpdateMessages = useCallback(
    (newMessages: TeamMessage[]) => {
      setMessages(newMessages)
      saveTeamMessages(newMessages, goalId)
    },
    [goalId],
  )

  const handleAddAgent = (newAgent: TeamAgent) => {
    const updated = [...agents, newAgent]
    handleUpdateAgents(updated)
  }

  const handleDeleteAgent = (agentId: string) => {
    const updated = agents.filter((a) => a.id !== agentId)
    handleUpdateAgents(updated)
    if (selected === agentId) {
      setSelected('group')
    }
  }

  // 发送消息
  const handleSendMessage = (content: string, mentions?: string[]) => {
    const userMsg: TeamMessage = {
      id: `msg-${Date.now()}`,
      senderId: 'user',
      senderName: '学习者 (You)',
      avatar: '👤',
      content,
      timestamp: Date.now(),
      mentions,
      isGroupChat: selected === 'group',
      targetAgentId: selected === 'group' ? undefined : selected,
    }

    const nextMessages = [...messages, userMsg]
    handleUpdateMessages(nextMessages)

    // 智能体回应调度
    setTimeout(() => {
      if (selected === 'group') {
        // 群聊模式：根据 mentions 或默认主控导师回应
        let respondingAgent = agents[0] // 默认主控导师
        if (mentions && mentions.length > 0 && mentions[0] !== 'all') {
          const matched = agents.find((a) => a.id === mentions[0])
          if (matched) respondingAgent = matched
        }

        const replyMsg: TeamMessage = {
          id: `msg-${Date.now() + 1}`,
          senderId: respondingAgent.id,
          senderName: respondingAgent.name,
          senderRole: respondingAgent.role,
          avatar: respondingAgent.avatar,
          color: respondingAgent.color,
          thought: `[协同调度分析] 学习者提出了新任务需求：「${content.slice(0, 30)}...」。分析当前教学状态，分派各专业智能体跟进。`,
          content: `${respondingAgent.name} 已收到指令！\n\n针对「${content}」，我已与团队成员同步任务。我们将按照职责链路推进：首先由检索与概念提炼跟进，随后撰写结构化讲义并设计随堂自测。`,
          timestamp: Date.now(),
          isGroupChat: true,
        }
        handleUpdateMessages([...nextMessages, replyMsg])
      } else {
        // 1对1 模式：特定智能体专门回复
        const currentAgent = agents.find((a) => a.id === selected)
        if (!currentAgent) return

        const replyMsg: TeamMessage = {
          id: `msg-${Date.now() + 1}`,
          senderId: currentAgent.id,
          senderName: currentAgent.name,
          senderRole: currentAgent.role,
          avatar: currentAgent.avatar,
          color: currentAgent.color,
          content: `你好！我是负责【${currentAgent.role}】的 ${currentAgent.name}。\n\n针对你的任务：「${content}」，我将结合我的专长（${currentAgent.capabilities.join('、')}）为你提供全流程支持。`,
          timestamp: Date.now(),
          isGroupChat: false,
          targetAgentId: 'user',
        }
        handleUpdateMessages([...nextMessages, replyMsg])
      }
    }, 600)
  }

  // 模拟真实多智能体协作演练流程
  const handleSimulateWorkflow = () => {
    if (isSimulating) return
    setIsSimulating(true)

    // 清空现有消息，从头逐条播放 preset 演练
    handleUpdateMessages([])

    let step = 0
    const runNextStep = () => {
      if (step >= PRESET_SIMULATION_MESSAGES.length) {
        setIsSimulating(false)
        return
      }

      const msgToAdd = PRESET_SIMULATION_MESSAGES[step]
      setMessages((prev) => {
        const next = [...prev, msgToAdd]
        saveTeamMessages(next, goalId)
        return next
      })

      step++
      simulationTimeoutRef.current = window.setTimeout(runNextStep, 950)
    }

    simulationTimeoutRef.current = window.setTimeout(runNextStep, 300)
  }

  // 清除定时器
  useEffect(() => {
    return () => {
      if (simulationTimeoutRef.current) {
        clearTimeout(simulationTimeoutRef.current)
      }
    }
  }, [])

  const handleClearMessages = () => {
    handleUpdateMessages([])
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-paper select-text">
      {/* 左侧：聊天框 (群聊 / 私聊) */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        <AgentTeamChat
          selected={selected}
          agents={agents}
          messages={messages}
          onSendMessage={handleSendMessage}
          onSimulateWorkflow={handleSimulateWorkflow}
          isSimulating={isSimulating}
          onClearMessages={handleClearMessages}
          onBackToGroup={() => setSelected('group')}
          goalTitle={goalTitle}
        />
      </div>

      {/* 右侧：各个agent的列表（含置顶群聊） */}
      <div className="w-80 md:w-88 xl:w-96 shrink-0 h-full border-l border-line/70">
        <AgentTeamRoster
          agents={agents}
          selected={selected}
          onSelect={setSelected}
          onAddAgent={handleAddAgent}
          onDeleteAgent={handleDeleteAgent}
          goalTitle={goalTitle}
        />
      </div>
    </div>
  )
}
