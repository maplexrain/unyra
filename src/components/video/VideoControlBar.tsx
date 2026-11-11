/*
 * 这个文件负责：底部控制条的**按钮行**——播放/暂停与时间显示、左侧选集/字幕/分段
 * 与右侧笔记的抽屉开关、音量组（静音切换+悬停滑块）、字幕菜单（轨道切换 / 外挂导入 /
 * 时间轴微调 / 字号倍率）、倍速菜单（预设档位与 ±0.1 微调）、截图、水平镜像、全屏。
 * 原样搬自 VideoPlayer.tsx 控制条按钮行区块（样式与注释一行未动）；展示组件按
 * 仓库惯例逐项收 props、内联回调。
 */

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  BookOpen,
  Camera,
  Captions,
  Check,
  FlipHorizontal,
  Gauge,
  ListTree,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { t } from '../../i18n'
import { formatClock } from '../../video/transcript'
import type { Transcript, TranscriptSegment } from '../../video/types'
import { SPEED_PRESETS } from './videoPlayerShared'

export interface VideoControlBarProps {
  isPlaying: boolean
  /** 播放/暂停切换 */
  togglePlay: () => void
  currentTime: number
  effectiveDuration: number
  /** 左侧选集/字幕/分段抽屉开关（没有列表时不传，按钮不画） */
  onToggleLeftOverlay?: () => void
  leftOverlayOpen: boolean
  /** 右侧笔记栏开关 */
  onToggleRightOverlay?: () => void
  rightOverlayOpen: boolean
  /** 音量控制组 */
  isMuted: boolean
  volume: number
  volumeHovered: boolean
  setVolumeHovered: (v: boolean) => void
  toggleMute: () => void
  changeVolume: (val: number) => void
  /** 字幕菜单 */
  subtitleMenuOpen: boolean
  setSubtitleMenuOpen: (v: boolean) => void
  /** 字幕菜单展开时要收起倍速菜单（两个菜单互斥） */
  setSpeedMenuOpen: (v: boolean) => void
  subtitleTrack: 'off' | 'builtin' | 'external'
  setSubtitleTrack: (track: 'off' | 'builtin' | 'external') => void
  transcript?: Transcript | null
  externalSegments: TranscriptSegment[]
  externalName: string
  subtitleOffsetMs: number
  setSubtitleOffsetMs: Dispatch<SetStateAction<number>>
  subtitleScale: number
  changeSubtitleScale: (scale: number) => void
  /** 隐藏的字幕导入 input 挂点（input 本体留在门面） */
  fileInputRef: RefObject<HTMLInputElement | null>
  /** 倍速菜单 */
  speedMenuOpen: boolean
  playbackRate: number
  changePlaybackRate: (rate: number) => void
  /** 右侧功能按钮 */
  takeScreenshot: () => void
  isMirrored: boolean
  toggleMirror: () => void
  isFullscreen: boolean
  toggleFullscreen: () => void
}

