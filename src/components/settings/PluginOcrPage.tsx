/**
 * 设置 → 插件 → 功能性插件 → OCR 文字识别：二级独立配置页。
 *
 * 核心能力：
 * 1. 模型矩阵：多款离线模型（极速版、高精度版、Tesseract 多语言、西文专用）下载与管理；
 * 2. 丰富下载源：国内镜像、官方源、魔搭社区与 GitHub CDN，支持本机导入；
 * 3. 缓存管理：查看已识别页签缓存并支持一键清空；
 * 4. 离线架构：模型本地推理与数据安全声明。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  RefreshCw,
  ScanText,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import {
  cancelOcrDownload,
  chooseOcrModelFile,
  downloadOcrModel,
  formatBytes,
  ocrModelStatus,
  onOcrModelProgress,
  removeOcrModel,
  revealOcrModelDir,
  setActiveOcrModel,
  type OcrModelOption,
  type OcrModelStatus,
} from '../../lib/ocr/model'
import { clearMemoryOcrCache, getMemoryOcrCacheCount } from '../../lib/ocr/cache'
import { t } from '../../i18n'

interface Props {
  onToast: (msg: string) => void
}

export function PluginOcrPage({ onToast }: Props) {
  const [status, setStatus] = useState<OcrModelStatus | null>(null)
  const [selectedSource, setSelectedSource] = useState('hf-mirror')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [progressNote, setProgressNote] = useState('')
  const [error, setError] = useState('')
  const [cachedCount, setCachedCount] = useState(() => getMemoryOcrCacheCount())

  const refresh = useCallback(() => {
    void ocrModelStatus().then((s) => {
      setStatus(s)
      setCachedCount(getMemoryOcrCacheCount())
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    return onOcrModelProgress((p) => {
      if (p.modelId) setDownloadingId(p.modelId)
      setPercent(p.percent)
      setProgressNote(p.note ?? '')
      if (p.percent >= 100) {
        setDownloadingId(null)
        setPercent(null)
        setProgressNote('')
        refresh()
      }
    })
  }, [refresh])

  const handleStartDownload = (modelId: string) => {
    setError('')
    setDownloadingId(modelId)
    setPercent(0)
    void downloadOcrModel(modelId, selectedSource)
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? t('下载失败'))
        } else {
          onToast(t('OCR 模型下载完成') + (res.source ? t('（来自 {0}）', res.source) : ''))
        }
      })
      .finally(() => {
        setDownloadingId(null)
        setPercent(null)
        setProgressNote('')
        refresh()
      })
  }

  const handlePickLocal = () => {
    setError('')
    void chooseOcrModelFile().then((res) => {
      if (res.canceled) return
      if (!res.ok) {
        setError(res.error ?? t('导入失败'))
      } else {
        onToast(t('已成功导入本机模型'))
        refresh()
      }
    })
  }

  const handleSetActive = (modelId: string) => {
    void setActiveOcrModel(modelId).then((ok) => {
      if (ok) {
        onToast(t('已切换当前 OCR 识别模型'))
        refresh()
      }
    })
  }

  const handleRemove = (modelId: string) => {
    void removeOcrModel(modelId).then((res) => {
      if (!res.ok) {
        setError(res.error ?? t('删除失败'))
      } else {
        onToast(t('已删除模型文件'))
        refresh()
      }
    })
  }

  const handleClearCache = () => {
    clearMemoryOcrCache()
    setCachedCount(0)
    onToast(t('已清空 OCR 识别缓存'))
  }

  return (
    <div className="flex flex-col gap-4 select-none">
      {/* 头部简介 */}
      <div className="flex flex-col gap-1 border-b border-line pb-3">
        <div className="flex items-center gap-2">
          <ScanText size={16} className="text-seal" />
          <h2 className="text-[14px] font-semibold text-ink-strong">{t('本地 OCR 文字识别配置')}</h2>
        </div>
        <p className="text-[11.5px] text-ink-soft">
          {t('基于端侧离线深度学习引擎，模型全部在本地运行，断网依然可用。支持 PDF 扫描件文字识别与原生级隐形框选复制。')}
        </p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center justify-between rounded-none border border-warn-deep/30 bg-warn-deep/10 px-3 py-2 text-[12px] text-warn-deep">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="p-0.5 hover:opacity-80">
            <X size={13} />
          </button>
        </div>
      )}

      {/* 下载源选择 */}
      <section className="rounded-none border border-line bg-card/60 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Download size={14} className="text-seal" />
            <span className="text-[13px] font-semibold text-ink-strong">{t('下载镜像加速源')}</span>
          </div>
          <span className="text-[11px] text-ink-faint">{t('支持多源热切换')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
          {(status?.sources || []).map((src) => {
            const active = selectedSource === src.id
            return (
              <button
                key={src.id}
                type="button"
                onClick={() => setSelectedSource(src.id)}
                className={`flex items-center justify-between px-3 py-2 border rounded-none text-left transition ${
                  active
                    ? 'border-seal bg-seal/5 text-ink-strong font-medium'
                    : 'border-line hover:border-line-strong text-ink-soft bg-paper/30'
                }`}
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-[12px] truncate">{src.name}</span>
                  <span className="text-[10px] text-ink-faint">{src.speedHint}</span>
                </div>
                {active && <Check size={13} className="text-seal stroke-[2.5]" />}
              </button>
            )
          })}
        </div>
      </section>

      {/* 模型矩阵下载选择 */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu size={14} className="text-seal" />
            <span className="text-[13px] font-semibold text-ink-strong">{t('模型下载选项')}</span>
          </div>
          <span className="text-[11px] text-ink-faint">{t('可根据硬件与阅读偏好按需下载')}</span>
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          {(status?.models || []).map((model: OcrModelOption) => {
            const isDownloading = downloadingId === model.id

            return (
              <div
                key={model.id}
                className="flex flex-col gap-2 rounded-none border border-line bg-card/60 p-3.5 transition hover:border-line-strong"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ink-strong">{model.name}</span>
                    <span className="font-mono text-[11px] text-ink-faint">({model.sizeMb} MB)</span>
                    <div className="flex items-center gap-1">
                      {model.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.2 text-[10px] rounded-none border border-line bg-paper-deep/60 text-ink-soft"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  {model.exists ? (
                    <div className="flex items-center gap-1.5">
                      {status?.activeModelId === model.id && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded-none border border-seal/40 bg-seal/10 text-seal font-medium">
                          {t('使用中')}
                        </span>
                      )}
                      <span className="flex items-center gap-1 rounded-none border border-ok-deep/40 bg-ok-deep/10 px-2 py-0.5 text-[10.5px] font-medium text-ok-deep">
                        <Check size={11} className="stroke-[2.5]" />
                        {t('已就绪 · {0}', formatBytes(model.bytes))}
                      </span>
                    </div>
                  ) : isDownloading ? (
                    <span className="rounded-none border border-warn-deep/40 bg-warn-deep/10 px-2 py-0.5 text-[10.5px] font-medium text-warn-deep animate-pulse">
                      {t('下载中 {0}%', percent ?? 0)}
                    </span>
                  ) : (
                    <span className="rounded-none border border-line bg-line/30 px-2 py-0.5 text-[10.5px] text-ink-faint">
                      {t('未下载')}
                    </span>
                  )}
                </div>

                <p className="text-[11.5px] text-ink-soft leading-relaxed">{model.description}</p>

                {/* 进度条 */}
                {isDownloading && percent !== null && (
                  <div className="mt-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-none bg-line">
                      <div
                        className="h-full bg-seal transition-[width] duration-150"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    {progressNote && <div className="mt-1 text-[10.5px] text-ink-faint">{progressNote}</div>}
                  </div>
                )}

                {/* 操作按键 */}
                <div className="mt-1 flex items-center justify-end gap-2">
                  {isDownloading ? (
                    <button
                      type="button"
                      onClick={() => void cancelOcrDownload()}
                      className="flex items-center gap-1 rounded-none border border-line bg-card px-2.5 py-1 text-[11px] text-ink hover:border-line-strong transition"
                    >
                      <X size={11} />
                      <span>{t('取消')}</span>
                    </button>
                  ) : !model.exists ? (
                    <button
                      type="button"
                      onClick={() => handleStartDownload(model.id)}
                      className="flex items-center gap-1 rounded-none bg-seal px-3 py-1 text-[11px] font-medium text-white hover:bg-seal-deep transition"
                    >
                      <Download size={11} />
                      <span>{t('下载模型')}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {status?.activeModelId !== model.id && (
                        <button
                          type="button"
                          onClick={() => handleSetActive(model.id)}
                          className="flex items-center gap-1 rounded-none border border-line bg-card px-2 py-1 text-[11px] text-ink-soft hover:text-ink hover:border-line-strong transition"
                        >
                          <Check size={11} />
                          <span>{t('设为当前')}</span>
                        </button>
                      )}
                      {model.bytes < model.totalBytes * 0.7 && (
                        <button
                          type="button"
                          onClick={() => handleStartDownload(model.id)}
                          className="flex items-center gap-1 rounded-none border border-seal/40 bg-seal/5 px-2 py-1 text-[11px] font-medium text-seal hover:bg-seal hover:text-white transition"
                          title={t('下载完整离线权重（{0} MB）', model.sizeMb)}
                        >
                          <Download size={11} />
                          <span>{t('下载完整版')}</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove(model.id)}
                        className="flex items-center gap-1 rounded-none border border-line px-2.5 py-1 text-[11px] text-ink-soft hover:text-rose-500 hover:border-rose-300 transition"
                        title={t('删除此模型')}
                      >
                        <Trash2 size={11} />
                        <span>{t('删除')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 离线导入与文件夹入口 */}
      <section className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
        <button
          type="button"
          onClick={handlePickLocal}
          className="flex items-center gap-1.5 rounded-none border border-line bg-card px-3 py-1.5 text-[11.5px] font-medium text-ink hover:border-line-strong transition"
        >
          <FolderOpen size={13} />
          <span>{t('从本机挑选离线模型…')}</span>
        </button>

        <button
          type="button"
          onClick={() => void revealOcrModelDir()}
          className="flex items-center gap-1.5 rounded-none border border-line bg-card px-3 py-1.5 text-[11.5px] text-ink-soft hover:text-ink hover:border-line-strong transition"
        >
          <FolderOpen size={13} />
          <span>{t('打开模型目录')}</span>
        </button>
      </section>

      {/* 页面 OCR 缓存管理 */}
      <section className="rounded-none border border-line bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive size={15} className="text-seal" />
            <div>
              <h3 className="text-[13px] font-semibold text-ink-strong">{t('页面 OCR 识别缓存')}</h3>
              <p className="text-[11px] text-ink-faint">
                {t('已识别过的 PDF 页面自动缓存至磁盘，重复翻阅 0 秒呈现框选层')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11.5px] text-ink-soft">
              {t('已缓存 {0} 页', cachedCount)}
            </span>
            <button
              type="button"
              onClick={handleClearCache}
              className="flex items-center gap-1 rounded-none border border-line bg-card px-2.5 py-1 text-[11px] text-ink-soft hover:text-ink hover:border-line-strong transition"
            >
              <RefreshCw size={11} />
              <span>{t('清空缓存')}</span>
            </button>
          </div>
        </div>
      </section>

      {/* 隐私与安全说明 */}
      <div className="flex items-start gap-2 rounded-none border border-line bg-paper-deep/40 p-3 text-[11px] text-ink-faint leading-relaxed">
        <ShieldCheck size={14} className="shrink-0 text-seal mt-0.5" />
        <span>
          {t('端侧隐私保障：所有 OCR 页面栅格化与模型文本识别均 100% 在您本机运行，绝不上传任何文档图像或文字内容至外部网络。')}
        </span>
      </div>
    </div>
  )
}
