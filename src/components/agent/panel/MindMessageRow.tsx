/**
 * 思维层的一行：**第一层不折叠，也不能折叠**——每条消息进来就完整展开，
 * 折叠只发生在消息内部的过程件（思考 / 工具调用，见 MessageBubble 的 SinglePart）。
 *
 * 每行先亮出宿主写死的**原始元信息**（`channel` 信封的时间、通道、id、发信人），
 * 再挂消息本身；这样界面上看到的来源与模型上下文里读到的抬头是同一份，不需要互相猜。
 * 没有 channel 抬头的 assistant 回复则显示角色名与时间。
 *
 * 历史消息与 work 视图共用：work 的消息就是 role 派给它的任务 + 它的执行过程。
 */
import { channelMetaLineOf, currentUserName } from '../../../learn/roleWork/channels'
import { t, useLocale } from '../../../i18n'
import { MessageRow, type MessageRowProps } from './MessageBubble'

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
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
  const { msgRefs, ...body } = rest
  const who = m.role === 'user' ? currentUserName() : agentName || t('智能体')
  const meta = m.channel ? channelMetaLineOf(m.channel) : ''
  return (
    <div
      ref={(el) => {
        if (!msgRefs?.current) return
        if (el) msgRefs.current.set(m.id, el)
        else msgRefs.current.delete(m.id)
      }}
      data-mind-message-id={m.id}
      className={'border-b border-line/40 py-2 ' + (faded ? 'opacity-55 ' : '')}
    >
      <div className="mb-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10.5px]">
        {meta ? (
          <span data-mind-raw className="min-w-0 break-all font-mono leading-relaxed text-ink-faint">
            {meta}
          </span>
        ) : (
          <>
            <span className="font-medium text-ink-soft">{who}</span>
            <span className="text-ink-faint">{timeOf(m.ts)}</span>
          </>
        )}
      </div>
      <MessageRow {...body} m={m} faded={false} flash={flash} mind />
    </div>
  )
}