export function VideoControlBar({
  isPlaying,
  togglePlay,
  currentTime,
  effectiveDuration,
  onToggleLeftOverlay,
  leftOverlayOpen,
  onToggleRightOverlay,
  rightOverlayOpen,
  isMuted,
  volume,
  volumeHovered,
  setVolumeHovered,
  toggleMute,
  changeVolume,
  subtitleMenuOpen,
  setSubtitleMenuOpen,
  setSpeedMenuOpen,
  subtitleTrack,
  setSubtitleTrack,
  transcript,
  externalSegments,
  externalName,
  subtitleOffsetMs,
  setSubtitleOffsetMs,
  subtitleScale,
  changeSubtitleScale,
  fileInputRef,
  speedMenuOpen,
  playbackRate,
  changePlaybackRate,
  takeScreenshot,
  isMirrored,
  toggleMirror,
  isFullscreen,
  toggleFullscreen,
}: VideoControlBarProps) {
  const speedMenuRef = useRef<HTMLDivElement>(null)

  // 点击空白处或按 Escape 键关闭倍速面板
  useEffect(() => {
    if (!speedMenuOpen) return
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setSpeedMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSpeedMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [speedMenuOpen, setSpeedMenuOpen])

  return (
    <div className="mt-1 flex items-center justify-between text-white/90">
      {/* 左侧：播放/暂停与时间显示 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlay}
          title={isPlaying ? t('暂停 (空格)') : t('播放 (空格)')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/90 transition hover:bg-white/20 hover:text-white"
        >
          {isPlaying ? <Pause size={17} className="fill-white" /> : <Play size={17} className="ml-0.5 fill-white" />}
        </button>

        <div className="flex items-center gap-1 font-mono text-[12px] text-white/80">
          <span className="text-white">{formatClock(currentTime * 1000)}</span>
          <span className="text-white/40">/</span>
          <span>{formatClock(effectiveDuration * 1000)}</span>
        </div>
      </div>

      {/* 右侧功能控制集合 */}
      <div className="flex items-center gap-1.5">
        {/* 左侧选集/字幕/分段抽屉开关 */}
        {onToggleLeftOverlay && (
          <button
            type="button"
            onClick={onToggleLeftOverlay}
            title={leftOverlayOpen ? t('收起列表面板 (Tab)') : t('展开列表面板 (Tab)')}
            aria-expanded={leftOverlayOpen}
            className={
              'flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-[11.5px] transition hover:bg-white/20 ' +
              (leftOverlayOpen ? 'bg-white/25 text-seal font-medium' : 'text-white/80 hover:text-white')
            }
          >
            <ListTree size={15} />
            <span>{t('选集/字幕/分段')}</span>
            <kbd className="hidden sm:inline rounded bg-white/10 px-1 py-0.5 text-[9px] font-mono text-white/60">Tab</kbd>
          </button>
        )}

        {/* 右侧笔记栏开关 */}
        {onToggleRightOverlay && (
          <button
            type="button"
            onClick={onToggleRightOverlay}
            title={rightOverlayOpen ? t('收起笔记 (双击 Shift)') : t('展开笔记 (双击 Shift)')}
            aria-expanded={rightOverlayOpen}
            className={
              'flex h-8 items-center gap-1.5 px-2.5 rounded-lg text-[11.5px] transition hover:bg-white/20 ' +
              (rightOverlayOpen ? 'bg-white/25 text-seal font-medium' : 'text-white/80 hover:text-white')
            }
          >
            <BookOpen size={15} />
            <span>{t('笔记')}</span>
            <kbd className="hidden sm:inline rounded bg-white/10 px-1 py-0.5 text-[9px] font-mono text-white/60">Shift ×2</kbd>
          </button>
        )}

        {/* 音量控制组 */}
        <div
          onMouseEnter={() => setVolumeHovered(true)}
          onMouseLeave={() => setVolumeHovered(false)}
          className="relative flex items-center"
        >
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? t('取消静音 (M)') : t('静音 (M)')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            {isMuted || volume === 0 ? (
              <VolumeX size={17} />
            ) : volume < 0.5 ? (
              <Volume1 size={17} />
            ) : (
              <Volume2 size={17} />
            )}
          </button>

          {/* 音量滑块（悬停展开） */}
          <div
            className={`flex items-center overflow-hidden transition-all duration-200 ${
              volumeHovered ? 'w-20 opacity-100 mr-2' : 'w-0 opacity-0'
            }`}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => changeVolume(parseFloat(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-seal"
              title={t('音量 {0}%', String(Math.round((isMuted ? 0 : volume) * 100)))}
            />
          </div>
        </div>

        {/* 外挂字幕控制：鼠标经过即展开（用户定的，不再要求点击） */}
        <div
          className="relative"
          onMouseEnter={() => {
            setSubtitleMenuOpen(true)
            setSpeedMenuOpen(false)
          }}
          onMouseLeave={() => setSubtitleMenuOpen(false)}
        >
          <button
            type="button"
            title={t('字幕设置')}
            className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium transition hover:bg-white/20 ${
              subtitleTrack !== 'off' ? 'bg-white/15 text-seal font-semibold' : 'text-white/80'
            }`}
          >
            <Captions size={15} />
            <span>{subtitleTrack === 'off' ? t('字幕') : t('字幕开')}</span>
          </button>

          {/* 字幕菜单面板 */}
          {subtitleMenuOpen && (
            <div className="absolute right-0 bottom-full mb-2 w-52 rounded-xl border border-white/15 bg-card/95 p-2 text-ink shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95">
              <div className="px-2 py-1 text-[11px] font-semibold text-ink-faint">
                {t('字幕轨道')}
              </div>

              <button
                type="button"
                onClick={() => {
                  setSubtitleTrack('off')
                  setSubtitleMenuOpen(false)
                }}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-line/50"
              >
                <span>{t('关闭字幕')}</span>
                {subtitleTrack === 'off' && <Check size={13} className="text-seal" />}
              </button>

              {transcript?.segments?.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubtitleTrack('builtin')
                    setSubtitleMenuOpen(false)
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-line/50"
                >
                  <span className="truncate">
                    {t('内置/转录字幕')}
                    {transcript.language ? ` (${transcript.language})` : ''}
                  </span>
                  {subtitleTrack === 'builtin' && <Check size={13} className="text-seal" />}
                </button>
              ) : null}

              {externalSegments.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubtitleTrack('external')
                    setSubtitleMenuOpen(false)
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] text-ink hover:bg-line/50"
                >
                  <span className="truncate" title={externalName}>
                    {t('外挂：{0}', externalName || t('自定义字幕'))}
                  </span>
                  {subtitleTrack === 'external' && <Check size={13} className="text-seal" />}
                </button>
              ) : null}

              <div className="my-1 border-t border-line/60" />

              {/* 导入本地外挂字幕按钮 */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-seal hover:bg-seal/10"
              >
                <Upload size={13} />
                <span>{t('导入外挂字幕 (.srt/.vtt)')}</span>
              </button>

              {/* 时间轴同步微调 */}
              {subtitleTrack !== 'off' && (
                <div className="mt-1 pt-1 border-t border-line/60">
                  <div className="flex items-center justify-between px-2 text-[10.5px] text-ink-faint">
                    <span>{t('时间轴微调')}</span>
                    <span className="font-mono text-seal">
                      {subtitleOffsetMs > 0 ? `+${subtitleOffsetMs}ms` : `${subtitleOffsetMs}ms`}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-1 px-1">
                    <button
                      type="button"
                      onClick={() => setSubtitleOffsetMs((v) => v - 500)}
                      className="rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                    >
                      -0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubtitleOffsetMs(0)}
                      className="flex items-center justify-center rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                      title={t('复位')}
                    >
                      <RotateCcw size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubtitleOffsetMs((v) => v + 500)}
                      className="rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                    >
                      +0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubtitleOffsetMs((v) => v + 1000)}
                      className="rounded bg-line/40 py-0.5 text-center font-mono text-[10px] text-ink hover:bg-line"
                    >
                      +1s
                    </button>
                  </div>
                </div>
              )}

              {/* 字幕字号倍率调节 */}
              {subtitleTrack !== 'off' && (
                <div className="mt-1 pt-1 border-t border-line/60">
                  <div className="flex items-center justify-between px-2 text-[10.5px] text-ink-faint">
                    <span>{t('字幕字号')}</span>
                    <span className="font-mono text-seal font-medium">{subtitleScale}x</span>
                  </div>
                  <div className="mt-1 grid grid-cols-4 gap-1 px-1">
                    {[
                      { label: t('小'), scale: 0.8 },
                      { label: t('标准'), scale: 1.0 },
                      { label: t('大'), scale: 1.25 },
                      { label: t('特大'), scale: 1.5 },
                    ].map((item) => (
                      <button
                        key={item.scale}
                        type="button"
                        onClick={() => changeSubtitleScale(item.scale)}
                        className={`rounded py-0.5 text-center text-[10px] transition ${
                          subtitleScale === item.scale
                            ? 'bg-seal text-white font-medium shadow-xs'
                            : 'bg-line/40 text-ink hover:bg-line'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 倍速控制菜单：点击固定打开，高层级，选择倍速后或点击空白处关闭 */}
        <div ref={speedMenuRef} className="relative z-50">
          <button
            type="button"
            onClick={() => {
              setSpeedMenuOpen(!speedMenuOpen)
              if (!speedMenuOpen) {
                setSubtitleMenuOpen(false)
              }
            }}
            title={t('倍速调节')}
            className={`flex h-8 min-w-[42px] items-center justify-center rounded-lg px-2 text-[12px] font-medium transition cursor-pointer select-none ${
              speedMenuOpen
                ? 'bg-white/25 text-seal font-semibold'
                : 'text-white/80 hover:bg-white/20 hover:text-white'
            }`}
          >
            <span>{playbackRate === 1.0 ? t('倍速') : `${playbackRate}x`}</span>
          </button>

          {/* 倍速选择面板 */}
          {speedMenuOpen && (
            <div className="absolute right-0 bottom-full mb-3 w-48 rounded-2xl border border-line/80 dark:border-white/15 bg-card/95 text-ink shadow-2xl backdrop-blur-xl ring-1 ring-black/5 dark:ring-white/10 p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150 select-none">
              <div className="flex items-center justify-between px-1 pb-2 border-b border-line/60">
                <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-soft">
                  <Gauge size={13} className="text-seal" />
                  <span>{t('播放倍速')}</span>
                </div>
                <span className="font-mono text-[11.5px] font-bold text-seal bg-seal/10 dark:bg-seal/25 px-1.5 py-0.5 rounded">
                  {playbackRate}x
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 py-2">
                {SPEED_PRESETS.map((rate) => {
                  const active = playbackRate === rate
                  return (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => {
                        changePlaybackRate(rate)
                        setSpeedMenuOpen(false)
                      }}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11.5px] font-mono transition-all cursor-pointer ${
                        active
                          ? 'bg-seal text-white font-semibold shadow-xs'
                          : 'text-ink hover:bg-line/50 dark:hover:bg-white/10'
                      }`}
                    >
                      <span>{rate === 1.0 ? '1.0x' : `${rate}x`}</span>
                      {active && <Check size={12} className="stroke-[2.5]" />}
                    </button>
                  )
                })}
              </div>

              <div className="flex items-center justify-between border-t border-line/60 pt-2 px-0.5 gap-1">
                <button
                  type="button"
                  onClick={() => changePlaybackRate(playbackRate - 0.1)}
                  disabled={playbackRate <= 0.25}
                  className="flex-1 rounded-md py-1 text-center font-mono text-[11px] text-ink-soft hover:bg-line/60 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                  title={t('降低 0.1x')}
                >
                  -0.1
                </button>
                <button
                  type="button"
                  onClick={() => {
                    changePlaybackRate(1.0)
                    setSpeedMenuOpen(false)
                  }}
                  className="flex-1 rounded-md py-1 text-center text-[11px] text-ink-soft hover:bg-line/60 hover:text-ink transition cursor-pointer"
                  title={t('重置为 1.0x 正常速度')}
                >
                  {t('正常')}
                </button>
                <button
                  type="button"
                  onClick={() => changePlaybackRate(playbackRate + 0.1)}
                  disabled={playbackRate >= 3.0}
                  className="flex-1 rounded-md py-1 text-center font-mono text-[11px] text-ink-soft hover:bg-line/60 hover:text-ink disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
                  title={t('提高 0.1x')}
                >
                  +0.1
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 截图当前画面 */}
        <button
          type="button"
          onClick={takeScreenshot}
          title={t('截图 (保存当前帧并复制到剪贴板)')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <Camera size={16} />
        </button>

        {/* 水平镜像翻转 */}
        <button
          type="button"
          onClick={toggleMirror}
          title={isMirrored ? t('关闭镜像翻转') : t('水平镜像翻转')}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/20 ${
            isMirrored ? 'bg-white/20 text-seal' : 'text-white/80 hover:text-white'
          }`}
        >
          <FlipHorizontal size={16} />
        </button>

        {/* 全屏切换 */}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? t('退出全屏 (F)') : t('全屏 (F)')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </div>
    </div>
  )
}
