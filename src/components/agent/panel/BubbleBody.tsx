/**
 * 双层汇报气泡：`text` 里用单独一行 `---` 分隔简短 / 详细正文。
 *
 * 默认只显示分隔线前的口语化短汇报；存在详细段时提供「查看详细 / 收起详细」切换。
 * 只负责正文与切换按钮；气泡底色、头像与元信息仍由 GroupChatPanel / RoleChatView 负责。
 */
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { t } from '../../../i18n'
import { splitChatText } from '../../../lib/chatText'
import { BubbleRichText } from './BubbleRichText'

export function BubbleBody({
  text,
  names = [],
  labels,
  tone = 'agent',
  onMention,
}: {
  text: string
  names?: string[]
  labels?: Record<string, string>
  tone?: 'user' | 'agent'
  onMention?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const parts = useMemo(() => splitChatText(text), [text])
  const hasDetail = Boolean(parts.detail)
  const showingDetail = hasDetail && open

  return (
    <>
      <BubbleRichText
        text={showingDetail ? parts.detail : parts.brief}
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
