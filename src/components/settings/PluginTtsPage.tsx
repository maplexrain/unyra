/**
 * 设置 → 插件 → 功能性插件 → 语音合成 (TTS)：配置与试听页面。
 *
 * 包含：
 * 1. 适配器选择：系统原生 (Web Speech)、本地离线模型 (Sherpa-ONNX VITS)、云端 API (OpenAI 协议)
 * 2. 离线轻量模型的一键极速下载（约 42MB）、进度跟踪与目录管理
 * 3. 云端 API 的 BaseURL、Key、模型与音色配置
 * 4. 实时发音试听、语速调节与发音人切换
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Cpu,
  Download,
  FolderOpen,
  Globe,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { useTTS, ttsManager, type TTSVoice } from '../../lib/tts'
import { isWeb, native } from '../../lib/native'
import type { TtsModelProgress, TtsModelStatus } from '../../../shared/ipc'
import { OpenAICompatibleTTSAdapter } from '../../lib/tts/adapters/openaiCompatible'
import { t } from '../../i18n'

interface Props {
  onToast: (msg: string) => void
}

const STORAGE_OPENAI_CFG = 'moji:tts:openai_cfg'
const STORAGE_SELECTED_VOICE = 'moji:tts:selected_voice'

export function PluginTtsPage({ onToast }: Props) {
  const { activeAdapterId, setActiveAdapter, rate, setRate, state, speak, stop } = useTTS()

  // 本地离线模型状态
  const [modelStatus, setModelStatus] = useState<TtsModelStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<TtsModelProgress | null>(null)

  // 音色列表与当前音色
  const [voices, setVoices] = useState<TTSVoice[]>([])
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_SELECTED_VOICE) || ''
    } catch {
      return ''
    }
  })

  // 云端 API 配置
  const [openaiCfg, setOpenaiCfg] = useState<{ baseUrl: string; apiKey: string; model: string; defaultVoice: string }>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_OPENAI_CFG)
      if (raw) return JSON.parse(raw)
    } catch {}
    return {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'tts-1',
      defaultVoice: 'alloy',
    }
  })

  // 试听测试文本
  const [testText, setTestText] = useState('你好！我是归一专属助教，探索知识的旅途上，很高兴陪伴在你身边。')

  // 刷新离线模型状态
  const refreshModel = useCallback(async () => {
    if (isWeb() || !window.mojiNative?.tts) return
    try {
      const s = await native().tts.modelStatus()
      setModelStatus(s)
    } catch (err) {
      console.warn('[TTS] 检查离线模型状态失败：', err)
    }
  }, [])

  // 刷新音色列表
  const refreshVoices = useCallback(async () => {
    try {
      const v = await ttsManager.getVoices()
      setVoices(v)
      if (v.length > 0 && !selectedVoice) {
        setSelectedVoice(v[0].id)
      }
    } catch {}
  }, [selectedVoice])

  useEffect(() => {
    void refreshModel()
  }, [refreshModel])

  useEffect(() => {
    void refreshVoices()
  }, [activeAdapterId, refreshVoices])

  // 监听下载进度
  useEffect(() => {
    if (isWeb() || !window.mojiNative?.tts) return
    return native().tts.onModelProgress((p) => {
      setProgress(p)
      if (p.percent >= 100) {
        setDownloading(false)
        void refreshModel()
      }
    })
  }, [refreshModel])

  // 开始下载离线模型
  const handleStartDownload = async () => {
    if (isWeb() || !window.mojiNative?.tts) {
      onToast(t('Web 模式暂不支持本地离线模型'))
      return
    }
    setDownloading(true)
    setProgress({ received: 0, total: 42 * 1024 * 1024, percent: 0, note: t('开始连接下载源...') })
    try {
      const res = await native().tts.downloadModel()
      if (res.ok) {
        onToast(t('离线模型已下载就绪！'))
        void refreshModel()
        void refreshVoices()
      } else {
        onToast(t('下载失败：{0}', res.error || '未知错误'))
      }
    } catch (err: any) {
      onToast(t('下载异常：{0}', err?.message || String(err)))
    } finally {
      setDownloading(false)
    }
  }

  // 取消下载
  const handleCancelDownload = async () => {
    if (isWeb() || !window.mojiNative?.tts) return
    await native().tts.cancelDownload()
    setDownloading(false)
    setProgress(null)
    onToast(t('已取消下载'))
  }

  // 删除离线模型
  const handleRemoveModel = async () => {
    if (isWeb() || !window.mojiNative?.tts) return
    if (!window.confirm(t('确定删除本地离线语音模型吗？删除后可随时重新下载。'))) return
    const res = await native().tts.removeModel()
    if (res.ok) {
      onToast(t('离线模型已清理'))
      void refreshModel()
      void refreshVoices()
    } else {
      onToast(t('删除失败：{0}', res.error || '未知错误'))
    }
  }

  // 打开所在文件夹
  const handleRevealModel = async () => {
    if (isWeb() || !window.mojiNative?.tts) return
    await native().tts.revealModel()
  }

  // 保存云端配置
  const handleSaveOpenai = () => {
    try {
      localStorage.setItem(STORAGE_OPENAI_CFG, JSON.stringify(openaiCfg))
      const adapter = ttsManager.getAdapter('openai-compatible') as OpenAICompatibleTTSAdapter
      if (adapter) {
        adapter.updateConfig(openaiCfg)
      }
      onToast(t('云端 API 配置已保存'))
    } catch {}
  }

  // 保存选中的音色
  const handleSelectVoice = (id: string) => {
    setSelectedVoice(id)
    try {
      localStorage.setItem(STORAGE_SELECTED_VOICE, id)
    } catch {}
  }

  // 试听测试
  const isPlaying = state === 'playing'
  const handleToggleTest = async () => {
    if (isPlaying) {
      stop()
      return
    }
    try {
      await speak(testText, {
        voiceId: selectedVoice,
        rate,
      })
    } catch (err: any) {
      onToast(t('试听失败：{0}', err?.message || String(err)))
    }
  }

  return (
    <div className="flex flex-col gap-6 py-1 text-ink max-w-[720px]">
      {/* 头部介绍 */}
      <div className="flex flex-col gap-1 border-b border-line pb-4">
        <h2 className="text-base font-semibold text-ink flex items-center gap-2">
          <Volume2 size={18} className="text-seal" />
          <span>{t('语音合成 (TTS)')}</span>
        </h2>
        <p className="text-xs text-ink-subtle leading-relaxed">
          {t('为助教对话与学习文档提供拟人化语音播报。采用统一适配器架构，支持零依赖的系统原生语音、极速离线轻量模型以及云端 API。')}
        </p>
      </div>

      {/* 适配器选项卡 */}
      <div className="flex flex-col gap-2.5">
        <label className="text-xs font-medium text-ink-soft">{t('发音引擎选择')}</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* 1. 系统原生 */}
          <div
            onClick={() => setActiveAdapter('web-speech')}
            className={`flex flex-col gap-1.5 p-3 rounded-lg border transition cursor-pointer ${
              activeAdapterId === 'web-speech'
                ? 'border-seal bg-seal/5 shadow-sm'
                : 'border-line hover:border-line-strong hover:bg-paper-deep/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-xs text-ink flex items-center gap-1.5">
                <Globe size={14} className="text-seal" />
                <span>{t('系统原生语音')}</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-line/60 text-ink-faint">Web Speech</span>
            </div>
            <p className="text-[11px] text-ink-subtle leading-normal">
              {t('系统内置引擎，零网络零配置，开箱即用。')}
            </p>
          </div>

          {/* 2. 本地离线模型 */}
          <div
            onClick={() => setActiveAdapter('sherpa-offline')}
            className={`flex flex-col gap-1.5 p-3 rounded-lg border transition cursor-pointer ${
              activeAdapterId === 'sherpa-offline'
                ? 'border-seal bg-seal/5 shadow-sm'
                : 'border-line hover:border-line-strong hover:bg-paper-deep/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-xs text-ink flex items-center gap-1.5">
                <Cpu size={14} className="text-seal" />
                <span>{t('本地离线模型')}</span>
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${modelStatus?.exists ? 'bg-ok/15 text-ok font-medium' : 'bg-line/60 text-ink-faint'}`}>
                {modelStatus?.exists ? t('已就绪') : t('需下载 · 42MB')}
              </span>
            </div>
            <p className="text-[11px] text-ink-subtle leading-normal">
              {t('Sherpa-ONNX 端侧轻量 VITS 神经网络，纯离线无网络依赖。')}
            </p>
          </div>

          {/* 3. 云端 API */}
          <div
            onClick={() => setActiveAdapter('openai-compatible')}
            className={`flex flex-col gap-1.5 p-3 rounded-lg border transition cursor-pointer ${
              activeAdapterId === 'openai-compatible'
                ? 'border-seal bg-seal/5 shadow-sm'
                : 'border-line hover:border-line-strong hover:bg-paper-deep/30'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-xs text-ink flex items-center gap-1.5">
                <Sparkles size={14} className="text-seal" />
                <span>{t('云端 API')}</span>
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-line/60 text-ink-faint">OpenAI 协议</span>
            </div>
            <p className="text-[11px] text-ink-subtle leading-normal">
              {t('接入 OpenAI、SiliconFlow 或本地中转的高拟真音色。')}
            </p>
          </div>
        </div>
      </div>

      {/* 详细配置区域 */}
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-paper-deep/20 p-4">
        {/* 本地离线模型配置详情 */}
        {activeAdapterId === 'sherpa-offline' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-ink">{t('VITS aishell3 轻量离线模型')}</h4>
                <p className="text-[11px] text-ink-subtle">{t('轻巧体积 (~42MB)，毫秒级端侧合成，支持 174 位说话人')}</p>
              </div>

              {modelStatus?.exists ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleRevealModel}
                    className="flex items-center gap-1 text-[11px] text-ink-subtle hover:text-ink px-2 py-1 rounded bg-line/40 hover:bg-line transition cursor-pointer"
                    title={t('在文件管理器中打开模型目录')}
                  >
                    <FolderOpen size={12} />
                    <span>{t('定位目录')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRemoveModel}
                    className="flex items-center gap-1 text-[11px] text-error hover:bg-error/10 px-2 py-1 rounded transition cursor-pointer"
                    title={t('删除已下载模型文件')}
                  >
                    <Trash2 size={12} />
                    <span>{t('删除')}</span>
                  </button>
                </div>
              ) : downloading ? (
                <button
                  type="button"
                  onClick={handleCancelDownload}
                  className="flex items-center gap-1 text-[11px] text-error hover:bg-error/10 px-2.5 py-1 rounded border border-error/30 transition cursor-pointer"
                >
                  <X size={12} />
                  <span>{t('取消下载')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartDownload}
                  className="flex items-center gap-1 text-xs text-paper bg-seal hover:bg-seal-deep px-3 py-1.5 rounded-lg font-medium transition cursor-pointer shadow-sm"
                >
                  <Download size={13} />
                  <span>{t('一键极速下载 (~42MB)')}</span>
                </button>
              )}
            </div>

            {/* 下载进度条 */}
            {downloading && progress && (
              <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-line/20 border border-line">
                <div className="flex justify-between text-[11px] text-ink-subtle">
                  <span>{progress.note || t('正在下载中...')}</span>
                  <span className="font-mono">{progress.percent}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-line/40 overflow-hidden">
                  <div
                    className="h-full bg-seal rounded-full transition-all duration-200"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 云端 API 配置详情 */}
        {activeAdapterId === 'openai-compatible' && (
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-semibold text-ink">{t('云端 API 连接设置')}</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-subtle">{t('接口地址 (Base URL)')}</label>
                <input
                  type="text"
                  value={openaiCfg.baseUrl}
                  onChange={(e) => setOpenaiCfg({ ...openaiCfg, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="rounded border border-line bg-paper px-2.5 py-1.5 text-xs text-ink outline-none focus:border-seal font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-subtle">{t('API 密钥 (API Key)')}</label>
                <input
                  type="password"
                  value={openaiCfg.apiKey}
                  onChange={(e) => setOpenaiCfg({ ...openaiCfg, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="rounded border border-line bg-paper px-2.5 py-1.5 text-xs text-ink outline-none focus:border-seal font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-subtle">{t('模型名称 (Model)')}</label>
                <input
                  type="text"
                  value={openaiCfg.model}
                  onChange={(e) => setOpenaiCfg({ ...openaiCfg, model: e.target.value })}
                  placeholder="tts-1"
                  className="rounded border border-line bg-paper px-2.5 py-1.5 text-xs text-ink outline-none focus:border-seal font-mono"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-ink-subtle">{t('音色 (Voice)')}</label>
                <select
                  value={openaiCfg.defaultVoice}
                  onChange={(e) => setOpenaiCfg({ ...openaiCfg, defaultVoice: e.target.value })}
                  className="rounded border border-line bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-seal cursor-pointer"
                >
                  <option value="alloy">Alloy (中性)</option>
                  <option value="echo">Echo (沉稳男声)</option>
                  <option value="fable">Fable (英伦语调)</option>
                  <option value="onyx">Onyx (磁性男声)</option>
                  <option value="nova">Nova (活泼女声)</option>
                  <option value="shimmer">Shimmer (清脆女声)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleSaveOpenai}
                className="flex items-center gap-1.5 text-xs text-paper bg-seal hover:bg-seal-deep px-3 py-1.5 rounded-lg font-medium transition cursor-pointer"
              >
                <Check size={12} />
                <span>{t('保存云端配置')}</span>
              </button>
            </div>
          </div>
        )}

        {/* 音色与语速调节 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-line/60">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-soft">{t('发音音色')}</label>
            <select
              value={selectedVoice}
              onChange={(e) => handleSelectVoice(e.target.value)}
              className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink outline-none focus:border-seal cursor-pointer"
            >
              {voices.length === 0 ? (
                <option value="">{t('默认音色')}</option>
              ) : (
                voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} {v.lang ? `(${v.lang})` : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-xs">
              <label className="font-medium text-ink-soft">{t('朗读语速')}</label>
              <span className="font-mono text-ink-subtle">{rate}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.05"
              value={rate}
              onChange={(e) => setRate(Number.parseFloat(e.target.value))}
              className="w-full accent-seal cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* 现场发音试听区域 */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-paper p-4 shadow-sm">
        <label className="text-xs font-medium text-ink flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Mic size={14} className="text-seal" />
            <span>{t('发音实时试听')}</span>
          </span>
          <button
            type="button"
            onClick={() => setTestText('你好！我是归一专属助教，探索知识的旅途上，很高兴陪伴在你身边。')}
            className="text-[11px] text-ink-faint hover:text-ink flex items-center gap-1 transition cursor-pointer"
          >
            <RotateCcw size={11} />
            <span>{t('重置示例')}</span>
          </button>
        </label>

        <textarea
          rows={2}
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder={t('输入想要朗读的文本...')}
          className="rounded-lg border border-line bg-paper-deep/30 px-3 py-2 text-xs text-ink outline-none focus:border-seal focus:bg-paper resize-none"
        />

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={handleToggleTest}
            className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg font-medium transition cursor-pointer shadow-sm ${
              isPlaying
                ? 'bg-seal/10 text-seal border border-seal/30'
                : 'bg-seal text-paper hover:bg-seal-deep'
            }`}
          >
            {isPlaying ? (
              <>
                <Square size={13} className="fill-current" />
                <span>{t('停止试听')}</span>
              </>
            ) : (
              <>
                <Play size={13} className="fill-current" />
                <span>{t('点击试听发音')}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
