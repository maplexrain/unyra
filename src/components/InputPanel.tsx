/**
 * 设置 → 输入：快捷键。
 *
 * 这一页只回答一个问题——「手怎么把话喂进这个应用」：每条绑定画成一行，
 * 现在是什么、改没改过、和别人撞没撞；改键时直接按键，不再让人手打 "Ctrl+Shift+K"。
 *
 * （语音输入原来也在这里，2026-11 搬去「设置 → 插件 → 功能性插件 → 语音输入」：
 *   它现在是插件，模型、语言、GPU 这些配置都跟着插件那一页走。）
 */

import { useCallback, useEffect, useState } from 'react'
import { Keyboard, RotateCcw } from 'lucide-react'
import { pane } from './Pane'
import {
  comboFromEvent,
  comboLabel,
  formatCombo,
  resetAllShortcuts,
  resetShortcut,
  setShortcut,
  setShortcutRecording,
  shortcutRows,
  type ShortcutRow,
} from '../lib/shortcuts'
import { t } from '../i18n'

interface Props {
  onToast: (msg: string) => void
}

function ShortcutSection({ onToast }: Props) {
  const [rows, setRows] = useState<ShortcutRow[]>(shortcutRows)
  /** 正在录键的那一条；null 表示没在录 */
  const [recordingId, setRecordingId] = useState<string | null>(null)
  /** 录键过程中按住的修饰键（显示成 Ctrl +，让人知道按键已经收到了） */
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')

  const refresh = useCallback(() => setRows(shortcutRows()), [])

  // 录键：这一段时间里快捷键模块整个闭嘴（见 setShortcutRecording），否则按到已占用的
  // 组合会当场触发那个功能，而这会儿用户只是想把键录下来
  useEffect(() => {
    if (!recordingId) return
    setShortcutRecording(true)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecordingId(null)
        setError('')
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) {
        // 只按了修饰键：先显示出来，等主键
        const mods: string[] = []
        if (e.ctrlKey) mods.push('Ctrl')
        if (e.altKey) mods.push('Alt')
        if (e.shiftKey) mods.push('Shift')
        if (e.metaKey) mods.push('Win')
        setPending(mods.join(' + '))
        return
      }
      const text = formatCombo(combo)
      const res = setShortcut(recordingId, text)
      if (res.ok) {
        setRecordingId(null)
        setError('')
        onToast(t('快捷键已改成 {0}', comboLabel(text)))
        refresh()
        return
      }
      // 撞了 / 被占用：停在录键状态，让人直接按另一个
      setError(res.error)
      setPending(text)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setShortcutRecording(false)
    }
  }, [recordingId, onToast, refresh])

  const startRecording = (id: string) => {
    setError('')
    setPending('')
    setRecordingId(id)
  }

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-ink-soft">
        <Keyboard size={13} />
        <span>{t('快捷键')}</span>
      </div>

      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const recording = recordingId === row.id
          return (
            <div key={row.id} className="rounded-lg border border-line bg-card px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-ink-strong">{t(row.label)}</span>
                <span className="rounded-md border border-line-strong/70 bg-paper-deep px-2 py-0.5 font-mono text-[11.5px] text-ink-strong">
                  {recording ? pending || t('请按下组合…') : comboLabel(row.combo)}
                </span>
                {recording ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRecordingId(null)
                      setError('')
                    }}
                    className="rounded-lg px-2 py-0.5 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
                  >
                    {t('取消（Esc）')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => startRecording(row.id)}
                    className="rounded-lg border border-line px-2 py-0.5 text-[11.5px] text-ink transition hover:border-line-strong"
                  >
                    {t('改键')}
                  </button>
                )}
                {row.custom && !recording && (
                  <button
                    type="button"
                    onClick={() => {
                      resetShortcut(row.id)
                      setError('')
                      refresh()
                    }}
                    className="flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
                    title={t('恢复默认 {0}', comboLabel(row.def))}
                  >
                    <RotateCcw size={11} />
                    {t('重置')}
                  </button>
                )}
                {row.conflict && (
                  <span className="text-[11.5px] text-warn-deep">{t('与「{0}」冲突', row.conflict)}</span>
                )}
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-ink-faint">{t(row.hint)}</div>
              {recording && (
                <div className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
                  {t('直接按下想用的组合键（至少要带 Ctrl / Alt / Win，或 F1~F12）。')}
                  {error && <span className="ml-1 text-warn-deep">{t(error)}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            resetAllShortcuts()
            setError('')
            refresh()
            onToast(t('快捷键已全部恢复默认'))
          }}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink transition hover:border-line-strong"
        >
          <RotateCcw size={12} />
          {t('全部恢复默认')}
        </button>
        <span className="text-[11px] text-ink-faint">{t('改完立刻生效，自动保存')}</span>
      </div>
      <div className="mt-2 rounded-lg border border-line bg-card/60 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
        {t('系统已经用掉的组合（Ctrl+C / Ctrl+R / F12 之类）不让绑：拦在这里，总比绑完发现复制不好使强。焦点在输入框里时，不带 Ctrl / Alt / Win 的组合不会触发——否则绑一个字母就把那个字母打不出来了。')}
      </div>
    </section>
  )
}

export default function InputPanel({ onToast }: Props) {
  return (
    <div className={pane(3, true)}>
      <ShortcutSection onToast={onToast} />
    </div>
  )
}
