/**
 * useAgent 的**动作入口**（从 useAgent.ts 原样搬出）：界面能叫动的那些「起一轮」的入口——
 * send（向当前会话发消息）、runWorkflow（触发工作流）、compactNow（手动压缩）、
 * autoTeach（建节点后自动开讲）、runHidden（隐藏指令）与 resumeInterrupted（继续被
 * 中断的一轮），外加自动压缩 / 工流出队两个收口 ref 的装填。
 *
 * 它们都落在 runTurn 之上（工作流与隐藏指令也是一轮 runTurn，只是 hidden + mark）；
 * 收口点见 hook 本体与 queue。声明顺序由 hook 本体保证：这里在 runTurn 之后才被调用。
 */

import { useCallback, useEffect, useState } from 'react'
import type { ChannelStamp, MessageQuote, PendingFile, PendingImage } from '../../agent/types'
import type { AgentVoice } from '../../agent/agentProfile'
import { DEFAULT_AGENT_NAME } from '../../agent/agentProfile'
import type { AgentRunTarget } from '../agent/sandboxOps'
import type { PromptModule } from '../ai/promptModules'
import { addConversation, conversationById, nodeById, resolveDisplayedConversation } from '../graph'
import { resolveRoleConversation, roleConversationId, roleOfConversation, ensureRoleConversation } from '../roleWork/roles'
import { findWorkflow, renderWorkflowInstruction, workflowModules, workflowPrep } from '../workflows'
import { appendGroupMessage } from '../groupChat'
import { groupPeer, inboundEnvelope, peerOf, userPeer } from '../roleWork/channels'
import { native } from '../../lib/native'
import { MIN_ACTIVE_MESSAGES, activeMessages } from '../compact'
import { t } from '../../i18n'
import type { LearnStore } from '../types'

