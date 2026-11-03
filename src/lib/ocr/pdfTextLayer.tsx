/**
 * PDF 页面文字图层与 OCR 隐形挂贴组件。
 *
 * 核心原理：
 * 1. 优先提取 PDF 自身矢量文本坐标；对于扫描件或图片型 PDF，自动触发 OCR 识别引擎；
 * 2. 坐标均归一化为 0~1 的相对百分比，并在原文字相同位置以全透明 span 挂贴；
 * 3. 支持原生般的鼠标拖拽框选、双击选词、右键复制与 Ctrl+C 拷贝。
 */

import { memo } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { loadPdfjs } from '../../learn/pdfRender'
import { native, type OcrLineItem, type OcrPageResult } from '../native'
import { ocrPluginOn } from './plugin'
import { buildOcrCacheKey, getCachedOcrResult, setCachedOcrResult } from './cache'

export interface PageTextExtractionResult {
  lines: OcrLineItem[]
  isScanned: boolean
  fromCache: boolean
}

/**
 * 抽取或识别指定 PDF 页面的文本排版结构
 */
export async function extractOrOcrPageText(
  pdfDoc: PDFDocumentProxy,
  pageNum: number,
  docPath: string,
  canvas: HTMLCanvasElement | null,
): Promise<PageTextExtractionResult> {
  const cacheKey = buildOcrCacheKey(docPath, pageNum)

  // 1. 检查已持久化的缓存
  const cached = await getCachedOcrResult(cacheKey)
  if (cached && cached.lines.length > 0) {
    return {
      lines: cached.lines,
      isScanned: false,
      fromCache: true,
    }
  }

  const pdfjs = await loadPdfjs()
  const page: PDFPageProxy = await pdfDoc.getPage(pageNum)
  const baseVp = page.getViewport({ scale: 1.0 })

  // 2. 尝试提取 PDF 矢量文本
  try {
    const textContent = await page.getTextContent()
    if (textContent.items && textContent.items.length > 0) {
      const lines: OcrLineItem[] = []

      for (const rawItem of textContent.items) {
        const item = rawItem as { str?: string; transform?: number[]; width?: number; height?: number }
        if (!item.str || !item.transform) continue

        // 将 PDF 局部矩阵与视口矩阵结合，得出视口像素坐标
        const tx = pdfjs.Util.transform(baseVp.transform, item.transform)
        const fontH = Math.max(8, Math.hypot(tx[2], tx[3]))
        const w = Math.max(4, (item.width || 0) * baseVp.scale)
        const x = tx[4]
        const y = tx[5] - fontH // PDF 基线转视口顶端

        const normX = Math.max(0, Math.min(1, x / baseVp.width))
        const normY = Math.max(0, Math.min(1, y / baseVp.height))
        const normW = Math.max(0.005, Math.min(1 - normX, w / baseVp.width))
        const normH = Math.max(0.005, Math.min(1 - normY, fontH / baseVp.height))

        lines.push({
          text: cleanOcrText(item.str),
          bbox: { x: normX, y: normY, width: normW, height: normH },
        })
      }

      if (lines.length > 0) {
        const pageResult: OcrPageResult = {
          page: pageNum,
          lines,
          fullText: lines.map((l) => l.text).join(' '),
          modelId: 'native-pdf-vector',
          createdAt: Date.now(),
        }
        await setCachedOcrResult(cacheKey, pageResult)
        return { lines, isScanned: false, fromCache: false }
      }
    }
  } catch (err) {
    console.warn(`[pdf-text] 提取第 ${pageNum} 页原生文本异常:`, err)
  }

  // 3. 矢量文本为空：判定为扫描件或纯图片 PDF，按需调用 OCR
  if (canvas && ocrPluginOn()) {
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      const res = await native().ocr.recognize({
        imageDataUrl: dataUrl,
        page: pageNum,
      })

      if (res.ok && res.result && res.result.lines.length > 0) {
        await setCachedOcrResult(cacheKey, res.result)
        return {
          lines: res.result.lines,
          isScanned: true,
          fromCache: res.fromCache ?? false,
        }
      }
    } catch (err) {
      console.warn(`[ocr] 识别第 ${pageNum} 页失败:`, err)
    }
  }

  return {
    lines: [],
    isScanned: true,
    fromCache: false,
  }
}

