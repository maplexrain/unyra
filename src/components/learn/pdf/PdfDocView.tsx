/**
 * PDF 文件只读预览组件（PdfDocView）
 *
 * 核心设计：
 * 1. 采用 pdfjs-dist 高清矢量栅格化渲染，支持视网膜/高分屏（devicePixelRatio）清晰渲染；
 * 2. 连续滚动页面视图，配备顶部浮动工具条：包含页码指示器、翻页、放大、缩小、重置与自适应缩放；
 * 3. 严格只读（不支持编辑），无任何源码/编辑切换入口；
 * 4. 遵循全局直角规范（rounded-none）。
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Maximize2,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
  Sparkles,
  X,
} from 'lucide-react'
import { OcrTextOverlay, extractOrOcrPageText } from '../../../lib/ocr/pdfTextLayer'
import { ocrPluginOn, OCR_PLUGIN_ID } from '../../../lib/ocr/plugin'
import type { OcrLineItem } from '../../../lib/native'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfjs } from '../../../learn/pdfRender'
import { readLocalMediaFile } from '../../../lib/localFiles'
import { readUserBinary, userAbsPrefix } from '../../../lib/storage'
import { fileNameOf } from '../../../learn/tabs'
import { t } from '../../../i18n'

interface Props {
  path: string
  scale?: number
}

interface PageItemProps {
  pdfDoc: PDFDocumentProxy
  pageNum: number
  zoom: number
  docPath: string
  onVisible?: (pageNum: number) => void
  onRequireOcr?: () => void
}

/**
 * 单页渲染子组件：使用 IntersectionObserver 懒渲染接近可视区的页面，节约显存与计算
 */
const PdfPageItem = memo(function PdfPageItem({
  pdfDoc,
  pageNum,
  zoom,
  docPath,
  onVisible,
  onRequireOcr,
}: PageItemProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const renderedRef = useRef(false)
  const loadingRef = useRef(false)
  const nextRenderRequestedRef = useRef(false)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [textLines, setTextLines] = useState<OcrLineItem[]>([])
  const extractingRef = useRef(false)

  const loadText = useCallback(async () => {
    if (extractingRef.current || !pdfDoc) return
    extractingRef.current = true
    try {
      const res = await extractOrOcrPageText(pdfDoc, pageNum, docPath, canvasRef.current)
      if (res.lines.length > 0) {
        setTextLines(res.lines)
      }
      if (res.isScanned && !ocrPluginOn()) {
        onRequireOcr?.()
      }
    } finally {
      extractingRef.current = false
    }
  }, [pdfDoc, pageNum, docPath, onRequireOcr])

  // 1. 获取基础页面尺寸以提前占位，避免页面高度坍塌跳动
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum)
        if (!alive) return
        const vp = page.getViewport({ scale: zoom })
        setDimensions({ width: Math.floor(vp.width), height: Math.floor(vp.height) })
      } catch {}
    })()
    return () => {
      alive = false
    }
  }, [pdfDoc, pageNum, zoom])

  // 2. 页面渲染函数：若正在渲染前一轮缩放，取消并排队执行最新一轮；已渲染完成则绝不重复渲染
  const renderPage = useCallback(async () => {
    if (!canvasRef.current || renderedRef.current) return

    if (loadingRef.current) {
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel()
        } catch {}
        renderTaskRef.current = null
      }
      nextRenderRequestedRef.current = true
      return
    }

    loadingRef.current = true

    try {
      const page = await pdfDoc.getPage(pageNum)
      const canvas = canvasRef.current
      if (!canvas) return

      const pixelRatio = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1))
      // 直接以包含设备像素比的 scale 获取 viewport，保证高分屏下超清栅格化
      const viewport = page.getViewport({ scale: zoom * pixelRatio })

      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width / pixelRatio)}px`
      canvas.style.height = `${Math.floor(viewport.height / pixelRatio)}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const task = page.render({
        canvasContext: ctx,
        viewport,
      } as unknown as Parameters<typeof page.render>[0])
      renderTaskRef.current = task

      await task.promise
      renderedRef.current = true
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'RenderingCancelledException') {
        // 正常取消，忽略
      } else {
        console.warn(`[pdf] 渲染第 ${pageNum} 页失败:`, err)
      }
    } finally {
      loadingRef.current = false
      renderTaskRef.current = null
      if (nextRenderRequestedRef.current) {
        nextRenderRequestedRef.current = false
        void renderPage()
      }
    }
  }, [pdfDoc, pageNum, zoom])

  // 缩放变动时，重置渲染标记以重新生成适配新尺寸的高清画布（轻量防抖 50ms 聚合连滚）
  useEffect(() => {
    renderedRef.current = false
    const t = setTimeout(() => {
      void renderPage()
    }, 50)
    return () => clearTimeout(t)
  }, [zoom, renderPage])

  // 首页及前 3 页进入时主动触发一次渲染与文本层提取，无需等待滚动探测
  useEffect(() => {
    if (pageNum <= 3) {
      void renderPage()
      void loadText()
    }
  }, [pageNum, renderPage, loadText])

  // 3. 视口探测：超前 1000px 预加载，滚动进入前已提前渲染完毕，保证无缝平滑体验
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onVisible?.(pageNum)
            if (!renderedRef.current) {
              void renderPage()
            }
            if (textLines.length === 0) {
              void loadText()
            }
          }
        }
      },
      {
        rootMargin: '1000px 0px 1000px 0px',
      }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [renderPage, pageNum, onVisible, textLines.length, loadText])

  return (
    <div
      ref={containerRef}
      data-page-number={pageNum}
      className="relative my-4 flex shrink-0 justify-center bg-white shadow-md border border-line-strong/30 rounded-none overflow-hidden"
      style={{
        width: dimensions ? `${dimensions.width}px` : 'auto',
        height: dimensions ? `${dimensions.height}px` : 'auto',
        minHeight: dimensions ? `${dimensions.height}px` : '800px',
        maxWidth: '100%',
      }}
    >
      <canvas ref={canvasRef} className="block select-none bg-white w-full h-full" />
      <OcrTextOverlay lines={textLines} pageHeight={dimensions?.height || 800} />
    </div>
  )
})

