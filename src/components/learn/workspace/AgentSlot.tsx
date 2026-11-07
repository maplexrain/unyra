import type { Dispatch, SetStateAction } from 'react'
import type { AgentTabRef, DocView, LearnStore, TabRef } from '../../../learn/types'
import { agentTabKey } from '../../../learn/agentTabs'
import type { TabCloseMode } from '../../../learn/tabs'
import { queueOf } from '../../../learn/agentQueue'
import {
  addFreeConversation,
  deleteFreeConversation,
  freeConversationById,
} from '../../../learn/freeChat'
import { conversationById, deleteMessage, resolveDisplayedConversation, updateMessageText } from '../../../learn/graph'
import { resetPrefixGate } from '../../../agent/prefixGate'
import { saveAgentSettings, loadAgentSettings } from '../../../agent/settings'
import { personaOf } from '../../../agent/persona'
import { docFormatOf } from '../../../agent/docFormat'
import type { Conversation, PendingFile, PendingImage } from '../../../agent/types'
import type { AskAnswers } from '../../../agent/tools'
import type { ReasoningEffort } from '../../../ai/types'
import { userAbsPath } from '../../../lib/storage'
import AgentTabStrip from '../../agent/AgentTabStrip'
import { AgentTabPane } from './AgentTabPane'
import { goalFocusByGoal } from './goalFocus'
import type { useAgent } from '../../../learn/useAgent'
import type { useWorkflowStarters } from './useWorkflowStarters'
import { t } from '../../../i18n'

type AgentApi = ReturnType<typeof useAgent>
type StartersApi = ReturnType<typeof useWorkflowStarters>
type AgentSettings = ReturnType<typeof loadAgentSettings>

/**
 * agent 栏（页签条 + keepalive 面板 + 空态）需要的宿主能力与派生值。
 *
 * 字段多但都是单向喂入：数据按「store 派生」与「useAgentTabActions 的动作」两路来，
 * 组件内部不再读宿主的任何闭包变量（除 deps 外零外部标识符）。
 */
export interface AgentSlotDeps {
  store: LearnStore
  getLatest: () => LearnStore
  set: (s: LearnStore) => void
  agent: AgentApi
  /** 固定聊天页签的会话列表（learn/freeChat） */
  freeChats: Conversation[]
  currentFreeConvId: string | null
  setFreeConvId: Dispatch<SetStateAction<string | null>>
  onToast: (msg: string) => void
  openTab: (ref: TabRef, preferredView?: DocView) => void
  effort: ReasoningEffort
  setGlobalEffort: (next: ReasoningEffort) => void
  hasKey: boolean
  providerName: string
  vision: boolean
  agentSettings: AgentSettings
  setSettingsEpoch: Dispatch<SetStateAction<number>>
  /** 栏上画的列表 = 固定页签置左 + 本目标的页签原序 */
  stripTabs: AgentTabRef[]
  /** 常挂面板的列表 = 全部页签（不按目标过滤，见宿主 agentPanes 的说明） */
  agentPanes: AgentTabRef[]
  activeAgentTab: AgentTabRef
  activeAgentTabId: string | null
  docGoalIds: Set<string>
  agentTabTitle: (ref: AgentTabRef) => string
  agentTabRunning: (ref: AgentTabRef) => boolean
  activateAgentTab: (key: string) => void
  closeAgentTab: (key: string) => void
  closeAgentTabMode: (key: string, mode: TabCloseMode) => void
  reorderAgentTabList: (keys: string[]) => void
  openAgentTab: (ref: AgentTabRef, activate?: boolean) => void
  handleNewGoalConversation: () => void
  removeConversation: (conversationId: string) => void
  newConversationIn: (tab: AgentTabRef) => void
  selectConversationIn: (tab: AgentTabRef, conversationId: string) => void
  pruneImagesOf: (s: LearnStore) => void
  startSuperLab: StartersApi['startSuperLab']
  newExam: StartersApi['newExam']
  shouldWaitInLine: (convId: string) => boolean
}

/**
 * agent 栏的整块 JSX：页签条 + **keepalive** 面板循环 + 没有任何页签时的空态。
 *
 * 每枚面板的 props 由 agentTabProps 按页签解析（数据与动作各归各的导师），
 * 激活的拿到 active 标记，切回可见时重新量定位条（隐藏期间量到的全是零矩形）。
 */
