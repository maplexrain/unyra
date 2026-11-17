import type { PlaybackStatus } from '../../../learn/classroom/types'
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  Maximize,
  Minimize,
  FileCode,
  FolderTree,
} from 'lucide-react'
import { t } from '../../../i18n'

export interface ClassroomControlsProps {
  status: PlaybackStatus
  playbackRate: number
  onTogglePlay: () => void
  onPrevBeat: () => void
  onNextBeat: () => void
  onSetRate: (rate: number) => void
  onReplay: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
  onToggleResources: () => void
  hasResources: boolean
  isResourcesOpen: boolean
  onOpenEditor: () => void
}

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 2.0]

export default function ClassroomControls({
  status,
  playbackRate,
  onTogglePlay,
  onPrevBeat,
  onNextBeat,
  onSetRate,
  onReplay,
  isFullscreen,
  onToggleFullscreen,
  onToggleResources,
  hasResources,
  isResourcesOpen,
  onOpenEditor,
}: ClassroomControlsProps) {
  const isPlaying = status === 'playing'
  const isEnded = status === 'ended'

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-line/40 bg-card/90 backdrop-blur-md select-none shrink-0">
      {/* 左侧：播放核心控制组 */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onPrevBeat}
          title={t('上一节拍')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
        >
          <SkipBack size={16} />
        </button>

        {isEnded ? (
          <button
            type="button"
            onClick={onReplay}
            title={t('重新开讲')}
            className="flex h-8.5 w-8.5 items-center justify-center rounded-lg bg-seal text-white hover:bg-seal-deep shadow-xs transition cursor-pointer"
          >
            <RotateCcw size={16} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onTogglePlay}
            title={isPlaying ? t('暂停 (空格)') : t('播放 (空格)')}
            className="flex h-8.5 w-8.5 items-center justify-center rounded-lg bg-seal text-white hover:bg-seal-deep shadow-xs transition cursor-pointer"
          >
            {isPlaying ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
          </button>
        )}

        <button
          type="button"
          onClick={onNextBeat}
          title={t('下一节拍')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
        >
          <SkipForward size={16} />
        </button>

        {/* 状态指示小字 */}
        <div className="ml-2 text-[12px] font-mono text-ink-faint">
          {status === 'playing'
            ? t('正在演播...')
            : status === 'paused'
            ? t('已暂停')
            : status === 'waiting_checkpoint'
            ? t('等待思考')
            : status === 'ended'
            ? t('演播完毕')
            : t('就绪')}
        </div>
      </div>

      {/* 右侧：倍速与功能工具 */}
      <div className="flex items-center gap-2">
        {/* 倍速切换 */}
        <div className="flex items-center rounded-lg bg-line/40 p-0.5 text-[11px] font-semibold border border-line/30">
          {SPEED_OPTIONS.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => onSetRate(rate)}
              className={`rounded px-1.5 py-0.5 transition ${
                playbackRate === rate
                  ? 'bg-card text-seal font-bold shadow-2xs'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* 关联子资源坞开关 */}
        <button
          type="button"
          onClick={onToggleResources}
          title={t('课堂关联资源（笔记/考试/超级文档/文件）')}
          className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] font-medium transition cursor-pointer border ${
            isResourcesOpen
              ? 'bg-seal/15 border-seal text-seal font-bold'
              : 'border-line/40 text-ink-soft hover:bg-line/50 hover:text-ink'
          }`}
        >
          <FolderTree size={14} />
          <span>{t('关联资源')}</span>
          {hasResources && <span className="w-1.5 h-1.5 rounded-full bg-seal" />}
        </button>

        {/* 课件 DSL JSON 查看与编辑 */}
        <button
          type="button"
          onClick={onOpenEditor}
          title={t('查看/编辑课件 DSL (JSON)')}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line/40 text-ink-soft hover:bg-line/50 hover:text-ink transition cursor-pointer"
        >
          <FileCode size={15} />
        </button>

        {/* 全屏切换 */}
        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? t('退出全屏') : t('全屏呈现')}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-line/40 text-ink-soft hover:bg-line/50 hover:text-ink transition cursor-pointer"
        >
          {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
        </button>
      </div>
    </div>
  )
}
