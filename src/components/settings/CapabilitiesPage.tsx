/**
 * 设置 → 模型 → 能力接入：TTS（文字转语音）/ STT（语音转文字）/ OCR（文字识别）
 * 三项能力的接入方式配置，以及 DeepSeek Files API 的文件管理。
 *
 * 紧凑高效设计：
 * - 采用头部右侧分段器（Segmented Switch），消除大面积笨重卡片，空间利用率大幅提升；
 * - 动态显示子配置，保持视觉清爽克制；
 * - 结果本地缓存（见 lib/capsCache）。
 */

import { useRef, useState, useSyncExternalStore } from 'react'
import {
  AlertCircle,
  Check,
  Eye,
  KeyRound,
  Loader2,
  Mic,
  RefreshCw,
  ScrollText,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react'
import { t } from '../../i18n'
import {
  findReferencedDeepSeekKey,
  labelOf,
  loadAiSettings,
  saveAiSettings,
  type AiCapabilities,
  type CapabilityMode,
  type CapsOcrPurposeSetting,
  type LocalServiceConfig,
  type TtsMode,
  type OcrMode,
} from '../../ai/settings'
import { presetOf } from '../../ai/providers'
import {
  CAPS_OCR_PURPOSES,
  CAPS_OCR_PURPOSE_LABEL,
  CAPS_STT_LANGUAGES,
  DEEPSEEK_TTS_VOICES,
  DEFAULT_CAPABILITIES,
} from '../../ai/capabilitySettings'
import { setVoiceSetting, useVoiceSettings } from '../../lib/voice/settings'
import { loadCapabilities, subscribeCapabilities } from '../../lib/capabilities'
import { isWeb, native } from '../../lib/native'
import type { CapsFileEntry } from '../../../shared/ipc'

const subscribeCaps = (cb: () => void) => subscribeCapabilities(cb)

/* ---------- 紧凑现代控件 ---------- */

function SegmentedSwitch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; hint?: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-line/70 bg-card/60 p-0.5 text-[11px] shadow-2xs">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-all ${
              active
                ? 'bg-seal text-white shadow-xs'
                : 'text-ink-soft hover:bg-line/40 hover:text-ink'
            }`}
          >
            {active && <Check size={11} className="stroke-[3]" />}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  password,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  password?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-soft">{label}</span>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-card px-2.5 py-1 font-mono text-[11.5px] text-ink-strong outline-none transition focus:border-seal/60 placeholder:font-sans placeholder:text-ink-faint/70"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-soft">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-card px-2.5 py-1 text-[11.5px] text-ink-strong outline-none transition focus:border-seal/60"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ---------- 主体面板 ---------- */

interface CapsPageProps {
  onToast: (msg: string) => void
}

export function CapabilitiesPage({ onToast }: CapsPageProps) {
  const caps = useSyncExternalStore(subscribeCaps, loadCapabilities)
  const voice = useVoiceSettings()
  const dsRef = findReferencedDeepSeekKey()

  const update = (patch: (c: AiCapabilities) => AiCapabilities) => {
    const settings = loadAiSettings()
    const base = settings.capabilities ?? DEFAULT_CAPABILITIES
    saveAiSettings({ ...settings, capabilities: patch(base) })
  }

  const setTtsMode = (mode: TtsMode) => update((c) => ({ ...c, tts: { ...c.tts, mode } }))
  const setSttMode = (mode: CapabilityMode) => update((c) => ({ ...c, stt: { ...c.stt, mode } }))
  const setOcrMode = (mode: OcrMode) => update((c) => ({ ...c, ocr: { ...c.ocr, mode } }))

  const patchLocal = (
    key: 'tts' | 'stt' | 'ocr',
    patch: Partial<LocalServiceConfig>,
  ) => update((c) => ({ ...c, [key]: { ...c[key], local: { ...(c[key].local ?? { baseUrl: '' }), ...patch } } }))

  const dsKeyMissing = !dsRef
  const isWin = !isWeb() && /Windows/i.test(navigator.userAgent)

  return (
    <div className="flex flex-col gap-3.5 overflow-y-auto p-4">
      {/* 状态横幅：DeepSeek Key 复用状态 */}
      <div
        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-[11.5px] transition ${
          dsKeyMissing
            ? 'border-warn/30 bg-warn/[0.05] text-warn-deep'
            : 'border-seal/30 bg-seal/[0.04] text-seal-deep'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {dsKeyMissing ? <AlertCircle size={14} className="shrink-0 text-warn" /> : <KeyRound size={14} className="shrink-0 text-seal" />}
          <span className="truncate">
            {dsKeyMissing
              ? t('尚未配置 DeepSeek 提供商。「DeepSeek 官方」模式需复用其 API Key，请先到「提供商与模型」配置。')
              : t('「DeepSeek 官方」接入自动复用提供商（{0}）的 API Key，无需重复填写。', labelOf(dsRef.provider))}
          </span>
        </div>
        <span className="shrink-0 text-[10.5px] font-medium opacity-80">
          {dsKeyMissing ? t('未绑定') : t('已就绪')}
        </span>
      </div>

      {/* 1. 文字转语音 (TTS) */}
      <section className="rounded-xl border border-line bg-card/70 p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-seal/10 text-seal">
              <Volume2 size={15} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-ink-strong">{t('文字转语音 (TTS)')}</span>
                <span className="rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-soft">
                  {caps.tts.mode === 'system'
                    ? t('系统原生')
                    : caps.tts.mode === 'deepseek'
                      ? t('DeepSeek 官方')
                      : caps.tts.mode === 'local'
                        ? t('本地服务')
                        : t('已关闭')}
                </span>
              </div>
            </div>
          </div>
          <SegmentedSwitch
            value={caps.tts.mode}
            onChange={setTtsMode}
            options={[
              { value: 'system', label: t('系统原生'), hint: t('Web Speech 免费离线') },
              {
                value: 'deepseek',
                label: t('DeepSeek 官方'),
                hint: dsKeyMissing ? t('需先配置 DeepSeek') : t('按量计费，高清人声'),
              },
              { value: 'local', label: t('本地适配器'), hint: t('兼容 OpenAI /audio/speech') },
              { value: 'off', label: t('关闭'), hint: t('隐藏朗读') },
            ]}
          />
        </div>

        {/* 动态配置项 */}
        {caps.tts.mode === 'deepseek' && (
          <div className="mt-3 border-t border-line/50 pt-2.5">
            <div className="max-w-xs">
              <SelectField
                label={t('音色')}
                value={caps.tts.voiceId ?? 'stella'}
                options={DEEPSEEK_TTS_VOICES.map((v) => ({ value: v.id, label: v.label }))}
                onChange={(v) => update((c) => ({ ...c, tts: { ...c.tts, voiceId: v } }))}
              />
            </div>
          </div>
        )}

        {caps.tts.mode === 'local' && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 border-t border-line/50 pt-2.5">
            <TextField
              label={t('服务地址')}
              value={caps.tts.local?.baseUrl ?? ''}
              placeholder="http://127.0.0.1:8000/v1"
              onChange={(v) => patchLocal('tts', { baseUrl: v })}
            />
            <TextField
              label={t('模型 (选填)')}
              value={caps.tts.local?.model ?? ''}
              placeholder="tts-1"
              onChange={(v) => patchLocal('tts', { model: v })}
            />
            <TextField
              label={t('音色 (选填)')}
              value={caps.tts.local?.voice ?? ''}
              placeholder="alloy"
              onChange={(v) => patchLocal('tts', { voice: v })}
            />
            <TextField
              label={t('API Key (选填)')}
              password
              value={caps.tts.local?.apiKey ?? ''}
              onChange={(v) => patchLocal('tts', { apiKey: v })}
            />
          </div>
        )}
      </section>

      {/* 2. 语音转文字 (STT) */}
      <section className="rounded-xl border border-line bg-card/70 p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-seal/10 text-seal">
              <Mic size={15} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-ink-strong">{t('语音转文字 (STT)')}</span>
                <span className="rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-soft">
                  {caps.stt.mode === 'deepseek'
                    ? t('DeepSeek 官方')
                    : caps.stt.mode === 'local'
                      ? t('本地服务')
                      : t('已关闭')}
                </span>
              </div>
            </div>
          </div>
          <SegmentedSwitch
            value={caps.stt.mode}
            onChange={setSttMode}
            options={[
              {
                value: 'deepseek',
                label: t('DeepSeek 官方'),
                hint: dsKeyMissing ? t('需先配置 DeepSeek') : t('按量计费，高识别率'),
              },
              { value: 'local', label: t('本地适配器'), hint: t('兼容 OpenAI /audio/transcriptions') },
              { value: 'off', label: t('关闭'), hint: t('隐藏麦克风') },
            ]}
          />
        </div>

        {/* 动态配置项 */}
        {caps.stt.mode !== 'off' && (
          <div className="mt-3 border-t border-line/50 pt-2.5 flex flex-col gap-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
              <SelectField
                label={t('识别语言')}
                value={caps.stt.language ?? 'auto'}
                options={[
                  { value: 'auto', label: t('自动识别') },
                  ...CAPS_STT_LANGUAGES.filter((l) => l !== 'auto').map((l) => ({
                    value: l,
                    label: { zh: t('中文 (Mandarin)'), en: 'English', ja: '日本語', ko: '한국어', yue: t('粤语 (Cantonese)') }[l] ?? l,
                  })),
                ]}
                onChange={(v) => update((c) => ({ ...c, stt: { ...c.stt, language: v } }))}
              />
              <label className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-[11px] font-medium text-ink-soft">
                  <span>{t('录音门限降噪')}</span>
                  <span className="tabular-nums font-mono text-[10px] text-ink-faint">{voice.noiseGate}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={voice.noiseGate}
                  onChange={(e) => setVoiceSetting({ noiseGate: Number(e.target.value) })}
                  className="mt-1 h-1.5 w-full cursor-pointer accent-seal"
                />
              </label>
            </div>

            {caps.stt.mode === 'local' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <TextField
                  label={t('服务地址')}
                  value={caps.stt.local?.baseUrl ?? ''}
                  placeholder="http://127.0.0.1:8000/v1"
                  onChange={(v) => patchLocal('stt', { baseUrl: v })}
                />
                <TextField
                  label={t('模型 (选填)')}
                  value={caps.stt.local?.model ?? ''}
                  placeholder="whisper-1"
                  onChange={(v) => patchLocal('stt', { model: v })}
                />
                <TextField
                  label={t('API Key (选填)')}
                  password
                  value={caps.stt.local?.apiKey ?? ''}
                  onChange={(v) => patchLocal('stt', { apiKey: v })}
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* 3. 文字识别 (OCR) */}
      <section className="rounded-xl border border-line bg-card/70 p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-seal/10 text-seal">
              <ScrollText size={15} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-ink-strong">{t('文字识别 (OCR)')}</span>
                <span className="rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-soft">
                  {caps.ocr.mode === 'system'
                    ? t('系统自带')
                    : caps.ocr.mode === 'deepseek'
                      ? t('DeepSeek 官方')
                      : caps.ocr.mode === 'local'
                        ? t('本地服务')
                        : t('已关闭')}
                </span>
              </div>
            </div>
          </div>
          <SegmentedSwitch
            value={caps.ocr.mode}
            onChange={setOcrMode}
            options={[
              ...(isWin
                ? [
                    {
                      value: 'system' as const,
                      label: t('系统自带'),
                      hint: t('Windows 原生 OCR，完全离线免费'),
                    },
                  ]
                : []),
              {
                value: 'deepseek',
                label: t('DeepSeek 官方'),
                hint: dsKeyMissing ? t('需先配置 DeepSeek') : t('约 1.5 元/千页'),
              },
              { value: 'local', label: t('本地适配器'), hint: t('自架 OpenAI 视觉模型') },
              { value: 'off', label: t('关闭'), hint: t('关闭 OCR 识别') },
            ]}
          />
        </div>

        {/* 动态配置项 */}
        {caps.ocr.mode === 'deepseek' && (
          <div className="mt-3 border-t border-line/50 pt-2.5">
            <div className="max-w-xs">
              <SelectField
                label={t('识别档位')}
                value={caps.ocr.purpose}
                options={CAPS_OCR_PURPOSES.map((p) => ({ value: p, label: CAPS_OCR_PURPOSE_LABEL[p] }))}
                onChange={(v) => update((c) => ({ ...c, ocr: { ...c.ocr, purpose: v as CapsOcrPurposeSetting } }))}
              />
            </div>
          </div>
        )}

        {caps.ocr.mode === 'local' && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2.5 border-t border-line/50 pt-2.5">
            <TextField
              label={t('服务地址')}
              value={caps.ocr.local?.baseUrl ?? ''}
              placeholder="http://127.0.0.1:8000/v1"
              onChange={(v) => patchLocal('ocr', { baseUrl: v })}
            />
            <TextField
              label={t('视觉模型 (选填)')}
              value={caps.ocr.local?.model ?? ''}
              placeholder="glm-4v / qwen-vl"
              onChange={(v) => patchLocal('ocr', { model: v })}
            />
            <TextField
              label={t('API Key (选填)')}
              password
              value={caps.ocr.local?.apiKey ?? ''}
              onChange={(v) => patchLocal('ocr', { apiKey: v })}
            />
          </div>
        )}
      </section>

      {/* 4. DeepSeek Files API（可选能力） */}
      <FilesPanel onToast={onToast} />
    </div>
  )
}

/* ---------- Files API 文件管理 ---------- */

function FilesPanel({ onToast }: CapsPageProps) {
  const [, forceRender] = useState(0)
  const [files, setFiles] = useState<CapsFileEntry[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const engine = findReferencedDeepSeekKey()
  const filesOn = (() => {
    if (!engine) return false
    const cfg = engine.provider
    const preset = cfg.kind === 'provider' ? presetOf(cfg.id) : undefined
    return (cfg.files ?? preset?.files)?.enabled === true
  })()

  if (!filesOn || !engine) {
    return (
      <section className="rounded-xl border border-line bg-card/70 p-3.5 shadow-2xs">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-line/60 text-ink-soft">
              <Eye size={15} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-bold text-ink-strong">{t('云端文件 (Files API)')}</span>
                <span className="rounded bg-line/60 px-1.5 py-px text-[10px] text-ink-soft">{t('未启用')}</span>
              </div>
            </div>
          </div>
        </header>
      </section>
    )
  }

  const listFiles = async () => {
    setBusy('list')
    setError('')
    try {
      const res = await native().caps.filesList({ engine: { kind: 'deepseek', apiKey: engine.apiKey } })
      if (res.ok) {
        setFiles(res.files)
        forceRender((v) => v + 1)
      } else {
        setError(res.error)
      }
    } finally {
      setBusy('')
    }
  }

  const uploadFile = async (file: File) => {
    setBusy('upload')
    setError('')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      const res = await native().caps.filesCreate({
        dataBase64: btoa(binary),
        filename: file.name,
        purpose: 'user_data',
        engine: { kind: 'deepseek', apiKey: engine.apiKey },
      })
      if (res.ok) {
        onToast(t('已上传：{0}', file.name))
        await listFiles()
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('上传失败'))
    } finally {
      setBusy('')
    }
  }

  const removeFile = async (id: string, name: string) => {
    setBusy(id)
    setError('')
    try {
      const res = await native().caps.filesDelete({ fileId: id, engine: { kind: 'deepseek', apiKey: engine.apiKey } })
      if (res.ok) {
        setFiles((prev) => prev?.filter((f) => f.id !== id) ?? null)
        onToast(t('已删除：{0}', name))
      } else {
        setError(res.error)
      }
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="rounded-xl border border-line bg-card/70 p-3.5 shadow-2xs">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-seal/10 text-seal">
            <Eye size={15} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-bold text-ink-strong">{t('云端文件 (Files API)')}</span>
              <span className="rounded bg-seal/10 px-1.5 py-px text-[10px] font-medium text-seal-deep">{t('已启用')}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void uploadFile(f)
            }}
          />
          <button
            type="button"
            disabled={busy !== ''}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 rounded-lg bg-seal px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-seal-deep disabled:opacity-50"
          >
            {busy === 'upload' ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {t('上传文件')}
          </button>
          <button
            type="button"
            disabled={busy !== ''}
            onClick={() => void listFiles()}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-soft transition hover:bg-card disabled:opacity-50"
          >
            {busy === 'list' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {t('刷新列表')}
          </button>
        </div>
      </header>

      {error && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/[0.05] px-3 py-1.5 text-[11px] text-warn-deep">
          <AlertCircle size={12} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
        </div>
      )}

      {files === null ? (
        <p className="mt-2 text-[11px] text-ink-faint">{t('点击「刷新列表」拉取云端文件。')}</p>
      ) : files.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-faint">{t('当前云端还没有已上传的文件。')}</p>
      ) : (
        <div className="mt-2.5 flex flex-col divide-y divide-line/50 rounded-lg border border-line/70 max-h-48 overflow-y-auto">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] hover:bg-paper/40 transition">
              <span className="min-w-0 flex-1 truncate font-mono text-ink-strong">{f.filename}</span>
              <span className="shrink-0 text-ink-faint text-[10.5px]">{formatSize(f.bytes)}</span>
              <span className="shrink-0 rounded bg-line/60 px-1.5 py-0.5 text-[9.5px] text-ink-soft">{f.purpose}</span>
              <button
                type="button"
                disabled={busy === f.id}
                onClick={() => void removeFile(f.id, f.filename)}
                title={t('删除云端文件')}
                className="shrink-0 p-1 text-ink-faint transition hover:text-warn disabled:opacity-40"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}
