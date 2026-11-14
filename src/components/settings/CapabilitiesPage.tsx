/**
 * 设置 → 模型 → 能力接入：TTS（文字转语音）/ STT（语音转文字）/ OCR（文字识别）
 * 三项能力的接入方式配置，以及 DeepSeek Files API 的文件管理。
 *
 * 2026-11-14 之前这三个能力是内置插件（本地模型下载 + 端侧推理）；迁到模型体系后
 * 每项只有两种接法：
 * - **DeepSeek 官方**：复用 DeepSeek 提供商的 API Key（与网络搜索同源，这里不存第二把）；
 * - **本地适配器**：用户自己架 OpenAI 兼容服务，填 baseUrl（以 /v1 结尾）；
 *   应用不再内置任何模型与下载器。
 *
 * 计费提醒：DeepSeek 的 TTS / ASR / OCR 都按量计费，所以合成与识别的结果一律
 * 落盘缓存（见 lib/capsCache）——同一页 PDF、同一段话不会花两次钱。
 */

import { useRef, useState, useSyncExternalStore } from 'react'
import { Check, Eye, KeyRound, Mic, ScrollText, RefreshCw, Trash2, Upload, Volume2, AlertCircle, Loader2 } from 'lucide-react'
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

/* ---------- 通用行式控件（与 ProviderListPage 同一观感：直角、行式、低噪声） ---------- */

