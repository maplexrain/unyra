import { useEffect, useRef, useMemo } from 'react'
import type { PlaybackStatus, TimelineBeat } from '../../../learn/classroom/types'
import { Eye } from 'lucide-react'

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
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const activeBeatRef = useRef<HTMLButtonElement | null>(null)

  // 当激活节拍变化时自动平滑滚动居中
  useEffect(() => {
    if (activeBeatRef.current && scrollContainerRef.current) {
      activeBeatRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      })
    }
  }, [activeBeatIndex])

  // 按画面 Scene 对 Beats 进行分组
  const sceneGroups = useMemo(() => {
    const groups: Array<{ sceneIndex: number; title: string; beats: Array<{ beat: TimelineBeat; globalIdx: number }> }> = []
    beats.forEach((b, idx) => {
      let g = groups.find((item) => item.sceneIndex === b.sceneIndex)
      if (!g) {
        g = { sceneIndex: b.sceneIndex, title: b.sceneTitle, beats: [] }
        groups.push(g)
      }
      g.beats.push({ beat: b, globalIdx: idx })
    })
    return groups
  }, [beats])

  return (
    <div
      ref={scrollContainerRef}
      className="w-full border-t border-line/60 bg-paper/95 px-4 py-2.5 overflow-x-auto overflow-y-hidden select-none [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line/70"
    >
      <div className="flex items-center gap-6 min-w-max">
        {sceneGroups.map((group) => (
          <div key={`scene_${group.sceneIndex}`} className="flex items-center gap-2">
            {/* 画面分段标题胶囊 */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-line/40 text-[11.5px] font-semibold text-ink-soft shrink-0 border border-line/30">
              <span className="w-1.5 h-1.5 rounded-full bg-seal" />
              <span>{group.title}</span>
            </div>

            {/* 该画面下的所有动作节拍 */}
            <div className="flex items-center gap-1.5">
              {group.beats.map(({ beat, globalIdx }) => {
                const isActive = globalIdx === activeBeatIndex
                const isPassed = globalIdx < activeBeatIndex
                const isPlaying = isActive && status === 'playing'

                return (
                  <button
                    key={beat.beatId}
                    type="button"
                    ref={isActive ? activeBeatRef : null}
                    onClick={() => onSeek(beat.sceneIndex, beat.startActionIndex)}
                    title={`跳转到：${beat.label}`}
                    className={`group relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-left transition cursor-pointer border ${
                      isActive
                        ? 'bg-seal/15 border-seal text-seal font-bold shadow-xs'
                        : isPassed
                        ? 'bg-card text-ink-soft border-line/50 hover:border-line hover:text-ink'
                        : 'bg-card/50 text-ink-faint border-line/30 hover:border-line/70 hover:text-ink-soft'
                    }`}
                  >
                    {/* 状态徽标 */}
                    <div className="flex items-center justify-center shrink-0">
                      {isPlaying ? (
                        <span className="flex h-2.5 w-2.5 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-seal opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-seal" />
                        </span>
                      ) : isActive ? (
                        <span className="inline-flex rounded-full h-2 w-2 bg-seal" />
                      ) : (
                        <span
                          className={`inline-flex rounded-full h-1.5 w-1.5 ${
                            isPassed ? 'bg-ink-soft' : 'bg-line-strong/60'
                          }`}
                        />
                      )}
                    </div>

                    {/* 节拍文本描述 */}
                    <span className="text-[12px] truncate max-w-[150px]">{beat.label}</span>

                    {/* 视觉动画项数小徽标 */}
                    {beat.visualActionCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] px-1 py-0.2 rounded bg-line/50 text-ink-faint opacity-80 shrink-0">
                        <Eye size={10} />
                        <span>{beat.visualActionCount}</span>
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
