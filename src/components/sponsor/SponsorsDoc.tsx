/**
 * 「赞助者名单与特别鸣谢」页签：
 * 动态加载并渲染项目仓库 docs/sponsors.md 的 Markdown 原文。
 * 具有本地秒开、远程动态同步、离线兜底、手动刷新与导出能力。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Heart, RotateCw } from 'lucide-react'
import { t } from '../../i18n'
import { native } from '../../lib/native'
import { renderNote } from '../../lib/markdown'
import { fadeMask, useScrollEdges } from '../../lib/scrollFade'
import {
  fetchLatestSponsorsMarkdown,
  getInitialSponsorsMarkdown,
} from '../../lib/sponsorDoc'

export default function SponsorsDoc() {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const edges = useScrollEdges(scrollRef)

  // 优先从本地缓存或内置包秒级展示，无白屏与网络等待感知
  const [content, setContent] = useState<string>(() => getInitialSponsorsMarkdown())
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // 挂载后静默从远程项目仓库拉取最新名单，有新内容即无缝刷新
  useEffect(() => {
    let active = true
    void fetchLatestSponsorsMarkdown().then((res) => {
      if (active && res.ok && res.content) {
        setContent(res.content)
      }
    })
    return () => {
      active = false
    }
  }, [])

  // 手动点击刷新
  const handleRefresh = useCallback(() => {
    if (refreshing) return
    setRefreshing(true)
    setNote(t('正在获取最新名单...'))
    void fetchLatestSponsorsMarkdown().then((res) => {
      setRefreshing(false)
      if (res.ok) {
        setContent(res.content)
        setNote(t('已同步最新名单'))
      } else {
        setNote(t('网络未连通，已显示本地缓存'))
      }
      window.setTimeout(() => setNote(null), 2500)
    })
  }, [refreshing])

  // 导出 Markdown 文件
  const exportDoc = useCallback(() => {
    if (saving) return
    setSaving(true)
    void native()
      .saveText({
        suggestedName: '归一-赞助者名单.md',
        content,
        title: t('导出赞助者名单'),
      })
      .then((res) => {
        setSaving(false)
        if (res.ok) setNote(t('已导出'))
        else if (!res.canceled) setNote(res.error ?? t('导出失败'))
        if (res.ok) window.setTimeout(() => setNote(null), 1600)
      })
  }, [content, saving])

  const html = useMemo(() => renderNote(content), [content])

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper">
      {/* 页头 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-card/60 px-4 py-2">
        <Heart size={15} className="shrink-0 text-rose-500 fill-rose-500" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-strong">
          {t('赞助者名单与特别鸣谢')}
        </span>
        {note && <span className="shrink-0 text-[11px] text-ink-faint transition-opacity">{note}</span>}

        {/* 刷新按钮 */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          title={t('从仓库同步最新名单')}
          className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-card px-2.5 text-[11.5px] font-medium text-ink-soft transition hover:border-line-strong hover:bg-paper hover:text-ink disabled:opacity-50"
        >
          <RotateCw size={12} className={refreshing ? 'animate-spin text-rose-500' : ''} />
          <span>{t('刷新')}</span>
        </button>

        {/* 导出按钮 */}
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