function ModeRow({ active, label, hint, onClick }: { active: boolean; label: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
        active
          ? 'border-seal/50 bg-seal/[0.06] shadow-2xs'
          : 'border-line/70 bg-card/60 hover:border-line hover:bg-card'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          active ? 'border-seal bg-seal text-white' : 'border-line-strong/60'
        }`}
      >
        {active && <Check size={10} className="stroke-[3]" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[12.5px] ${active ? 'font-medium text-ink-strong' : 'text-ink-soft'}`}>{label}</span>
        {hint && <span className="mt-0.5 block truncate text-[10.5px] text-ink-faint">{hint}</span>}
      </span>
    </button>
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
      <span className="text-[11.5px] font-medium text-ink-soft">{label}</span>
      <input
        type={password ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 font-mono text-[12px] text-ink-strong outline-none transition focus:border-seal/60 placeholder:font-sans placeholder:text-ink-faint/70"
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
      <span className="text-[11.5px] font-medium text-ink-soft">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-[12px] text-ink-strong outline-none transition focus:border-seal/60"
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

/* ---------- 能力卡 ---------- */

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
  // 「系统自带」只在 Windows 桌面端出现（Windows.Media.Ocr 是系统组件）
  const patchLocal = (
    key: 'tts' | 'stt' | 'ocr',
    patch: Partial<LocalServiceConfig>,
  ) => update((c) => ({ ...c, [key]: { ...c[key], local: { ...(c[key].local ?? { baseUrl: '' }), ...patch } } }))

  const dsKeyMissing = !dsRef
  const isWin = !isWeb() && /Windows/i.test(navigator.userAgent)

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      {/* DeepSeek Key 状态：三个能力共用一把（复用提供商，与网络搜索同源） */}
      <div
        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[11.5px] ${
          dsKeyMissing
            ? 'border-warn/30 bg-warn/[0.05] text-warn-deep'
            : 'border-seal/30 bg-seal/[0.04] text-seal-deep'
        }`}
      >
        {dsKeyMissing ? <AlertCircle size={14} className="shrink-0" /> : <KeyRound size={14} className="shrink-0" />}
        {dsKeyMissing ? (
          <span>
            {t('尚未配置 DeepSeek 提供商。选择「DeepSeek 官方」接入的能力会复用它的 API Key——请先到「提供商与模型」创建。')}
          </span>
        ) : (
          <span>
            {t('「DeepSeek 官方」接入自动复用提供商（{0}）的 API Key，与网络搜索同源，无需重复填写。', labelOf(dsRef.provider))}
          </span>
        )}
      </div>

      {/* TTS */}
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <header className="mb-3 flex items-center gap-1.5">
          <Volume2 size={14} className="text-seal" />
          <span className="text-[12.5px] font-medium text-ink-strong">{t('文字转语音 (TTS)')}</span>
          <span className="text-[11px] text-ink-faint">{t('朗读 AI 消息；结果本地缓存，重听不再计费')}</span>
        </header>
        <div className="grid grid-cols-2 gap-2">
          <ModeRow active={caps.tts.mode === 'system'} label={t('系统原生')} hint={t('浏览器 Web Speech，免费离线')} onClick={() => setTtsMode('system')} />
          <ModeRow
            active={caps.tts.mode === 'deepseek'}
            label={t('DeepSeek 官方')}
            hint={dsKeyMissing ? t('需要先配置 DeepSeek 提供商') : t('复用提供商 API Key（按量计费）')}
            onClick={() => setTtsMode('deepseek')}
          />
          <ModeRow active={caps.tts.mode === 'local'} label={t('本地适配器')} hint={t('自架 OpenAI 兼容 /audio/speech')} onClick={() => setTtsMode('local')} />
          <ModeRow active={caps.tts.mode === 'off'} label={t('关闭')} hint={t('隐藏朗读按钮')} onClick={() => setTtsMode('off')} />
        </div>
        {caps.tts.mode === 'deepseek' && (
          <div className="mt-3 border-t border-line/60 pt-3">
            <SelectField
              label={t('音色')}
              value={caps.tts.voiceId ?? 'stella'}
              options={DEEPSEEK_TTS_VOICES.map((v) => ({ value: v.id, label: v.label }))}
              onChange={(v) => update((c) => ({ ...c, tts: { ...c.tts, voiceId: v } }))}
            />
          </div>
        )}
        {caps.tts.mode === 'local' && (
          <div className="mt-3 flex flex-col gap-2.5 border-t border-line/60 pt-3">
            <TextField
              label={t('服务地址（以 /v1 结尾）')}
              value={caps.tts.local?.baseUrl ?? ''}
              placeholder="http://127.0.0.1:8000/v1"
              onChange={(v) => patchLocal('tts', { baseUrl: v })}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <TextField label={t('模型（选填）')} value={caps.tts.local?.model ?? ''} onChange={(v) => patchLocal('tts', { model: v })} />
              <TextField label={t('音色（选填）')} value={caps.tts.local?.voice ?? ''} onChange={(v) => patchLocal('tts', { voice: v })} />
            </div>
            <TextField label={t('API Key（选填）')} password value={caps.tts.local?.apiKey ?? ''} onChange={(v) => patchLocal('tts', { apiKey: v })} />
          </div>
        )}
      </section>

      {/* STT */}
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <header className="mb-3 flex items-center gap-1.5">
          <Mic size={14} className="text-seal" />
          <span className="text-[12.5px] font-medium text-ink-strong">{t('语音转文字 (STT)')}</span>
          <span className="text-[11px] text-ink-faint">{t('导师输入框的麦克风按钮；录音只存在内存里')}</span>
        </header>
        <div className="grid grid-cols-3 gap-2">
          <ModeRow active={caps.stt.mode === 'off'} label={t('关闭')} onClick={() => setSttMode('off')} />
          <ModeRow
            active={caps.stt.mode === 'deepseek'}
            label={t('DeepSeek 官方')}
            hint={dsKeyMissing ? t('需要先配置 DeepSeek 提供商') : t('复用提供商 API Key（按量计费）')}
            onClick={() => setSttMode('deepseek')}
          />
          <ModeRow active={caps.stt.mode === 'local'} label={t('本地适配器')} hint={t('自架 OpenAI 兼容 /audio/transcriptions')} onClick={() => setSttMode('local')} />
        </div>
        {caps.stt.mode !== 'off' && (
          <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-line/60 pt-3">
            <SelectField
              label={t('识别语言')}
              value={caps.stt.language ?? 'auto'}
              options={[
                { value: 'auto', label: t('自动') },
                ...CAPS_STT_LANGUAGES.filter((l) => l !== 'auto').map((l) => ({
                  value: l,
                  label: { zh: t('中文'), en: 'English', ja: '日本語', ko: '한국어', yue: t('粤语') }[l] ?? l,
                })),
              ]}
              onChange={(v) => update((c) => ({ ...c, stt: { ...c.stt, language: v } }))}
            />
            <label className="flex flex-col gap-1">
              <span className="text-[11.5px] font-medium text-ink-soft">
                {t('录音降噪（{0}）', String(voice.noiseGate))}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={voice.noiseGate}
                onChange={(e) => setVoiceSetting({ noiseGate: Number(e.target.value) })}
                className="mt-2 accent-seal"
              />
              <span className="text-[10.5px] text-ink-faint">{t('越高越不怕环境噪声，也越容易漏掉轻声')}</span>
            </label>
            {caps.stt.mode === 'local' && (
              <TextField
                label={t('服务地址（以 /v1 结尾）')}
                value={caps.stt.local?.baseUrl ?? ''}
                placeholder="http://127.0.0.1:8000/v1"
                onChange={(v) => patchLocal('stt', { baseUrl: v })}
              />
            )}
            {caps.stt.mode === 'local' && (
              <TextField label={t('模型（选填）')} value={caps.stt.local?.model ?? ''} onChange={(v) => patchLocal('stt', { model: v })} />
            )}
            {caps.stt.mode === 'local' && (
              <TextField label={t('API Key（选填）')} password value={caps.stt.local?.apiKey ?? ''} onChange={(v) => patchLocal('stt', { apiKey: v })} />
            )}
          </div>
        )}
      </section>

      {/* OCR */}
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <header className="mb-3 flex items-center gap-1.5">
          <ScrollText size={14} className="text-seal" />
          <span className="text-[12.5px] font-medium text-ink-strong">{t('文字识别 (OCR)')}</span>
          <span className="text-[11px] text-ink-faint">{t('PDF 扫描件的文字层；每页结果落盘缓存')}</span>
        </header>
        <div className="grid grid-cols-2 gap-2">
          <ModeRow active={caps.ocr.mode === 'off'} label={t('关闭')} onClick={() => setOcrMode('off')} />
          <ModeRow
            active={caps.ocr.mode === 'deepseek'}
            label={t('DeepSeek 官方')}
            hint={dsKeyMissing ? t('需要先配置 DeepSeek 提供商') : t('复用提供商 API Key（约 1.5 元/千页）')}
            onClick={() => setOcrMode('deepseek')}
          />
          <ModeRow active={caps.ocr.mode === 'local'} label={t('本地适配器')} hint={t('自架 OpenAI 兼容视觉模型')} onClick={() => setOcrMode('local')} />
          {isWin && (
            <ModeRow
              active={caps.ocr.mode === 'system'}
              label={t('系统自带')}
              hint={t('Windows 内置 OCR，完全离线免费，词级定位')}
              onClick={() => setOcrMode('system')}
            />
          )}
        </div>
        {caps.ocr.mode !== 'off' && (
          <div className="mt-3 grid grid-cols-2 gap-2.5 border-t border-line/60 pt-3">
            {caps.ocr.mode === 'deepseek' && (
              <SelectField
                label={t('识别档位')}
                value={caps.ocr.purpose}
                options={CAPS_OCR_PURPOSES.map((p) => ({ value: p, label: CAPS_OCR_PURPOSE_LABEL[p] }))}
                onChange={(v) => update((c) => ({ ...c, ocr: { ...c.ocr, purpose: v as CapsOcrPurposeSetting } }))}
              />
            )}
            {caps.ocr.mode === 'local' && (
              <TextField
                label={t('服务地址（以 /v1 结尾）')}
                value={caps.ocr.local?.baseUrl ?? ''}
                placeholder="http://127.0.0.1:8000/v1"
                onChange={(v) => patchLocal('ocr', { baseUrl: v })}
              />
            )}
            {caps.ocr.mode === 'local' && (
              <TextField label={t('视觉模型（选填）')} value={caps.ocr.local?.model ?? ''} onChange={(v) => patchLocal('ocr', { model: v })} />
            )}
            {caps.ocr.mode === 'local' && (
              <TextField label={t('API Key（选填）')} password value={caps.ocr.local?.apiKey ?? ''} onChange={(v) => patchLocal('ocr', { apiKey: v })} />
            )}
          </div>
        )}
      </section>

      {/* DeepSeek Files API（可选能力；开关在提供商的高级配置） */}
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

  // Files 开关看的是 **DeepSeek 那条配置**（不是全局提供商）：
  // 用户显式设置优先，没设过回落 DeepSeek 预设的内置默认（开箱即用）
  const engine = findReferencedDeepSeekKey()
  const filesOn = (() => {
    if (!engine) return false
    const cfg = engine.provider
    const preset = cfg.kind === 'provider' ? presetOf(cfg.id) : undefined
    return (cfg.files ?? preset?.files)?.enabled === true
  })()

  if (!filesOn || !engine) {
    return (
      <section className="rounded-xl border border-line bg-card/60 p-4">
        <header className="flex items-center gap-1.5">
          <Eye size={14} className="text-seal" />
          <span className="text-[12.5px] font-medium text-ink-strong">{t('云端文件 (Files API)')}</span>
          <span className="text-[11px] text-ink-faint">{t('可选能力')}</span>
        </header>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {engine
            ? t('当前提供商未启用 Files API——可在提供商高级配置里打开。')
            : t('配置 DeepSeek 提供商并启用 Files API 后，可以在这里管理云端文件（上传 / 列出 / 删除）。')}
        </p>
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
    <section className="rounded-xl border border-line bg-card/60 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Eye size={14} className="text-seal" />
          <span className="text-[12.5px] font-medium text-ink-strong">{t('云端文件 (Files API)')}</span>
          <span className="text-[11px] text-ink-faint">{t('上传到 DeepSeek 云端的文件（user_data）')}</span>
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
            {t('上传')}
          </button>
          <button
            type="button"
            disabled={busy !== ''}
            onClick={() => void listFiles()}
            className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-soft transition hover:bg-card disabled:opacity-50"
          >
            {busy === 'list' ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {t('刷新')}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/[0.05] px-3 py-2 text-[11px] text-warn-deep">
          <AlertCircle size={12} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
        </div>
      )}

      {files === null ? (
        <p className="text-[11px] text-ink-faint">{t('点「刷新」拉取云端文件列表。')}</p>
      ) : files.length === 0 ? (
        <p className="text-[11px] text-ink-faint">{t('云端还没有文件。')}</p>
      ) : (
        <div className="flex flex-col divide-y divide-line/50 rounded-lg border border-line/70">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate text-ink-strong">{f.filename}</span>
              <span className="shrink-0 text-ink-faint">{formatSize(f.bytes)}</span>
              <span className="shrink-0 rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-ink-soft">{f.purpose}</span>
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
