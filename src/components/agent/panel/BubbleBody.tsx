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
import { splitWorkRefs, workInlineKey, type WorkInlineSource } from '../../../lib/workInline'
import { BubbleRichText } from './BubbleRichText'
import { WorkInline } from './WorkInline'

export function BubbleBody({
  text,
  names = [],
  labels,
  tone = 'agent',
  onMention,
  work,
  messageId,
  workAnchorByKey,
}: {
  text: string
  names?: string[]
  labels?: Record<string, string>
  tone?: 'user' | 'agent'
  onMention?: (name: string) => void
  /** 当前会话 / 群聊可见的 work 会话来解析正文里的 `[标题](work: id)` */
  work?: WorkInlineSource
  /** 当前气泡对应的通道消息 id：配合 workAnchorByKey 去重内嵌状态 */
  messageId?: string
  /** 同一个列表里「work 去重键 → 应显示它的消息 id」，见 lib/workInline 的 latestWorkAnchors */
  workAnchorByKey?: Map<string, string>
}) {
  const [open, setOpen] = useState(false)
  const parts = useMemo(() => splitChatText(text), [text])
  const hasDetail = Boolean(parts.detail)
  const showingDetail = hasDetail && open
  const segments = useMemo(
    () => splitWorkRefs(showingDetail ? parts.detail : parts.brief),
    [showingDetail, parts],
  )

  /** 同一条气泡里也最多显示一次：详情/简短两段若都引用同一个 work，不叠两枚状态块。 */
  const shownWorks = new Set<string>()

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.type === 'work') {
          const key = workInlineKey(work, segment.workRef)
          if (workAnchorByKey && messageId && workAnchorByKey.get(key) !== messageId) return null
          if (shownWorks.has(key)) return null
          shownWorks.add(key)
          return (
            <WorkInline
              key={`work:${i}:${segment.workRef}`}
              title={segment.title}
              workRef={segment.workRef}
              source={work}
            />
          )
        }
        return segment.text.trim() ? (
          <BubbleRichText
            key={`text:${i}`}
            text={segment.text}
            names={names}
            labels={labels}
            tone={tone}
            onMention={onMention}
          />
        ) : null
      })}
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