export function AgentSlot({ deps }: { deps: AgentSlotDeps }) {
  const {
    store,
    getLatest,
    set,
    agent,
    freeChats,
    currentFreeConvId,
    setFreeConvId,
    onToast,
    openTab,
    effort,
    setGlobalEffort,
    hasKey,
    providerName,
    vision,
    agentSettings,
    setSettingsEpoch,
    stripTabs,
    agentPanes,
    activeAgentTab,
    activeAgentTabId,
    docGoalIds,
    agentTabTitle,
    agentTabRunning,
    activateAgentTab,
    closeAgentTab,
    closeAgentTabMode,
    reorderAgentTabList,
    openAgentTab,
    handleNewGoalConversation,
    removeConversation,
    newConversationIn,
    selectConversationIn,
    pruneImagesOf,
    startSuperLab,
    newExam,
    shouldWaitInLine,
  } = deps

  /**
   * 一枚 agent 页签的整份面板 props（keepalive 的每枚页签各取各的，见挂载处的循环）。
   *
   * 数据全部按页签解析：会话与它的流式/表单/账目、子代理桶、目标会话列表；动作也
   * 全部绑到**这一枚页签**的目标上——后台页签里的输入框、菜单、停止键发的都是它自己
   * 那位导师，不借用「眼前激活的页签」。全局设置（人格 / 模型 / 档位）由所有页签共享。
   */
  const agentTabProps = (tab: AgentTabRef) => {
    /*
     * 固定聊天页签：会话住在 learn/freeChat（独立文件），发送走 agent.sendFree——
     * 没有系统提示词/工具/人格，所以 ask、子代理、压缩这些导师域的槽一律置空；
     * 界面上由 AgentPanel 的 free 模式收起对应的功能（菜单三项、无「正在辅导」）。
     */
    if (tab.kind === 'free') {
      const convId = currentFreeConvId
      const conv = freeConversationById(convId)
      const stream = convId ? agent.streams[convId] : undefined
      const nope = () => {}
      return {
        conversation: conv ?? null,
        conversations: freeChats,
        streaming: stream?.parts ?? null,
        streamingMessageId: stream?.messageId ?? null,
        running: !!(convId && agent.runningByConversation[convId]),
        free: true,
        onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
          const id = convId ?? addFreeConversation().id
          if (id !== convId) setFreeConvId(id)
          // 正跑着（或队里排着人）：排进等待队列，等这一轮收口再发（见 learn/agentQueue）
          if (shouldWaitInLine(id)) {
            agent.enqueueMessage({ conversationId: id, free: true, text, images, files })
            return 'queued' as const
          }
          agent.sendFree(id, text, { files, images })
          return 'sent' as const
        },
        queue: queueOf(agent.queues, convId),
        onQueueDrop: (id: string) => {
          if (convId) agent.dropQueuedMessage(convId, id)
        },
        onQueueSendNow: (id: string) => {
          if (convId) agent.sendQueuedNow(convId, id)
        },
        onStop: () => agent.stop(convId ?? undefined),
        onEditMessage: () => {},
        onDeleteMessage: () => {},
        onResumeInterrupted: () => {},
        ask: null,
        onAskSubmit: () => {},
        onAskCancel: () => {},
        tps: (convId ? agent.tpsByConv[convId] : null) ?? null,
        liveUsage: (convId ? agent.liveUsageByConv[convId] : null) ?? null,
        compacting: false,
        onCompact: nope,
        onSuperLab: nope,
        onExam: nope,
        sub: { sessions: [], defs: [], running: false, live: [] },
        viewSubId: null,
        onOpenSub: () => {},
        onNewConversation: () => {
          setFreeConvId(addFreeConversation().id)
        },
        onSelectConversation: (id: string) => setFreeConvId(id),
        onDeleteConversation: (id: string) => {
          if (id && agent.runningByConversation[id]) {
            onToast(t('这一段正在运行，先停止再删除'))
            return
          }
          deleteFreeConversation(id)
          if (id === currentFreeConvId) setFreeConvId(null)
        },
      }
    }
    const isSub = tab.kind === 'sub'
    const goalId = isSub ? (conversationById(store, tab.conversationId)?.goalId ?? null) : tab.goalId
    // 页签里记的会话丢了（被删过）就回落到该目标最近的一段——与 agentView 同一条口径
    const convId = isSub
      ? tab.conversationId
      : tab.conversationId &&
          conversationById(store, tab.conversationId)?.goalId === tab.goalId
        ? tab.conversationId
        : (resolveDisplayedConversation(store, tab.goalId) ?? null)
    const nodeId = goalId
      ? (goalFocusByGoal.get(goalId) ?? (store.goals.find((g) => g.id === goalId)?.rootNodeId || store.nodes.find((n) => n.goalId === goalId)?.id || null))
      : null
    const conv = convId ? (conversationById(store, convId) ?? null) : null
    const target = goalId && convId ? { goalId, nodeId: nodeId || null, conversationId: convId } : null
    const bucket = conv?.subagents
    const sessions = bucket?.sessions ?? []
    const session = isSub ? (sessions.find((x) => x.id === tab.sessionId) ?? null) : null
    const stream = convId ? agent.streams[convId] : undefined
    return {
      // 页签属于哪个目标（子代理经会话反查）：「记忆」入口按它开对应目标的记忆页签
      goalId,
      conversation: conv,
      conversations: goalId ? store.conversations.filter((c) => c.goalId === goalId) : [],
      streaming: stream?.parts ?? null,
      streamingMessageId: stream?.messageId ?? null,
      running: !!(convId && agent.runningByConversation[convId]),
      onSend: (text: string, images: PendingImage[], files: PendingFile[]) => {
        if (!target) return 'sent' as const
        /*
         * 导师正在跑（或队里还排着人）：这条排进等待队列，不挤进正在跑的那一轮——
         * 一轮 Agent 是一次完整的模型循环，半路塞一条用户消息会让这一轮实发的上下文
         * 自相矛盾（前缀门禁会当场拦下，见 agent/prefixGate）。
         */
        if (shouldWaitInLine(target.conversationId)) {
          agent.enqueueMessage({
            conversationId: target.conversationId,
            target,
            text,
            images,
            files,
          })
          return 'queued' as const
        }
        agent.send(text, {
          target,
          ...(images.length || files.length
            ? { images: images.length ? images : undefined, files: files.length ? files : undefined }
            : {}),
        })
        return 'sent' as const
      },
      queue: queueOf(agent.queues, convId),
      onQueueDrop: (id: string) => {
        if (convId) agent.dropQueuedMessage(convId, id)
      },
      onQueueSendNow: (id: string) => {
        if (convId) agent.sendQueuedNow(convId, id)
      },
      onStop: () => agent.stop(convId ?? undefined),
      onEditMessage: (messageId: string, text: string) => {
        // 改写消息正文 = 设计内的历史改写：这一会话的前缀账重新开始记（见 agent/prefixGate）
        resetPrefixGate(convId ?? '')
        set(updateMessageText(getLatest(), convId ?? '', messageId, text))
      },
      onDeleteMessage: (messageId: string) => {
        // 同上：删除消息之后的历史与已实发的那份不再前缀一致
        resetPrefixGate(convId ?? '')
        const next = deleteMessage(getLatest(), convId ?? '', messageId)
        set(next)
        pruneImagesOf(next)
      },
      onResumeInterrupted: () => {
        if (target) agent.resumeInterrupted(target)
      },
      ask: (convId ? agent.pendingAskByConv[convId] : null) ?? null,
      onAskSubmit: (answers: AskAnswers) => {
        if (convId) agent.submitAsk(answers, convId)
      },
      onAskCancel: () => {
        if (convId) agent.cancelAsk(convId)
      },
      tps: (convId ? agent.tpsByConv[convId] : null) ?? null,
      liveUsage: (convId ? agent.liveUsageByConv[convId] : null) ?? null,
      compacting: !!convId && agent.compactingConvId === convId,
      onCompact: () => {
        if (convId) void agent.compactNow(convId)
      },
      // 菜单动作绑到这一枚页签的落点节点（节点归属的解析见 runWorkflow）
      // onSuperLab 仍在这里：斜杠命令 /superlab 消费它（更多菜单已摘除工作流分组）
      onSuperLab: () => {
        if (nodeId) startSuperLab(nodeId)
      },
      onExam: () => newExam(nodeId ?? undefined),
      sub: {
        sessions,
        defs: bucket?.defs ?? [],
        running: agent.subRunsAll.some((r) => r.conversationId === convId),
        live: agent.subRunsAll
          .filter((r) => r.conversationId === convId)
          .map(({ sessionId: sid, runId, parts }) => ({ sessionId: sid, runId, parts })),
      },
      viewSubId: session?.id ?? null,
      onOpenSub: (sid: string) => {
        if (convId) openAgentTab({ kind: 'sub', conversationId: convId, sessionId: sid }, true)
      },
      onNewConversation: () => newConversationIn(tab),
      onSelectConversation: (id: string) => selectConversationIn(tab, id),
    }
  }

  return activeAgentTab ? (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        agent 栏的页签条：一页签一份独立的上下文与运行时。目标级导师的关闭守卫
        （文档区还有它的页签 / 还在跑）与子代理页签的随时可关，见 AgentTabStrip。
      */}
      <AgentTabStrip
        tabs={stripTabs}
        activeId={activeAgentTabId}
        titleOf={agentTabTitle}
        runningOf={agentTabRunning}
        docTabsOf={(ref) => (ref.kind === 'goal' ? docGoalIds.has(ref.goalId) : false)}
        onActivate={activateAgentTab}
        onClose={closeAgentTab}
        onCloseMode={closeAgentTabMode}
        onReorder={reorderAgentTabList}
        onNewConversation={store.activeGoalId ? handleNewGoalConversation : undefined}
      />
      {/*
        **keepalive**：所有页签的面板常挂（absolute 铺满、非激活的 display:none）——
        滚动位置、跟随状态、编辑态、输入框里打到一半的话，切走再回来都还在。
        每枚面板的 props 由 agentTabProps 按页签解析（数据与动作各归各的导师），
        激活的拿到 active 标记，切回可见时重新量定位条（隐藏期间量到的全是零矩形）。
      */}
      <div className="relative min-h-0 flex-1">
        {/* 常挂的是全部页签（见 agentPanes 的说明），栏上画哪几枚由 stripTabs 决定 */}
        {agentPanes.map((tab) => {
          const key = agentTabKey(tab)
          const on = key === activeAgentTabId
          const props = agentTabProps(tab)
          return (
            <AgentTabPane
              key={key}
              tabKey={key}
              active={on}
              hasKey={hasKey}
              providerLabel={providerName}
              onModelChanged={() => setSettingsEpoch((n) => n + 1)}
              vision={vision}
              onNotice={onToast}
              onOpenAgentSettings={() => openTab({ kind: 'agentSettings' })}
              onOpenSettings={() => openTab({ kind: 'agentSettings' })}
              effort={effort}
              onSetEffort={setGlobalEffort}
              compactThreshold={agentSettings.compact.threshold}
              persona={agentSettings.persona}
              onPickPersona={(id) => {
                saveAgentSettings({ ...agentSettings, persona: id })
                onToast(t('导师人格已切到「{0}」，从下一轮开始生效', personaOf(id).label))
              }}
              docFormat={agentSettings.docFormat}
              onPickDocFormat={(id) => {
                saveAgentSettings({ ...agentSettings, docFormat: id })
                onToast(t('文档格式已切到「{0}」，从下一轮开始生效', docFormatOf(id).label))
              }}
              onDeleteConversation={removeConversation}
              onOpenFile={(pathOrRel, title) => {
                const norm = pathOrRel.replace(/\\/g, '/')
                const isAbs = /^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(norm)
                const abs = isAbs ? norm : (userAbsPath(norm) ?? norm)
                openTab({ kind: 'local', path: abs, ...(title ? { title } : {}) })
              }}
              {...props}
            />
          )
        })}
      </div>
    </div>
  ) : (
    /*
      一枚页签都没有：还没有任何目标被打开过（或用户把导师都关了）。
      说清「导师从哪里来」——打开一份目标下的文档，它的导师会自己出现。
    */
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <span className="text-[13px] font-medium text-ink-soft">{t('超级导师')}</span>
      <p className="max-w-[240px] text-[11.5px] leading-relaxed text-ink-faint">
        {t('打开一份目标下的文档，它的导师会在这里出现。')}
      </p>
    </div>
  )
}
