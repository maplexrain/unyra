/**
 * 输入框里的麦克风按钮与录音中的小计时器。
 *
 * 交互与视觉规范：
 * 1. 点一下话筒开始录音；识别出来的文字**分块直接写进输入框**（没有预览浮窗、没有缓存区）；
 * 2. 录音时按钮左边亮出一颗红点与计时，点它、敲空格 / 回车都结束这一段；Esc 丢弃；
 * 3. 识别与音频缓存的节制在 lib/voice/session（分块、静音 3 秒丢缓存），这里只管画；
 * 4. 错误提示可自关闭，贴在按钮上方，不遮挡输入区。
 */

import { useEffect, useSyncExternalStore } from 'react'
import { Loader2, X } from 'lucide-react'
import {
  cancelRecording,
  clearVoiceMessage,
  setVoiceSink,
  startRecording,
  stopRecording,
  subscribeVoice,
  voiceState,
  type VoiceSink,
} from '../../../lib/voice/session'
import { voicePluginOn } from '../../../lib/voice/plugin'
import { t } from '../../../i18n'

/** 话筒：一个圆角矩形的话筒头 + 一道托架弧 + 一根立杆。24 的网格里画，按 size 缩 */
function MicGlyph({ size, filled }: { size: number; filled: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="9"
        y="3"
        width="6"
        height="11"
        rx="3"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.5 21h7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

const subscribe = (cb: () => void) => subscribeVoice(cb)

interface Props {
  /**
   * 这一份输入框是不是眼前的那一份。
   * 页签是 keepalive 的：每枚面板都挂着一个麦克风，只有可见的那一枚能登记接收方——
   * 否则转录出来的字会落进别的那一页的输入框（落点是模块级单槽）。
   */
  active?: boolean
  /**
   * 造一个「实时落字器」：输入框那一侧负责两件事——
   * 用这一段的全文替换上一次写进去的同段文字；这一段定稿时收口。
   */
  makeSink: () => VoiceSink | null
}

export default function MicButton({ makeSink, active = true }: Props) {
  const state = useSyncExternalStore(subscribe, voiceState)
  const recording = state.phase === 'recording'
  const working = state.phase === 'working'
  const hasError = state.phase === 'error' && !!state.message

  // 把落字器登记给会话；切到后台 / 卸载时注销（注销只对「最后一次登记」生效）
  useEffect(() => {
    if (!active) return
    const next = makeSink()
    if (!next) return
    return setVoiceSink(next)
  }, [makeSink, active])

  /**
   * 录音期间快捷键：空格或回车结束、Esc 取消。
   * 用捕获阶段并阻止默认：防止击键打进编辑器引发冲突。
   */
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault()
        e.stopPropagation()
        void stopRecording()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelRecording()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording])

  if (!voicePluginOn()) return null

  const title = recording
    ? t('正在录音（{0}）——按空格/回车或再点一下完成，Esc 丢弃剩余录音', clock(state.seconds))
    : working
      ? t('识别处理中…')
      : t('语音输入：点一下开始，边说边写进输入框')

  return (
    <div className="relative flex items-center gap-1">
      {/* 报错小弹条 */}
      {hasError && (
        <div className="absolute bottom-full right-0 mb-2 z-50 flex w-[280px] items-start gap-2 rounded-xl border border-warn/40 bg-card/95 p-2.5 text-[11px] leading-snug text-ink shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-md">
          <span className="flex-1 text-warn">{state.message}</span>
          <button
            type="button"
            onClick={clearVoiceMessage}
            className="shrink-0 p-0.5 text-ink-faint hover:text-ink transition"
            title={t('关闭')}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/*
        录音中的小计时器：一颗红点 + 秒数。它同时也是一条「结束」按钮——
        文字已经在输入框里了，这里只管「什么时候收工」，不再占一块预览区。
      */}
      {recording && (
        <button
          type="button"
          onClick={() => void stopRecording()}
          title={t('完成（空格 / 回车）')}
          className="flex h-7 items-center gap-1.5 rounded-md bg-seal/10 px-2 text-[11px] tabular-nums text-seal-deep transition hover:bg-seal/15"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-70" />
            {/* 声音越大点越大：没有预览浮窗之后，这一点放大就是「它在听」的反馈 */}
            <span
              className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal transition-transform duration-100"
              style={{ transform: 'scale(' + (1 + Math.min(0.8, state.level * 6)).toFixed(2) + ')' }}
            />
          </span>
          {clock(state.seconds)}
        </button>
      )}

      {/* 话筒主按钮 */}
      <button
        type="button"
        title={title}
        aria-label={title}
        aria-pressed={recording}
        onClick={() => {
          if (recording) {
            void stopRecording()
            return
          }
          if (working) return
          clearVoiceMessage()
          void startRecording()
        }}
        className={
          'relative flex h-7 w-7 items-center justify-center rounded-md transition ' +
          (recording
            ? 'bg-seal/15 text-seal ring-2 ring-seal/40 shadow-sm'
            : working
              ? 'text-ink-faint'
              : 'text-ink-soft hover:bg-line/40 hover:text-seal')
        }
      >
        {working ? (
          <Loader2 size={15} className="animate-spin text-ink-faint" />
        ) : (
          <MicGlyph size={15} filled={recording} />
        )}
      </button>
    </div>
  )
}
