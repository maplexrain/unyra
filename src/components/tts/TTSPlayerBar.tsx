/**
 * TTS 浮动微型播放控制器 (TTSPlayerBar)
 *
 * 当全局有音频朗读任务时自动滑出展示：
 * - 实时显示当前朗读内容摘要；
 * - 播放/暂停、停止控制；
 * - 语速一键循环切换（1.0x → 1.25x → 1.5x → 0.75x）；
 * - 当前激活适配器标识展示与切换。
 */

import { Pause, Play, Square, Volume2 } from 'lucide-react'
import { useTTS } from '../../lib/tts'
import { t } from '../../i18n'

const SPEED_OPTIONS = [1.0, 1.25, 1.5, 0.75]

export function TTSPlayerBar() {
  const { state, currentText, rate, activeAdapterId, adapters, pause, resume, stop, setRate, setActiveAdapter } = useTTS()

  if (state === 'idle' || !currentText) {
    return null
  }

  const isPaused = state === 'paused'

  const handleNextSpeed = () => {
    const curIdx = SPEED_OPTIONS.findIndex((s) => Math.abs(s - rate) < 0.05)
    const nextIdx = (curIdx + 1) % SPEED_OPTIONS.length
    setRate(SPEED_OPTIONS[nextIdx])
  }

  // 截取前 40 个字符作为播放摘要
  const previewText = currentText.length > 40 ? `${currentText.slice(0, 40)}...` : currentText

  return (
    <div className="flex items-center gap-2.5 rounded-full border border-line-strong/60 bg-paper/95 px-3.5 py-1.5 shadow-lg backdrop-blur-md text-xs text-ink transition-all animate-in fade-in slide-in-from-bottom-2">
      {/* 动态律动指示器 */}
      <div className="flex items-center gap-1 text-seal">
        <Volume2 size={14} className={state === 'playing' ? 'animate-pulse' : ''} />
        <span className="font-medium text-[11px] tracking-wide text-seal">TTS</span>
      </div>

      {/* 文本摘要 */}
      <span className="max-w-[180px] truncate text-ink-subtle select-none font-sans" title={currentText}>
        {previewText}
      </span>

      {/* 适配器切换器 */}
      <select
        value={activeAdapterId}
        onChange={(e) => setActiveAdapter(e.target.value)}
        className="rounded bg-line/40 px-1.5 py-0.5 text-[11px] text-ink-subtle hover:text-ink cursor-pointer border-none outline-none"
        title={t('切换 TTS 适配器')}
      >
        {adapters.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      {/* 语速切换 */}
      <button
        type="button"
        onClick={handleNextSpeed}
        className="rounded bg-line/40 px-1.5 py-0.5 text-[11px] font-mono font-medium text-ink-subtle hover:bg-line hover:text-ink transition cursor-pointer"
        title={t('切换朗读语速')}
      >
        {rate}x
      </button>

      {/* 播放 / 暂停 */}
      <button
        type="button"
        onClick={isPaused ? resume : pause}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-seal/10 text-seal hover:bg-seal hover:text-paper transition cursor-pointer"
        title={isPaused ? t('继续播放') : t('暂停播放')}
      >
        {isPaused ? <Play size={10} className="ml-0.5 fill-current" /> : <Pause size={10} className="fill-current" />}
      </button>

      {/* 停止 */}
      <button
        type="button"
        onClick={stop}
        className="flex h-5 w-5 items-center justify-center rounded-full text-ink-faint hover:bg-line hover:text-ink transition cursor-pointer"
        title={t('停止朗读')}
      >
        <Square size={9} className="fill-current" />
      </button>
    </div>
  )
}
