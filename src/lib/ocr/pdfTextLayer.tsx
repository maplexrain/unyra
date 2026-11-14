/**
 * PDF 页面文字图层与 OCR 隐形挂贴组件（自研实现，2026-11-14 定稿）。
 *
 * 核心原理：
 * 1. 优先提取 PDF 自身矢量文本坐标；扫描件且「能力接入」配了 OCR 时，调用识别并把
 *    行级 bbox 挂贴为全透明 span（字号按**矩形容器宽度自适应**——见 fitFontSize）；
 * 2. DeepSeek 版面识别返回 grounding 标记（实测格式：ref=类别、正文在 box 后带 ＞
 *    前缀；官方文档形态 ref=文字本身，双形态兼容）；
 * 3. 支持原生般的鼠标拖拽框选、双击选词、右键复制与 Ctrl+C 拷贝。
 *
 * 滚动性能纪律：画布→JPEG 用 toBlob+FileReader；OCR 全局串行队列；结果一律落盘缓存
 * （识别按量计费，同一页绝不识别第二次）；OCR 只对接近视口的页放行。
 */

import { memo } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { loadPdfjs } from '../../learn/pdfRender'
import { native, type OcrLineItem, type OcrPageResult } from '../native'
import { capsCacheGet, capsCacheSet, capsHashKey, docOcrEpoch } from '../capsCache'
import { ocrEngineOf } from '../capabilities'

export type { OcrLineItem }

export interface PageTextExtractionResult {
  lines: OcrLineItem[]
  isScanned: boolean
  fromCache: boolean
  /** OCR 服务的原样返回（含 grounding 标记）：诊断挂贴用；矢量路径没有 */
  rawOcrText?: string
}

/* ---------- OCR 全局串行队列 ---------- */

let ocrChain: Promise<unknown> = Promise.resolve()
function runOcrSerially<T>(job: () => Promise<T>): Promise<T> {
  const next = ocrChain.then(job, job)
  ocrChain = next.catch(() => {})
  return next
}

/** 画布 → JPEG dataURL：编码在线程池（toBlob），失败返回 null（调用方跳过本页） */
async function canvasToJpegDataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  try {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) return null
    return await new Promise<string>((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve((fr.result as string) || '')
      fr.onerror = () => resolve('')
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/* ---------- 文本清洗 ---------- */

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

/* ---------- DeepSeek OCR 的 grounding 标记解析 ---------- */

/**
 * **真实输出格式**（2026-11-14 用户实测返回为准，官方文档示例有歧义）：
 *
 *   `<|ref|>类别<|/ref|><|box|>[[x1,y1,x2,y2]]<|/box|>＞ 该区域的文字`
 *
 * - ref 对里是**类别名**（header / title / text / image / footer / page_number…）；
 * - **正文在 box 对之后**，每块以 `＞`（全角 U+FF1E，兼容半角 >）开头；
 * - box 坐标按页面宽高归一化到 0–1000、左上原点；标记用全角竖线 ｜（兼容半角 |）；
 * - image 等纯图形类别跳过；正文为空的块自然也挂不上；
 * - 快速识别档输出纯文本无标记——**不挂贴**（位置必歪的估算挂贴比没有更糟）。
 */
const GROUNDING_BLOCK_RE = /<\|ref\|>([^<]*)<\|\/ref\|>\s*<\|box\|>([^<]*)<\|\/box\|>/g
/** 纯图形类别：区域里没有可复制的文字，挂贴无意义 */
const NON_TEXT_REF_RE = /^(image|figure|picture|photo|chart|logo|seal|stamp)\s*$/i
/** 每块正文的行首前缀：全角 ＞ 或半角 >（后跟可选空格） */
const BODY_PREFIX_RE = /^\s*[＞>]\s?/

/** 字符宽度权重（块内断行与字号公式共用）：CJK/全角记 1，其余记 0.55 */
function charWeight(text: string): number {
  let w = 0
  for (const ch of text) {
    w += /[\u2E80-\u9FFF\u3000-\u303F\uFF00-\uFF60\u2010-\u2027\u2FF0-\u2FFB]/.test(ch) ? 1 : 0.55
  }
  return w
}

function rowsIntoBbox(rows: string[], x1: number, y1: number, x2: number, y2: number, out: OcrLineItem[]): void {
  if (rows.length === 0) return
  const h = (y2 - y1) / rows.length
  for (let i = 0; i < rows.length; i++) {
    out.push({
      text: cleanOcrText(rows[i]),
      bbox: { x: x1, y: y1 + i * h, width: x2 - x1, height: h },
    })
  }
}

/**
 * 块内重断行：服务端把画布的**多行**合成一行长句时（块 ratio > 2.6），挂贴若保持
 * 一行就会横向溢出页面。按面积法估字号 → 反推出画布实际行数 k → 按字符权重贪心
 * 分成 k 段（断点优先取空格/行界，中文无空格则硬断）——行位置与画布换行对齐。
 */
function reflowBlockRows(rows: string[], boxW: number, boxH: number): string[] {
  const total = rows.reduce((sum, r) => sum + charWeight(r), 0)
  if (total <= 0 || rows.length === 0) return rows
  const blockRatio = boxH / (boxW / total)
  if (blockRatio <= 2.6) return rows
  const f = Math.sqrt((boxW * boxH) / (1.9 * total))
  const k = Math.max(1, Math.round(boxH / (1.9 * f)))
  if (k <= rows.length) return rows
  const quota = total / k
  const flat = rows.join('\n')
  const out: string[] = []
  let segStart = 0
  let acc = 0
  let seg = 1
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i]
    acc += ch === '\n' ? 0 : charWeight(ch)
    if (seg < k && acc >= quota) {
      // 断点回退到最近的空格/行界（别把英文单词劈开）；找不到就在当前位置硬断
      let cut = i
      for (let j = i; j > segStart && i - j < 12; j--) {
        const c = flat[j]
        if (c === ' ' || c === '\n') {
          cut = j
          break
        }
      }
      out.push(flat.slice(segStart, cut).replace(/\n/g, ' ').trim())
      while (cut < flat.length && (flat[cut] === ' ' || flat[cut] === '\n')) cut++
      segStart = cut
      i = segStart - 1
      acc = 0
      seg++
    }
  }
  out.push(flat.slice(segStart).replace(/\n/g, ' ').trim())
  return out.filter(Boolean)
}

