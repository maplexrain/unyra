/**
 * 设置 → 插件 → 功能性插件 → 语音输入：这一项自己的配置页。
 *
 * 三块，按「从没有到能用」的顺序排：
 * 1. **模型**：SenseVoiceSmall 的 228 MB 在这儿下（下载、换本机文件、删掉，
 *    以及「下到哪儿了」的进度）。没有它，插件根本打不开——守卫就写在这里的下一步。
 * 2. **识别**：语言（默认自动）与 GPU 加速（默认跟着设备走：有显卡就用）。
 * 3. **它是什么**：引擎跑在哪、音频去哪了——这一页是用户唯一能读到这些的地方。
 *
 * 页面本身不做判定：能不能开由 lib/plugins 的守卫说了算，模型状态由主进程说了算。
 */

import { useCallback, useEffect, useState } from 'react'
import { Check, Download, FolderOpen, Trash2, X } from 'lucide-react'
import {
  cancelDownload,
  chooseModelFile,
  downloadModel,
  formatBytes,
  modelStatus,
  onModelProgress,
  removeModel,
  revealModel,
  VOICE_MODEL_MB,
  VOICE_MODEL_NAME,
  type ModelStatus,
} from '../../lib/voice/model'
import {
  VOICE_LANGUAGES,
  pinVoiceGpu,
  refreshVoiceGpuDefault,
  setVoiceSetting,
  useVoiceSettings,
  voiceGpu,
  voiceGpuName,
  voiceHasGpu,
  type VoiceLanguage,
} from '../../lib/voice/settings'
import { t } from '../../i18n'

const LANGUAGE_LABELS: Record<VoiceLanguage, string> = {
  auto: '自动',
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  yue: '粤语',
}

interface Props {
  onToast: (msg: string) => void
}

export function PluginVoicePage({ onToast }: Props) {
  const settings = useVoiceSettings()
  const [status, setStatus] = useState<ModelStatus | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void modelStatus().then(setStatus)
  }, [])

  useEffect(() => {
    refresh()
    // 换显卡 / 插坞之后不该要求重启：进这一页就问一次设备
    void refreshVoiceGpuDefault()
  }, [refresh])

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

  const ready = status?.exists === true
  const gpuOn = voiceGpu()

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- 模型 ---------- */}
      <section>
        <div className="mb-2 text-ink-soft">{t('模型')}</div>
        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            <span className="text-ink-strong">{VOICE_MODEL_NAME}</span>
            {status === null ? (
              <span className="text-ink-faint">{t('正在检查…')}</span>
            ) : ready ? (
              <span className="flex items-center gap-1 text-ink-strong">
                <Check size={12} className="text-seal" />
                {t('已就绪 · {0}', formatBytes(status.bytes))}
              </span>
            ) : status.bytes > 0 ? (
              <span className="text-ink-soft">
                {t('还没下完（{0} / {1}）', formatBytes(status.bytes), formatBytes(status.totalBytes))}
              </span>
            ) : (
              <span className="text-ink-soft">{t('还没下载（约 {0} MB）', VOICE_MODEL_MB)}</span>
            )}
          </div>

          {status && <div className="mt-1 break-all font-mono text-[10.5px] text-ink-faint">{status.dir}</div>}
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
            <button
              type="button"
              onClick={() => void revealModel()}
              className="rounded-lg px-2 py-1 text-[11.5px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
            >
              {t('在文件夹中显示')}
            </button>
            {ready && (
              <button
                type="button"
                onClick={drop}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] text-ink-faint transition hover:bg-seal/10 hover:text-seal"
              >
                <Trash2 size={11} />
                {t('删除模型')}
              </button>
            )}
          </div>

          {error && <div className="mt-2 text-[11px] leading-relaxed text-warn-deep">{error}</div>}
          <div className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {t('「用本机文件」挑的是 model.int8.onnx，词表 tokens.txt 要放在同一个目录里（从 HuggingFace 整份下下来的目录就是这个样子）。模型存在系统用户目录下，不属于任何一份学习数据——换用户、换数据目录都还在。')}
          </div>
        </div>
      </section>

      {/* ---------- 识别 ---------- */}
      <section>
        <div className="mb-2 text-ink-soft">{t('识别')}</div>

        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <div className="text-[12.5px] text-ink-strong">{t('识别语言')}</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
            {t('默认自动：SenseVoice 自己判断这一段是哪种语言，中英混说也不用切。话里夹着专业词、或者它认错了语种时，指定一种会更准。')}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {VOICE_LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setVoiceSetting({ language: code })}
                className={
                  'rounded-lg border px-2.5 py-1 text-[11.5px] transition ' +
                  (settings.language === code
                    ? 'border-seal/60 bg-seal/10 text-seal-deep'
                    : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink')
                }
              >
                {t(LANGUAGE_LABELS[code])}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-card px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-ink-strong">{t('GPU 加速')}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {voiceHasGpu()
                  ? t('检测到显卡：{0}。默认就走它；语音运行时没带 GPU 版时会自己退回 CPU，识别照样出字，只是慢一点。', voiceGpuName() || t('有显卡'))
                  : t('这台机器上没有检测到独立显卡，识别跑在 CPU 上——一段 5 秒的话约 0.2 秒，够用。')}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={gpuOn}
              onClick={() => pinVoiceGpu(!gpuOn)}
              className={
                'relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition ' + (gpuOn ? 'bg-seal' : 'bg-line-strong/60')
              }
            >
              <span
                className={
                  'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ' +
                  (gpuOn ? 'left-[16px]' : 'left-[2px]')
                }
              />
            </button>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-ink-faint">
            {settings.gpu === null
              ? t('现在是「跟随设备」：上面这个值是按这台机器检测出来的，拨一下就固定下来（以后换机器也不会自己变）。')
              : t('已经手动固定成「{0}」；想交回自动判断，把开关拨回检测到的那一侧即可。', gpuOn ? t('开') : t('关'))}
          </div>
        </div>
      </section>

      {/* ---------- 它是什么 ---------- */}
      <section className="rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        {t('识别跑在应用主进程里的 sherpa-onnx 原生运行时（{0}）：录音在你按下结束之后才送去识别，一次出结果，不是边说边出字。', 'SenseVoiceSmall')}
        {t('音频只在这一次识别里存在内存中，不写盘、不出本机。')}
      </section>
    </div>
  )
}
