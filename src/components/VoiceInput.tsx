/**
 * 语音输入的全局接线：登记快捷键、画那个「正在听」的小条。
 *
 * 它挂在 App 上（每个路由分支都挂一份），所以「光标在任意输入框里按住 Ctrl+T」
 * 这件事对全应用有效——聊天框、笔记、试卷填空、登录页的昵称框，都一样。
 *
 * 小条的位置贴着**当前光标所在的那个输入框**（它的位置由会话每次心跳报上来），
 * 而不是固定在屏幕某处：说话的人眼睛在输入框上，提示就该在那儿。
 * 找不到目标（比如焦点根本不在输入框里）时退到屏幕下方居中，把原因说清楚。
 */

import { useEffect, useState } from 'react'
import { Loader2, Mic } from 'lucide-react'
import { useShortcut } from '../lib/useShortcut'
import {
  abortVoice,
  startVoice,
  stopVoice,
  subscribeVoice,
  voiceState,
  type VoiceState,
} from '../lib/voice/session'
import { useVoiceSettings } from '../lib/voice/settings'
import { t } from '../i18n'

/** 订阅会话状态；只在这一层订阅，别的地方要读就读 voiceState() */
function useVoice(): VoiceState {
  const [value, setValue] = useState(voiceState)
  useEffect(() => subscribeVoice(() => setValue(voiceState())), [])
  return value
}

/** 电平条：5 根竖条按音量起伏。RMS 一般只有 0.0x，乘 6 再夹到 1 才看得出动 */
function LevelMeter({ level }: { level: number }) {
  const scaled = Math.min(1, Math.max(0.06, level * 6))
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
      {[0.55, 0.85, 1, 0.75, 0.5].map((weight, i) => (
        <i
          key={i}
          className="w-[3px] rounded-full bg-seal transition-[height] duration-100"
          style={{ height: Math.max(3, Math.round(16 * scaled * weight)) + 'px' }}
        />
      ))}
    </span>
  )
}

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

export default function VoiceInput() {
  const voice = useVoice()
  const settings = useVoiceSettings()

  // 换路由 / 换用户时把话筒收掉：那个组件已经不在了，不该还占着麦克风
  useEffect(() => () => abortVoice(), [])

  // 按下开始听、松开结束。按住型快捷键（见 lib/shortcuts 的 hold）。
  // 关掉开关时连键都不登记：那时候按下去应当什么都不发生
  useShortcut('voice.input', {
    enabled: settings.enabled,
    down: () => void startVoice(),
    up: () => stopVoice(),
  })

  if (voice.phase === 'idle') return null

  const failed = voice.phase === 'error'
  const anchor = voice.anchor
  // 贴着输入框上沿；没有目标就退到屏幕下方居中
  const style = anchor
    ? {
        left: Math.round(Math.min(Math.max(anchor.left, 12), window.innerWidth - 320)) + 'px',
        top: Math.max(12, anchor.top - 54) + 'px',
      }
    : { left: '50%', bottom: '72px', transform: 'translateX(-50%)' }

  return (
    <div
      role="status"
      style={style}
      className={
        'no-print pointer-events-none fixed z-50 flex max-w-[420px] items-center gap-2.5 rounded-xl border px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.22)] transition-colors ' +
        (failed ? 'border-warn/50 bg-warn/95 text-white' : 'border-line-strong bg-card/97 text-ink')
      }
    >
      {failed ? (
        <span className="text-[12px] leading-snug">{voice.message}</span>
      ) : voice.phase === 'preparing' ? (
        <>
          <Mic size={14} className="shrink-0 animate-pulse text-seal" />
          <span className="text-[12px] leading-snug">{voice.message || t('正在准备语音模型…')}</span>
        </>
      ) : (
        <>
          {voice.busy && !voice.text ? (
            <Loader2 size={14} className="shrink-0 animate-spin text-seal" />
          ) : (
            <Mic size={14} className="shrink-0 text-seal" />
          )}
          <LevelMeter level={voice.level} />
          <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-ink-strong">
            {/*
              message 在「正在听」这一档也要露出来：看门狗与「有声音但认不出字」的提示
              都写在这里，藏起来的话用户看到的又是「它没反应」
            */}
            {voice.text || voice.message || (voice.busy ? t('识别中…') : t('在听…（松开结束）'))}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">{clock(voice.seconds)}</span>
        </>
      )}
    </div>
  )
}