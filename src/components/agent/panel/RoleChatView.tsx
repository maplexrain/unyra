/**
 * role 的 **chat 层**：只画 user / agent 两个通道的对外消息。
 *
 * 工具、思考、work 的内部过程与 Work 通道交付都不进这里——它们在 mind 层；
 * 这一层永远不把「它是怎么做的」暴露给外部对话者。
 */
import { useMemo } from 'react'
import type { ChannelMessage } from '../../../agent/types'
import { t } from '../../../i18n'

function labelOf(m: ChannelMessage): string {
  if (m.kind === 'user') return m.direction === 'in' ? t('用户') : t('我')
  return m.direction === 'in' ? m.from.name || t('另一位角色') : t('我')
}

export function RoleChatView({ channels }: { channels: ChannelMessage[] }) {
  const visible = useMemo(
    () => channels.filter((m) => m.kind === 'user' || m.kind === 'agent').slice(-200),
    [channels],
  )

  if (!visible.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
        <div className="text-[13px]">{t('这里只有对外说的话')}</div>
        <div className="max-w-[320px] text-[11.5px] leading-relaxed">
          {t('工具调用、思考过程与 work 的内部日志都在「思维」层；这一层按来源只显示用户与其它角色的消息。')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pb-2">
      {visible.map((m) => {
        const mine = m.direction === 'out'
        return (
          <div key={m.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
            <div className={'max-w-[86%] ' + (mine ? 'items-end' : 'items-start')}>
              <div className="mb-0.5 flex items-center gap-1.5 px-1 text-[10.5px] text-ink-faint">
                <span>{labelOf(m)}</span>
                <span>{new Date(m.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                {m.auto ? <span className="text-amber-600">{t('自动')}</span> : null}
              </div>
              <div
                className={
                  'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ' +
                  (mine
                    ? 'bg-ink-strong text-paper'
                    : m.kind === 'agent'
                      ? 'border border-seal/25 bg-seal/8 text-ink'
                      : 'border border-line bg-card text-ink')
                }
              >
                {m.text}
              </div>
              {m.attachments?.images?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.attachments.images.map((img) => (
                    <span key={img.id} className="rounded-md border border-line px-1.5 py-0.5 text-[10.5px] text-ink-faint">
                      {img.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
