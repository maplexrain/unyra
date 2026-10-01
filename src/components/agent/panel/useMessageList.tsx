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

import WaveBars from '../../WaveBars'
import { CompactionDivider } from './CompactionDivider'
import { HiddenDivider, MessageRow, Parts } from './MessageBubble'
import type { MessageListProps } from './MessageList'
import type { ConversationMessage } from '../../../agent/types'
import { t } from '../../../i18n'

/**
 * 把消息列切成渲染段：隐藏消息（导师动作）按**相邻**归成一段，其余各自一段。
 * 相邻的分割线在 HiddenDivider 里融成一条——不归段的话，工作流连着触发的两下
 * 就画出两条紧贴的横线（见 HiddenDivider 的说明）。
 */
type Segment =
  | { kind: 'marks'; msgs: ConversationMessage[]; start: number }
  | { kind: 'row'; m: ConversationMessage; at: number }

function toSegments(messages: ConversationMessage[]): Segment[] {
  const segments: Segment[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.hidden) {
      const last = segments[segments.length - 1]
      if (last && last.kind === 'marks') last.msgs.push(m)
      else segments.push({ kind: 'marks', msgs: [m], start: i })
    } else {
      segments.push({ kind: 'row', m, at: i })
    }
  }
  return segments
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
}: MessageListProps) {
  return (
    <>
      {messages.length === 0 && !streaming && (
        <div className="mt-6 rounded-lg border border-dashed border-line bg-card/60 px-3.5 py-4 text-[13.5px] leading-relaxed text-ink-soft">
          <p className="font-medium text-ink">{t('让 AI 把这一概念讲清楚。')}</p>
          <p className="mt-1 text-ink-faint">
            {t('它会把讲解直接写进左侧的教学文档。选中文档里的陌生词汇就能创建下级节点继续深入；想要一份自己的笔记，直接说「把刚才讲的要点整理进我的笔记」。')}
          </p>
          <p className="mt-2 text-[12.5px] text-ink-faint">
            {t('试试：「用直觉解释这个概念」「给我一个具体例子」「我卡在这里了，帮我拆开」')}
          </p>
        </div>
      )}

      {/* 摘要卡永远在最上面：压缩之后它就是第一条消息（旧消息全部失活、只作显示） */}
      {summary && (
        <CompactionDivider summary={summary} open={summaryOpen} onToggle={() => setSummaryOpen((v) => !v)} />
      )}

      {toSegments(messages).map((seg) => {
        /*
         * 一条消息一行，行自己 memo 过（见 MessageBubble 的 MessageRow）：
         * 能变的东西（消息本体、是否失活、是否在闪、是否待确认删除、正在编辑的文本）
         * 都在 props 里，流式逐跳重渲染时没变过的那些就整棵子树跳过。
         * toSegments 每次渲染现算，但产出的 row 段里的 m 是同一个对象——memo 不受影响。
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
          />
        )
      })}

      {streaming && streaming.length > 0 && (
        <div className="mb-4">
          <Parts parts={streaming} />
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
