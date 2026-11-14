/**
 * PDF 文件只读预览组件（PdfDocView）
 *
 * 核心设计：
 * 1. 采用 pdfjs-dist 高清矢量栅格化渲染，支持视网膜/高分屏（devicePixelRatio）清晰渲染；
 * 2. 连续滚动页面视图，配备顶部浮动工具条：页码指示器、翻页、放大、缩小、重置与自适应缩放；
 * 3. 严格只读（不支持编辑），无任何源码/编辑切换入口；
 * 4. 遵循全局直角规范（rounded-none）。
 *
 * 滚动性能架构（2026-11-14 性能批次定稿，每一条都对应一次真实卡顿）：
 * - **currentPage 单一写者**：页码只由 onScroll 经 PdfPageMetrics（基准高度前缀和
 *   表，见 learn/pdfOffsets）推导——旧做法 onScroll 估算页码与 IntersectionObserver
 *   精确页码两个写者打架，对不上号时 ±2 活跃窗口抖动，页面反复挂载/卸载（每次挂载
 *   都是一轮全分辨率重渲染）。观察器现在只负责**触发**渲染与文字提取，不写页码；
 * - **两级观察器分级预取**：1000px 观察器管画布渲染（便宜，提前两屏做）与矢量文本
 *   提取（pdf.js worker，也便宜）；300px 观察器才放行 **OCR**（昂贵：主进程一页吃
 *   几秒全核 CPU）——纯预取页永远不触发 OCR，快速滚动不再被 OCR 拖住；
 * - **窗口元素 memo**：滚动列表按 [winStart, winEnd] 记忆化，页码在窗口内变化时
 *   直接复用上一次的 element 数组，千页文档的列表 diff 成本趋近于零；
 * - **基準尺寸跨 zoom 复用**：页面量测上报 scale=1 基准尺寸（缩放只乘系数），
 *   占位与换算表口径一致，混合页面尺寸不再高度跳变。
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { OcrTextOverlay, extractOrOcrPageText, type OcrLineItem } from '../../../lib/ocr/pdfTextLayer'
import { PdfOcrBanner } from './PdfOcrBanner'
import { usePdfZoomHud } from './usePdfZoomHud'
import { capsOcrOn, subscribeCapabilities } from '../../../lib/capabilities'
import { bumpDocOcrEpoch, docOcrEpoch } from '../../../lib/capsCache'
import { PdfContextMenu, type PdfMenuState } from './PdfContextMenu'
import { OcrDebugOverlay } from './OcrDebugOverlay'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfjs } from '../../../learn/pdfRender'
import { PdfPageMetrics, type PdfPageSize } from '../../../learn/pdfOffsets'
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
  eagerRender?: boolean
  /** 扫描页且 OCR 插件未开：提示外层把「装 OCR 插件」的 Banner 再请出来 */
  onRequireOcr?: () => void
  /** 上报本页 scale=1 基准尺寸（换算表与占位共用的口径，跨 zoom 复用） */
  onDimensions?: (pageNum: number, base: PdfPageSize) => void
  /** 重挂时的已知基准尺寸（换算表里登记过的）：免得先按 800px 兜底再跳一次高度 */
  initialBase?: PdfPageSize
  /** 本文档的 OCR 缓存纪元：右键清缓存会 bump 它，本页据此撤下旧挂贴、清记账并当场重提取 */
  ocrEpoch: number
  /** 挂贴文字显隐（对齐调试态） */
  showOcrText: boolean
}

interface PlaceholderProps {
  pageNum: number
  width: number
  height: number
}

/**
 * 虚拟占位组件：当页面距离视口较远时仅挂载极简占位节点，释放 Canvas 上下文与显存。
 * 纯展示（无观察器）：换页由外层按换算表现算，不再自己盯着视口。
 */
const PdfPagePlaceholder = memo(function PdfPagePlaceholder({
  pageNum,
  width,
  height,
}: PlaceholderProps) {
  return (
    <div
      data-page-number={pageNum}
      className="relative my-4 flex shrink-0 items-center justify-center bg-paper/60 border border-line/30 rounded-none overflow-hidden select-none"
      style={{
        width: `${width}px`,
        height: `${height}px`,
        minHeight: `${height}px`,
        maxWidth: '100%',
      }}
    >
      <span className="text-[12px] font-mono text-ink-faint/50">
        - {pageNum} -
      </span>
    </div>
  )
})

