/**
 * 设置 → 插件 → 功能性插件 → 语音输入：这一项自己的配置页。
 *
 * 包含：
 * 1. 模型：SenseVoiceSmall 离线模型下载、本机替换与删除
 * 2. 识别：多语言选择与独立 GPU 硬件加速开关
 * 3. 离线架构：端侧运行与音频隐私安全说明
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Cpu,
  Download,
  FolderOpen,
  Languages,
  Mic,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
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
  auto: '自动识别',
  zh: '普通话',
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
      {/* 头部简介 */}
      <div className="flex flex-col gap-1 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <Mic size={16} className="text-seal" />
          <h2 className="text-[14px] font-semibold text-ink-strong">{t('本地语音输入配置')}</h2>
        </div>
        <p className="text-[11.5px] text-ink-soft">
          {t('基于 SenseVoice 的端侧离线语音转文字引擎，模型全部在本地运行，断网依然可用。')}
        </p>
      </div>

      {/* 离线模型管理卡片 */}
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink-strong">{VOICE_MODEL_NAME}</span>
            <span className="font-mono text-[11px] text-ink-faint">({VOICE_MODEL_MB} MB)</span>
          </div>

          {status === null ? (
            <span className="text-[11px] text-ink-faint">{t('检查状态中…')}</span>
          ) : ready ? (
            <span className="flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-0.5 text-[10.5px] font-medium text-ok-deep">
              <Check size={11} className="stroke-[3]" />
              {t('模型已就绪 · {0}', formatBytes(status.bytes))}
            </span>
          ) : status.bytes > 0 ? (
            <span className="rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-[10.5px] font-medium text-warn-deep">
              {t('下载中断（{0} / {1}）', formatBytes(status.bytes), formatBytes(status.totalBytes))}
            </span>
          ) : (
            <span className="rounded-full border border-line bg-line/40 px-2.5 py-0.5 text-[10.5px] text-ink-faint">
              {t('未下载')}
            </span>
          )}
        </div>

        {status && (
          <div className="mt-2 break-all rounded-md border border-line bg-paper-deep/60 px-2.5 py-1.5 font-mono text-[10.5px] text-ink-faint">
            {status.dir}
          </div>
        )}

        {note && <div className="mt-2 text-[11.5px] text-ink-soft">{note}</div>}

        {/* 下载进度条 */}
        {percent !== null && (
          <div className="mt-3">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-seal transition-[width] duration-200"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10.5px] text-ink-faint">
              <span>{t('正在下载模型文件…')}</span>
              <span>{percent}%</span>
            </div>
          </div>
        )}

        {/* 操作按钮组 */}
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          {busy ? (
            <button
              type="button"
              onClick={() => void cancelDownload()}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[11.5px] font-medium text-ink transition hover:border-line-strong"
            >
              <X size={12} />
              <span>{t('取消下载')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startDownload}
              className="flex items-center gap-1.5 rounded-lg bg-seal px-3 py-1.5 text-[11.5px] font-medium text-white shadow-xs transition hover:bg-seal-deep"
            >
              <Download size={12} />
              <span>{ready ? t('重新下载') : t('下载模型')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={pickLocal}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[11.5px] font-medium text-ink transition hover:border-line-strong hover:bg-card/80"
          >
            <FolderOpen size={12} className="text-seal" />
            <span>{t('导入本机模型…')}</span>
          </button>

          <button
            type="button"
            onClick={() => void revealModel()}
            className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:text-ink"
          >
            {t('在文件夹中显示')}
          </button>

          {ready && (
            <button
              type="button"
              onClick={drop}
              className="flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] text-ink-faint transition hover:border-seal/40 hover:bg-seal/5 hover:text-seal"
            >
              <Trash2 size={11} />
              <span>{t('删除模型')}</span>
            </button>
          )}
        </div>

        {error && <div className="mt-2 text-[11px] text-warn-deep">{error}</div>}
      </section>

      {/* 识别语言与硬件加速 */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* 语言选择 */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-card/60 p-3.5">
          <div>
            <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-strong">
              <Languages size={14} className="text-seal" />
              <span>{t('识别语言偏好')}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
              {t('默认自动推断语种；指定语种在混合杂音时准确度更高。')}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {VOICE_LANGUAGES.map((code) => {
              const isSelected = settings.language === code
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setVoiceSetting({ language: code })}
                  className={`rounded-lg border px-2.5 py-1 text-[11.5px] transition outline-none ${
                    isSelected
                      ? 'border-seal/60 bg-seal/10 font-medium text-seal-deep ring-1 ring-seal/20'
                      : 'border-line bg-card text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {t(LANGUAGE_LABELS[code])}
                </button>
              )
            })}
          </div>
        </div>

        {/* GPU 加速开关 */}
        <div className="flex flex-col justify-between rounded-xl border border-line bg-card/60 p-3.5">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-strong">
                <Cpu size={14} className="text-seal" />
                <span>{t('GPU 硬件加速')}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={gpuOn}
                onClick={() => pinVoiceGpu(!gpuOn)}
                className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
                  gpuOn ? 'bg-seal' : 'bg-line-strong/60'
                }`}
              >
                <span
                  className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
                    gpuOn ? 'left-[16px]' : 'left-[2px]'
                  }`}
                />
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              {voiceHasGpu()
                ? t('检测到显卡：{0}。开启后推导延迟降低 60%。', voiceGpuName() || t('独立显卡'))
                : t('未检测到独立显卡；识别直接运行在 CPU 上，延迟依然在 0.2 秒内。')}
            </p>
          </div>

          <div className="mt-3 text-[10.5px] text-ink-faint">
            {settings.gpu === null ? t('当前：跟随设备自动判断') : t('当前：已手动固定设置')}
          </div>
        </div>
      </section>

      {/* 离线隐私保证 */}
      <div className="rounded-xl border border-line bg-card/60 p-3.5 text-[11px] leading-relaxed text-ink-soft">
        <div className="flex items-center gap-1.5 font-medium text-ink-strong">
          <ShieldCheck size={14} className="text-seal" />
          <span>{t('端侧隐私安全')}</span>
        </div>
        <p className="mt-1">
          {t(
            '语音识别直接跑在应用主进程的原生运行时中，松开按键后一次性在内存中转录。录音音频绝对不写磁盘、不经过网络上传，完全离线运行。'
          )}
        </p>
      </div>
    </div>
  )
}
