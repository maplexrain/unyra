/**
 * 消息列表那一段 JSX：空状态、摘要分界线、每条消息（含隐藏指令的分界条）、
 * 流式内容与思考中的波浪条。
 *
 * 从 AgentPanel 的 return 里整段搬出来，只把「谁调用了它」换成 props：编辑 / 删除 /
 * 打开大图依旧回调上去，编辑框与操作按钮仍旧在原本的位置。
 * 定位条那一份 DOM 不在这里——它是挂在整块面板上的，见 MsgRail.tsx。
 *
 * 拆成 hook（而不是直接写成组件）是为了满足 oxlint 的 fast-refresh 规则：
 * 一个 .tsx 只导出组件，别的东西（这里是 MessageListProps）另放 MessageList.tsx。
 *
 * 每条消息本身（画法与 memo）在 MessageBubble.tsx 的 MessageRow 里，这里只把它们排成一列。
 */

import { useMemo } from 'react'
import { MessageSquare, Sparkles } from 'lucide-react'
import WaveBars from '../../WaveBars'
import { CompactionDivider } from './CompactionDivider'
import { HiddenDivider, MessageRow, Parts } from './MessageBubble'
import type { MessageListProps } from './MessageList'
import type { InjectItem } from './partGroups'
import type { ConversationMessage } from '../../../agent/types'
import { isPromptInject } from '../../../agent/messageKind'
import { t } from '../../../i18n'

/**
 * 把消息列切成渲染段。
 *
 * 两类隐藏消息在界面上**去向不同**（判据见 agent/messageKind）：
 * - **工作流指令**（出卷 / 阅卷 / 开讲 / 压缩…）：按**相邻**归成一段，画一条分界条。
 *   相邻的融成一条——工作流连着触发两下，各画各的就是两条紧贴的横线。
 * - **提示词注入**（人格 / 文档格式 / 技能库 / 提示词模块）：不画分界条，攒起来交给
 *   **紧接着的那条导师回复**，并进它的「思考、工具与提示词」过程组。它们与思考、
 *   工具调用是同一层的东西（这一轮凭什么这么答），从前挤在分界条上会把那行字挤爆。
 *
 * 攒着的那几条若碰上一条**用户自己发的**消息，就继续往下带：它们是为「这一轮的回答」
 * 注入的，跟着回答走才说得通。整段消息里都没有回复（用户刚发出去、导师还没开口）时
 * 由调用方交给正在流式的那一段（见返回的 pending）。
 */
type Segment =
  | { kind: 'marks'; msgs: ConversationMessage[]; start: number }
  | { kind: 'row'; m: ConversationMessage; at: number; prelude?: InjectItem[] }

/** 隐藏消息 → 过程组里那一条（标签取 mark，正文取它进上下文的原文） */
function toInjectItem(m: ConversationMessage): InjectItem {
  return {
    type: 'inject',
    id: m.id,
    label: t(m.mark ?? '提示词注入'),
    text: m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n\n').trim(),
  }
}

function toSegments(messages: ConversationMessage[]): { segments: Segment[]; pending: InjectItem[] } {
  const segments: Segment[] = []
  /** 已经攒下、还没交给任何一条回复的提示词注入 */
  let pending: InjectItem[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.hidden) {
      if (isPromptInject(m)) {
        pending.push(toInjectItem(m))
        continue
      }
      const last = segments[segments.length - 1]
      if (last && last.kind === 'marks') last.msgs.push(m)
      else segments.push({ kind: 'marks', msgs: [m], start: i })
      continue
    }
    if (m.role === 'assistant' && pending.length) {
      segments.push({ kind: 'row', m, at: i, prelude: pending })
      pending = []
      continue
    }
    segments.push({ kind: 'row', m, at: i })
  }
  return { segments, pending }
}

