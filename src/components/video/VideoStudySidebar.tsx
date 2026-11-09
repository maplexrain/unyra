/**
 * 视频页签·左侧浮层（VideoStudyTab 拆分模块）：
 * 按 Tab 展开/收起：
 * - 高度收缩：top-[40px] bottom-[56px]，彻底避开顶部标题栏与底部控制栏，防止重叠；
 * - 样式：无圆角、无边框、无遮罩渐变，背景模糊降至 2px；
 * - 三行垂直切分，高度权重比为 1:1:1，均分高度（1选集列表，1字幕列表，1视频分段）。
 *
 * 原样搬自 VideoStudyTab.tsx 的 leftOverlay 区块（注释一并带走），收成逐项 props
 * 的展示组件；切来源/seek/生成分段走门面内联回调——onResolveSource 由门面补上
 * video.fields 再走 runResolve；三块列表挂点 ref 由 useVideoStudy 拥有、递进来挂。
 */

import type { RefObject } from 'react'
import { Captions, ListTree, ListVideo, Loader2, RotateCcw, X } from 'lucide-react'
import { spawnInkRipple } from '../../lib/motion'
import { t } from '../../i18n'
import { formatClock } from '../../video/transcript'
import type { TranscriptSegment, VideoSource } from '../../video/types'
import type { VideoChapter } from '../../learn/types'

interface Props {
  /** 浮层是否展开（Tab 切换 / 播放器按钮切换） */
  open: boolean
  /** 当前解析结果：选集/分页列表与标题 */
  source: VideoSource | null
  /** 解析中：切换选集/分页的按钮禁用 */
  busy: boolean
  /** 转录段 */
  segments: TranscriptSegment[]
  /** 当前播放落在哪一行字幕 */
  activeIdx: number
  /** 当前来源的分段行 */
  chapterRows: VideoChapter[]
  /** 当前播放落在哪个分段 */
  activeChapterIdx: number
  /** 分段生成中（禁点、转圈） */
  chaptersBusy: boolean
  /** 转录字幕总字符数：用于限制 50,000 字符防爆破上下文 */
  totalTranscriptChars: number
  /** 有没有可用字幕 */
  hasTranscript: boolean
  /** 字幕获取失败/缺失的提示话术；null = 没有额外提示 */
  transcriptNote: string | null
  /** 字幕列表滚动容器挂点：字幕行跟随定位滚动用 */
  listRef: RefObject<HTMLDivElement | null>
  /** 字幕行挂点（按行序） */
  rowRefs: RefObject<Array<HTMLDivElement | null>>
  /** 分段列表容器挂点 */
  chapterListRef: RefObject<HTMLDivElement | null>
  /** 收起浮层 */
  onClose: () => void
  /** 切换到某条来源（合集项 / 分 P）：门面补上 video.fields 再走 runResolve */
  onResolveSource: (source: string) => void
  /** 跳转到指定毫秒 */
  onSeekMs: (ms: number) => void
  /** 手动生成分段或重新分段 */
  onRunChapters: (force?: boolean) => void
}

