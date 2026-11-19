/**
 * useSuperAgent: 面向 React UI 的三平面 Agent 交互 Hook
 *
 * 职责：
 * 1. 维护 SuperAgentEngine 单例生命周期与异步加载；
 * 2. 状态不可变投影与实时流式事件分流（host 流式 vs worker 零拷贝流式）；
 * 3. 挂载自动防抖落盘与卸载立即 flush 保护。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadAiSettings, resolveGlobal, type AiSettings } from '../../ai/settings'
import { SuperAgentEngine } from '../../agent/super/engine'
import type {
  AgentEvent,
  AgentPart,
  BlackboardEntry,
  ConversationMessage,
  SuperAgentEvent,
  SuperAgentState,
  WorkerSession,
} from '../../agent/super/types'
import type { LearnStore } from '../types'
import { flushSuperAgentState, loadSuperAgentState, saveSuperAgentState } from './persist'
import { buildSuperHostSystemPrompt } from './prompts'
import { createSuperWorkerTools } from './workerRig'

export interface UseSuperAgentOptions {
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

export function useSuperAgent(options: UseSuperAgentOptions) {
  const { scopeId, goalTitle, store, getLatest, set, nodeId, aiSettings: propAiSettings, onToast } = options

  const [state, setState] = useState<SuperAgentState | null>(null)
  const [hostRunning, setHostRunning] = useState(false)
  const [hostStreaming, setHostStreaming] = useState<HostStreamingSlot | null>(null)
  const [workerStreams, setWorkerStreams] = useState<Record<string, WorkerStreamSlot>>({})

  const engineRef = useRef<SuperAgentEngine | null>(null)
  const scopeIdRef = useRef(scopeId)
  scopeIdRef.current = scopeId

  const resolvedAi = useMemo(() => {
    const s = propAiSettings ?? loadAiSettings()
    return resolveGlobal(s)
  }, [propAiSettings])

  // 初始化或切换 scope 时载入状态与初始化 Engine
  useEffect(() => {
    let cancelled = false
    const sid = scopeId

    async function init() {
      // 切换前若有旧 engine，先立即保存
      if (engineRef.current) {
        await flushSuperAgentState(engineRef.current.getState().id)
      }

      const loaded = await loadSuperAgentState(sid)
      if (cancelled) return

      const hostPrompt = buildSuperHostSystemPrompt({ goalTitle })
      loaded.hostSystemPrompt = hostPrompt

      const engine = new SuperAgentEngine({
        id: sid,
        initialState: loaded,
        provider: resolvedAi.provider,
        model: resolvedAi.model,
        effort: resolvedAi.effort,
        createWorkerTools: (workerId) =>
          createSuperWorkerTools({
            getLatest,
            set,
            goalId: sid === 'global' ? null : sid,
            nodeId,
          }),
        onEvent: (event: SuperAgentEvent) => {
          handleSuperEvent(event)
        },
        onStateChange: (nextState) => {
          setState({ ...nextState })
          saveSuperAgentState(sid, nextState)
        },
      })

      engineRef.current = engine
      setState({ ...engine.getState() })
      setHostRunning(false)
      setHostStreaming(null)
      setWorkerStreams({})
    }

    void init()

    return () => {
      cancelled = true
      if (engineRef.current) {
        engineRef.current.stopAll()
        void flushSuperAgentState(sid)
      }
    }
  }, [scopeId, goalTitle, resolvedAi.provider.id, resolvedAi.model, resolvedAi.effort])

  // 事件分流处理
  const handleSuperEvent = useCallback((event: SuperAgentEvent) => {
    switch (event.type) {
      case 'host-thinking':
        setHostStreaming((prev) => ({
          thinking: (prev?.thinking || '') + event.delta,
          text: prev?.text || '',
          activeTool: prev?.activeTool,
        }))
        break
      case 'host-text-delta':
        setHostStreaming((prev) => ({
          thinking: prev?.thinking || '',
          text: (prev?.text || '') + event.delta,
          activeTool: prev?.activeTool,
        }))
        break
      case 'host-tool-call':
        setHostStreaming((prev) => ({
          thinking: prev?.thinking || '',
          text: prev?.text || '',
          activeTool: `${event.name}`,
        }))
        break
      case 'host-tool-result':
        setHostStreaming((prev) => ({
          thinking: prev?.thinking || '',
          text: prev?.text || '',
          activeTool: undefined,
        }))
        break
      case 'host-done':
        setHostRunning(false)
        setHostStreaming(null)
        break
      case 'worker-chat-delta':
        setWorkerStreams((prev) => {
          const slot = prev[event.workerId] || { mind: [], chat: '', hop: event.hop ?? 0 }
          return {
            ...prev,
            [event.workerId]: {
              ...slot,
              chat: slot.chat + event.delta,
              hop: event.hop ?? slot.hop,
            },
          }
        })
        break
      case 'worker-mind-event':
        setWorkerStreams((prev) => {
          const slot = prev[event.workerId] || { mind: [], chat: '', hop: event.hop ?? 0 }
          const nextMind = [...slot.mind]
          // 简易累加
          if (event.event.type === 'thinking') {
            nextMind.push({ type: 'thinking', text: event.event.delta })
          } else if (event.event.type === 'tool-call') {
            nextMind.push({
              type: 'tool',
              id: event.event.id,
              name: event.event.name,
              args: event.event.args,
              result: '',
              ok: true,
              status: 'running',
            })
          }
          return {
            ...prev,
            [event.workerId]: {
              ...slot,
              mind: nextMind,
              hop: event.hop ?? slot.hop,
            },
          }
        })
        break
      case 'worker-status':
        if (event.status === 'done' || event.status === 'failed' || event.status === 'cancelled') {
          // 清理流式槽位中冗余文本
          setWorkerStreams((prev) => {
            const next = { ...prev }
            delete next[event.workerId]
            return next
          })
        }
        break
    }
  }, [])

  // 动作：发送给 Frontline Host
  const sendToHost = useCallback(
    async (text: string) => {
      const engine = engineRef.current
      if (!engine) return
      setHostRunning(true)
      try {
        await engine.sendUserMessage(text)
      } catch (e) {
        onToast?.(e instanceof Error ? e.message : '发送失败')
      } finally {
        setHostRunning(false)
      }
    },
    [onToast],
  )

  // 动作：直连发送给 Worker
  const sendToWorker = useCallback(
    async (workerId: string, text: string) => {
      const engine = engineRef.current
      if (!engine) return
      try {
        await engine.sendUserMessage(text, { targetWorkerId: workerId })
      } catch (e) {
        onToast?.(e instanceof Error ? e.message : '投递失败')
      }
    },
    [onToast],
  )

  // 动作：取消指定 Worker
  const cancelWorker = useCallback((workerId: string) => {
    engineRef.current?.cancelWorker(workerId)
  }, [])

  // 动作：中止全部
  const stopAll = useCallback(() => {
    engineRef.current?.stopAll()
    setHostRunning(false)
  }, [])

  // 排序后的 Worker 列表（运行中 > 等待中 > 活跃优先）
  const workers = useMemo(() => {
    if (!state) return []
    const list = Object.values(state.workers)
    return list.sort((a, b) => {
      const rank = (status: WorkerSession['status']) => {
        if (status === 'running') return 3
        if (status === 'waiting_input') return 2
        return 1
      }
      return rank(b.status) - rank(a.status) || b.updatedAt - a.updatedAt
    })
  }, [state])

  const hostMessages = useMemo(() => state?.hostMessages || [], [state])
  const mailboxCount = useMemo(() => state?.mailbox.length || 0, [state])
  const blackboard = useMemo(() => state?.blackboard || [], [state])

  return {
    state,
    hostMessages,
    hostRunning,
    hostStreaming,
    workers,
    workerStreams,
    mailboxCount,
    blackboard,
    sendToHost,
    sendToWorker,
    cancelWorker,
    stopAll,
  }
}
