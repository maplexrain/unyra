/**
 * AI 消息气泡上的 TTS 朗读按钮。
 *
 * 点击一键调用统一的 TTS 适配器管理器进行朗读；
 * 朗读中状态呈动态高亮与律动提示，再次点击即可停止。
 */

import { memo } from 'react'
import { Volume2, Square, Loader2 } from 'lucide-react'
import { useTTS } from '../../lib/tts'
import { t } from '../../i18n'

interface Props {
  text: string
}

export const MessageSpeakButton = memo(function MessageSpeakButton({ text }: Props) {
  const { currentText, state, speak, stop } = useTTS()

  const isCurrent = currentText === text
  const isPlaying = isCurrent && state === 'playing'
  const isLoading = isCurrent && state === 'loading'

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isPlaying || isLoading) {
      stop()
      return
    }
    try {
      await speak(text)
    } catch (err) {
      console.warn('[TTS] 朗读失败：', err)
    }
  }

  return (
    <button
      type="button"
      title={isPlaying ? t('停止朗读') : isLoading ? t('准备语音中...') : t('语音朗读')}
      onClick={handleClick}
      className={`flex h-6 items-center justify-center rounded px-1.5 transition cursor-pointer ${
        isPlaying
          ? 'text-seal bg-seal/10 font-medium'
          : isLoading
            ? 'text-ink-faint animate-spin'
            : 'text-ink-faint hover:bg-line/70 hover:text-ink'
      }`}
    >
      {isLoading ? (
        <Loader2 size={12} className="animate-spin" />
      ) : isPlaying ? (
        <Square size={12} className="fill-current" />
      ) : (
        <Volume2 size={12} />
      )}
    </button>
  )
})
