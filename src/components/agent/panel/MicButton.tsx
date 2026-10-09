/**
 * 输入框里的麦克风按钮：**按一下开始录，再按一下（或敲空格）结束，然后出字**。
 *
 * 三件事写在这里，别处都不重复：
 * 1. **画那颗按钮**——手绘的 SVG（话筒头 + 支架），不是图标字体：录音时它要变成
 *    实心 + 一圈呼吸的环，图标件给不了这种状态；
 * 2. **空格结束**：录音期间在捕获阶段拦下空格（不拦的话它会打进取词框里）。
 *    Esc 则是「这一段不要了」；
 * 3. **出字落进输入框**：识别结果经 setVoiceSink 交回这里，再由 insertTextAtCaret
 *    插到光标处（见 lib/composerDoc）。
 *
 * 只有插件开着的时候才画（见 lib/voice/plugin）：这是「设置 → 插件」里的一项功能，
 * 没开就不该在输入框上留一颗按了没反应的按钮。
 */
import { useEffect } from 'react'
import { clearVoiceMessage, cancelRecording, setVoiceSink, startRecording, stopRecording, subscribeVoice, voiceState } from '../../../lib/voice/session'
import { voicePluginOn } from '../../../lib/voice/plugin'
import { t } from '../../../i18n'
import { useSyncExternalStore } from 'react'

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
  /** 识别出来的文字：调用方插进输入框（见 Composer 的 editorRef） */
  onText: (text: string) => void
}

export default function MicButton({ onText }: Props) {
  const state = useSyncExternalStore(subscribe, voiceState)
  const recording = state.phase === 'recording'
  const working = state.phase === 'working'

  // 结果交回输入框；组件卸载时注销，免得文字落到一个已经不在的输入框上
  useEffect(() => {
    setVoiceSink(onText)
    return () => setVoiceSink(null)
  }, [onText])

  /**
   * 录音期间的两个键：**空格结束**（用户要的那个）、Esc 丢弃。
   * 用捕获阶段并阻止默认：不拦的话空格会打进取词框，而取词框正是此刻的焦点。
   */
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
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
    ? t('正在录音（{0}）——按空格或再点一下结束，Esc 丢弃', clock(state.seconds))
    : working
      ? t('识别中…')
      : t('语音输入：点一下开始录，说完按空格结束')

  return (
    <div className="relative">
      {recording && (
        <span className="pointer-events-none absolute -top-7 right-0 whitespace-nowrap rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-ink-soft shadow-sm">
          {clock(state.seconds)} · {t('空格结束')}
        </span>
      )}
      {(state.phase === 'error' || working) && state.message && (
        <span className="pointer-events-none absolute bottom-full right-0 mb-2 w-[260px] rounded-lg border border-warn/40 bg-warn/95 px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
          {state.message}
        </span>
      )}
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
        /*
         * 没有底色、没有边框：它跟发送键那一排图标一样，是「浮在输入卡片上的一个动作」。
         * 状态只靠颜色与那个实心的话筒头表达——录音时整颗话筒变印章红并填实。
         */
        className={
          'flex h-8 w-8 items-center justify-center rounded-lg transition ' +
          (recording
            ? 'text-seal'
            : working
              ? 'text-ink-faint'
              : 'text-ink-soft hover:text-seal')
        }
      >
        <MicGlyph size={15} filled={recording} />
      </button>
    </div>
  )
}
