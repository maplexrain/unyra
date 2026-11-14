/**
 * OCR 识别详情浮层（右键菜单「查看本页 OCR 识别详情」打开）——诊断工具。
 *
 * 展示一页的三样东西：
 * 1. **文字层数据**：喂给 pdfjs TextLayer 的 items（文字 + PDF 空间坐标）——挂贴
 *    用的就是这些，位置/字号问题在这里先对答案；
 * 2. **原始返回**：OCR 服务的原样文本（含 grounding 标记），一键复制；
 * 3. **路径信息**：矢量还是 OCR、缓存命中还是现识、档位。
 * 数据走 extractPageTextData（缓存命中不重新花钱；缓存没有该页时当场识别一次）。
 */

import { useEffect, useRef, useState, type RefObject } from 'react'
import { X } from 'lucide-react'
import { t } from '../../../i18n'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { extractOrOcrPageText, type PageTextExtractionResult } from '../../../lib/ocr/pdfTextLayer'
import { ocrEngineOf } from '../../../lib/capabilities'

interface Props {
  pdfDoc: PDFDocumentProxy
  pageNum: number
  docPath: string
  /** 滚动容器（canvas 按页码从它的 DOM 里查：debug 打开时页面可能已换挡） */
  scrollRef: RefObject<HTMLDivElement | null>
  onClose: () => void
}

/** 来源的中文措辞 */
function sourceLabel(res: PageTextExtractionResult | null): string {
  if (!res) return t('提取失败')
  if (res.lines.length > 0) {
    if (!res.isScanned) {
      if (res.fromCache) return t('PDF 矢量文本（缓存）')
      return t('PDF 矢量文本（现提取）')
    }
    if (res.fromCache) return t('OCR（缓存命中）')
    return t('OCR（本次现识）')
  }
  if (res.rawOcrText) return t('OCR 返回纯文本（快速识别档，无坐标不挂贴）')
  return t('本页没有任何文字层')
}

export function OcrDebugOverlay({ pdfDoc, pageNum, docPath, scrollRef, onClose }: Props) {
  const [result, setResult] = useState<PageTextExtractionResult | null>(null)
  const [loading, setLoading] = useState(true)
  const engineCfg = ocrEngineOf()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  canvasRef.current =
    (scrollRef.current?.querySelector(`[data-page-number="${pageNum}"] canvas`) as HTMLCanvasElement | null) ?? null
  const canvas = canvasRef.current

  useEffect(() => {
    let alive = true
    setLoading(true)
    void extractOrOcrPageText(pdfDoc, pageNum, docPath, canvas, true)
      .then((res) => {
        if (alive) setResult(res)
      })
      .catch(() => {
        if (alive) setResult(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [pdfDoc, pageNum, docPath, canvas])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/60 p-6 select-none"
      onClick={onClose}
    >
      <div
        className="flex max-h-[86vh] w-[min(920px,92vw)] flex-col rounded-xl border border-line-strong bg-card shadow-[0_18px_60px_rgba(0,0,0,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-ink-strong">
              {t('OCR 识别详情 · 第 {0} 页', String(pageNum))}
            </h3>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              {loading
                ? t('读取中…（缓存没有这一页时会当场识别一次）')
                : `${t(sourceLabel(result))} · ${t('档位')}: ${engineCfg ? t(engineCfg.purpose === 'rich_layout_recognition' ? '版面识别' : '快速识别') : t('未接入')} · ${result ? t('{0} 行', String(result.lines.length)) : ''}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={t('关闭')}
            className="p-1 text-ink-soft transition hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <section>
            <h4 className="mb-1.5 text-[11.5px] font-medium text-ink-soft">
              {t('解析结果（挂贴用的就是这些行与坐标）')}
            </h4>
            <div className="max-h-[30vh] overflow-y-auto rounded-lg border border-line/70">
              {result && result.lines.length > 0 ? (
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="sticky top-0 bg-paper-deep text-ink-faint">
                      <th className="px-2 py-1 font-medium">{t('#')}</th>
                      <th className="px-2 py-1 font-medium">{t('文字')}</th>
                      <th className="px-2 py-1 font-medium">x</th>
                      <th className="px-2 py-1 font-medium">y</th>
                      <th className="px-2 py-1 font-medium">{t('宽')}</th>
                      <th className="px-2 py-1 font-medium">{t('高')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/40">
                    {result.lines.map((l, i) => (
                      <tr key={i} className="text-ink-soft">
                        <td className="px-2 py-1 text-ink-faint">{i + 1}</td>
                        <td className="max-w-[380px] truncate px-2 py-1 text-ink" title={l.text}>
                          {l.text}
                        </td>
                        <td className="px-2 py-1 font-mono">{l.bbox.x.toFixed(3)}</td>
                        <td className="px-2 py-1 font-mono">{l.bbox.y.toFixed(3)}</td>
                        <td className="px-2 py-1 font-mono">{l.bbox.width.toFixed(3)}</td>
                        <td className="px-2 py-1 font-mono">{l.bbox.height.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-3 py-2 text-[11px] text-ink-faint">
                  {loading ? t('读取中…') : t('没有解析出任何项')}
                </p>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col">
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="text-[11.5px] font-medium text-ink-soft">
                {t('识别服务原始返回（含标记原样）')}
              </h4>
              {result?.rawOcrText && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.rawOcrText ?? '').catch(() => undefined)
                  }}
                  className="text-[11px] text-seal-deep hover:underline"
                >
                  {t('复制原始返回')}
                </button>
              )}
            </div>
            <pre className="min-h-[120px] flex-1 overflow-auto rounded-lg border border-line/70 bg-paper-deep/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-soft select-text">
              {loading
                ? t('读取中…')
                : (result?.rawOcrText ??
                  t('（无——矢量路径不经 OCR，或这一页没有识别结果）'))}
            </pre>
          </section>
        </div>
      </div>
    </div>
  )
}