export function cleanOcrText(str: string): string {
  if (!str) return ''
  let prev = ''
  let cur = str
  while (prev !== cur) {
    prev = cur
    cur = cur
      .replace(/([\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e])\s+([\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e])/g, '$1$2')
      .replace(/([\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e])\s+([0-9a-zA-Z])/g, '$1$2')
      .replace(/([0-9a-zA-Z])\s+([\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e])/g, '$1$2')
  }
  return cur.trim()
}

interface TextOverlayProps {
  lines: OcrLineItem[]
  pageHeight: number
}

/**
 * 隐形全透明文字层：挂贴在 Canvas 画布上层，专供框选与复制。
 * 针对中英文混排、逐词微坐标和排版贴合进行了高精度对齐优化。
 */
export const OcrTextOverlay = memo(function OcrTextOverlay({ lines, pageHeight }: TextOverlayProps) {
  if (!lines || lines.length === 0) return null

  const isCjk = (s: string) => /[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff5e]/.test(s)

  return (
    <div
      className="ocr-text-layer absolute inset-0 pointer-events-auto select-text overflow-hidden z-10"
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      <style>{`
        .ocr-text-layer,
        .ocr-text-layer * {
          -webkit-text-fill-color: transparent !important;
          color: transparent !important;
        }
        .ocr-text-layer ::selection,
        .ocr-text-layer *::selection,
        .ocr-text-layer span::selection {
          background: rgba(56, 139, 253, 0.35) !important;
          color: transparent !important;
          -webkit-text-fill-color: transparent !important;
          text-shadow: none !important;
        }
      `}</style>
      {lines.map((line, lineIdx) => {
        // 优先使用逐词高精度坐标（Windows OCR / PaddleOCR 词级别包围盒），实现原文字位置 1:1 精确贴合
        if (line.words && line.words.length > 0) {
          return (
            <div key={lineIdx} className="contents select-text">
              {line.words.map((w, wIdx) => {
                const next = line.words![wIdx + 1]
                const trailingSpace = next && !isCjk(w.text) && !isCjk(next.text) ? ' ' : ''
                const fSize = Math.max(9, Math.round(w.bbox.height * pageHeight))
                return (
                  <span
                    key={`${lineIdx}-${wIdx}`}
                    className="absolute cursor-text whitespace-nowrap select-text text-transparent flex items-center justify-center pointer-events-auto"
                    style={{
                      left: `${(w.bbox.x * 100).toFixed(3)}%`,
                      top: `${(w.bbox.y * 100).toFixed(3)}%`,
                      width: `${(w.bbox.width * 100).toFixed(3)}%`,
                      height: `${(w.bbox.height * 100).toFixed(3)}%`,
                      fontSize: `${fSize}px`,
                      lineHeight: 1,
                      color: 'transparent',
                      WebkitTextFillColor: 'transparent',
                      textShadow: 'none',
                    }}
                    title={w.text}
                  >
                    {w.text}{trailingSpace}
                  </span>
                )
              })}
            </div>
          )
        }

        const text = cleanOcrText(line.text)
        const fSize = Math.max(10, Math.round(line.bbox.height * pageHeight))
        return (
          <span
            key={lineIdx}
            className="absolute cursor-text whitespace-nowrap select-text text-transparent flex items-center pointer-events-auto"
            style={{
              left: `${(line.bbox.x * 100).toFixed(3)}%`,
              top: `${(line.bbox.y * 100).toFixed(3)}%`,
              width: `${(line.bbox.width * 100).toFixed(3)}%`,
              height: `${(line.bbox.height * 100).toFixed(3)}%`,
              fontSize: `${fSize}px`,
              lineHeight: 1,
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
              textShadow: 'none',
            }}
            title={text}
          >
            {text}
          </span>
        )
      })}
    </div>
  )
})