export default function VideoStudySidebar({
  open,
  source,
  busy,
  segments,
  activeIdx,
  chapterRows,
  activeChapterIdx,
  chaptersBusy,
  totalTranscriptChars,
  hasTranscript,
  transcriptNote,
  listRef,
  rowRefs,
  chapterListRef,
  onClose,
  onResolveSource,
  onSeekMs,
  onRunChapters,
}: Props) {
  return (
    <div
      className={
        'absolute left-0 top-[40px] bottom-[56px] z-20 flex w-[340px] max-w-[46vw] flex-col overflow-hidden bg-black/85 text-white backdrop-blur-[2px] shadow-2xl transition-all duration-200 ' +
        (open ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-4 pointer-events-none')
      }
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 第一行（权重 1）：选集列表 */}
      <div className="flex flex-1 min-h-0 flex-col bg-white/[0.02]">
        <div className="flex shrink-0 items-center justify-between px-3 pt-2 pb-1 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 min-w-0">
            <ListVideo size={14} className="text-pink-400 shrink-0" />
            <span className="text-[12px] font-semibold text-white/95 truncate">
              {source?.collection ? t('合集 / 选集') : t('选集列表')}
            </span>
            {source?.pages && (
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] text-white/60 shrink-0">
                {source.pages.length}P
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onClose()}
            title={t('收起列表 (Tab)')}
            className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white transition cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
          {source?.collection && (
            <div className="pb-2">
              <div className="px-2 pb-0.5 pt-1 text-[10.5px] font-medium text-white/50">
                {t('合集')} · {source.collection.name}
              </div>
              {source.collection.items.map((item) => (
                <button
                  key={item.source}
                  type="button"
                  title={item.title}
                  disabled={busy}
                  onClick={() => onResolveSource(item.source)}
                  className={
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-left transition cursor-pointer disabled:opacity-50 ' +
                    (item.current ? 'bg-pink-500/25 text-white font-medium' : 'text-white/80 hover:bg-white/10')
                  }
                >
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{item.title}</span>
                  <span
                    className={
                      'shrink-0 font-mono text-[10px] ' +
                      (item.current ? 'text-pink-400 font-semibold' : 'text-white/50')
                    }
                  >
                    {item.durationMs ? formatClock(item.durationMs) : '--:--'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {source?.pages && (
            <div>
              {source.collection && (
                <div className="px-2 pb-0.5 pt-1 text-[10.5px] font-medium text-white/50">
                  {t('选集')} · {source.pages.length}
                </div>
              )}
              {source.pages.map((item) => (
                <button
                  key={item.source}
                  type="button"
                  title={item.title}
                  disabled={busy}
                  onClick={() => onResolveSource(item.source)}
                  className={
                    'flex w-full items-center gap-2 rounded py-1 pl-3 pr-2 text-left transition cursor-pointer disabled:opacity-50 ' +
                    (item.current ? 'bg-pink-500/25 text-white font-medium' : 'text-white/80 hover:bg-white/10')
                  }
                >
                  <span className="shrink-0 font-mono text-[10px] text-white/50">P{item.page}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px]">{item.title}</span>
                  <span
                    className={
                      'shrink-0 font-mono text-[10px] ' +
                      (item.current ? 'text-pink-400 font-semibold' : 'text-white/50')
                    }
                  >
                    {item.durationMs ? formatClock(item.durationMs) : '--:--'}
                  </span>
                </button>
              ))}
            </div>
          )}

          {!source?.collection && !source?.pages && (
            <div className="flex h-full flex-col items-center justify-center p-3 text-center text-[11.5px] text-white/45">
              <span className="truncate max-w-[280px]">{source?.title ?? t('单视频')}</span>
            </div>
          )}
        </div>
      </div>

      {/* 第二行（权重 1）：字幕列表 */}
      <div className="flex flex-1 min-h-0 flex-col border-t border-white/10">
        <div className="flex shrink-0 items-center justify-between px-3 pt-2 pb-1 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 min-w-0">
            <Captions size={14} className="text-pink-400 shrink-0" />
            <span className="text-[12px] font-semibold text-white/95 truncate">{t('字幕列表')}</span>
            {segments.length > 0 && (
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] text-white/60 shrink-0">
                {segments.length}
              </span>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1" ref={listRef}>
          {segments.length ? (
            segments.map((seg, i) => (
              <div key={seg.startMs} ref={(el) => { rowRefs.current[i] = el }}>
                <button
                  type="button"
                  onClick={() => onSeekMs(seg.startMs)}
                  className={
                    'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition cursor-pointer ' +
                    (i === activeIdx ? 'bg-pink-500/25 text-white' : 'text-white/80 hover:bg-white/10')
                  }
                >
                  <span
                    className={
                      'mt-px w-11 shrink-0 pt-px text-right font-mono text-[10.5px] ' +
                      (i === activeIdx ? 'text-pink-400 font-semibold' : 'text-white/50')
                    }
                  >
                    {formatClock(seg.startMs)}
                  </span>
                  <span
                    className={
                      'min-w-0 flex-1 text-[12px] leading-relaxed ' +
                      (i === activeIdx ? 'font-medium text-white' : 'text-white/85')
                    }
                  >
                    {seg.text}
                  </span>
                </button>
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center p-3 text-center text-[11.5px] text-white/50">
              {transcriptNote ?? t('这条来源没有可用的转录。')}
            </div>
          )}
        </div>
      </div>

      {/* 第三行（权重 1）：视频分段 */}
      <div className="flex flex-1 min-h-0 flex-col border-t border-white/10 bg-white/[0.01]">
        <div className="flex shrink-0 items-center justify-between px-3 pt-2 pb-1 bg-white/[0.02]">
          <div className="flex items-center gap-1.5 min-w-0">
            <ListTree size={14} className="text-pink-400 shrink-0" />
            <span className="text-[12px] font-semibold text-white/95 truncate">{t('视频分段')}</span>
            {chapterRows.length > 0 && (
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] text-white/60 shrink-0">
                {chapterRows.length}
              </span>
            )}
          </div>
          {chaptersBusy ? (
            <span className="flex items-center gap-1 text-[10.5px] text-pink-300">
              <Loader2 size={11} className="animate-spin" />
              {t('生成中…')}
            </span>
          ) : hasTranscript && chapterRows.length > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                spawnInkRipple(e)
                onRunChapters(true)
              }}
              title={t('重新生成 AI 视频分段')}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-white/70 hover:text-white hover:bg-white/10 transition moji-press cursor-pointer"
            >
              <RotateCcw size={11} className="transition-transform" />
              <span>{t('重新分段')}</span>
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1" ref={chapterListRef}>
          {chapterRows.length ? (
            chapterRows.map((ch, i) => (
              <button
                key={ch.startMs}
                type="button"
                onClick={() => onSeekMs(ch.startMs)}
                title={ch.summary}
                className={
                  'flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition cursor-pointer ' +
                  (i === activeChapterIdx ? 'bg-pink-500/25 text-white' : 'text-white/80 hover:bg-white/10')
                }
              >
                <span
                  className={
                    'mt-px w-11 shrink-0 pt-px text-right font-mono text-[10.5px] ' +
                    (i === activeChapterIdx ? 'text-pink-400 font-semibold' : 'text-white/50')
                  }
                >
                  {formatClock(ch.startMs)}
                </span>
                <span
                  className={
                    'min-w-0 flex-1 text-[12px] leading-relaxed ' +
                    (i === activeChapterIdx ? 'font-medium text-white' : 'text-white/85')
                  }
                >
                  {ch.summary}
                </span>
              </button>
            ))
          ) : chaptersBusy ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[11.5px] text-white/60">
              <Loader2 size={16} className="animate-spin text-pink-400" />
              <span>{t('正在生成视频语义分段…')}</span>
            </div>
          ) : !hasTranscript ? (
            <div className="flex h-full items-center justify-center p-3 text-center text-[11.5px] text-white/40">
              {t('暂无可用字幕，无法分段')}
            </div>
          ) : totalTranscriptChars > 50000 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
              <p className="text-[11.5px] leading-relaxed text-amber-300">
                {t('字幕共 {0} 字符（超出 50,000 字符限制）', totalTranscriptChars.toLocaleString())}
              </p>
              <p className="text-[10.5px] text-white/50">
                {t('为避免超出上下文窗口，长视频需手动生成')}
              </p>
              <button
                type="button"
                onClick={() => onRunChapters()}
                className="mt-1 rounded-md bg-pink-600 px-3 py-1.5 text-[11.5px] font-medium text-white shadow transition hover:bg-pink-700 cursor-pointer"
              >
                {t('手动生成分段')}
              </button>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-[11.5px] text-white/50">
              <span>{t('播放视频时将自动生成分段')}</span>
              <button
                type="button"
                onClick={() => onRunChapters()}
                className="rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/80 hover:bg-white/20 transition cursor-pointer"
              >
                {t('立即生成分段')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