export function parseGroundingLines(raw: string): OcrLineItem[] | null {
  const text = raw.replace(/｜/g, '|')
  if (!text.includes('<|ref|>') || !text.includes('<|box|>')) return null
  const blocks = [...text.matchAll(GROUNDING_BLOCK_RE)]
  if (blocks.length === 0) return null

  const out: OcrLineItem[] = []
  for (let i = 0; i < blocks.length; i++) {
    const m = blocks[i]
    const category = m[1].trim()
    if (NON_TEXT_REF_RE.test(category)) continue
    const nums = (m[2].match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
    if (nums.length < 4) continue
    const x1 = Math.max(0, Math.min(1, nums[0] / 1000))
    const y1 = Math.max(0, Math.min(1, nums[1] / 1000))
    const x2 = Math.max(0, Math.min(1, nums[2] / 1000))
    const y2 = Math.max(0, Math.min(1, nums[3] / 1000))
    if (x2 - x1 < 0.004 || y2 - y1 < 0.004) continue
    // 正文在 box 对之后，直到下一个 ref 对开始（或文末）；剥掉行首 ＞ 前缀
    const bodyStart = (m.index ?? 0) + m[0].length
    const bodyEnd = i + 1 < blocks.length ? (blocks[i + 1].index ?? text.length) : text.length
    const rawRows = text
      .slice(bodyStart, bodyEnd)
      .split(/\r?\n/)
      .map((l) => l.replace(BODY_PREFIX_RE, '').trim())
      .filter(Boolean)
    let rows: string[]
    if (rawRows.length > 0) {
      // 实测形态：正文在 box 对之后。多行合并块重断行（判据在 reflowBlockRows 内）
      rows = reflowBlockRows(rawRows, x2 - x1, y2 - y1)
    } else if (!/^[a-z_-]+$/i.test(category)) {
      // 官方文档形态的兼容：ref 内是**被引用的文字本身**（示例 `<|ref|>标题<|/ref|>`），
      // box 后没有正文——此时把 ref 内容当正文。仅当它不像英文类别词时回落
      rows = [category]
    } else {
      continue
    }
    rowsIntoBbox(rows, x1, y1, x2, y2, out)
  }
  return out.length > 0 ? out : null
}

/* ---------- 画布行带检测：换行边界不问模型，问像素 ---------- */

/**
 * 水平投影找行带：darkY[y] = 盒区域内第 y 行的暗像素计数。连续高于阈值的行是一行
 * 文字，行间空隙是暗像素低谷——这就是画布真实的换行位置（像素级，比模型输出的
 * 行粒度细且准）。
 *
 * 纯函数，输入暗像素计数（由 refineLinesByImage 从 canvas 取像素算出），可单测。
 */
export function detectRowBands(darkY: number[]): Array<{ start: number; end: number }> {
  const max = darkY.reduce((m, v) => Math.max(m, v), 0)
  if (max <= 0) return []
  // 阈值：峰值的一成——文字行必然有笔画，行间空隙接近 0；容忍扫描噪声
  const thr = Math.max(1, max * 0.12)
  const bands: Array<{ start: number; end: number }> = []
  let start = -1
  for (let y = 0; y < darkY.length; y++) {
    if (darkY[y] > thr) {
      if (start < 0) start = y
    } else if (start >= 0) {
      bands.push({ start, end: y })
      start = -1
    }
  }
  if (start >= 0) bands.push({ start, end: darkY.length })
  // 合并间隔 ≤ 2px 的相邻段（同一行内的字符上下错落会切成两段）
  const merged: Array<{ start: number; end: number }> = []
  for (const b of bands) {
    const last = merged[merged.length - 1]
    if (last && b.start - last.end <= 2) last.end = b.end
    else merged.push({ ...b })
  }
  // 丢弃高度不足的噪声段（对齐线/污点），其余即文字行
  return merged.filter((b) => b.end - b.start >= 3)
}

/**
 * 把一行文字按行带容量切成 k 段：每段的字符权重配额 ∝ 行带高度。
 * 与 reflowBlockRows 同思路，但配额来自**像素实测的行带**（画布真实的换行），
 * 且断点优先回退空格。返回 k 段（不足的段给空串，由调用方对齐）。
 */
export function splitTextByBands(text: string, bandHeights: number[]): string[] {
  const total = charWeight(text)
  const sum = bandHeights.reduce((a, b) => a + b, 0)
  if (total <= 0 || sum <= 0 || bandHeights.length <= 1) return [text]
  const k = bandHeights.length
  const flat = text
  const out: string[] = []
  let segStart = 0
  let acc = 0
  let seg = 1
  for (let i = 0; i < flat.length; i++) {
    acc += charWeight(flat[i])
    const quota = (total * bandHeights.slice(0, seg).reduce((a, b) => a + b, 0)) / sum
    if (seg < k && acc >= quota) {
      // 当前字符计入本段；断点回退到最近的空格（英文别劈词），中文硬断
      let cut = Math.min(flat.length, i + 1)
      for (let j = cut; j > segStart && cut - j < 12; j--) {
        if (flat[j - 1] === ' ') {
          cut = j - 1
          break
        }
      }
      out.push(flat.slice(segStart, cut).trim())
      while (cut < flat.length && flat[cut] === ' ') cut++
      segStart = cut
      i = segStart - 1
      acc = 0
      seg++
    }
  }
  out.push(flat.slice(segStart).trim())
  return out
}

/**
 * 用画布像素精化 OCR 行：对每个行级 bbox 做**水平投影**，检测盒内的真实行带。
 * 服务端把画布多行合成一行时（一行 bbox 里检测出 ≥2 个行带），把文字按行带重新
 * 拆分——每行的 y/高度直接取行带边界（像素级对齐画布），不再是估算。
 */
export function refineLinesByImage(canvas: HTMLCanvasElement, lines: OcrLineItem[]): OcrLineItem[] {
  const ctx = canvas.getContext('2d')
  const cw = canvas.width
  const ch = canvas.height
  if (!ctx || cw === 0 || ch === 0) return lines

  const out: OcrLineItem[] = []
  for (const line of lines) {
    const bands = detectRowBandsInBox(ctx, cw, ch, line.bbox)
    if (bands.length <= 1) {
      out.push(line)
      continue
    }
    // 多行合并块：文字按行带容量切分，行 y/高度直接取行带边界
    const bandHs = bands.map((b) => b.y2 - b.y1)
    const parts = splitTextByBands(cleanOcrText(line.text), bandHs)
    for (let i = 0; i < bands.length; i++) {
      const text = parts[i]?.trim()
      if (!text) continue
      out.push({
        text,
        bbox: { x: line.bbox.x, y: bands[i].y1, width: line.bbox.width, height: bands[i].y2 - bands[i].y1 },
      })
    }
  }
  return out
}

/** 对单个 bbox 区域取像素、算暗像素行计数、找行带（返回归一化 y 区间） */
function detectRowBandsInBox(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  bbox: { x: number; y: number; width: number; height: number },
): Array<{ y1: number; y2: number }> {
  const x0 = Math.max(0, Math.floor(bbox.x * cw))
  const y0 = Math.max(0, Math.floor(bbox.y * ch))
  const w = Math.max(1, Math.min(cw - x0, Math.ceil(bbox.width * cw)))
  const h = Math.max(1, Math.min(ch - y0, Math.ceil(bbox.height * ch)))
  if (w <= 0 || h <= 0 || h < 6) return []

  let img: ImageData
  try {
    img = ctx.getImageData(x0, y0, w, h)
  } catch {
    return []
  }
  const data = img.data
  // 逐行统计暗像素（白底黑字；彩色标题亮度也低于阈值，浅色水印不算）
  const darkY: number[] = new Array(h).fill(0)
  for (let py = 0; py < h; py++) {
    let count = 0
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (lum < 150) count++
    }
    darkY[py] = count
  }
  const bands = detectRowBands(darkY)
  return bands.map((b) => ({ y1: (y0 + b.start) / ch, y2: (y0 + b.end) / ch }))
}

