import type { CSSProperties } from 'react'
import type { LearnStore } from '../../learn/types'
import { outlineByMember } from '../../learn/outline'
import { renderNoteGfm } from '../../lib/markdown'
import MarkdownView from '../MarkdownView'
import { t } from '../../i18n'

/**
 * 大纲导读页签（**只读**）：一份大纲的「导读」讲解（OutlineDoc.guide / OutlineEntity.guide，
 * 见 learn/types/node）——这条线教什么、为什么这样分层排序、每层衔接什么。
 *
 * 内容全部从大纲数据派生（页签自己没有状态，跟着 store 更新）；「生成大纲导读」工作流
 * 写完 guide 的那一刻，这里就是成稿。大纲没了或还没写导读时给一句指路，不渲染空正文。
 */

function GuideEmpty({ text }: { text: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center text-[12.5px] text-ink-faint">
      {text}
    </div>
  )
}

export default function OutlineGuideView({
  store,
  outlineId,
  scale = 1,
}: {
  store: LearnStore
  /** 大纲成员 id：附身大纲 = 宿主文档 id，游离大纲 = 实体 id（见 tabKey 的 g: 前缀） */
  outlineId: string
  /** 正文字号系数：与文档预览共用同一份 docScale */
  scale?: number
}) {
  const found = outlineByMember(store, outlineId)
  if (!found) {
    return <GuideEmpty text={t('这份大纲已经不在了，导读也随之没有了')} />
  }
  const title = found.kind === 'attached' ? found.doc.title : found.entity.title
  const guide = (found.kind === 'attached' ? found.outline?.guide : found.entity.guide) ?? ''
  const html = guide.trim() ? renderNoteGfm(guide) : ''
  return (
    <div className="print-flat relative flex min-h-0 flex-1 flex-col bg-card">
      {/* 页头：页签名 + 它讲的是哪份大纲 */}
      <div className="flex shrink-0 items-baseline gap-2.5 border-b border-line/60 px-7 py-3">
        <h1 className="text-[14px] font-bold tracking-wide text-ink-strong">{t('大纲导读')}</h1>
        <span className="min-w-0 truncate text-[11.5px] text-ink-faint" title={title}>
          {title}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {html ? (
          <div
            className="note-preview moji-node-note doc-measure relative px-7 pt-4 pb-10"
            style={{ '--doc-scale': scale } as CSSProperties}
          >
            <MarkdownView html={html} />
          </div>
        ) : (
          <div className="px-7 py-10 text-[12.5px] leading-relaxed text-ink-faint">
            {t('这份大纲还没有导读——在它的大纲卡右键「生成大纲导读」补一份')}
          </div>
        )}
      </div>
    </div>
  )
}
