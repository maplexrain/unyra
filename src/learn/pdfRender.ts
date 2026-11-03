/**
 * 这个文件负责什么：**PDF 页面栅格化**——把一份 PDF 的指定页渲染成 PNG 字节，
 * 给 api.see 的 pdf 分支用（渲染完仍走图像通道，内容层契约不动）。
 *
 * 两个实现决定：
 * 1. **pdf.js 懒加载**：主包不背这 ~1.5MB——see 的 pdf 分支第一次被调用才动态 import
 *    （pdf.js 本体与 worker 源码各成一个懒加载分块）。worker 源码经 `?raw` 内联，
 *    用时再建 blob URL（与沙箱 worker 同一条已验证的路：生产是 file:// 加载，
 *    直接 `new Worker(file://…)` 会被 Chromium 拒，blob: 在 CSP 的 worker-src 里明确放行）。
 * 2. **不配 cMap / standard fonts 资源**：那要给几百个 cmap 文件在 file:// 下开 fetch 通道
 *    （worker 里 fetch file:// 一律被拦），v1 先不做——字体未内嵌的少数 CJK PDF 可能缺字，
 *    这条限制写进了 api 文档；绝大多数论文与讲义（内嵌字体或扫描件）不受影响。
 */

/** 渲染目标长边：与图片归一化的上限一致（learn/images 的 MAX_EDGE），渲染时一步到位 */
const TARGET_EDGE = 1568

let loading: Promise<typeof import('pdfjs-dist')> | null = null

export function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  loading ??= (async () => {
    const [{ default: workerSource }, mod] = await Promise.all([
      import('pdfjs-dist/build/pdf.worker.min.mjs?raw'),
      import('pdfjs-dist'),
    ])
    // worker 源码自包含（无 import 语句），blob 模块 worker 可直接跑；
    // pdf.js 自己处理失败回退（fake worker 主线程渲染），这里只把最顺的路铺好
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    mod.GlobalWorkerOptions.workerSrc = url
    return mod
  })()
  return loading
}

export interface PdfPageImage {
  /** 页码（1 起） */
  page: number
  /** 渲染出的 PNG 字节 */
  bytes: Uint8Array
}

export type PdfRenderResult =
  | { ok: true; pages: PdfPageImage[]; total: number }
  | { ok: false; error: string }

/**
 * 把一份 PDF 的指定页各渲染成一张 PNG。
 * data 会被 pdf.js transfer 走（buffer detach），所以这里先复制一份，调用方的字节不动。
 */
export async function renderPdfPages(
  data: Uint8Array,
  pages: number[],
): Promise<PdfRenderResult> {
  try {
    const pdfjs = await loadPdfjs()
    // v6 里 destroy 挂在 loadingTask 上（关掉 worker）；doc 上只有 cleanup
    const task = pdfjs.getDocument({ data: data.slice() })
    const doc = await task.promise
    try {
      const out: PdfPageImage[] = []
      for (const n of pages) {
        if (n < 1 || n > doc.numPages) {
          return { ok: false, error: `第 ${n} 页不存在：这份 PDF 共 ${doc.numPages} 页。` }
        }
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        // 长边对齐 1568（图片归一化同款上限）；小页最多放大 2 倍（矢量渲染，锐一点没坏处）
        const scale = Math.min(2, Math.max(1, TARGET_EDGE / Math.max(base.width, base.height)))
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.ceil(viewport.width))
        canvas.height = Math.max(1, Math.ceil(viewport.height))
        const ctx = canvas.getContext('2d')
        if (!ctx) return { ok: false, error: '当前环境无法渲染 PDF 页面（拿不到 2D 画布）' }
        // pdf.js 对空白区域渲染成透明，PNG 带 alpha 在部分消费方显示为黑底——先铺白
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, viewport }).promise
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        canvas.width = 0
        canvas.height = 0
        if (!blob) return { ok: false, error: `第 ${n} 页渲染失败（画布导不出图片）` }
        out.push({ page: n, bytes: new Uint8Array(await blob.arrayBuffer()) })
      }
      return { ok: true, pages: out, total: doc.numPages }
    } finally {
      doc.cleanup().catch(() => {})
      void task.destroy().catch(() => {})
    }
  } catch (err) {
    return {
      ok: false,
      error: 'PDF 解析失败：' + (err instanceof Error ? err.message : String(err)) +
        '（可能是损坏的文件、加密文档，或这份文件其实不是 PDF）',
    }
  }
}