export function useMessageList({
  messages,
  summaryStart,
  summary,
  summaryOpen,
  setSummaryOpen,
  streaming,
  running,
  loopLabel,
  flashId,
  msgRefs,
  editing,
  setEditing,
  saveEdit,
  confirmDel,
  clickDelete,
  onResumeNotice,
  setBubblePreview,
  onOpenFile,
  onSelectPrompt,
  goalId,
  free,
}: MessageListProps) {
  /*
   * 分段只在 messages 变了之后重算：流式写作时 messages 身份不变（正在长的那一段
   * 走 streaming，见 AgentPanel），于是 prelude 数组的身份也稳定——memo 过的消息行
   * 不会因为每个 chunk 重渲染一次而被打掉。
   */
  const { segments, pending } = useMemo(() => toSegments(messages), [messages])
  const suggestions = useMemo(
    () =>
      free
        ? [
            t('帮我梳理一段思路或方案'),
            t('快速解答一个技术或日常疑问'),
            t('探讨一个观点的不同视角与利弊'),
          ]
        : [
            t('用直白的例子解释这个概念'),
            t('帮我梳理要点并整理进笔记'),
            t('针对难点出一道随堂小测验'),
          ],
    [free],
  )

  return (
    <>
      {messages.length === 0 && !streaming && (
        <div className="my-auto flex flex-col items-center justify-center px-4 py-8 text-center select-none animate-in fade-in duration-300">
          <div className="flex h-11 w-11 items-center justify-center text-seal/80">
            {free ? (
              <MessageSquare size={26} className="stroke-[1.6]" style={{ color: 'var(--color-ink-soft, #98928a)' }} />
            ) : (
              <Sparkles size={26} className="stroke-[1.6]" />
            )}
          </div>
          <h4 className="mt-2 text-[14.5px] font-medium tracking-wide text-ink-strong">
            {free ? t('自由对话已就绪') : t('超级导师已就绪')}
          </h4>
          <p className="mt-1 max-w-[280px] text-[12px] leading-relaxed text-ink-soft">
            {free
              ? t('探索想法、快速答疑、方案构思或自由交流，随时随地开启对话')
              : t('针对当前知识点随思提问、拆解推导或生成笔记')}
          </p>
          <div className="mt-5 flex flex-col items-center gap-2 text-[11.5px] text-ink-faint">
            <span className="text-[11px] text-ink-faint/70">{t('可以这样对我说：')}</span>
            <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-[340px]">
              {suggestions.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSelectPrompt?.(item)}
                  className="rounded-full px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors duration-150 hover:text-seal cursor-pointer"
                >
                  “{item}”
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 摘要卡永远在最上面：压缩之后它就是第一条消息（旧消息全部失活、只作显示） */}
      {summary && (
        <CompactionDivider summary={summary} open={summaryOpen} onToggle={() => setSummaryOpen((v) => !v)} />
      )}

      {segments.map((seg) => {
        /*
         * 一条消息一行，行自己 memo 过（见 MessageBubble 的 MessageRow）：
         * 能变的东西（消息本体、是否失活、是否在闪、是否待确认删除、正在编辑的文本、
         * 以及并进过程组的那几条提示词注入）都在 props 里，流式逐跳重渲染时
         * 没变过的那些就整棵子树跳过。
         */
        if (seg.kind === 'marks') {
          return (
            <HiddenDivider
              key={seg.msgs[0].id}
              msgs={seg.msgs}
              faded={seg.start < summaryStart}
              flash={seg.msgs.some((m) => m.id === flashId)}
              msgRefs={msgRefs}
            />
          )
        }
        const m = seg.m
        return (
          <MessageRow
            key={m.id}
            m={m}
            prelude={seg.prelude}
            faded={seg.at < summaryStart}
            flash={flashId === m.id}
            confirming={confirmDel === m.id}
            editingText={editing?.id === m.id ? editing.text : null}
            msgRefs={msgRefs}
            onResumeNotice={onResumeNotice}
            onSaveEdit={saveEdit}
            onDelete={clickDelete}
            setEditing={setEditing}
            setBubblePreview={setBubblePreview}
            onOpenFile={onOpenFile}
            goalId={goalId}
          />
        )
      })}

      {streaming && streaming.length > 0 && (
        <div className="mb-4">
          {/*
            还没落库的那一轮：攒下的提示词注入交给它——与落库之后并进回复是同一个位置，
            用户不会在这一轮收口时看到那几行「跳」一下。
          */}
          <Parts parts={streaming} prelude={pending.length ? pending : undefined} streaming={true} />
        </div>
      )}

      {/* 没有流式内容、也没有回复可挂的注入（极少见：用户刚发出、导师还没开口）：自己成一组 */}
      {pending.length > 0 && !(streaming && streaming.length > 0) && (
        <div className="mb-4">
          <Parts parts={[]} prelude={pending} />
        </div>
      )}

      {/*
        loop 进行中的波浪条：挂在最后一条消息（或正在流式输出的那段）下方。
        这里的意义是「证明没卡」——思考与工具执行都可能安静十几秒，
        没有这个反馈，用户会以为坏了。running 一结束就随之卸载。
      */}
        {running && (
          <div className="moji-in-soft mb-4 flex items-center gap-2.5 text-[12.5px] text-ink-faint">
            <WaveBars className="text-seal" />
            {/*
              moji-sheen：文字上有一道循环掠过的高光（见 styles/motion.css）。
              它自己带字色（渐变裁进字里），所以这里不必再给 text-* 类；
              关掉动效偏好时那一条会把颜色退回 ink-faint。
            */}
            <span className="moji-sheen">{loopLabel}</span>
          </div>
        )}
    </>
  )
}
