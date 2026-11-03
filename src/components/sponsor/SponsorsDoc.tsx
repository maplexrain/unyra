/**
 * 「赞助者名单与特别鸣谢」页签：
 * 把 docs/sponsors.md 的 Markdown 原文渲染为应用内可读、美观的致谢页面。
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { Download, Heart } from 'lucide-react'
import { t } from '../../i18n'
import { native } from '../../lib/native'
import { renderNote } from '../../lib/markdown'
import { fadeMask, useScrollEdges } from '../../lib/scrollFade'
import sponsorsContent from '../../../docs/sponsors.md?raw'

export default function SponsorsDoc() {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const edges = useScrollEdges(scrollRef)
  const html = useMemo(() => renderNote(sponsorsContent), [])
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const exportDoc = useCallback(() => {
    if (saving) return
    setSaving(true)
    void native()
      .saveText({
        suggestedName: '归一-赞助者名单.md',
        content: sponsorsContent,
        title: t('导出赞助者名单'),
      })
      .then((res) => {
        setSaving(false)
        if (res.ok) setNote(t('已导出'))
        else if (!res.canceled) setNote(res.error ?? t('导出失败'))
        if (res.ok) window.setTimeout(() => setNote(null), 1600)
      })
  }, [saving])

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper">
      {/* 页头 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card/60 px-4 py-2">
        <Heart size={15} className="shrink-0 text-rose-500 fill-rose-500" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-strong">
          {t('赞助者名单与特别鸣谢')}
        </span>
        {note && <span className="shrink-0 text-[11px] text-ink-faint">{note}</span>}
        <button
          type="button"
          onClick={exportDoc}
          disabled={saving}
          title={t('导出为 .md 文件')}
          className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-[11.5px] font-medium text-ink-soft transition hover:border-line-strong hover:bg-paper hover:text-ink disabled:opacity-50"
        >
          <Download size={13} />
          <span>{t('导出 Markdown')}</span>
        </button>
      </div>

      {/* 正文：渲染 markdown */}
      <div
        ref={scrollRef}
        style={{ maskImage: fadeMask(edges, 16), WebkitMaskImage: fadeMask(edges, 16) }}
        className="flex-1 overflow-y-auto px-6 py-8"
      >
        <div className="mx-auto max-w-3xl">
          <div
            className="note-preview prose prose-neutral max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </div>
  )
}
