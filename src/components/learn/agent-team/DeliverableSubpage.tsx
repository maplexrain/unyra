/**
 * 交付正文二级页面 (DeliverableSubpage)
 *
 * 架构规范：
 * 1. 聊天区二级页面形态：在主聊天视口内平滑推入，顶栏提供清晰的「← 返回」导航；
 * 2. 100% 完整复用系统原生 Agent 消息列表组件 (MessageRow, Parts)：
 *    - 严格遵循素面无壳规矩：无外层多余边框、无多层嵌套卡片、无背景色与内边距包裹；
 *    - 思考过程与工具调用过程原生折叠收起 (ThinkingBlock, ProcessGroup)，被内容自然撑开，绝不设限高滚动条；
 *    - 正文采用自然 Markdown 分段排布与零拷贝呈现；
 * 3. 视口居中 max-w-[800px] 排布，纯粹沉浸式查验交付成果。
 */

import { memo, useMemo, useRef } from 'react'
import {
  ArrowLeft,
  LayoutGrid,
  StopCircle,
  Zap,
} from 'lucide-react'
import type {
  BlackboardEntry,
  WorkerSession,
} from '../../../agent/super/types'
import { hasDelivery, type DeliveryRecord } from '../../../agent/delivery'
import type { WorkerStreamSlot } from '../../../learn/superAgent/useAgentTeam'
import type { AgentPart, ConversationMessage } from '../../../agent/types'
import { MessageRow, Parts } from '../../agent/panel/MessageBubble'
import WaveBars from '../../WaveBars'
import { t } from '../../../i18n'

export type SubpageMode =
  | { kind: 'worker'; workerId: string }
  | { kind: 'blackboard' }
  | { kind: 'worker_list' }

export interface DeliverableSubpageProps {
  mode: SubpageMode
  agentName: string
  workers: WorkerSession[]
  workerStreams: Record<string, WorkerStreamSlot>
  blackboard: BlackboardEntry[]
  backLabel?: string
  goalId?: string
  onOpenFile?: (pathOrRel: string, title?: string) => void
  onSelectWorker: (workerId: string) => void
  onCancelWorker: (workerId: string) => void
  onBack: () => void
}