/* ---------- 挂贴字号：矩形容器宽度自适应 ---------- */

/**
 * 挂贴字号：按「盒高 ÷ 宽度约束字号（ratio）」分两支。
 *
 * - **ratio ≤ 2.6**（det 盒框住文字本身的常态：盒高 = 字号 × 1.1~2 的行距）：
 *   字号 = min(盒宽 ÷ 权重, 盒高)。宽度约束保证单行 nowrap 的透明文本不溢出盒子
 *   （溢出会被容器裁掉 → 复制缺字，真案：标题复制只出前半句）；
 * - **ratio > 2.6**（盒高远超单行行盒——服务端把画布的多行合成了一行长句，det 盒
 *   覆盖 k 行）：宽度约束会把字号压到一半以下。改按**面积 + 典型行距**反推：
 *   f = sqrt(盒宽 × 盒高 ÷ (1.9 × 权重))。
 *
 * 字符权重按全角近似：CJK/全角标点记 1，其余（ASCII 等）记 0.55。
 */
export function fitFontSize(text: string, boxWidthPx: number, boxHeightPx: number): number {
  const weight = charWeight(text)
  if (weight <= 0) return Math.max(8, boxHeightPx)
  const byWidth = boxWidthPx / weight
  const ratio = boxHeightPx / byWidth
  if (ratio <= 2.6) {
    return Math.max(8, Math.min(boxHeightPx, byWidth))
  }
  return Math.max(8, Math.sqrt((boxWidthPx * boxHeightPx) / (1.9 * weight)))
}

