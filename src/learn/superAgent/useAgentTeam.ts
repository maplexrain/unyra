/**
 * useAgentTeam: 面向 React UI 的多 Agent 团队协作 Hook
 *
 * 职责：
 * 1. 批量管理 5 位专业 Agent 与 TeamBus 实例的生命周期；
 * 2. 状态不可变投影：各专家的独立 hostMessages, streaming, workers, mailbox 与黑板；
 * 3. 实时多 Agent 流式事件分流；
 * 4. 自动防抖分文件落盘与离开/切换目标时立即 flush 保护。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hasApiKey, loadAiSettings, resolveGlobal, type AiSettings } from '../../ai/settings'
import { resetPrefixGate } from '../../agent/prefixGate'
import { TeamBus } from '../../agent/team/teamBus'
import { DEFAULT_TEAM_PROFILES } from '../../agent/team/presets'
import type {
  TeamAgentProfile,
  TeamState,
} from '../../agent/team/types'
import type {
  BlackboardEntry,
  SuperAgentEvent,
  SuperAgentState,
  WorkerSession,
} from '../../agent/super/types'
import type { AgentPart, ConversationMessage } from '../../agent/types'
import type { LearnStore } from '../types'
import {
  flushTeamAgentState,
  flushTeamState,
  loadTeamAgentState,
  loadTeamState,
  saveTeamAgentState,
  saveTeamState,
} from './persist'
import { createSuperWorkerTools } from './workerRig'
import { t } from '../../i18n'

export interface UseAgentTeamOptions {
  scopeId: string
  goalTitle?: string
  store?: LearnStore
  getLatest?: () => LearnStore
  set?: (s: LearnStore) => void
  nodeId?: string | null
  aiSettings?: AiSettings
  onToast?: (msg: string) => void
}

export interface HostStreamingSlot {
  thinking: string
  text: string
  activeTool?: string
}

export interface WorkerStreamSlot {
  mind: AgentPart[]
  chat: string
  hop: number
}

export interface AgentViewSnapshot {
  profile: TeamAgentProfile
  state: SuperAgentState
  hostMessages: ConversationMessage[]
  hostStreaming: HostStreamingSlot | null
  hostRunning: boolean
  workers: WorkerSession[]
  workerStreams: Record<string, WorkerStreamSlot>
  mailboxCount: number
  blackboard: BlackboardEntry[]
  waitingWorkersCount: number
  runningWorkersCount: number
}

export function useAgentTeam(options: UseAgentTeamOptions) {
  const {
    scopeId,
    goalTitle,
    store: _store,
    getLatest,
    set,
    nodeId,
    aiSettings: propAiSettings,
    onToast,
  } = options

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamState, setTeamState] = useState<TeamState | null>(null)
  const [agentStates, setAgentStates] = useState<Record<string, SuperAgentState>>({})
  const [hostRunningMap, setHostRunningMap] = useState<Record<string, boolean>>({})
  const [hostStreamingMap, setHostStreamingMap] = useState<Record<string, HostStreamingSlot | null>>({})
  const [workerStreamsMap, setWorkerStreamsMap] = useState<Record<string, Record<string, WorkerStreamSlot>>>({})

  const teamBusRef = useRef<TeamBus | null>(null)
  const scopeIdRef = useRef(scopeId)
  scopeIdRef.current = scopeId

  const resolvedAi = useMemo(() => {
    const s = propAiSettings ?? loadAiSettings()
    return resolveGlobal(s)
  }, [propAiSettings])

  // 初始化或切换 scope 时载入团队状态
  useEffect(() => {
    let cancelled = false
    const sid = scopeId

    async function init() {
      setReady(false)
      setError(null)
      setHostRunningMap({})
      setHostStreamingMap({})
      setWorkerStreamsMap({})

      // 切换目标前 flush 旧数据
      if (teamBusRef.current) {
        const oldSid = teamBusRef.current.getScopeId()
        await flushTeamState(oldSid)
        for (const p of DEFAULT_TEAM_PROFILES) {
          await flushTeamAgentState(oldSid, p.id)
        }
      }

      // 1. 载入团队总状态
      const loadedTeam = (await loadTeamState(sid)) || {
        scopeId: sid,
        agents: [...DEFAULT_TEAM_PROFILES],
        channelMessages: [],
        delegations: {},
        updatedAt: Date.now(),
      }

      // 2. 并行载入 5 位专家的各自持久化状态
      const initialAgentStates: Record<string, SuperAgentState> = {}
      for (const p of DEFAULT_TEAM_PROFILES) {
        const agState = await loadTeamAgentState(sid, p.id)
        initialAgentStates[p.id] = agState
      }

      if (cancelled) return

      // 3. 构建 TeamBus
      const bus = new TeamBus({
        scopeId: sid,
        profiles: DEFAULT_TEAM_PROFILES,
        provider: resolvedAi.provider,
        model: resolvedAi.model,
        effort: resolvedAi.effort,
        initialState: loadedTeam,
        agentInitialStates: initialAgentStates,
        createWorkerTools: (_agentId, _workerId, allowedGroups) => {
          return createSuperWorkerTools({
            getLatest,
            set,
            goalId: sid,
            nodeId,
            allowedGroups,
          })
        },
        onStateChange: (updatedTeam) => {
          setTeamState({
            ...updatedTeam,
            channelMessages: [...updatedTeam.channelMessages],
            delegations: { ...updatedTeam.delegations },
          })
          saveTeamState(sid, updatedTeam)
        },
        onAgentStateChange: (agentId, updatedAgentState) => {
          setAgentStates((prev) => ({
            ...prev,
            [agentId]: {
              ...updatedAgentState,
              hostMessages: [...updatedAgentState.hostMessages],
              workers: { ...updatedAgentState.workers },
              mailbox: [...updatedAgentState.mailbox],
              blackboard: [...updatedAgentState.blackboard],
            },
          }))
          saveTeamAgentState(sid, agentId, updatedAgentState)
        },
        onAgentEvent: (agentId, e: SuperAgentEvent) => {
          handleAgentEvent(agentId, e)
        },
      })

      teamBusRef.current = bus
      setTeamState(bus.getTeamState())
      setAgentStates(initialAgentStates)
      setReady(true)
    }

    void init()

    return () => {
      cancelled = true
      if (teamBusRef.current) {
        void flushTeamState(sid)
        for (const p of DEFAULT_TEAM_PROFILES) {
          void flushTeamAgentState(sid, p.id)
        }
      }
    }
  }, [scopeId, goalTitle, getLatest, set, nodeId, resolvedAi])

  // 处理每个 Agent 的实时流式事件
  const handleAgentEvent = useCallback((agentId: string, e: SuperAgentEvent) => {
    if (e.type === 'host-start') {
      setHostRunningMap((prev) => ({ ...prev, [agentId]: true }))
    } else if (e.type === 'host-thinking') {
      setHostStreamingMap((prev) => {
        const cur = prev[agentId] || { thinking: '', text: '' }
        return { ...prev, [agentId]: { ...cur, thinking: cur.thinking + e.delta } }
      })
    } else if (e.type === 'host-text-delta') {
      setHostStreamingMap((prev) => {
        const cur = prev[agentId] || { thinking: '', text: '' }
        return { ...prev, [agentId]: { ...cur, text: cur.text + e.delta } }
      })
    } else if (e.type === 'host-tool-call') {
      setHostStreamingMap((prev) => {
        const cur = prev[agentId] || { thinking: '', text: '' }
        return { ...prev, [agentId]: { ...cur, activeTool: e.name } }
      })
    } else if (e.type === 'host-tool-result') {
      setHostStreamingMap((prev) => {
        const cur = prev[agentId] || { thinking: '', text: '' }
        return { ...prev, [agentId]: { ...cur, activeTool: undefined } }
      })
    } else if (e.type === 'host-done') {
      setHostStreamingMap((prev) => ({ ...prev, [agentId]: null }))
      setHostRunningMap((prev) => ({ ...prev, [agentId]: false }))
      if (e.error) {
        setError(e.error)
        onToast?.(e.error)
      }
    } else if (e.type === 'worker-chat-delta') {
      setWorkerStreamsMap((prev) => {
        const agMap = prev[agentId] || {}
        const cur = agMap[e.workerId] || { mind: [], chat: '', hop: e.hop ?? 1 }
        return {
          ...prev,
          [agentId]: {
            ...agMap,
            [e.workerId]: { ...cur, chat: cur.chat + e.delta, hop: e.hop ?? cur.hop },
          },
        }
      })
    } else if (e.type === 'worker-mind-event') {
      setWorkerStreamsMap((prev) => {
        const agMap = prev[agentId] || {}
        const cur = agMap[e.workerId] || { mind: [], chat: '', hop: e.hop ?? 1 }
        return {
          ...prev,
          [agentId]: {
            ...agMap,
            [e.workerId]: {
              ...cur,
              mind: [...cur.mind, e.event as AgentPart],
              hop: e.hop ?? cur.hop,
            },
          },
        }
      })
    } else if (e.type === 'worker-status') {
      if (e.status === 'done' || e.status === 'failed' || e.status === 'cancelled') {
        setWorkerStreamsMap((prev) => {
          const agMap = { ...(prev[agentId] || {}) }
          delete agMap[e.workerId]
          return { ...prev, [agentId]: agMap }
        })
      }
    }
  }, [])

  // 检查 API Key
  const checkApiKey = useCallback((): boolean => {
    const s = propAiSettings ?? loadAiSettings()
    if (!hasApiKey(s)) {
      const msg = t('请先在应用设置中配置 AI 提供商与 API Key')
      setError(msg)
      onToast?.(msg)
      return false
    }
    return true
  }, [propAiSettings, onToast])

  // 1. 向协作频道发送消息
  const sendChannelMessage = useCallback(
    async (text: string) => {
      if (!checkApiKey()) return
      const bus = teamBusRef.current
      if (!bus) return
      bus.updateAiConfig(resolvedAi)
      try {
        await bus.sendChannelMessage(text)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        onToast?.(msg)
      }
    },
    [checkApiKey, resolvedAi, onToast],
  )

  // 2. 向指定专家发送私聊消息
  const sendDirectMessage = useCallback(
    async (agentId: string, text: string) => {
      if (!checkApiKey()) return
      const bus = teamBusRef.current
      if (!bus) return
      bus.updateAiConfig(resolvedAi)

      setHostRunningMap((prev) => ({ ...prev, [agentId]: true }))
      try {
        await bus.sendDirectMessage(agentId, text)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        onToast?.(msg)
      } finally {
        setHostRunningMap((prev) => ({ ...prev, [agentId]: false }))
        setHostStreamingMap((prev) => ({ ...prev, [agentId]: null }))
      }
    },
    [checkApiKey, resolvedAi, onToast],
  )

  // 3. 直连快通道投递给某专家内部的 Worker
  const sendToWorker = useCallback(
    async (agentId: string, workerId: string, text: string) => {
      if (!checkApiKey()) return
      const bus = teamBusRef.current
      if (!bus) return
      bus.updateAiConfig(resolvedAi)
      try {
        await bus.sendDirectMessage(agentId, text, { targetWorkerId: workerId })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        onToast?.(msg)
      }
    },
    [checkApiKey, resolvedAi, onToast],
  )

  // 4. 取消指定工单
  const cancelWorker = useCallback((agentId: string, workerId: string) => {
    const bus = teamBusRef.current
    const engine = bus?.getAgentEngine(agentId)
    engine?.cancelWorker(workerId)
  }, [])

  // 5. 停止指定 Agent 或全部
  const stopAgent = useCallback((agentId: string) => {
    teamBusRef.current?.stopAgent(agentId)
    setHostRunningMap((prev) => ({ ...prev, [agentId]: false }))
    setHostStreamingMap((prev) => ({ ...prev, [agentId]: null }))
  }, [])

  const stopAll = useCallback(() => {
    teamBusRef.current?.stopAll()
    setHostRunningMap({})
    setHostStreamingMap({})
  }, [])

  // 6. 清空/重置某专家会话
  const resetAgent = useCallback(
    async (agentId: string) => {
      const bus = teamBusRef.current
      const eng = bus?.getAgentEngine(agentId)
      if (!eng) return
      eng.stopAll()

      const st = eng.getState()
      st.hostMessages = []
      st.workers = {}
      st.mailbox = []
      st.blackboard = []

      resetPrefixGate('super:host:' + st.id)
      setAgentStates((prev) => ({ ...prev, [agentId]: { ...st } }))
      await flushTeamAgentState(scopeIdRef.current, agentId)
    },
    [],
  )

  // 7. 清空协作频道消息与工单
  const resetChannel = useCallback(async () => {
    const bus = teamBusRef.current
    if (!bus) return
    const st = bus.getTeamState()
    st.channelMessages = []
    st.delegations = {}
    setTeamState({ ...st })
    await flushTeamState(scopeIdRef.current)
  }, [])

  // 构建各专家的视图投影快照
  const agents = useMemo<Record<string, AgentViewSnapshot>>(() => {
    const out: Record<string, AgentViewSnapshot> = {}
    for (const profile of DEFAULT_TEAM_PROFILES) {
      const id = profile.id
      const st = agentStates[id] || {
        id: `${scopeId}:${id}`,
        hostSystemPrompt: '',
        hostMessages: [],
        workers: {},
        mailbox: [],
        blackboard: [],
      }
      const workers = Object.values(st.workers).sort((a, b) => b.createdAt - a.createdAt)
      const waitingWorkersCount = workers.filter((w) => w.status === 'waiting_input').length
      const runningWorkersCount = workers.filter((w) => w.status === 'running').length

      out[id] = {
        profile,
        state: st,
        hostMessages: st.hostMessages,
        hostStreaming: hostStreamingMap[id] ?? null,
        hostRunning: Boolean(hostRunningMap[id]),
        workers,
        workerStreams: workerStreamsMap[id] || {},
        mailboxCount: st.mailbox.length,
        blackboard: st.blackboard,
        waitingWorkersCount,
        runningWorkersCount,
      }
    }
    return out
  }, [agentStates, hostRunningMap, hostStreamingMap, workerStreamsMap, scopeId])

  return {
    ready,
    error,
    clearError: () => setError(null),
    profiles: DEFAULT_TEAM_PROFILES,
    channelMessages: teamState?.channelMessages || [],
    delegations: teamState?.delegations || {},
    agents,
    sendChannelMessage,
    sendDirectMessage,
    sendToWorker,
    cancelWorker,
    stopAgent,
    stopAll,
    resetAgent,
    resetChannel,
  }
}
