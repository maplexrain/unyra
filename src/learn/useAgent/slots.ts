/**
 * useAgent 的「会话分槽」状态落点（从 useAgent.ts 原样搬出）：所有按 **conversationId
 * 分槽**的 state 与会话级 ref 集中在这里声明，useAgent 本体（hook.ts）一次性解构取用。
 *
 * 为什么按会话分槽：agent 栏页签化之后，几位导师可以同时各跑各的——谁的流式、谁在跑、
 * 谁挂着表单、谁攒着实时账，都各归各；UI 读的是「眼前这一位」的那一份，页签的关闭守卫
 * 读整张表（「导师正在跑」的判定与「眼前看的是哪位」是两回事）。
 */

import { useRef, useState } from 'react'
import type { AgentPart, MessageUsage } from '../../agent/types'
import type { AskFormPayload } from '../../agent/tools'
import type { SubAgentManager } from '../../agent/subagent/manager'

/** 流式槽的一格：这一轮回复归属的会话、回复的固定 id 与累计片段 */
export type StreamingSlot = {
  conversationId: string
  messageId: string
  parts: AgentPart[]
}

/** 声明 useAgent 的全部「会话分槽」state 与 ref（六张槽表 + 子代理实时槽 + 会话级 ref） */
export function useAgentSlots() {
  const [streaming, setStreaming] = useState<Record<string, StreamingSlot>>({})
  /**
   * 在跑的轮次按**会话**记（agent 栏页签化之后，几位导师可以同时各跑各的；
   * 键 = conversationId）。UI 读的是当前会话那一份，页签的关闭守卫读整张表——
   * 「导师正在跑」的判定与「眼前看的是哪位」是两回事。
   */
  const [running, setRunning] = useState<Record<string, true>>({})
  /** 每个会话一个中止器：停止按钮只停当前会话，别的导师不受牵连 */
  const abortMapRef = useRef(new Map<string, AbortController>())
  /** 同一会话的轮次串行化（见 runTurn 的说明）：conversationId → 在途轮次的结束承诺 */
  const turnChainRef = useRef(new Map<string, Promise<void>>())
  /**
   * wf.invoke 的队列（键 = conversationId）：导师在一轮里把活交给某条工作流时先排在这儿，
   * 这一轮收口后才由宿主起（见 WorkflowOps.invoke 与 wfDrainRef）。几位导师各跑各的，
   * 谁交的活归谁那一轮。
   */
  const pendingWfRef = useRef(new Map<string, Array<{ id: string; params?: Record<string, string | number> }>>())
  /** 这条会话上连着触发了几条工作流（见 MAX_WF_CHAIN）；链一断就归零 */
  const wfChainRef = useRef(new Map<string, number>())
  /**
   * api.ask 的待回答表单**按会话各挂各的**（表单卡只渲染在发起它的那个会话的输入框上方），
   * 与它的「收卷人」。ask 在工具执行里阻塞等待，表单提交 / 取消 / 停止按钮三条路
   * 都要能把它唤醒（见 runTurn 里的装配）；收卷人按表单 id 认领——并发时多个导师
   * 各问各的，交卷必须落到问话的那一位手里。
   */
  const [pendingAsk, setPendingAsk] = useState<Record<string, { id: string; form: AskFormPayload }>>({})
  const askWaitersRef = useRef(new Map<string, (value: unknown) => void>())
  /**
   * 最近一跳实测的输出速度（tok/s，见 ChatUsage.tps）。轮次开始时清零，
   * 每跳 usage 带着它来就更新——输入区的状态条读它（跑完之后回退到消息里的存量）。
   */
  const [tps, setTps] = useState<Record<string, number>>({})
  /**
   * 正在跑的这一轮**到目前为止**的账（每跳 usage 来就重算一份），按会话分开。
   * 输入区的上下文占用圆环要的是「现在这一跳结束时占了多少」，而不是整轮跑完、
   * 落进会话的那一份——一轮里模型要来回好几跳，每跳输入都在涨，等轮末才更新
   * 圆环就错过了全程。轮次结束随落库一起清空（圆环回退到持久化的那份）。
   */
  const [liveUsage, setLiveUsage] = useState<Record<string, MessageUsage>>({})
  /**
   * 子代理会话住在 Conversation.subagents 上、随 chat.json 落盘（生命周期 = 这段
   * 导师对话，见 docs/subagent-architecture.md）——这里不再另立状态，读走对话、
   * 写走子代理管理器的 setBucket。留在内存的只有两样：
   * - subRuns：并发在跑的各场任务的流式输出（一段对话可同时跑多场，按 runId 分槽）；
   * - 子代理管理器（按 conversationId 各一个，跨轮存活——轮次结束仍在后台跑的任务
   *   由它继续管着，下一轮的 wait 领回交付）。
   */
  const [subRuns, setSubRuns] = useState<Array<{ conversationId: string; sessionId: string; runId: string; parts: AgentPart[] }>>([])
  const subManagersRef = useRef(new Map<string, SubAgentManager>())

  return {
    streaming,
    setStreaming,
    running,
    setRunning,
    abortMapRef,
    turnChainRef,
    pendingWfRef,
    wfChainRef,
    pendingAsk,
    setPendingAsk,
    askWaitersRef,
    tps,
    setTps,
    liveUsage,
    setLiveUsage,
    subRuns,
    setSubRuns,
    subManagersRef,
  }
}
