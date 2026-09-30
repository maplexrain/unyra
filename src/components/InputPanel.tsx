/**
 * 设置 → 输入：语音转文字 + 快捷键。
 *
 * 两块放在一起是因为它们回答的是同一个问题——「话怎么进这个应用」：
 * 一块管嘴（语音），一块管手（键盘）。
 *
 * 语音那块的按钮全部围绕模型：它 57 MB，下载要有进度、要能取消、要能换一份本地的、
 * 也要能删掉把磁盘要回来。快捷键那块则把每条绑定画成一行：现在是什么、改没改过、
 * 和别人撞没撞——改键时直接按键，不再让人手打 "Ctrl+Shift+K" 这种字符串。
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Download, FolderOpen, Keyboard, Mic, RotateCcw, Trash2, X } from 'lucide-react'
import { pane } from './Pane'
import Switch from './Switch'
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
import { useVoiceSettings, setVoiceSetting } from '../lib/voice/settings'
import { SAMPLE_RATE, startMic } from '../lib/voice/mic'
import { voiceBackend } from '../lib/voice/session'
import { t } from '../i18n'
import {
  cancelDownload,
  chooseModelFile,
  downloadModel,
  formatBytes,
  modelStatus,
  onModelProgress,
  removeModel,
  revealModel,
  type ModelStatus,
} from '../lib/voice/model'

interface Props {
  onToast: (msg: string) => void
}

/* ---------- 语音转文字 ---------- */

