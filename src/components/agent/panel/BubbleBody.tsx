/**
 * 双层汇报气泡：默认显示外层短汇报 `text`，有 `detail` 时允许展开查看详细版。
 *
 * 只负责正文与切换按钮；气泡底色、头像与元信息仍由 GroupChatPanel / RoleChatView 负责。
 */
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { t } from '../../../i18n'
import { BubbleRichText } from './BubbleRichText'

export function BubbleBody({
  text,
  detail,
  names = [],
  labels,
  tone = 'agent',
  onMention,
}: {
  text: string
  /** 内层详细汇报；缺省 = 普通单层消息 */
  detail?: string
  names?: string[]
  labels?: Record<string, string>
  tone?: 'user' | 'agent'
  onMention?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hasDetail = Boolean(detail?.trim())
  const showingDetail = hasDetail && open

  return (
    <>
      <BubbleRichText
        text={showingDetail ? detail! : text}
        names={names}
        labels={labels}
        tone={tone}
        onMention={onMention}
      />
      {hasDetail ? (
        <button
          type="button"
          data-bubble-detail-toggle="true"
          aria-expanded={showingDetail}
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-0.5 rounded text-[10.5px] font-medium text-ink-faint transition hover:text-seal"
        >
          {showingDetail ? (
            <>
              {t('收起详细')}
              <ChevronUp size={11} aria-hidden="true" />
            </>
          ) : (
            <>
              {t('查看详细')}
              <ChevronDown size={11} aria-hidden="true" />
            </>
          )}
        </button>
      ) : null}
    </>
  )
}
