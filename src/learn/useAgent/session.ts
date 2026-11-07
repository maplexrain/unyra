/**
 * useAgent 的**会话级副作用**（从 useAgent.ts 原样搬出）：会话的落库（persist）、
 * 起名（nameConversation）与子代理管理器（getOrCreateSubManager）。
 *
 * 三件事都是「拿到一段 Conversation 之后围着它转」的辅助：persist 把更新并进 store
 * 的会话清单；起名只在第一轮顺手做一次；子代理管理器一段对话一个、跨轮存活。
 */

import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { AgentPart, Conversation } from '../../agent/types'
import { applyEvent } from '../agent/events'
import { createSubAgentManager, type SubAgentManager } from '../../agent/subagent/manager'
import { EMPTY_SUB_BUCKET } from '../../agent/subagent/registry'
import { conversationById } from '../graph'
import { generateConversationTitle, namingSource } from '../title'
import type { LearnStore } from '../types'

/** 会话落库、起名与子代理管理器（依赖由 hook 本体传入；namingRef 由自由聊天共用） */
export function useAgentSession(deps: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  subManagersRef: { current: Map<string, SubAgentManager> }
  setSubRuns: Dispatch<SetStateAction<Array<{ conversationId: string; sessionId: string; runId: string; parts: AgentPart[] }>>>
}) {
  const { getLatest, set, subManagersRef, setSubRuns } = deps

  const persist = useCallback(
    (next: Conversation) => {
      const s = getLatest()
      const exists = s.conversations.some((c) => c.id === next.id)
      const conversations = exists
        ? s.conversations.map((c) => (c.id === next.id ? next : c))
        : [...s.conversations, next]
      set({ ...s, conversations })
    },
    [getLatest, set],
  )

  /**
   * 给这段对话起个名（见 learn/title）。**只在一段对话还没有标题时做一次**，
   * 失败就安静地算了——起名是锦上添花，不能影响任何一次真正的对话。
   *
   * 为什么挂在 runTurn 里、而不是「新建对话」那一刻：新建时对话是空的，一句话都没有，
   * 拿什么起名。第一轮跑起来时那句话才刚进会话（见 runTurn 里 persist 之后的那一处）。
   *
   * namingRef 是在途标记：第一轮还没跑完用户又发了一条时，不要再发一次起名请求。
   */
  const namingRef = useRef(new Set<string>())
  const nameConversation = useCallback(
    (conv: Conversation) => {
      if (conv.title || namingRef.current.has(conv.id)) return
      const goal = getLatest().goals.find((g) => g.id === conv.goalId)
      const source = namingSource(conv, goal?.question ?? '')
      if (!source) return
      namingRef.current.add(conv.id)
      void generateConversationTitle({ text: source })
        .then((title) => {
          const cur = conversationById(getLatest(), conv.id)
          // 期间它可能被删掉了、或已经由别的路径起了名（换用户时整份 store 会换掉）
          if (!cur || cur.title) return
          persist({ ...cur, title })
        })
        .catch((err: unknown) => {
          console.warn('[agent] 对话起名失败', err)
        })
        .finally(() => namingRef.current.delete(conv.id))
    },
    [getLatest, persist],
  )

  /**
   * 子代理管理器：一段对话一个、跨轮存活（在跑的任务不随轮次结束而停，
   * 交付挂起在它手里，下一轮的 wait 领回）。桶的读写都在这条对话上。
   */
  const getOrCreateSubManager = useCallback(
    (conversationId: string): SubAgentManager => {
      let m = subManagersRef.current.get(conversationId)
      if (!m) {
        m = createSubAgentManager({
          getBucket: () => conversationById(getLatest(), conversationId)?.subagents ?? EMPTY_SUB_BUCKET,
          setBucket: (update) => {
            const stored = conversationById(getLatest(), conversationId)
            if (!stored) return
            const next = update(stored.subagents ?? EMPTY_SUB_BUCKET)
            // 空桶不存字段：没有子代理的对话不该在 chat.json 里多一截空结构
            persist({ ...stored, subagents: next.defs.length || next.sessions.length ? next : undefined })
          },
          onEvent: (sessionId, runId, e) => {
            setSubRuns((prev) => {
              const cur = prev.find((r) => r.runId === runId)
              const parts = cur ? [...cur.parts] : []
              applyEvent(parts, e)
              return cur
                ? prev.map((r) => (r.runId === runId ? { ...r, parts } : r))
                : [...prev, { conversationId, sessionId, runId, parts }]
            })
          },
          onRunEnd: (_sessionId, runId) => {
            setSubRuns((prev) => prev.filter((r) => r.runId !== runId))
          },
        })
        subManagersRef.current.set(conversationId, m)
      }
      return m
    },
    // subManagersRef / setSubRuns 都是跨渲染稳定的 ref / setState：列进依赖不改变记忆化行为
    [getLatest, persist, subManagersRef, setSubRuns],
  )

  return { persist, namingRef, nameConversation, getOrCreateSubManager }
}