function VoiceSection({ onToast }: Props) {
  const settings = useVoiceSettings()
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** 麦克风自检：只开话筒、不碰 whisper，用来分辨「声音没进来」与「引擎不认字」 */
  const [micTest, setMicTest] = useState<null | {
    running: boolean
    level: number
    seconds: number
    device: string
    samples: number
  }>(null)

  const refresh = useCallback(() => {
    void modelStatus().then(setStatus)
  }, [])

  useEffect(refresh, [refresh])

  // 下载进度由主进程推（见 electron/voice.ts）：每 512 KB 一条
  useEffect(
    () =>
      onModelProgress((p) => {
        setPercent(p.percent)
        setNote(p.note ?? '')
        if (p.percent >= 100) refresh()
      }),
    [refresh],
  )

  const startDownload = () => {
    setError('')
    setBusy(true)
    setPercent(0)
    void downloadModel()
      .then((res) => {
        if (!res.ok) setError(res.error ?? t('下载失败'))
        else onToast(t('语音模型下载完成') + (res.source ? t('（来自{0}）', res.source) : ''))
      })
      .finally(() => {
        setBusy(false)
        setPercent(null)
        setNote('')
        refresh()
      })
  }

  const pickLocal = () => {
    setError('')
    void chooseModelFile().then((res) => {
      if (res.canceled) return
      if (!res.ok) setError(res.error ?? t('没能用这个文件'))
      else onToast(t('已改用本机那份模型'))
      refresh()
    })
  }

  const drop = () => {
    void removeModel().then((res) => {
      if (!res.ok) setError(res.error ?? t('删除失败'))
      else onToast(t('已删除语音模型'))
      refresh()
    })
  }

  /**
   * 麦克风自检：开 8 秒话筒，把电平、收到的秒数与设备名实时显示出来。
   *
   * 它**不经过 whisper**——「说话没反应」这类问题，这一步就能劈成两半：
   * 是声音根本没进来（设备 / 权限 / 静音键），还是引擎不认字（模型 / 音频格式）。
   * 没有这个按钮的话，两种情况在界面上长得一模一样。
   */
  const testMic = () => {
    setError('')
    setMicTest({ running: true, level: 0, seconds: 0, device: '', samples: 0 })
    void (async () => {
      try {
        const session = await startMic()
        const timer = window.setInterval(() => {
          setMicTest({
            running: true,
            level: session.level(),
            seconds: session.seconds(),
            device: session.device(),
            samples: session.samples(),
          })
        }, 150)
        window.setTimeout(() => {
          window.clearInterval(timer)
          const samples = session.samples()
          const device = session.device()
          session.stop()
          setMicTest({ running: false, level: 0, seconds: samples / SAMPLE_RATE, device, samples })
          console.info(
            '[voice] 麦克风自检：收到 ' + samples + ' 个采样（' + (samples / SAMPLE_RATE).toFixed(1) + ' 秒），设备：' + device,
          )
        }, 8000)
      } catch (err) {
        setMicTest(null)
        setError(err instanceof Error ? err.message : t('打不开麦克风'))
      }
    })()
  }

  const ready = status?.exists === true

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-ink-soft">
        <Mic size={13} />
        <span>{t('语音转文字')}</span>
      </div>

      <Switch
        on={settings.enabled}
        onChange={(next) => setVoiceSetting({ enabled: next })}
        label={t('启用语音输入')}
        hint={t('光标放在任意输入框里，按住快捷键说话，松开结束；说的字实时落到光标处（第一次用会向系统申请麦克风权限）。')}
      />
      <div className="mt-2">
        <Switch
          on={settings.gpu}
          onChange={(next) => setVoiceSetting({ gpu: next })}
          label={t('用 GPU 加速（WebGPU）')}
          hint={t('同一台机器上实测差 40 倍：识别 3 秒音频，CPU 要 16 秒、显卡只要 1 秒出头。显卡或驱动不支持时会自动退回 CPU，不用管这个开关；只有在显卡驱动有毛病、转写出错时才需要关掉。')}
        />
      </div>
      {voiceBackend() && (
        <div className="mt-1.5 text-[11px] text-ink-faint">
          {t('上次实际用的是：{0}', voiceBackend() === 'gpu' ? t('WebGPU（显卡）') : t('CPU（自动回退过一次）'))}
        </div>
      )}

      <div className="mt-2 rounded-lg border border-line bg-card px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          <span className="text-ink-faint">{t('语音模型')}</span>
          {status === null ? (
            <span className="text-ink-faint">{t('正在检查…')}</span>
          ) : ready ? (
            <span className="flex items-center gap-1 text-ink-strong">
              <Check size={12} className="text-seal" />
              {t('已就绪 · {0}', formatBytes(status.bytes))}
            </span>
          ) : (
            <span className="text-ink-soft">{t('还没下载（whisper.cpp base q5_1，约 57 MB）')}</span>
          )}
        </div>

        {status && <div className="mt-1 break-all font-mono text-[10.5px] text-ink-faint">{status.path}</div>}

        {note && <div className="mt-1.5 text-[11px] text-ink-soft">{note}</div>}
        {percent !== null && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-seal transition-[width] duration-200" style={{ width: percent + '%' }} />
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {busy ? (
            <button
              type="button"
              onClick={() => void cancelDownload()}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink transition hover:border-line-strong"
            >
              <X size={12} />
              {t('取消下载')}
            </button>
          ) : (
            <button
              type="button"
              onClick={startDownload}
              className="flex items-center gap-1.5 rounded-lg bg-seal px-2.5 py-1 text-[11.5px] font-medium text-white transition hover:bg-seal-deep"
            >
              <Download size={12} />
              {ready ? t('重新下载') : t('下载模型')}
            </button>
          )}
          <button
            type="button"
            onClick={pickLocal}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink transition hover:border-line-strong"
          >
            <FolderOpen size={12} />
            {t('用本机文件')}
          </button>
          {ready && (
            <>
              <button
                type="button"
                onClick={() => void revealModel()}
                className="rounded-lg px-2 py-1 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
              >
                {t('在文件夹中显示')}
              </button>
              <button
                type="button"
                onClick={drop}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-faint transition hover:bg-seal/10 hover:text-seal"
              >
                <Trash2 size={11} />
                {t('删除模型')}
              </button>
            </>
          )}
        </div>

        {/* 麦克风自检：与模型无关的一段，专门用来查「声音到底进没进来」 */}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <button
            type="button"
            onClick={testMic}
            disabled={micTest?.running}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink transition hover:border-line-strong disabled:pointer-events-none disabled:opacity-50"
          >
            <Mic size={12} />
            {micTest?.running ? t('正在听（8 秒）…') : t('测试麦克风')}
          </button>
          {micTest && (
            <span className="flex items-center gap-2 text-[11px] text-ink-soft">
              <span className="inline-flex h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <span
                  className="h-full rounded-full bg-seal transition-[width] duration-100"
                  style={{ width: Math.min(100, Math.round(micTest.level * 600)) + '%' }}
                />
              </span>
              {micTest.running
                ? t('已收 {0} 秒', micTest.seconds.toFixed(1))
                : t('收到 {0} 秒音频', micTest.seconds.toFixed(1))}
            </span>
          )}
        </div>
        {micTest && !micTest.running && (
          <div className="mt-1.5 text-[11px] leading-relaxed">
            {micTest.samples > 0 ? (
              <span className="text-ink-soft">{t('话筒是通的：{0}', micTest.device)}</span>
            ) : (
              <span className="text-warn-deep">
                {t('一点声音都没收到（设备：{0}）。检查系统默认输入设备、麦克风上的静音键，以及系统有没有允许本应用使用麦克风', micTest.device || t('未知'))}
              </span>
            )}
          </div>
        )}
        {error && <div className="mt-2 text-[11px] leading-relaxed text-warn-deep">{error}</div>}
        <div className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {t('识别在 whisper.cpp 的 WASM 引擎里跑，跑在单独的 Worker 里——解一段音频要几秒，占着主线程会把界面卡住。音频不出本机，也不写盘：只在这一轮转写里存在内存中。')}
        </div>
      </div>
    </section>
  )
}

/* ---------- 快捷键 ---------- */

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
    <div className={pane(5, true)}>
      <VoiceSection onToast={onToast} />
      <ShortcutSection onToast={onToast} />
    </div>
  )
}