/*
 * 这个文件负责：进度条**交互区**——拖拽/点击跳转的落点、悬停时间胶囊与离屏
 * 16:9 帧预览、缓冲/已播放两条进度、滑块手柄，以及 AI 语义分段点（视频总结分段：
 * 点一下跳到那段开头，悬停给这一段的内容概述）。
 * 原样搬自 VideoPlayer.tsx 进度条区块（样式与注释一行未动）；展示组件按仓库惯例
 * 逐项收 props、内联回调。分段点 onMouseDown 要 stopPropagation（敏感区，原样保留）。
 */

import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { formatClock } from '../../video/transcript'
import type { VideoChapter } from '../../learn/types'

export interface VideoProgressBarProps {
  /** 进度条交互区挂点：seek 按它的实测矩形换算百分比 */
  progressBarRef: RefObject<HTMLDivElement | null>
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void
  onMouseMove: (e: ReactMouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
  hoverPercent: number | null
  hoverTime: number | null
  hoverPosPx: number
  /** 悬停帧预览画布：离屏视频 seek 完成后画到这里 */
  previewCanvasRef: RefObject<HTMLCanvasElement | null>
  currentPercent: number
  bufferedPercent: number
  effectiveDuration: number
  /** 当前来源的 AI 语义分段（按选集 source 存，见 learn/video/summarize） */
  chapters?: VideoChapter[] | null
  /** 悬停落进的分段（预览下方显示那段标题） */
  hoverChapter: VideoChapter | null
  /** 点分段点跳到那段开头 */
  onChapterClick: (ch: VideoChapter) => void
}

export function VideoProgressBar({
  progressBarRef,
  onMouseDown,
  onMouseMove,
  onMouseLeave,
  hoverPercent,
  hoverTime,
  hoverPosPx,
  previewCanvasRef,
  currentPercent,
  bufferedPercent,
  effectiveDuration,
  chapters,
  hoverChapter,
  onChapterClick,
}: VideoProgressBarProps) {
  return (
    <div
      ref={progressBarRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className="group/progress relative flex h-4 w-full cursor-pointer items-center py-1.5"
    >
      {/* 进度条悬停预览浮层 */}
      {hoverPercent !== null && hoverTime !== null && (
        <div
          style={{
            left: `${hoverPosPx}px`,
            transform: 'translateX(-50%)',
          }}
          className="pointer-events-none absolute bottom-5 z-40 flex flex-col items-center gap-1"
        >
          {/* 预览缩略图盒子（无加载态：seek 期间沿用上一帧，滑动才不会一路闪） */}
          <div className="relative h-[90px] w-[160px] overflow-hidden rounded-md border border-white/20 bg-black shadow-xl">
            <canvas
              ref={previewCanvasRef}
              width={160}
              height={90}
              className="h-full w-full object-cover"
            />
          </div>
          {/* 悬停时间胶囊 */}
          <span className="rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] font-medium text-white shadow backdrop-blur-xs">
            {formatClock(hoverTime * 1000)}
          </span>
          {/* 落在某个分段之内：预览下方显示那一段的标题 */}
          {hoverChapter && (
            <span
              title={hoverChapter.summary}
              className="max-w-[220px] truncate rounded bg-seal/90 px-1.5 py-0.5 text-[10.5px] font-medium text-white shadow"
            >
              {hoverChapter.summary}
            </span>
          )}
        </div>
      )}

      {/* 进度条轨道底色 */}
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/progress:h-1.5">
        {/* 缓冲进度条 */}
        <div
          style={{ width: `${Math.min(100, Math.max(0, bufferedPercent))}%` }}
          className="absolute inset-y-0 left-0 bg-white/35"
        />
        {/* 已播放进度条 */}
        <div
          style={{ width: `${Math.min(100, Math.max(0, currentPercent))}%` }}
          className="absolute inset-y-0 left-0 bg-seal"
        />
      </div>

      {/* 进度条滑块手柄 */}
      <div
        style={{
          left: `${Math.min(100, Math.max(0, currentPercent))}%`,
        }}
        className="absolute -ml-1.5 h-3 w-3 rounded-full bg-seal shadow transition-transform group-hover/progress:scale-125"
      />

      {/* AI 语义分段点：点一下跳到那段开头，悬停给出这一段的内容概述（title 原生提示，零布局风险） */}
      {(chapters ?? []).map((ch) => (
        <button
          key={ch.startMs}
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => onChapterClick(ch)}
          title={`${formatClock(ch.startMs)} · ${ch.summary}`}
          style={{
            left: `${effectiveDuration > 0 ? Math.min(100, Math.max(0, (ch.startMs / (effectiveDuration * 1000)) * 100)) : 0}%`,
          }}
          className="absolute top-1/2 z-10 h-2 w-2 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-white/60 bg-seal shadow transition-transform hover:scale-150"
        />
      ))}
    </div>
  )
}