/* ---------- 主入口：一页的文字层（行级 bbox，透明 span 挂贴） ---------- */

/**
 * 抽取或识别指定 PDF 页面的文本排版结构。
 *
 * @param allowOcr 矢量提取失败（扫描件）时是否真的调用 OCR——昂贵路径只对
 *   接近视口的页放行（PdfPageItem 的 300px 观察器），纯预取页传 false
 */
export async function extractOrOcrPageText(
  pdfDoc: PDFDocumentProxy,
  pageNum: number,
  docPath: string,
  canvas: HTMLCanvasElement | null,
  allowOcr: boolean,
): Promise<PageTextExtractionResult> {
  const normPath = docPath.replace(/\\/g, '/').toLowerCase()
  const engineCfg = ocrEngineOf()
  // 两把缓存键：矢量键（矢量提取免费且准，不带纪元——清 OCR 缓存不影响它）；
  // OCR 键带引擎档位与**文档纪元**——右键「清除本文档缓存」就是 bump 纪元
  const vectorKey = await capsHashKey('vec', normPath, pageNum)
  const ocrKey = await capsHashKey(
    'ocr',
    normPath,
    pageNum,
    engineCfg ? `${engineCfg.engine.kind}:${engineCfg.purpose}` : 'off',
    engineCfg ? docOcrEpoch(docPath) : 0,
  )

  // 1a. 矢量缓存（识别是按量计费的，同一页同一档绝不识别第二次）
  const cachedVec = await capsCacheGet<OcrPageResult>(vectorKey)
  if (cachedVec && cachedVec.lines.length > 0) {
    return { lines: cachedVec.lines, isScanned: false, fromCache: true }
  }
  // 1b. OCR 缓存
  const cachedOcr = await capsCacheGet<OcrPageResult>(ocrKey)
  if (cachedOcr && cachedOcr.lines.length > 0) {
    return {
      lines: cachedOcr.lines,
      isScanned: true,
      fromCache: true,
      rawOcrText: cachedOcr.rawOcrText,
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
        await capsCacheSet(vectorKey, pageResult)
        return { lines, isScanned: false, fromCache: false }
      }
    }
  } catch (err) {
    console.warn(`[pdf-text] 提取第 ${pageNum} 页原生文本异常:`, err)
  }

  // 3. 矢量文本为空：判定为扫描件或纯图片 PDF，按需调用 OCR（串行队列 + 分级放行）
  if (allowOcr && canvas && engineCfg) {
    const dataUrl = await canvasToJpegDataUrl(canvas)
    if (dataUrl) {
      try {
        const res = await runOcrSerially(() =>
          native().caps.ocr({
            imageDataUrl: dataUrl,
            purpose: engineCfg.purpose,
            engine: engineCfg.engine,
          }),
        )

        // 系统自带：主进程直接产出行级结构（视觉行 + 词级 bbox）——不解析、不精化
        if (res.ok && engineCfg.engine.kind === 'system') {
          const lines = res.lines ?? []
          if (lines.length > 0) {
            const pageResult: OcrPageResult = {
              page: pageNum,
              lines,
              fullText: lines.map((l) => l.text).join('\n'),
              modelId: 'system-ocr',
              createdAt: Date.now(),
            }
            await capsCacheSet(ocrKey, pageResult)
            return { lines, isScanned: true, fromCache: false }
          }
          return { lines: [], isScanned: true, fromCache: false, rawOcrText: res.error ?? '系统 OCR 未识别出文字' }
        }
        if (res.ok && res.text) {
          const lines = refineLinesByImage(
            canvas,
            parseGroundingLines(res.text) ?? [],
          )
          if (lines.length > 0) {
            const pageResult: OcrPageResult = {
              page: pageNum,
              lines,
              fullText: lines.map((l) => l.text).join('\n'),
              modelId: `${engineCfg.engine.kind}-ocr`,
              createdAt: Date.now(),
              // 原样保存识别服务的返回（含 grounding 标记）：诊断挂贴用
              rawOcrText: res.text,
            }
            await capsCacheSet(ocrKey, pageResult)
            return {
              lines,
              isScanned: true,
              fromCache: false,
              rawOcrText: res.text,
            }
          }
          // 无标记（快速识别档）：不缓存、不挂贴，但把原始返回带出去给诊断层
          return { lines: [], isScanned: true, fromCache: false, rawOcrText: res.text }
        }
      } catch (err) {
        console.warn(`[ocr] 识别第 ${pageNum} 页失败:`, err)
      }
    }
  }

  return {
    lines: [],
    isScanned: true,
    fromCache: false,
  }
}

