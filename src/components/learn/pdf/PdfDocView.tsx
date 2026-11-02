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
} from 'lucide-react'
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
  onVisible?: (pageNum: number) => void
}

/**
 * 单页渲染子组件：使用 IntersectionObserver 懒渲染接近可视区的页面，节约显存与计算
 */
const PdfPageItem = memo(function PdfPageItem({
  pdfDoc,
  pageNum,
  zoom,
  onVisible,
}: PageItemProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [rendered, setRendered] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)

  // 1. 获取基础页面尺寸以提前占位，避免页面高度坍塌跳动
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum)
        if (!alive) return
        const vp = page.getViewport({ scale: zoom })
        setDimensions({ width: vp.width, height: vp.height })
      } catch {}
    })()
    return () => {
      alive = false
    }
  }, [pdfDoc, pageNum, zoom])

  // 2. 页面渲染函数
  const renderPage = useCallback(async () => {
    if (!canvasRef.current || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)

    // 取消上一次未完成的渲染
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel()
      } catch {}
      renderTaskRef.current = null
    }

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
      setRendered(true)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'RenderingCancelledException') {
        // 正常取消，忽略
      } else {
        console.warn(`[pdf] 渲染第 ${pageNum} 页失败:`, err)
      }
    } finally {
      loadingRef.current = false
      setLoading(false)
      renderTaskRef.current = null
    }
  }, [pdfDoc, pageNum, zoom])

  // 首页及前 3 页进入时主动触发一次渲染，避免等待 IntersectionObserver 探测
  useEffect(() => {
    if (pageNum <= 3) {
      void renderPage()
    }
  }, [pageNum, renderPage])

  // 缩放变动时，已渲染的页面自动重新高清渲染
  useEffect(() => {
    if (rendered) {
      void renderPage()
    }
  }, [zoom])

  // 3. 视口探测：进入视口或接近视口时自动触发渲染
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onVisible?.(pageNum)
            void renderPage()
          }
        }
      },
      {
        rootMargin: '400px 0px 400px 0px',
      }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [renderPage, pageNum, onVisible])

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
      <canvas ref={canvasRef} className="block select-none bg-white" />
      {(!rendered || loading) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-paper/20 text-ink-faint select-none pointer-events-none">
          <Loader2 size={16} className="animate-spin text-seal" />
          <span className="text-[11px]">{t('第 {0} 页渲染中…', pageNum)}</span>
        </div>
      )}
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

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.max(0.5, Math.min(3.0, prev + delta)))
  }

  const handleFitWidth = async () => {
    if (!scrollRef.current || !pdfDoc) return
    const containerWidth = scrollRef.current.clientWidth - 48
    try {
      const firstPage = await pdfDoc.getPage(1)
      const baseVp = firstPage.getViewport({ scale: 1 })
      const targetZoom = Math.max(0.4, Math.min(3.0, containerWidth / baseVp.width))
      setZoom(Number(targetZoom.toFixed(2)))
    } catch {
      const targetZoom = Math.max(0.6, Math.min(2.5, containerWidth / 595))
      setZoom(Number(targetZoom.toFixed(2)))
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-card select-none">
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
            title={t('缩小')}
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
            title={t('放大')}
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
            onVisible={(p) => setCurrentPage(p)}
          />
        ))}
      </div>
    </div>
  )
})

export default PdfDocView