export const DeliverableSubpage = memo(function DeliverableSubpage({
  mode,
  agentName,
  workers,
  workerStreams,
  blackboard,
  backLabel,
  goalId,
  onOpenFile,
  onSelectWorker,
  onCancelWorker,
  onBack,
}: DeliverableSubpageProps) {
  // 当前选中工单
  const activeWorkerId = mode.kind === 'worker' ? mode.workerId : workers[0]?.id
  const currentWorker = useMemo(
    () => workers.find((w) => w.id === activeWorkerId),
    [workers, activeWorkerId],
  )
  const currentStream = currentWorker ? workerStreams[currentWorker.id] : undefined

  // 复用系统原生 MessageRow 所需的 DOM refs
  const msgRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const dummySetPreview = useRef(() => {}).current

  // 完整对齐 Agent 栏：若 Worker 拥有交付结果，将其以 DeliveryRecord 规范挂载于最后一条 assistant 消息
  const messagesWithDelivery = useMemo(() => {
    if (!currentWorker) return []
    const msgs = [...currentWorker.messages]
    const lastAssistIdx = msgs.map((m) => m.role).lastIndexOf('assistant')
    if (lastAssistIdx !== -1) {
      const targetMsg = msgs[lastAssistIdx]
      if (!targetMsg.delivery) {
        if (currentWorker.delivery && hasDelivery(currentWorker.delivery)) {
          msgs[lastAssistIdx] = { ...targetMsg, delivery: currentWorker.delivery }
        } else if (currentWorker.artifacts?.length) {
          const delivery: DeliveryRecord = {
            files: currentWorker.artifacts.map((art) => ({
              path: art.title,
              action: 'created',
              note: art.content.slice(0, 80).replace(/\n+/g, ' '),
              goalId: goalId || undefined,
            })),
            sources: [],
          }
          msgs[lastAssistIdx] = { ...targetMsg, delivery }
        }
      }
    }
    return msgs
  }, [currentWorker, goalId])

  // 流式输出时，将后台 Worker 的思考过程与交付正文拼合成标准 AgentPart[] 交由原生 Parts 渲染
  const streamingParts = useMemo(() => {
    if (!currentStream) return []
    const parts: AgentPart[] = [...currentStream.mind]
    if (currentStream.chat) {
      parts.push({ type: 'text', text: currentStream.chat })
    }
    return parts
  }, [currentStream])

  return (
    <div className="flex flex-col h-full w-full bg-paper overflow-hidden select-text">
      {/* 顶栏：面包屑导航 + 返回按钮 + 状态标 */}
      <div className="px-4 py-2.5 border-b border-line/60 flex items-center justify-between gap-3 shrink-0 bg-paper-deep/30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-semibold text-ink-subtle hover:text-ink hover:bg-line/40 transition cursor-pointer shrink-0"
            title={t('返回上一级')}
          >
            <ArrowLeft size={13} className="text-seal" />
            <span>{backLabel || t('返回')}</span>
          </button>

          <div className="h-3.5 w-[1px] bg-line shrink-0" />

          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-md bg-seal/15 text-seal flex items-center justify-center shrink-0">
              {mode.kind === 'blackboard' ? <LayoutGrid size={12} /> : <Zap size={12} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-[12.5px] font-bold text-ink-strong truncate">
                  {mode.kind === 'blackboard'
                    ? t('「{0}」共享黑板', agentName)
                    : currentWorker?.title || t('工单正文')}
                </h3>
                {mode.kind === 'worker' && currentWorker && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9px] font-semibold ${
                      currentWorker.status === 'done'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : currentWorker.status === 'running'
                          ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                          : 'bg-line/80 text-ink-faint'
                    }`}
                  >
                    {currentWorker.status === 'done'
                      ? t('已完成')
                      : currentWorker.status === 'running'
                        ? t('执行中')
                        : currentWorker.status === 'waiting_input'
                          ? t('等待输入')
                          : currentWorker.status === 'failed'
                            ? t('失败')
                            : t('已取消')}
                  </span>
                )}
              </div>
              {mode.kind === 'worker' && currentWorker && (
                <p className="text-[10px] text-ink-faint truncate max-w-lg">
                  {currentWorker.goal}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 右侧动作 */}
        <div className="flex items-center gap-2 shrink-0">
          {mode.kind === 'worker' && currentWorker && (
            <>
              {currentWorker.status === 'running' && (
                <button
                  type="button"
                  onClick={() => onCancelWorker(currentWorker.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-rose-500 hover:bg-rose-500/10 cursor-pointer transition font-medium"
                  title={t('中止工单运行')}
                >
                  <StopCircle size={12} />
                  <span>{t('中止')}</span>
                </button>
              )}
              {workers.length > 1 && (
                <div className="flex items-center gap-1 text-[11px] text-ink-faint">
                  <span>{t('工单:')}</span>
                  <select
                    value={currentWorker.id}
                    onChange={(e) => onSelectWorker(e.target.value)}
                    className="px-2 py-1 rounded-lg text-[11px] bg-paper border border-line text-ink cursor-pointer focus:outline-none max-w-[160px] truncate"
                  >
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 主体视口：800px 居中排布，完全无壳、自然撑开 */}
      <div className="flex-1 overflow-y-auto p-4 select-text">
        <div className="max-w-[800px] mx-auto w-full">
          {mode.kind === 'blackboard' ? (
            /* 黑板视图 */
            blackboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-ink-faint text-[12px] space-y-2">
                <LayoutGrid size={28} className="opacity-40" />
                <span>{t('当前黑板尚未沉淀任何条目')}</span>
              </div>
            ) : (
              <div className="space-y-3">
                {blackboard.map((entry) => (
                  <div
                    key={entry.workerId}
                    onClick={() => {
                      if (entry.workerId) onSelectWorker(entry.workerId)
                    }}
                    className="p-3.5 rounded-xl bg-card border border-line/80 hover:border-seal/40 transition cursor-pointer space-y-1.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between text-[11.5px]">
                      <span className="font-semibold text-ink-strong">{entry.title}</span>
                      <span className="text-[10px] text-ink-faint">
                        {new Date(entry.updatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-[12px] text-ink leading-relaxed line-clamp-3">
                      {entry.summary}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : !currentWorker ? (
            <div className="flex flex-col items-center justify-center py-20 text-ink-faint text-[12px]">
              <span>{t('暂无选中的工单')}</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 完整复用系统原生 Agent 消息行：MessageRow 严格遵循素面无壳设计，原生呈现 DeliveryBlock */}
              {messagesWithDelivery.map((m: ConversationMessage) => (
                <MessageRow
                  key={m.id}
                  m={m}
                  faded={false}
                  flash={false}
                  msgRefs={msgRefs}
                  setBubblePreview={dummySetPreview}
                  onOpenFile={onOpenFile}
                  goalId={goalId}
                />
              ))}

              {/* 若 Worker 正在执行流式推理，完整复用原生 Parts 与 WaveBars，过程件自然展开撑开 */}
              {streamingParts.length > 0 && (
                <div className="group relative mb-4">
                  <Parts parts={streamingParts} streaming={true} />
                  {currentWorker.status === 'running' && (
                    <div className="moji-in-soft mt-3 flex items-center gap-2.5 text-[12.5px] text-ink-faint">
                      <WaveBars className="text-seal" />
                      <span className="moji-sheen">{t('正在后台工坊执行中...')}</span>
                    </div>
                  )}
                </div>
              )}

              {/* 若既无历史消息也无流式内容 */}
              {messagesWithDelivery.length === 0 && streamingParts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-ink-faint text-[12px] space-y-2">
                  <Zap size={24} className="opacity-40" />
                  <span>{t('工单已就绪，等待执行。')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