/** 触发 OCR 的观察器余量（px）：页面真视口 300px 内才做识别，纯预取只渲染不识别 */
const OCR_NEAR_PX = 300
/** 渲染预取余量（px）：提前约一屏把画布画好 */
const RENDER_AHEAD_PX = 1000
/** 连续滚动模式的活跃窗口半宽：当前页 ±2 挂真页，其余全是轻占位 */
const VIRTUAL_OVERSCAN = 2

/**
 * 单页渲染子组件：两级 IntersectionObserver 分级预取（渲染便宜先做、OCR 昂贵近了才做），
 * 节约显存与计算的同时把昂贵路径挡在真视口之外。
 */
const PdfPageItem = memo(function PdfPageItem({
  pdfDoc,
  pageNum,
  zoom,
  docPath,
  eagerRender,
  onRequireOcr,
  onDimensions,
  initialBase,
  ocrEpoch,
  showOcrText,
}: PageItemProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [dimensions, setDimensions] = useState<PdfPageSize | null>(initialBase ?? null)
  const renderedRef = useRef(false)
  const loadingRef = useRef(false)
  const nextRenderRequestedRef = useRef(false)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const [textLines, setTextLines] = useState<OcrLineItem[]>([])
  const extractingRef = useRef(false)
  /** 提取记账：同一页同一档位（矢量/OCR × 插件开关）只试一次，别让重入观察区反复空跑 */
  const attemptedRef = useRef<Set<string>>(new Set())

  const loadText = useCallback(
    async (allowOcr: boolean) => {
      if (extractingRef.current || !pdfDoc) return
      // 记账键带上 OCR 接入状态与缓存纪元：接入方式、开关或「清缓存」都是新档位
      const attemptKey = `${allowOcr ? 'ocr' : 'vec'}:${capsOcrOn() ? 1 : 0}:${ocrEpoch}`
      if (attemptedRef.current.has(attemptKey)) return
      attemptedRef.current.add(attemptKey)
      extractingRef.current = true
      try {
        const res = await extractOrOcrPageText(pdfDoc, pageNum, docPath, canvasRef.current, allowOcr)
        if (res.lines.length > 0) {
          setTextLines(res.lines)
        }
        if (res.isScanned && !capsOcrOn()) {
          onRequireOcr?.()
        }
      } finally {
        extractingRef.current = false
      }
    },
    [pdfDoc, pageNum, docPath, onRequireOcr, ocrEpoch],
  )

  // 右键「清除本文档 OCR 缓存」（纪元 bump）之后：记账清空、旧挂贴撤下、当场重提取——
  // ocrKey 已经换键（缓存 miss），重提取会真按当前引擎重新识别一次
  useEffect(() => {
    if (!pdfDoc) return
    attemptedRef.current.clear()
    setTextLines([])
    if (renderedRef.current) void loadText(true)
  }, [ocrEpoch, loadText, pdfDoc])

  // 1. 量测 scale=1 基准尺寸：上报换算表与占位（跨 zoom 复用），本地按 zoom 折算显示尺寸
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum)
        if (!alive) return
        const vp = page.getViewport({ scale: 1 })
        const base = { width: Math.floor(vp.width), height: Math.floor(vp.height) }
        setDimensions(base)
        onDimensions?.(pageNum, base)
      } catch {}
    })()
    return () => {
      alive = false
    }
  }, [pdfDoc, pageNum, onDimensions])

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
      void loadText(false)
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
  }, [pdfDoc, pageNum, zoom, loadText])

  // 缩放变动时，重置渲染标记以重新生成适配新尺寸的高清画布（轻量防抖 50ms 聚合连滚）
  useEffect(() => {
    renderedRef.current = false
    const timer = setTimeout(() => {
      void renderPage()
    }, 50)
    return () => clearTimeout(timer)
  }, [zoom, renderPage])

  // 首页及前 3 页或翻页模式明确要求预热（eagerRender）时主动触发渲染，彻底避免切页闪屏
  useEffect(() => {
    if (eagerRender || pageNum <= 3) {
      void renderPage()
    }
  }, [eagerRender, pageNum, renderPage])

  // 监听全局插件状态切换事件（例如用户在设置中开启了 OCR 插件）
  useEffect(() => {
    const handlePluginChange = () => {
      if (textLines.length === 0 && renderedRef.current) {
        void loadText(true)
      }
    }
    window.addEventListener('moji:plugin-toggle', handlePluginChange)
    return () => window.removeEventListener('moji:plugin-toggle', handlePluginChange)
  }, [textLines.length, loadText])

  // 3. 渲染预取观察器（1000px）：滚动进入前把画布画好；矢量文本便宜，随渲染一起预取
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!renderedRef.current) {
              void renderPage()
            } else if (textLines.length === 0) {
              void loadText(false)
            }
          }
        }
      },
      { rootMargin: `${RENDER_AHEAD_PX}px 0px ${RENDER_AHEAD_PX}px 0px` },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [renderPage, textLines.length, loadText])

  // 4. OCR 放行观察器（300px）：页面真视口 300px 内才做识别——昂贵路径只对
  //    真正要看的页放行，快速滚动时预取窗口里的扫描页不会排队跑 OCR
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && renderedRef.current && textLines.length === 0) {
            void loadText(true)
          }
        }
      },
      { rootMargin: `${OCR_NEAR_PX}px 0px ${OCR_NEAR_PX}px 0px` },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [textLines.length, loadText])

  const displayW = dimensions ? Math.floor(dimensions.width * zoom) : undefined
  const displayH = dimensions ? Math.floor(dimensions.height * zoom) : undefined

  return (
    <div
      ref={containerRef}
      data-page-number={pageNum}
      className="relative my-4 flex shrink-0 justify-center bg-white shadow-md border border-line-strong/30 rounded-none overflow-hidden"
      style={{
        width: displayW ? `${displayW}px` : 'auto',
        height: displayH ? `${displayH}px` : 'auto',
        minHeight: displayH ? `${displayH}px` : '800px',
        maxWidth: '100%',
      }}
    >
      <canvas ref={canvasRef} className="block select-none bg-white w-full h-full" />
      {/* 文字层字号按显示高度折算（坐标是 0~1 百分比，zoom 无关） */}
      {/* debug 矩形层：直接按服务端 box 四值（x,y,w,h 归一化）画框——零中间变换，
          矩形贴原文 = 坐标正确，矩形歪 = 坐标/解析问题（与蓝字层的偏差互相对照） */}
      {showOcrText &&
        textLines.map((l, i) => (
          <div
            key={`ocr-rect-${i}`}
            className="pointer-events-none absolute z-[9] border border-amber-400/90 bg-amber-300/10"
            style={{
              left: `${(l.bbox.x * 100).toFixed(3)}%`,
              top: `${(l.bbox.y * 100).toFixed(3)}%`,
              width: `${(l.bbox.width * 100).toFixed(3)}%`,
              height: `${(l.bbox.height * 100).toFixed(3)}%`,
            }}
          />
        ))}
      {/* 隐形文字层（框选/复制；debug 态显示挂贴文字与画布原文对照） */}
      <OcrTextOverlay
        lines={textLines}
        pageHeight={Math.round((dimensions?.height ?? 842) * zoom)}
        pageWidth={Math.round((dimensions?.width ?? 595) * zoom)}
        debugVisible={showOcrText}
      />
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
  const [isEditingPage, setIsEditingPage] = useState(false)
  const [pageInput, setPageInput] = useState('')
  /** 尺寸登记版本号：新页面量测上报时 +1，让占位与换算表拿到精确高度 */
  const [dimsVersion, setDimsVersion] = useState(0)

  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 页高换算表（ref 持有，方法本身不触发渲染；变化经 dimsVersion 广播） */
  const pageMetrics = useRef(new PdfPageMetrics())
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
            rel = normPath.slice(prefix.length).replace(/^[/]+/, '')
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

        // 预载第 1 页的基准尺寸，作为换算表与占位的回退尺寸
        try {
          const p1 = await doc.getPage(1)
          const vp = p1.getViewport({ scale: 1 })
          pageMetrics.current.setFallback({ width: Math.floor(vp.width), height: Math.floor(vp.height) })
        } catch {}
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

  /** 尺寸上报：登记进换算表；新页/尺寸变化才 bump 版本（占位与列表按需重算） */
  const handleDimensions = useCallback((pNum: number, base: PdfPageSize) => {
    if (pageMetrics.current.setBase(pNum, base)) {
      setDimsVersion((v) => v + 1)
    }
  }, [])

  const handleRequireOcr = useCallback(() => {
    setOcrBannerDismissed(false)
  }, [])

  const scrollToPage = useCallback((pageNum: number) => {
    const p = Math.max(1, Math.min(numPages, pageNum))
    setCurrentPage(p)
    const el = scrollRef.current?.querySelector(`[data-page-number="${p}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [numPages])

  // 连续滚动模式：**currentPage 的唯一写者**——滚动位置经换算表精确推导页码
  // （观察器只触发渲染与文字提取，不再参与页码写入，窗口不再抖动）
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || numPages === 0) return
    const container = scrollRef.current
    const { scrollTop, clientHeight, scrollHeight } = container

    if (scrollTop + clientHeight >= scrollHeight - 30) {
      setCurrentPage(numPages)
      return
    }

    const page = pageMetrics.current.pageAt(scrollTop + clientHeight * 0.3, zoom, numPages)
    setCurrentPage(Math.max(1, Math.min(numPages, page)))
  }, [numPages, zoom])

  const [ocrBannerDismissed, setOcrBannerDismissed] = useState(false)
  const [ocrEnabled, setOcrEnabled] = useState(() => capsOcrOn())
  /** 本文档的 OCR 缓存纪元：右键清缓存 bump 后传给每一页（撤挂贴、清记账、重提取） */
  const [ocrEpoch, setOcrEpoch] = useState(() => docOcrEpoch(path))
  const [contextMenu, setContextMenu] = useState<PdfMenuState | null>(null)
  /** 挂贴文字显隐（右键切换的对齐调试态）：开起来直接看挂贴与画布原文是否对齐 */
  const [showOcrText, setShowOcrText] = useState(false)
  /** 右键「查看本页 OCR 识别详情」打开的诊断浮层（页码在打开时定格） */
  const [inspectPage, setInspectPage] = useState<number | null>(null)
  const handleClearOcrCache = useCallback(() => {
    bumpDocOcrEpoch(path)
    setOcrEpoch(docOcrEpoch(path))
  }, [path])
  useEffect(() => {
    // OCR 接入状态随「设置 → 模型 → 能力接入」变化：订阅 AI 设置（能力的落点在 ai 片）
    return subscribeCapabilities(() => setOcrEnabled(capsOcrOn()))
  }, [])

  const { visible: zoomHud, trigger: triggerZoomHud } = usePdfZoomHud()

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.max(0.4, Math.min(3.0, Number((prev + delta).toFixed(2)))))
    triggerZoomHud()
  }

  // Ctrl + 鼠标滚轮 / 触控板手势缩放控制（前置 capture 捕获，精准定位当前 PDF 区域）
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return

      const root = rootRef.current
      if (!root) return
      const target = e.target as Node | null
      const inRoot = (target && root.contains(target)) || (e.composedPath && e.composedPath().includes(root))
      if (!inRoot) return

      e.preventDefault()
      e.stopPropagation()

      const delta = -e.deltaY
      if (Math.abs(delta) < 0.5) return

      const unit = e.deltaMode === 1 ? 3 : 100
      const notches = Math.max(-3, Math.min(3, delta / unit))
      const step = Math.abs(notches) >= 0.4 ? (notches > 0 ? 0.1 : -0.1) : Number((notches * 0.1).toFixed(2))
      if (!step) return

      setZoom((prev) => Math.max(0.4, Math.min(3.0, Number((prev + step).toFixed(2)))))
      triggerZoomHud()
    }

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

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsEditingPage(false)
    const val = parseInt(pageInput.trim(), 10)
    if (!isNaN(val)) {
      scrollToPage(val)
    }
  }

  // 连续滚动模式的页签列表：按活跃窗口 [winStart, winEnd] 记忆化——页码在窗口内
  // 变化时直接复用上一次的 element 数组，React 逐项同一引用即跳过，千页文档的
  // 列表 diff 成本趋近于零（占位尺寸从换算表现取，量过的页永远精确）。
  // 注意在 early return **之前**算好：hook 顺序不允许依赖 loading 分支。
  const winStart = Math.max(1, currentPage - VIRTUAL_OVERSCAN)
  const winEnd = Math.min(numPages, currentPage + VIRTUAL_OVERSCAN)
  const scrollPages = useMemo(
    () =>
      pdfDoc
        ? Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
            if (pageNum >= winStart && pageNum <= winEnd) {
              return (
                <PdfPageItem
                  key={`${path}#p${pageNum}`}
                  pdfDoc={pdfDoc}
                  pageNum={pageNum}
                  zoom={zoom}
                  docPath={path}
                  initialBase={pageMetrics.current.sizeOf(pageNum)}
                  onRequireOcr={handleRequireOcr}
                  onDimensions={handleDimensions}
                  ocrEpoch={ocrEpoch}
                  showOcrText={showOcrText}
                />
              )
            }
            const base = pageMetrics.current.sizeOf(pageNum)
            return (
              <PdfPagePlaceholder
                key={`${path}#p${pageNum}#ph`}
                pageNum={pageNum}
                width={Math.floor(base.width * zoom)}
                height={Math.floor(base.height * zoom)}
              />
            )
          })
        : [],
    [numPages, winStart, winEnd, zoom, path, pdfDoc, dimsVersion, handleDimensions, handleRequireOcr, ocrEpoch, showOcrText],
  )

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

        {/* 翻页、模式切换与缩放控制器 */}
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

          {/* 页码指示器（点击可就地输入页码快速跳转） */}
          {isEditingPage ? (
            <form onSubmit={handlePageInputSubmit} className="inline-flex items-center">
              <input
                autoFocus
                type="number"
                min={1}
                max={numPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => setIsEditingPage(false)}
                className="w-12 h-6 px-1 text-center text-xs font-mono border border-seal bg-card text-ink outline-none rounded-none tabular-nums"
              />
              <span className="text-[11px] text-ink-faint ml-1">/ {numPages}</span>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setPageInput(String(currentPage))
                setIsEditingPage(true)
              }}
              title={t('点击输入页码快速跳转')}
              className="px-1.5 py-0.5 text-[11.5px] tabular-nums text-ink hover:bg-card/70 hover:text-seal transition rounded-none"
            >
              {t('{0} / {1}', currentPage, numPages)}
            </button>
          )}

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

      <PdfOcrBanner
        enabled={ocrEnabled}
        dismissed={ocrBannerDismissed}
        onDismiss={() => setOcrBannerDismissed(true)}
      />

      {/* 视图展现：高性能虚拟滚动（翻页模式已退役，2026-11-15） */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
          onContextMenu={(e) => {
            e.preventDefault()
            const pageEl = (e.target as HTMLElement).closest('[data-page-number]')
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              pageNum: pageEl ? Number(pageEl.getAttribute('data-page-number')) : currentPage,
            })
          }}
          className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overflow-x-auto p-4 bg-paper/50"
        >
          {scrollPages}
        </div>

      <PdfContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onClearOcrCache={handleClearOcrCache}
        onInspectOcr={(pageNum) => setInspectPage(pageNum)}
        showOcrText={showOcrText}
        onToggleOcrText={() => setShowOcrText((v) => !v)}
      />

      {inspectPage !== null && pdfDoc && (
        <OcrDebugOverlay
          pdfDoc={pdfDoc}
          pageNum={inspectPage}
          docPath={path}
          scrollRef={scrollRef}
          onClose={() => setInspectPage(null)}
        />
      )}

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
