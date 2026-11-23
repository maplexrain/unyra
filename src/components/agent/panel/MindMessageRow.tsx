/**
 * 思维层的一行：**每条消息自身可折叠、默认折叠**。
 *
 * 与聊天层不同，思维层不画气泡，也不把相邻思考 / 工具调用合成一组：折叠壳的标题行
 * 只负责回答「这一条是谁、属于哪一步」，点开才挂载真正的消息内容。收起时不挂 DOM，
 * 与 useFold 的既有纪律一致（流式期间不为了让隐藏文本参与排版而烧掉每一帧）。
 *
 * 历史消息与 work 视图共用：work 的消息就是 role 派给它的任务 + 它的执行过程。
 */
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { AgentPart, ConversationMessage } from '../../../agent/types'
import { currentUserName } from '../../../learn/roleWork/channels'
import { t, useLocale } from '../../../i18n'
import { lastLineOf } from './preview'
import { toolLabel } from './toolLabel'
import { MessageRow, type MessageRowProps } from './MessageBubble'
import { useFold } from './useFold'

function previewOf(m: ConversationMessage): string {
  const text = m.parts
    .filter((p): p is Extract<AgentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n')
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (firstLine) return firstLine

  const last = [...m.parts].reverse().find((p) => p.type !== 'hop')
  if (!last) return t('空消息')
  if (last.type === 'thinking') return t('思考 · {0}', lastLineOf(last.text || '') || '…')
  if (last.type === 'tool') return t('工具 · {0}', toolLabel(last.name, last.args))
  if (last.type === 'prompt-module') return t('提示词模块')
  if (last.type === 'channel-message') return t('通道消息')
  if (last.type === 'notice') return last.text
  return t('消息')
}

export function MindMessageRow({
  m,
  agentName,
  faded,
  flash,
  ...rest
}: MessageRowProps & {
  /** 当前 role 的显示名；用户消息则显示用户模块的昵称 */
  agentName: string
}) {
  useLocale()
  const { open, shown, toggle } = useFold()
  const { msgRefs, ...body } = rest
  const who = m.role === 'user' ? currentUserName() : agentName || t('智能体')
  const preview = previewOf(m)
  return (
    <div
      ref={(el) => {
        if (!msgRefs?.current) return
        if (el) msgRefs.current.set(m.id, el)
        else msgRefs.current.delete(m.id)
      }}
      data-mind-message-id={m.id}
      className={
        'border-b border-line/40 py-1 ' +
        (faded ? 'opacity-55 ' : '') +
        (flash ? 'moji-msg-flash ' : '')
      }
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full min-w-0 items-center gap-1.5 text-left text-[12.5px] text-ink-faint transition hover:text-ink-soft"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="shrink-0 font-medium text-ink-soft">{who}</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate opacity-80" title={preview}>
            {preview}
          </span>
        )}
        {open && <span className="min-w-0 flex-1 truncate opacity-70">{preview}</span>}
        <span className="ml-auto shrink-0 text-[10.5px] text-ink-faint">
          {new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </button>
      <div className={'moji-fold' + (open ? ' moji-fold-open' : '')}>
        <div>
          {shown && (
            <div className="pt-1.5">
              <MessageRow {...body} m={m} faded={false} flash={flash} mind />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
