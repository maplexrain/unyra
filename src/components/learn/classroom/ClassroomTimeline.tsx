import { useState, useRef } from 'react'
import type { PlaybackStatus, TimelineBeat } from '../../../learn/classroom/types'
import { Sparkles, Eye, Volume2 } from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomTimelineProps {
  beats: TimelineBeat[]
  activeBeatIndex: number
  status: PlaybackStatus
  onSeek: (sceneIndex: number, actionIndex: number) => void
}

export default function ClassroomTimeline({
  beats,
  activeBeatIndex,
  status,
  onSeek,
}: ClassroomTimelineProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const total = beats.length
  const isPlaying = status === 'playing'

  // 计算当前已完成进度的百分比
  const progressPercent =
    total <= 1 ? (activeBeatIndex >= 0 ? 100 : 0) : (activeBeatIndex / (total - 1)) * 100

  if (total === 0) {
    return (
      <div className="w-full border-t border-line/60 bg-paper/95 px-6 py-2.5 select-none flex items-center justify-center shrink-0">
        <span className="text-[11.5px] text-ink-faint tracking-wider">
          {t('暂无演播动作轴 · 空白课件')}
        </span>
      </div>
    )
  }

  return (
    <div className="relative z-20 w-full border-t border-line/60 bg-card/90 backdrop-blur-md px-6 py-2 select-none flex flex-col justify-center shrink-0">
      {/* 轴线容器 */}
      <div ref={trackRef} className="relative w-full h-8 flex items-center">
        {/* 轨道内槽（两侧预留 16px 留白） */}
        <div className="relative mx-4 w-[calc(100%-32px)] h-1.5 flex items-center">
          {/* 背景底槽 */}
          <div className="absolute inset-0 rounded-full bg-line/60" />

          {/* 进度条 */}
          <div
            className="absolute left-0 top-0 bottom-0 rounded-full bg-seal transition-all duration-150"
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          />

          {/* 均分分布的动作节拍节点 */}
          {beats.map((beat, index) => {
            const isActive = index === activeBeatIndex
            const isPassed = index < activeBeatIndex
            const isHovered = index === hoveredIndex
            const percent = total <= 1 ? 50 : (index / (total - 1)) * 100

            // 边缘自适应保护：处于左右边缘时 Tooltip 贴边对齐，绝不超出视口被截断！
            const isNearLeft = percent < 18
            const isNearRight = percent > 82

            return (
              <div
                key={beat.beatId}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex items-center justify-center"
                style={{ left: `${percent}%` }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* 交互圆点按钮 */}
                <button
                  type="button"
                  onClick={() => onSeek(beat.sceneIndex, beat.startActionIndex)}
                  className={`group relative flex items-center justify-center rounded-full transition-all duration-150 cursor-pointer ${
                    isActive
                      ? 'w-4 h-4 bg-seal ring-4 ring-seal/25 shadow-md shadow-seal/40 scale-110'
                      : isPassed
                      ? 'w-2.5 h-2.5 bg-seal hover:scale-140 hover:ring-3 hover:ring-seal/30'
                      : 'w-2.5 h-2.5 bg-card border-2 border-line-strong hover:border-seal hover:scale-140 hover:bg-seal/10'
                  }`}
                >
                  {/* 演播中水波纹扩散动效 */}
                  {isActive && isPlaying && (
                    <span className="absolute -inset-1 rounded-full bg-seal/40 animate-ping pointer-events-none" />
                  )}
                  <span className="sr-only">{beat.label}</span>
                </button>

                {/* 鼠标悬停弹出片段概要 Tooltip（边缘自适应对齐，永不被截断） */}
                {isHovered && (
                  <div
                    className={`absolute bottom-full mb-3.5 z-50 pointer-events-none min-w-[220px] max-w-[320px] p-3 rounded-xl bg-slate-900/95 text-slate-100 border border-white/15 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150 text-left ${
                      isNearLeft
                        ? 'left-0 translate-x-0'
                        : isNearRight
                        ? 'right-0 translate-x-0'
                        : 'left-1/2 -translate-x-1/2'
                    }`}
                  >
                    {/* 下拉小三角指示箭头（跟随贴边方向对齐） */}
                    <div
                      className={`absolute top-full border-4 border-transparent border-t-slate-900/95 ${
                        isNearLeft
                          ? 'left-3 translate-x-0'
                          : isNearRight
                          ? 'right-3 translate-x-0'
                          : 'left-1/2 -translate-x-1/2'
                      }`}
                    />

                    {/* 顶部画面标签与序号 */}
                    <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 mb-2">
                      <span className="text-[11px] font-bold text-sky-400 truncate max-w-[170px]">
                        {beat.sceneTitle}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {index + 1} / {total}
                      </span>
                    </div>

                    {/* 片段口语 / 动作概要正文 */}
                    <div className="text-[12.5px] text-slate-200 leading-snug line-clamp-3 font-medium flex items-start gap-1.5">
                      <Volume2 size={13} className="text-sky-400 shrink-0 mt-0.5" />
                      <span>{beat.snippet || beat.label}</span>
                    </div>

                    {/* 包含的视觉动画详情 */}
                    {beat.visualDetails && beat.visualDetails.length > 0 && (
                      <div className="mt-2 pt-1.5 border-t border-white/10 flex flex-wrap gap-1">
                        {beat.visualDetails.map((v, vIdx) => (
                          <span
                            key={vIdx}
                            className="inline-flex items-center gap-0.5 text-[9.5px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-mono"
                          >
                            <Eye size={9} className="text-emerald-400" />
                            <span>{v}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 交互提示 */}
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                      <span className="flex items-center gap-1">
                        <Sparkles size={10} className="text-seal" />
                        <span>{t('点击跳转至此动作')}</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
