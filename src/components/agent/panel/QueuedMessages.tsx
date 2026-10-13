/**
 * 等待队列：agent 正在跑的时候用户发出去的消息排在这里，摆在输入卡片**上方**。
 *
 * 这一块回答三个问题：排着几条、分别是什么、能不能动。所以每一条上都有
 * 「撤回」（在它跑起来之前收回来）与「立即发送」（不等了，就它先来）。
 *
 * 它不持有任何状态：队列在 learn/agentQueue（按会话存），事件往上交给宿主——
 * 这里只负责画。位置贴着输入卡片的上沿（原来是斜杠菜单待的地方）：队列与输入框
 * 是同一件事的两半，「我接着要说的话」与「我已经说了、还没被处理的话」。
 */

import { Image as ImageIcon, ListOrdered, Paperclip, SendHorizontal, Undo2 } from 'lucide-react'
import type { QueuedMessage } from '../../../learn/agentQueue'
import { t } from '../../../i18n'

export interface QueuedMessagesProps {
  items: QueuedMessage[]
  /** 撤回一条：它还没跑起来，摘掉就是摘掉 */
  onDrop: (id: string) => void
  /** 立即发送一条：当前这一轮若还在跑，先把它中止 */
  onSendNow: (id: string) => void
}

export function QueuedMessages({ items, onDrop, onSendNow }: QueuedMessagesProps) {
  if (!items.length) return null
  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-line bg-card/85 shadow-xs backdrop-blur-md">
      <div className="flex items-center gap-1.5 border-b border-line/70 bg-paper-deep/60 px-2.5 py-1.5">
        <ListOrdered size={12} className="shrink-0 text-seal" />
        <span className="shrink-0 text-[11px] font-medium text-ink-soft">{t('等待执行')}</span>
        <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">{t('{0} 条', items.length)}</span>
        {/* 这条规矩得写出来：队列会自己往前走，用户不必猜「它还在等什么」 */}
        <span className="ml-auto min-w-0 truncate text-[10px] text-ink-faint">{t('当前回答结束后自动按顺序发送')}</span>
      </div>
      <div className="moji-scroll-none max-h-[168px] space-y-1 overflow-y-auto p-1.5">
        {items.map((m, i) => (
          <div
            key={m.id}
            className="group flex items-start gap-2 rounded-lg border border-line/60 bg-paper/70 px-2 py-1.5 transition hover:border-line-strong"
          >
            {/* 序号就是它将要被执行的次序（当前这一轮收口后从 1 开始） */}
            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-line/70 text-[9.5px] font-semibold tabular-nums text-ink-soft">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              {/* 只写没有正文时：附件自己那条也发得出去（见 useComposer 的 submit） */}
              <p className="line-clamp-2 text-[12px] leading-snug break-words whitespace-pre-wrap text-ink">
                {m.text || t('（只有附件）')}
              </p>
              {(m.images.length > 0 || m.files.length > 0) && (
                <div className="mt-1 flex items-center gap-2.5 text-[10.5px] text-ink-faint">
                  {m.images.length > 0 && (
                    <span className="flex items-center gap-1">
                      <ImageIcon size={11} />
                      {t('{0} 张图', m.images.length)}
                    </span>
                  )}
                  {m.files.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Paperclip size={11} />
                      {t('{0} 个文件', m.files.length)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onDrop(m.id)}
                title={t('撤回：这条不再发送')}
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
              >
                <Undo2 size={11} />
                {t('撤回')}
              </button>
              <button
                type="button"
                onClick={() => onSendNow(m.id)}
                title={t('立即发送：中止当前回答，先跑这条')}
                className="flex items-center gap-1 rounded-md bg-seal/10 px-1.5 py-0.5 text-[10.5px] font-medium text-seal-deep transition hover:bg-seal/20"
              >
                <SendHorizontal size={11} />
                {t('立即发送')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