export const PdfDocView = memo(function PdfDocView({ path, scale: baseScale = 1.0 }: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1.15 * baseScale)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const name = fileNameOf(path)

  // 读取并加载 PDF 文件字节
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        let bytes: Uint8Array | null = null

        // 1. 尝试通过 Electron 本地媒体通道读取
        const res = await readLocalMediaFile(path)
        if (res.ok && res.dataUrl) {
          const commaIdx = res.dataUrl.indexOf(',')
          if (commaIdx !== -1) {
            const b64 = res.dataUrl.slice(commaIdx + 1)
            const binStr = atob(b64)
            const u8 = new Uint8Array(binStr.length)
            for (let i = 0; i < binStr.length; i++) {
              u8[i] = binStr.charCodeAt(i)
            }
            bytes = u8
          }
        }

        // 2. 兜底尝试通过用户目录相对路径读取（storage:readBinary）
        if (!bytes) {
          const prefix = userAbsPrefix()?.replace(/\\/g, '/').toLowerCase()
          const normPath = path.replace(/\\/g, '/')
          let rel: string | null = null
          if (prefix && normPath.toLowerCase().startsWith(prefix)) {
            rel = normPath.slice(prefix.length).replace(/^[\/]+/, '')
          } else if (!/^[a-zA-Z]:[/\\]|^[/\\]{2}|^\//.test(path)) {
            rel = normPath
          }
          if (rel) {
            const userUrl = await readUserBinary(rel)
            if (userUrl) {
              const commaIdx = userUrl.indexOf(',')
              const b64 = commaIdx !== -1 ? userUrl.slice(commaIdx + 1) : userUrl
              const binStr = atob(b64)
              const u8 = new Uint8Array(binStr.length)
              for (let i = 0; i < binStr.length; i++) {
                u8[i] = binStr.charCodeAt(i)
              }
              bytes = u8
            }
          }
        }

        if (!alive) return
        if (!bytes || !bytes.byteLength) {
          setError(res.error || t('未能读取 PDF 文件内容（文件不存在或内容为空）'))
          setLoading(false)
          return
        }

        const pdfjs = await loadPdfjs()
        const task = pdfjs.getDocument({ data: bytes.slice() })

        const doc = await task.promise
        if (!alive) {
          void task.destroy().catch(() => {})

          return
        }

        setPdfDoc(doc)
        setNumPages(doc.numPages)
        setLoading(false)
      } catch (err: unknown) {
        if (!alive) return
        setError(err instanceof Error ? err.message : t('PDF 解析失败，可能已损坏或受密码保护'))
        setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [path])

  const scrollToPage = (pageNum: number) => {
    const p = Math.max(1, Math.min(numPages, pageNum))
    setCurrentPage(p)
    const el = scrollRef.current?.querySelector(`[data-page-number="${p}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })

    }
  }

  const [ocrBannerDismissed, setOcrBannerDismissed] = useState(false)
  const [zoomHud, setZoomHud] = useState(false)

  const handleOpenOcrConfig = () => {
    try {
      localStorage.setItem('moji:settings:tab', 'plugins')
      localStorage.setItem('moji:settings:plugin', OCR_PLUGIN_ID)
    } catch {}
    window.dispatchEvent(new CustomEvent('moji:open-plugin-config', { detail: OCR_PLUGIN_ID }))
    window.dispatchEvent(new CustomEvent('moji:open-tab', { detail: { kind: 'settings' } }))
  }
  const zoomTimerRef = useRef<number | null>(null)

  const triggerZoomHud = useCallback(() => {
    setZoomHud(true)
    if (zoomTimerRef.current !== null) {
      window.clearTimeout(zoomTimerRef.current)
    }
    zoomTimerRef.current = window.setTimeout(() => {
      setZoomHud(false)
      zoomTimerRef.current = null
    }, 900)
  }, [])

  useEffect(() => {
    return () => {
      if (zoomTimerRef.current !== null) {
        window.clearTimeout(zoomTimerRef.current)
      }
    }
  }, [])

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.max(0.4, Math.min(3.0, Number((prev + delta).toFixed(2)))))
    triggerZoomHud()
  }

  // Ctrl + 鼠标滚轮 / 触控板手势缩放控制（前置 capture 捕获，精准定位当前 PDF 区域）
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // 必须按下 Ctrl (Windows/Linux) 或 Cmd (macOS)
      if (!e.ctrlKey && !e.metaKey) return

      const root = rootRef.current
      if (!root) return
      const target = e.target as Node | null
      const inRoot = (target && root.contains(target)) || (e.composedPath && e.composedPath().includes(root))
      if (!inRoot) return

      // 彻底阻止浏览器默认全局网页缩放及内部容器纵向滚动
      e.preventDefault()
      e.stopPropagation()

      const delta = -e.deltaY
      if (Math.abs(delta) < 0.5) return

      // deltaMode: 0=像素, 1=行, 2=页
      const unit = e.deltaMode === 1 ? 3 : 100
      const notches = Math.max(-3, Math.min(3, delta / unit))
      // 滚轮单格固定 0.1 步长，触控板微调
      const step = Math.abs(notches) >= 0.4 ? (notches > 0 ? 0.1 : -0.1) : Number((notches * 0.1).toFixed(2))
      if (!step) return

      setZoom((prev) => Math.max(0.4, Math.min(3.0, Number((prev + step).toFixed(2)))))
      triggerZoomHud()
    }

    // 挂在 window 捕获阶段：优先于一切内层容器滚动与被动监听，确保 100% 拦截并响应
    window.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('wheel', handleWheel, { capture: true })
    }
  }, [triggerZoomHud])

  const handleFitWidth = async () => {
    if (!scrollRef.current || !pdfDoc) return
    const containerWidth = scrollRef.current.clientWidth - 48
    try {
      const firstPage = await pdfDoc.getPage(1)
      const baseVp = firstPage.getViewport({ scale: 1 })
      const targetZoom = Math.max(0.4, Math.min(3.0, containerWidth / baseVp.width))
      setZoom(Number(targetZoom.toFixed(2)))
      triggerZoomHud()
    } catch {
      const targetZoom = Math.max(0.6, Math.min(2.5, containerWidth / 595))
      setZoom(Number(targetZoom.toFixed(2)))
      triggerZoomHud()
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-2.5 bg-paper select-none">
        <Loader2 size={22} className="animate-spin text-seal" />
        <span className="text-[13px] text-ink-soft">{t('正在载入 PDF 文档《{0}》…', name)}</span>
      </div>
    )
  }

  if (error || !pdfDoc) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center bg-paper select-none">
        <TriangleAlert size={26} className="text-warn-deep" />
        <h3 className="text-[14px] font-semibold text-ink-strong">{t('无法预览该 PDF 文件')}</h3>
        <p className="max-w-[420px] text-[12px] leading-relaxed text-ink-faint">{error}</p>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-card select-none">
      {/* 顶部控制工具条 */}
      <div className="no-print flex h-10 shrink-0 items-center justify-between border-b border-line bg-paper-deep/70 px-4 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={15} className="text-rose-500 shrink-0" />
          <span className="truncate text-[12px] font-medium text-ink-strong" title={name}>
            {name}
          </span>
          <span className="text-[11px] text-ink-faint ml-1">
            ({t('只读预览')})

          </span>
        </div>

        {/* 翻页与缩放控制器 */}
        <div className="flex items-center gap-1.5 text-[12px] text-ink-soft">
          {/* 上一页 */}
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => scrollToPage(currentPage - 1)}
            title={t('上一页')}
            className="flex h-7 w-7 items-center justify-center rounded-none text-ink-soft hover:text-ink hover:bg-card/70 disabled:opacity-40 transition"
          >
            <ChevronLeft size={15} />
          </button>

          {/* 页码指示器 */}
          <span className="px-1 text-[11.5px] tabular-nums text-ink">
            {t('{0} / {1}', currentPage, numPages)}
          </span>

          {/* 下一页 */}
          <button
            type="button"
            disabled={currentPage >= numPages}
            onClick={() => scrollToPage(currentPage + 1)}
            title={t('下一页')}
            className="flex h-7 w-7 items-center justify-center rounded-none text-ink-soft hover:text-ink hover:bg-card/70 disabled:opacity-40 transition"
          >
            <ChevronRight size={15} />
          </button>

          <span aria-hidden="true" className="mx-1 h-3.5 w-px bg-line" />

          {/* 缩小 */}
          <button
            type="button"
            onClick={() => handleZoom(-0.15)}
            title={t('缩小 (亦可 Ctrl+滚轮)')}
            className="flex h-7 w-7 items-center justify-center rounded-none text-ink-soft hover:text-ink hover:bg-card/70 transition"
          >
            <ZoomOut size={14} />
          </button>

          {/* 重置 100% */}
          <button
            type="button"
            onClick={() => setZoom(1.0)}
            title={t('重置为 100%')}
            className="px-1.5 py-0.5 text-[11px] tabular-nums text-ink-soft hover:text-ink hover:bg-card/70 rounded-none transition"
          >
            {Math.round(zoom * 100)}%
          </button>

          {/* 放大 */}
          <button
            type="button"
            onClick={() => handleZoom(0.15)}
            title={t('放大 (亦可 Ctrl+滚轮)')}
            className="flex h-7 w-7 items-center justify-center rounded-none text-ink-soft hover:text-ink hover:bg-card/70 transition"
          >
            <ZoomIn size={14} />
          </button>

          {/* 自适应宽度 */}
          <button
            type="button"
            onClick={handleFitWidth}
            title={t('自适应宽度')}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-ink-soft hover:text-ink hover:bg-card/70 rounded-none transition"
          >
            <Maximize2 size={12} />
            <span>{t('自适应')}</span>
          </button>
        </div>
      </div>

      {/* 未安装 OCR 插件提示 Banner */}
      {!ocrPluginOn() && !ocrBannerDismissed && (
        <div className="no-print flex items-center justify-between border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12px] text-ink-strong select-none">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={14} className="text-amber-500 shrink-0" />
            <span className="truncate">
              {t('当前未安装 OCR 文字识别插件，页面文字暂无法直接框选与复制。推荐下载 OCR 插件以获得最佳阅读体验。')}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              type="button"
              onClick={handleOpenOcrConfig}
              className="rounded-none bg-seal px-2.5 py-1 text-[11px] font-medium text-white hover:bg-seal-deep transition"
            >
              {t('下载 / 配置 OCR 插件')}
            </button>
            <button
              type="button"
              onClick={() => setOcrBannerDismissed(true)}
              title={t('关闭提示')}
              className="p-1 text-ink-soft hover:text-ink transition"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* PDF 页面滚动展示流 */}
      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overflow-x-auto p-4 bg-paper/50"
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <PdfPageItem
            key={`${path}#p${pageNum}`}
            pdfDoc={pdfDoc}
            pageNum={pageNum}
            zoom={zoom}
            docPath={path}
            onVisible={setCurrentPage}
            onRequireOcr={() => setOcrBannerDismissed(false)}
          />
        ))}
      </div>

      {/* 缩放浮动提示徽章（滚轮或按钮缩放时短暂显示） */}
      {zoomHud && (
        <div className="pointer-events-none absolute bottom-6 right-6 z-30 rounded-none bg-paper-deep/90 px-3 py-1.5 text-[12px] font-mono font-medium text-ink shadow-md border border-line backdrop-blur transition-opacity">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  )
})

export default PdfDocView
