import { X } from 'lucide-react'
import type { AgentTabRef } from '../../learn/types'
import { agentTabCloseBlock, agentTabKey, type AgentTabCloseBlock } from '../../learn/agentTabs'
import { t } from '../../i18n'

/**
 * agent 栏的页签条：像文档区那样自由开关导师对话。
 *
 * 一页签 = 一份独立的上下文与运行时——目标级导师一目标一枚（页签标题就是目标的标题），
 * 子代理会话一会话一枚（页签随时可关，任务在后台继续跑）。页签条上**只有页签**：
 * 「正在辅导什么」等身份信息住在输入框下面的状态行（见 AgentPanel），这里不重复。
 *
 * 关闭不是永远可点：目标级页签在「文档区还开着它的页签」「这一轮还在跑」时被守卫拦下
 * （见 learn/agentTabs 的 agentTabCloseBlock）——拦着的时候关闭键灰着、悬停说清原因，
 * 而不是点了没反应。
 */

interface Props {
  tabs: AgentTabRef[]
  activeId: string | null
  /** 页签标题：目标级显示目标的标题、子代理显示定义名（上层认得 store） */
  titleOf: (ref: AgentTabRef) => string
  /** 这一页签的导师 / 任务在不在跑（跑着的页签画一颗呼吸点，也参与关闭守卫） */
  runningOf: (ref: AgentTabRef) => boolean
  /** 关闭守卫的两项事实：目标级页签对应的目标在文档区有没有开着页签 */
  docTabsOf: (ref: AgentTabRef) => boolean
  onActivate: (key: string) => void
  onClose: (key: string) => void
}

const BLOCK_HINT: Record<Exclude<AgentTabCloseBlock, 'none'>, string> = {
  docs: '文档区还开着这个目标的页签，先关掉它们才能关闭导师',
  running: '导师正在运行，先停止这一轮再关闭',
}

/**
 * 目标级导师的页签图标：靶心。目标（goal）的靶子在正中，环一圈套一圈——
 * 与文档区页签的 DocTypeIcon 同一套 lucide 几何（24 视窗、2 描边、圆角端点），
 * 渲染成 13px。
 */
function GoalAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={'shrink-0 ' + (className ?? '')}
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.5" fill="currentColor" />
    </svg>
  )
}

/**
 * 派生子代理的页签图标：一 node 出两支（share-2 的几何）——导师派出去的分身，
 * 源头与分身连成一张小网。与靶心并排摆在同一条栏上，级差一眼可辨。
 */
function SubAgentIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={'shrink-0 ' + (className ?? '')}
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98" />
      <path d="M15.41 6.51l-6.82 3.98" />
    </svg>
  )
}

export default function AgentTabStrip({
  tabs,
  activeId,
  titleOf,
  runningOf,
  docTabsOf,
  onActivate,
  onClose,
}: Props) {
  return (
    // 页签条本身不占高度预算之外的东西：面板（消息列表 / 输入区）在它下面照旧
    // flex-1。横向溢出就滚（moji-scroll-none 藏滚动条，与文档区页签栏同一做法）。
    <div role="tablist" className="moji-scroll-none flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-2">
      {tabs.map((ref) => {
        const key = agentTabKey(ref)
        const on = key === activeId
        const running = runningOf(ref)
        // 子代理页签永远不拦（后台跑）；目标级页签的守卫数据由上层算好
        const block = agentTabCloseBlock(ref, { hasDocTabs: docTabsOf(ref), running })
        const closable = block === 'none'
        const title = titleOf(ref)
        return (
          <div
            key={key}
            role="tab"
            aria-selected={on}
            tabIndex={0}
            title={title + (closable ? '' : '（' + t(BLOCK_HINT[block]) + '）')}
            onClick={() => onActivate(key)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onActivate(key)
            }}
            className={
              'group flex h-7 min-w-[96px] max-w-[190px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[12px] transition-colors ' +
              (on
                ? 'border-line-strong bg-card font-medium text-ink-strong shadow-sm'
                : 'border-transparent text-ink-soft hover:bg-line/50 hover:text-ink')
            }
          >
            {ref.kind === 'goal' ? (
              <GoalAgentIcon className={running ? 'text-seal' : ''} />
            ) : (
              <SubAgentIcon className={running ? 'text-seal' : ''} />
            )}
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {running && (
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-seal" />
            )}
            <button
              type="button"
              disabled={!closable}
              title={closable ? t('关闭页签') : t(BLOCK_HINT[block])}
              aria-label={t('关闭页签')}
              onClick={(e) => {
                e.stopPropagation()
                onClose(key)
              }}
              className={
                'flex h-4 w-4 shrink-0 items-center justify-center rounded transition ' +
                (closable ? 'text-ink-faint hover:bg-line/60 hover:text-ink' : 'cursor-not-allowed opacity-30')
              }
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