/** send / 工作流 / 压缩 / 隐藏指令等动作入口（runTurn 由 hook 本体传入） */
export function useAgentActions(deps: {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  goalId: string | null
  nodeId: string | null
  conversationId: string | null
  /** 整张「谁在跑」的表（见 slots）：compactNow 与 resumeInterrupted 据此挡正在跑的会话 */
  running: Record<string, true>
  onNoticeRef: { current: ((message: string) => void) | undefined }
  pendingWfRef: { current: Map<string, Array<{ id: string; params?: Record<string, string | number> }>> }
  wfChainRef: { current: Map<string, number> }
  /** 到阈值自动压缩的触发口（ref 本体在 hook 本体声明，这里只装填，见下） */
  autoCompactRef: { current: ((ratio: number) => void) | null }
  /** wf.invoke 的出队口（ref 本体在 hook 本体声明，这里只装填，见下） */
  wfDrainRef: { current: ((target: AgentRunTarget) => boolean) | null }
  runTurn: (
    target: AgentRunTarget,
    text: string,
    hidden?: boolean,
    context?: string,
    quote?: MessageQuote,
    pending?: PendingImage[],
    files?: PendingFile[],
    mark?: string,
    isCompactTurn?: boolean,
    modules?: PromptModule[],
    wfParams?: Record<string, string | number>,
    channel?: ChannelStamp,
  ) => Promise<void>
}) {
  const { getLatest, set, goalId, nodeId, conversationId, running, onNoticeRef, pendingWfRef, wfChainRef, autoCompactRef, wfDrainRef, runTurn } = deps

  /**
   * 向当前会话发送用户消息。
   * context 只进模型上下文、不显示在气泡里；images 是随消息带出去的图片附件。
   * 参数用对象而不是位置参数：能带的东西已经有三样，位置参数太容易传错位。
   */
  const send = useCallback(
    (
      text: string,
      opts?: {
        context?: string
        quote?: MessageQuote
        images?: PendingImage[]
        files?: PendingFile[]
        /** 这条用户消息的来源通道（写进消息，history 据此补来源/时间戳） */
        channel?: ChannelStamp
        /**
         * 显式目标：keepalive 的页签面板各自绑定自己的会话——后台页签的输入框
         * 发出去也要落到它自己那一段对话上，不能借用「眼前激活的页签」。
         */
        target?: AgentRunTarget
      },
    ) => {
      let t = opts?.target ?? null
      if (!t) {
        const s = getLatest()
        const effectiveGoalId = goalId ?? s.activeGoalId ?? null
        if (effectiveGoalId) {
          const effectiveConvId =
            (conversationId && conversationById(s, conversationId)?.goalId === effectiveGoalId
              ? conversationId
              : null) ?? resolveDisplayedConversation(s, effectiveGoalId)
          const effectiveNodeId =
            (nodeId && nodeById(s, nodeId)?.goalId === effectiveGoalId ? nodeId : null) ??
            (s.goals.find((g) => g.id === effectiveGoalId)?.rootNodeId || s.nodes.find((n) => n.goalId === effectiveGoalId)?.id || null)

          if (effectiveConvId) {
            // 声部随会话走（agent team 分工）：当前显示的可能是承接声部的工作会话
            t = {
              goalId: effectiveGoalId,
              nodeId: effectiveNodeId || null,
              conversationId: effectiveConvId,
              voice: roleOfConversation(conversationById(s, effectiveConvId)) as AgentVoice,
            }
          }
        }
      }
      if (!t) return
      void runTurn(
        t,
        text,
        false,
        opts?.context,
        opts?.quote,
        opts?.images,
        opts?.files,
        undefined,
        false,
        undefined,
        undefined,
        opts?.channel,
      )
    },
    [goalId, nodeId, conversationId, runTurn, getLatest],
  )

  /**
   * 手动压缩上下文（输入区「更多 → 压缩上下文」）。
   *
   * 与自动压缩共用 summarize，差别只在谁触发（记进摘要里，界面上那句说明会跟着变）。
   * 跑着的时候不让压：这一轮结束时还要往会话里写回复，中途把历史换掉，
   * 那一轮的结果就落在一份已经作废的历史上了。
   */
  /** 正在手动压缩的是哪一段会话（null = 没在压）：keepalive 后多个面板要各认各的 */
  const [compactingConv, setCompactingConv] = useState<string | null>(null)

  /**
   * 触发一个工作流（内置或登记过的）。指令以 **user 角色**整段进入上下文（隐藏消息，
   * 带名字作分界条），不碰系统提示词——这是「工作流」与「提示词」的分界，登记表也照此语义存储。
   *
   * target 缺省**按节点归属解析**（与 runHidden 同一条口径）：nodeId 所属目标的会话收这条指令——
   * agent 栏页签化之后，「眼前看的是哪位导师」与「这件事该归哪位导师」是两回事；
   * 节点属于当前会话的目标时才直接用当前会话。autoTeach 那类「节点刚建、状态还没切过去」
   * 的调用方传显式 target。
   *
   * 触发前的响铃**只有带 prep 的才做**（见 workflowPrep）；主栏不再由这里切——
   * agent 栏页签化之后，「眼前看的是哪位导师」由用户自己决定。
   */
  const runWorkflow = useCallback(
    (
      ref: string,
      opts?: {
        /** 冲着哪个节点来（缺省 = 当前节点） */
        nodeId?: string
        /** 指令里 {{占位符}} 的实参（如回忆的 title、出卷的类型等级） */
        params?: Record<string, string | number>
        /** 跟着这条指令进上下文的额外说明（如大纲里那句定位） */
        hint?: string
        /** 显式目标：节点刚创建、hook 状态还没跟上时用 */
        target?: AgentRunTarget
        /**
         * 分诊给哪位 role 跑（角色阵容的分工）：**外部工作流统一经群聊进入**，默认 @调度龟，
         * 由它用 chat.send / work 递归派给对应 role；显式 target 的内部续跑才留在私聊。
         * compact 不给 voice：压缩是当前会话的维护操作，也不经调度员。
         */
        voice?: AgentVoice
        /** 附带的图片附件 */
        images?: PendingImage[]
        /** 附带的文件附件 */
        files?: PendingFile[]
        /** 显式要求从群聊进入（外部触发但带来了固定 target 的工作流，如报错修复） */
        viaGroup?: boolean
      },
    ) => {
      let target = opts?.target ?? null
      if (!target) {
        const s = getLatest()
        const targetNodeId = opts?.nodeId ?? nodeId ?? s.activeNodeId ?? null
        const targetNode = targetNodeId ? nodeById(s, targetNodeId) : null
        const targetGoalId = targetNode?.goalId ?? goalId ?? s.activeGoalId ?? null
        const nid =
          (targetNode && targetNode.goalId === targetGoalId ? targetNode.id : null) ??
          (nodeId && nodeById(s, nodeId)?.goalId === targetGoalId ? nodeId : null) ??
          (s.goals.find((g) => g.id === targetGoalId)?.rootNodeId || s.nodes.find((n) => n.goalId === targetGoalId)?.id || null)

        if (targetGoalId && opts?.voice && opts.voice !== 'tutor') {
          // 系统侧分诊（工作流统一经调度员路由）：落调度员的会话，由它委托给对应声部
          //（没有就给确定性 id，首轮启动落库，见 learn/roleWork/roles）
          target = {
            goalId: targetGoalId,
            nodeId: nid || null,
            conversationId:
              resolveRoleConversation(s, opts.voice, targetGoalId) ?? roleConversationId(targetGoalId, opts.voice),
            voice: opts.voice,
          }
        } else if (targetGoalId) {
          // 外部触发的工作流必须优先使用当前显示的上下文（正在交互的导师会话）
          const convId =
            (conversationId && conversationById(s, conversationId)?.goalId === targetGoalId
              ? conversationId
              : null) ?? resolveDisplayedConversation(s, targetGoalId)


          if (convId) {
            target = { goalId: targetGoalId, nodeId: nid || null, conversationId: convId }
          }
        }
      }
      if (!target) return
      const baseTarget = target
      const found = findWorkflow(getLatest(), baseTarget.goalId, ref)
      if (!found) {
        onNoticeRef.current?.(t('没有叫「{0}」的工作流（列表见超级导师设置，或让导师 api.wf.list()）', ref))
        return
      }
      // 响铃：workflowPrep 说该响就响一声（提醒用户「导师要问你东西了」）
      if (workflowPrep(found.prep).beep) {
        try {
          native().window.beep()
        } catch {
          // 测试环境没有 native 桥：提醒本来就是「尽力」
        }
      }
      // 档位全应用唯一（全局滑条）：聊天轮与工作流轮同档，绝不自动翻面（见 learn/effortGuard）。
      // 把这一轮的 promise 交回给调用方：手动压缩要知道「这一轮什么时候跑完」（见 compactNow）
      const instruction = renderWorkflowInstruction(found.instruction, opts?.params)
      /*
       * 外部入口（新目标 / 出卷 / 阅卷 / 开讲 / 超级实验室 / 联网调研 / 释义 / 大纲导读…）
       * 默认从群聊进入：先落一条 `@目标龟` 的群流水，再把同一件事以隐藏工作流指令投给目标 role。
       * 群消息是用户可见的任务票；隐藏指令保留模块 / 参数 / 兜底，目标 role 的回复因为
       * recent inbound = group 会回到群里，调度龟再按群聊递归派给其他兄弟。
       *
       * 内部续跑（wfDrain / 自动开讲 / 手动压缩）带显式 target，或属于 compact 维护轮，
       * 走私聊闭环，不能在用户没要求时凭空往群里塞消息；少数外部但带固定 target 的入口
       * （如报错修复）用 opts.viaGroup 显式要求进群。
       */
      const groupVoice = opts?.voice ?? 'dispatcher'
      const viaGroup =
        found.id !== 'compact' &&
        (opts?.viaGroup ?? !opts?.target)
      if (viaGroup) {
        const latest = getLatest()
        const ensured = ensureRoleConversation(latest, groupVoice, baseTarget.goalId)
        if (ensured.store !== latest) set(ensured.store)
        const groupTarget = {
          ...baseTarget,
          conversationId: ensured.conversationId,
          voice: groupVoice,
        }
        const roleName = DEFAULT_AGENT_NAME[groupVoice]
        const rolePeer = peerOf('agent', groupVoice, roleName)
        const from = userPeer()
        const now = Date.now()
        const label = found.name
        const body = `@${roleName} 【外部工作流 · ${label}】已触发，请处理。`
        const groupMessage = inboundEnvelope({
          channel: 'group',
          from,
          to: groupPeer(),
          text: body,
          ts: now,
          mentions: [rolePeer],
          goalId: groupTarget.goalId,
          extra: { title: `工作流指令 · ${label}`, text: instruction },
        })
        appendGroupMessage(groupMessage)
        // 群聊入站信封落进目标 role 的通道：chat.send 的「从哪来回哪去」与兜底都读最近入站。
        const current = conversationById(getLatest(), groupTarget.conversationId)
        if (current) {
          const inbound = inboundEnvelope({
            channel: 'group',
            from,
            to: rolePeer,
            text: body,
            ts: now,
            id: groupMessage.id,
            mentions: [rolePeer],
            goalId: groupTarget.goalId,
            extra: { title: `工作流指令 · ${label}`, text: instruction },
          })
          set({
            ...getLatest(),
            conversations: getLatest().conversations.map((c) =>
              c.id === groupTarget.conversationId
                ? { ...c, channels: [...(c.channels ?? []), inbound].slice(-200), updatedAt: now }
                : c,
            ),
          })
        }
        return runTurn(
          groupTarget,
          instruction,
          true,
          opts?.hint,
          undefined,
          opts?.images,
          opts?.files,
          found.name,
          false,
          workflowModules(found),
          opts?.params,
          { channel: 'group', from, to: rolePeer, ts: now, envelopeId: groupMessage.id, goalId: groupTarget.goalId ?? undefined },
        )
      }
      return runTurn(
        baseTarget,
        instruction,
        true,
        opts?.hint,
        undefined,
        opts?.images,
        opts?.files,
        found.name,
        // 压缩轮跑完不再触发自动压缩（否则写不成摘要时会一轮接一轮，见 isCompactTurn 的说明）
        found.id === 'compact',
        // 触发时随指令注入的提示词模块（内置 promptModule / 登记的 prompt；
        // 同一上下文只注一次，重复触发靠活消息上的标记去重）
        workflowModules(found),
        // 启动实参随指令落库：分界条展开时画参数行、高亮指令里对应的文字
        opts?.params,
      )
    },
    // onNoticeRef 是跨渲染稳定的 ref：列进依赖不改变记忆化行为
    // （goalId 维持不列——原实现如此，见 lint 的既有告警）
    [nodeId, conversationId, getLatest, runTurn, onNoticeRef],
  )

  /**
   * 手动压缩（「更多 → 压缩上下文」）：跑一轮**压缩工作流**。convId 缺省 = 当前会话；
   * keepalive 的页签面板各自传自己的会话（压缩中标记也按会话记，见 compactingConv）。
   *
   * 与上一版的分别：不再由宿主另起一次「把历史重发一遍再总结」的模型请求——
   * 导师本来就看得到整段上下文，让它自己把摘要写出来（见 learn/compact 与工作流指令）。
   * 「旧消息失活」发生在那轮 loop 结束时（见 runTurn 的 finally）。
   */
  const compactNow = useCallback(async (convId?: string) => {
    const id = convId ?? conversationId
    if (!id) return
    if (running[id]) {
      onNoticeRef.current?.(t('导师正在回答，等这一轮结束再压缩'))
      return
    }
    const latest = getLatest()
    const conv = conversationById(latest, id)
    if (!conv) return
    if (activeMessages(conv.messages).length < MIN_ACTIVE_MESSAGES) {
      onNoticeRef.current?.(t('这一段对话还很短，现在压缩省不下什么'))
      return
    }
    setCompactingConv(id)
    try {
      // 显式会话：目标整份给全（nodeId 取该目标的总目标节点，压缩轮不看节点，只为凑齐 target）
      if (convId && id !== conversationId) {
        const goal = latest.goals.find((g) => g.id === conv.goalId)
        await runWorkflow('compact', {
          target: {
            goalId: conv.goalId,
            nodeId: goal?.rootNodeId || null,
            conversationId: id,
            // store 里的会话不会是 free（仅聊天另存 freeChat）；类型面收窄见 roleOfConversation 的说明
            voice: roleOfConversation(conv) as AgentVoice,
          },
        })
      } else {
        await runWorkflow('compact')
      }
    } finally {
      setCompactingConv(null)
    }
    // onNoticeRef 是跨渲染稳定的 ref：列进依赖不改变记忆化行为
  }, [conversationId, running, getLatest, runWorkflow, onNoticeRef])

  // 下面两个 ref 的**本体**在 hook 本体里、早于 runTurnUnchecked 声明（runTurn 的 finally
  // 要读它们）；这里在每次渲染装填最新的一份闭包（runWorkflow 在本文件、晚于 runTurn，
  // 前面的闭包追不到它——挂 ref 每渲染刷新正是为此）。
  useEffect(() => {
    autoCompactRef.current = (ratio: number, target?: AgentRunTarget) => {
      onNoticeRef.current?.(t('上下文已用到 {0}%，正在压缩前面的对话…', Math.round(ratio * 100)))
      // target = 刚收口的这一轮：承接声部的会话压的是它自己（target.voice 随目标走），
      // 不给 target = 导师当前显示的那段（老口径）
      void runWorkflow('compact', target ? { target } : {})
    }
    wfDrainRef.current = (target: AgentRunTarget) => {
      const q = pendingWfRef.current.get(target.conversationId)
      if (!q || !q.length) {
        // 链断了（这一轮没再交活）：这条会话的触发计数归零，下次重新数
        wfChainRef.current.delete(target.conversationId)
        return false
      }
      const next = q.shift() as { id: string; params?: Record<string, string | number> }
      if (!q.length) pendingWfRef.current.delete(target.conversationId)
      wfChainRef.current.set(target.conversationId, (wfChainRef.current.get(target.conversationId) ?? 0) + 1)
      void runWorkflow(next.id, { params: next.params, target })
      return true
    }
  })

/**
 * 新建普通节点 / 学习目标后的隐藏指令（「开讲」与「学习大纲」两个**内置工作流**）。
 *
 * 节点现在是**先建出来、再交给 Agent 收拾**的：标题先用用户选中的原词占位，
 * 描述与教学文档都由 Agent 来写。这么做是为了让用户点一下就立刻得到反馈——
 * 旧流程要先等一次「生成描述」的模型请求，描述回来了 Agent 才开始工作，
 * 用户盯着空文档要多等好几秒，那几秒里他看不到任何东西在发生。
 *
 * 指令文本本体在 learn/workflows（与其它内置工作流统一管理；autoTeach 只是
 * 「带显式目标触发一次工作流」的旧入口）。
 */

  /**
   * 创建节点后自动开讲（隐藏指令，不展示给用户）；目标节点走大纲指令。
   * extra 是额外上下文（如 AI 大纲里那句定位说明），跟着这一轮进模型。
   * attachments 是目标创建或新建节点时带进来的图片与文件附件。
   */
  const autoTeach = useCallback(
    (
      target: AgentRunTarget,
      _goal = false,
      extra?: string,
      attachments?: { images?: PendingImage[]; files?: PendingFile[] },
    ) => {
      runWorkflow('teach-node', {
        target,
        hint: extra,
        params: target.nodeId ? { target: target.nodeId } : {},
        images: attachments?.images,
        files: attachments?.files,
      })
    },
    [runWorkflow],
  )

  /**
   * 发起一次隐藏指令（交卷后的自动阅卷、一键出题）。
   * nodeId 可覆盖：这些指令有时是冲着刚切过去的那个节点发的，
   * 但那一帧 store.activeNodeId 还没更新。
   *
   * 目标归属**按节点算**，不再借用当前会话：agent 栏页签化之后，「眼前看的是哪位导师」
   * 与「这件事该归哪位导师」是两回事——交卷的节点属于目标 B 时，哪怕页签停在 A 的
   * 导师上，阅卷也得进 B 的会话。目标没有会话时现场建一段（addConversation 不换激活态）。
   */
  const runHidden = useCallback(
    (text: string, on?: string, mark?: string) => {
      const s = getLatest()
      const target = on ?? nodeId
      const node = target ? nodeById(s, target) : null
      if (!node) return
      // 节点属于当前会话的目标时直接用当前会话；否则落到该目标当前显示的上下文（没有就新建）
      const conv =
        (conversationId && conversationById(s, conversationId)?.goalId === node.goalId
          ? conversationId
          : null) ??
        resolveDisplayedConversation(s, node.goalId) ??
        (() => {
          const made = addConversation(s, node.goalId)
          set(made.store)
          return made.conversation.id
        })()
      void runTurn(
        {
          goalId: node.goalId,
          nodeId: node.id,
          conversationId: conv,
          voice: roleOfConversation(conversationById(getLatest(), conv)) as AgentVoice,
        },
        text,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        mark,
      )
    },
    [nodeId, conversationId, getLatest, set, runTurn],
  )

  /**
   * 继续「应用退出时被中断」的那一轮（消息列表中断说明旁的「继续」按钮）。
   * target 缺省按当前会话；keepalive 的页签面板各自传自己的目标。
   *
   * 走一条**隐藏指令**起一轮新的 loop：被中断的那条回复已经收口（恢复是载入时做的，
   * inflight 标记已清），旧轮次本身救不回来——能做的是让导师读到中断说明后接着做。
   * 指令不显示（中断说明本身已经把事情讲清楚了，再来一个用户气泡只会占地方），
   * 但带 mark：对话里落一条「继续」分界条，这一轮在长对话里找得回来。
   */
  const resumeInterrupted = useCallback(
    (override?: AgentRunTarget) => {
      // 局部变量避开 t：外层那个 t 是 i18n 函数，指令文本要用它
      const tgt =
        override ??
        (goalId && conversationId
          ? {
              goalId,
              nodeId: nodeId || null,
              conversationId,
              voice: roleOfConversation(conversationById(getLatest(), conversationId)) as AgentVoice,
            }
          : null)
      if (!tgt) return
      if (running[tgt.conversationId]) {
        onNoticeRef.current?.(t('导师正在回答，等这一轮结束再继续'))
        return
      }
      void runTurn(
        tgt,
        t('上一轮回复在应用退出时被中断，以上是中断前保存的进度。请从中断处接着做，把没完成的部分完成；已经完成的部分不要重做。'),
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        t('继续'),
      )
    },
    // onNoticeRef 是跨渲染稳定的 ref：列进依赖不改变记忆化行为
    [goalId, nodeId, conversationId, running, runTurn, onNoticeRef, getLatest],
  )

  return { send, compactingConv, runWorkflow, compactNow, autoTeach, runHidden, resumeInterrupted }
}