/* ---------- 隐形文字层组件 ---------- */

interface TextOverlayProps {
  lines: OcrLineItem[]
  pageHeight: number
  /** 页面显示宽（px）：字号按「盒宽 ÷ 字符权重」自适应时要用，防止透明文本溢出盒子被容器裁掉 */
  pageWidth: number
  /** 调试态：挂贴文字显示出来，与画布原文对照对齐（右键「显示挂贴文字」切换） */
  debugVisible?: boolean
}

/**
 * 隐形全透明文字层：挂贴在 Canvas 画布上层，专供框选与复制。
 * 每行一个 span（字号按矩形容器宽度自适应，见 fitFontSize），透明化与选区高亮的
 * 规则在全局 styles/ocr.css（全局一份，不逐页内联）。
 */
export const OcrTextOverlay = memo(function OcrTextOverlay({
  lines,
  pageHeight,
  pageWidth,
  debugVisible = false,
}: TextOverlayProps) {
  if (!lines || lines.length === 0) return null

  return (
    <div
      className={`ocr-text-layer absolute inset-0 pointer-events-auto select-text overflow-hidden z-10 ${debugVisible ? 'ocr-text-layer-debug' : ''}`}
      style={{
        width: '100%',
        height: '100%',
      }}
    >
      {lines.map((line, lineIdx) => {
        const text = cleanOcrText(line.text)
        // 字号宽高取小：宽度约束保证透明文本不溢出盒子（溢出会被容器裁掉 → 复制缺字）
        const fSize = Math.round(fitFontSize(text, line.bbox.width * pageWidth, line.bbox.height * pageHeight))
        return (
          <span
            key={lineIdx}
            className="absolute cursor-text whitespace-nowrap select-text flex items-center pointer-events-auto"
            style={{
              left: `${(line.bbox.x * 100).toFixed(3)}%`,
              top: `${(line.bbox.y * 100).toFixed(3)}%`,
              width: `${(line.bbox.width * 100).toFixed(3)}%`,
              height: `${(line.bbox.height * 100).toFixed(3)}%`,
              fontSize: `${fSize}px`,
              lineHeight: 1,
              color: debugVisible ? 'rgba(30,64,175,0.92)' : 'transparent',
              WebkitTextFillColor: debugVisible ? 'rgba(30,64,175,0.92)' : 'transparent',
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
