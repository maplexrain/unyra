/**
 * OCR 文字识别：多模型管理与下载、磁盘缓存与识别推理（主进程通道）。
 *
 * 架构规范：
 * 1. 模型存放在用户数据目录下的 ocr-models/{modelId}/：作为跨会话公共资源；
 * 2. 识别结果缓存至 ocr-cache/{hash}.json：避免重复渲染相同 PDF 页面的重复算力开销；
 * 3. 支持多模型下载选择（极速版、高精度版、Tesseract 多语言、英文专属）与多镜像源加速；
 * 4. 离线支持：允许从本机直接导入已有的模型权重文件。
 */

import { dialog, ipcMain, shell, nativeImage, type WebContents } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import ort from 'onnxruntime-node'
import { getUserDataDir } from './storage/userData'
import { t } from './i18n'
import type {
  OcrDownloadRequest,
  OcrDownloadResult,
  OcrModelOption,
  OcrModelStatus,
  OcrPageResult,
  OcrRecognizeRequest,
  OcrRecognizeResult,
} from '../shared/ipc'

const OCR_ROOT_DIR = 'ocr-models'
const OCR_CACHE_DIR = 'ocr-cache'

interface ModelFileSpec {
  name: string
  urlPath?: string
  directUrls?: string[]
  bytes: number
}

interface ModelSpec {
  id: string
  name: string
  description: string
  sizeMb: number
  tags: string[]
  files: ModelFileSpec[]
}

const OCR_MODELS: ModelSpec[] = [
  {
    id: 'pp-ocrv4-mobile',
    name: 'PP-OCRv4 极速版',
    description: '轻量级通用中英文检测与识别模型，速度极快，适合日常文档、书籍与试卷',
    sizeMb: 16,
    tags: ['推荐', '极速', '中英双语'],
    files: [
      { name: 'ch_PP-OCRv4_det_infer.onnx', urlPath: 'PP-OCRv4/ch_PP-OCRv4_det_infer.onnx', bytes: 4745517 },
      { name: 'ch_PP-OCRv4_rec_infer.onnx', urlPath: 'PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx', bytes: 10857958 },
    ],
  },
  {
    id: 'pp-ocrv4-server',
    name: 'PP-OCRv4 高精度版',
    description: '大参数量深度识别模型，针对复杂排版、低清发票、繁体字与微小字号深度优化',
    sizeMb: 204,
    tags: ['高精度', '复杂版面', '多语言'],
    files: [
      { name: 'ch_PP-OCRv4_det_server_infer.onnx', urlPath: 'PP-OCRv4/ch_PP-OCRv4_det_server_infer.onnx', bytes: 113352104 },
      { name: 'ch_PP-OCRv4_rec_server_infer.onnx', urlPath: 'PP-OCRv4/ch_PP-OCRv4_rec_server_infer.onnx', bytes: 90530732 },
    ],
  },
  {
    id: 'english-digits',
    name: '英文与数字紧凑版',
    description: '超小体积西文字符与数字模型，内存开销极低，毫秒级即时响应',
    sizeMb: 9,
    tags: ['超轻量', '纯西文'],
    files: [
      { name: 'en_PP-OCRv3_rec_infer.onnx', urlPath: 'PP-OCRv3/en_PP-OCRv3_rec_infer.onnx', bytes: 8967018 },
    ],
  },
  {
    id: 'tesseract-wasm',
    name: 'Tesseract 多语言离线包',
    description: '标准经典开源 OCR 数据包，包含简体中文与西文字库，纯 CPU 离线通用',
    sizeMb: 3,
    tags: ['经典开源', '通用兼容'],
    files: [
      {
        name: 'chi_sim.traineddata',
        directUrls: [
          'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@main/chi_sim.traineddata',
          'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/chi_sim.traineddata',
        ],
        bytes: 1700263,
      },
      {
        name: 'tesseract-core.wasm',
        directUrls: [
          'https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.0/tesseract-core.wasm',
          'https://unpkg.com/tesseract.js-core@5.1.0/tesseract-core.wasm',
        ],
        bytes: 1011811,
      },
    ],
  },
]

const OCR_SOURCES = [
  {
    id: 'hf-mirror',
    name: '国内镜像源 (hf-mirror 加速)',
    speedHint: '国内网络推荐',
    base: 'https://hf-mirror.com/SWHL/RapidOCR/resolve/main/',
  },
  {
    id: 'huggingface',
    name: 'HuggingFace 官方源',
    speedHint: '海外直连通道',
    base: 'https://huggingface.co/SWHL/RapidOCR/resolve/main/',
  },
  {
    id: 'github',
    name: 'GitHub Releases / CDN',
    speedHint: 'Fastly 全球节点',
    base: 'https://ghproxy.net/https://raw.githubusercontent.com/SWHL/RapidOCR/main/',
  },
]

const getOcrRootDir = (): string => path.join(getUserDataDir(), OCR_ROOT_DIR)
const getOcrCacheDir = (): string => path.join(getUserDataDir(), OCR_CACHE_DIR)
const getModelDir = (modelId: string): string => path.join(getOcrRootDir(), modelId)

async function getFileSize(filePath: string): Promise<number> {
  try {
    return (await fsp.stat(filePath)).size
  } catch {
    return 0
  }
}

let activeModelId = 'pp-ocrv4-mobile'
let inflightController: AbortController | null = null

async function getModelOption(spec: ModelSpec): Promise<OcrModelOption> {
  const dir = getModelDir(spec.id)
  let bytes = 0
  let totalBytes = 0
  let allDone = true

  for (const f of spec.files) {
    totalBytes += f.bytes
    const s = await getFileSize(path.join(dir, f.name))
    bytes += s
    if (s < Math.min(100 * 1024, f.bytes * 0.7)) {
      allDone = false
    }
  }

  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    sizeMb: spec.sizeMb,
    tags: spec.tags,
    exists: allDone && bytes > 0,
    bytes,
    totalBytes,
  }
}

async function getModelStatus(): Promise<OcrModelStatus> {
  const models = await Promise.all(OCR_MODELS.map(getModelOption))

  // 探测本机导入模型（custom-local）
  const customDir = getModelDir('custom-local')
  try {
    const files = await fsp.readdir(customDir)
    if (files.length > 0) {
      let customBytes = 0
      for (const f of files) {
        customBytes += await getFileSize(path.join(customDir, f))
      }
      if (customBytes > 0) {
        models.unshift({
          id: 'custom-local',
          name: t('本机导入模型'),
          description: t('从本地挑选导入的自定义 OCR 权重文件 ({0})', files.join(', ')),
          sizeMb: Math.max(1, Math.round(customBytes / 1024 / 1024)),
          tags: ['本地导入', '自定义'],
          exists: true,
          bytes: customBytes,
          totalBytes: customBytes,
        })
      }
    }
  } catch {}

  return {
    activeModelId,
    models,
    sources: OCR_SOURCES.map((s) => ({
      id: s.id,
      name: s.name,
      speedHint: s.speedHint,
    })),
    dir: getOcrRootDir(),
  }
}

/* ---------- 模型下载 ---------- */

async function downloadModelFile(
  sender: WebContents,
  targetUrl: string,
  modelId: string,
  fileName: string,
  doneBytes: number,
  totalBytes: number,
  signal: AbortSignal,
): Promise<number> {
  const targetDir = getModelDir(modelId)
  await fsp.mkdir(targetDir, { recursive: true })
  const finalPath = path.join(targetDir, fileName)
  const partPath = `${finalPath}.part`

  const res = await fetch(targetUrl, { signal, redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`)
  }

  const handle = await fsp.open(partPath, 'w')
  let received = 0
  let lastReported = 0

  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk)
      received += chunk.length
      if (received - lastReported >= 256 * 1024) {
        lastReported = received
        if (!sender.isDestroyed()) {
          const currentAll = doneBytes + received
          sender.send('ocr:modelProgress', {
            modelId,
            received: currentAll,
            total: totalBytes,
            percent: totalBytes ? Math.min(99, Math.round((currentAll / totalBytes) * 100)) : 0,
            note: t('正在下载 {0}…', fileName),
          })
        }
      }
    }
  } finally {
    await handle.close()
  }

  await fsp.rename(partPath, finalPath)
  return received
}

async function downloadModel(sender: WebContents, req: OcrDownloadRequest): Promise<OcrDownloadResult> {
  if (inflightController) {
    return { ok: false, error: t('已有模型正在下载中，请稍候') }
  }

  const spec = OCR_MODELS.find((m) => m.id === req.modelId)
  if (!spec) {
    return { ok: false, error: t('未知的 OCR 模型标识') }
  }

  const selectedSource = OCR_SOURCES.find((s) => s.id === req.sourceId) || OCR_SOURCES[0]
  const ac = new AbortController()
  inflightController = ac

  const total = spec.files.reduce((acc, f) => acc + f.bytes, 0)
  let doneBytes = 0

  try {
    for (const f of spec.files) {
      const finalPath = path.join(getModelDir(spec.id), f.name)
      const currentSize = await getFileSize(finalPath)
      // 若已有完整权重（达到预期的 80% 以上），跳过该文件
      if (currentSize >= f.bytes * 0.8) {
        doneBytes += currentSize
        continue
      }

      let downloaded = false
      // 构造当前文件优先尝试的候选 URL 清单
      const candidateUrls: Array<{ name: string; url: string }> = []
      if (f.directUrls && f.directUrls.length > 0) {
        for (const u of f.directUrls) {
          candidateUrls.push({ name: 'CDN / 官方节点', url: u })
        }
      } else {
        const subPath = f.urlPath || f.name
        const sourcesToTry = [selectedSource, ...OCR_SOURCES.filter((s) => s.id !== selectedSource.id)]
        for (const src of sourcesToTry) {
          candidateUrls.push({ name: src.name, url: `${src.base}${subPath}` })
        }
      }

      for (const cand of candidateUrls) {
        try {
          if (!sender.isDestroyed()) {
            sender.send('ocr:modelProgress', {
              modelId: spec.id,
              received: doneBytes,
              total,
              percent: Math.round((doneBytes / total) * 100),
              note: t('正在从 {0} 下载 {1}…', cand.name, f.name),
            })
          }
          const bytes = await downloadModelFile(sender, cand.url, spec.id, f.name, doneBytes, total, ac.signal)
          doneBytes += bytes
          downloaded = true
          break
        } catch {
          await fsp.rm(`${finalPath}.part`, { force: true }).catch(() => {})
          if (ac.signal.aborted) {
            return { ok: false, error: t('已取消下载') }
          }
        }
      }

      if (!downloaded) {
        throw new Error(t('下载模型文件 {0} 失败，请切换镜像源后重试', f.name))
      }
    }

    // 确保 PaddleOCR 字符字典就绪
    const targetDir = getModelDir(spec.id)
    const dictPath = path.join(targetDir, 'ppocr_keys_v1.txt')
    try {
      await fsp.access(dictPath)
    } catch {
      const candidates = [
        path.join(__dirname, 'assets', 'ppocr_keys_v1.txt'),
        path.join(process.cwd(), 'electron/assets/ppocr_keys_v1.txt'),
        path.join(process.cwd(), 'scripts/ppocr_keys_v1.txt'),
      ]
      for (const c of candidates) {
        try {
          const content = await fsp.readFile(c)
          if (content.length > 500) {
            await fsp.writeFile(dictPath, content)
            break
          }
        } catch {}
      }
    }

    activeModelId = spec.id
    if (!sender.isDestroyed()) {
      sender.send('ocr:modelProgress', {
        modelId: spec.id,
        received: total,
        total,
        percent: 100,
        note: t('模型就绪完成'),
      })
    }

    return { ok: true, modelId: spec.id, bytes: total, source: selectedSource.name }
  } finally {
    inflightController = null
  }
}

async function removeModel(modelId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = getModelDir(modelId)
    await fsp.rm(dir, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function chooseModel(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  const res = await dialog.showOpenDialog({
    title: t('选择离线 OCR 模型文件 (*.onnx / *.traineddata)'),
    filters: [{ name: 'OCR 模型', extensions: ['onnx', 'traineddata', 'bin'] }],
    properties: ['openFile'],
  })

  if (res.canceled || !res.filePaths.length) {
    return { ok: false, canceled: true }
  }

  const chosenPath = res.filePaths[0]
  const fileName = path.basename(chosenPath)
  const targetDir = getModelDir('custom-local')
  await fsp.mkdir(targetDir, { recursive: true })
  await fsp.copyFile(chosenPath, path.join(targetDir, fileName))

  activeModelId = 'custom-local'
  return { ok: true }
}

/* ---------- 磁盘缓存 ---------- */

export function hashOcrKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex')
}

async function getCachedOcr(key: string): Promise<OcrPageResult | null> {
  try {
    const hash = hashOcrKey(key)
    const filePath = path.join(getOcrCacheDir(), `${hash}.json`)
    const raw = await fsp.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as OcrPageResult
    if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

async function setCachedOcr(key: string, data: OcrPageResult): Promise<boolean> {
  if (!data || !Array.isArray(data.lines) || data.lines.length === 0) {
    return false
  }
  try {
    const hash = hashOcrKey(key)
    const dir = getOcrCacheDir()
    await fsp.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `${hash}.json`)
    await fsp.writeFile(filePath, JSON.stringify(data), 'utf-8')
    return true
  } catch {
    return false
  }
}

/* ---------- 页面 OCR 识别推理 ---------- */

async function ensureWinOcrScript(): Promise<string> {
  const target = path.join(getOcrRootDir(), 'win_ocr_runner.ps1')
  try {
    const stat = await fsp.stat(target)
    if (stat.size > 200) return target
  } catch {}

  const candidates = [
    path.join(__dirname, 'assets', 'win_ocr_runner.ps1'),
    path.join(__dirname, '../electron/assets/win_ocr_runner.ps1'),
    path.join(process.cwd(), 'electron/assets/win_ocr_runner.ps1'),
    path.join(process.cwd(), 'scripts/win_ocr_runner.ps1'),
  ]

  for (const c of candidates) {
    try {
      const content = await fsp.readFile(c, 'utf-8')
      if (content && content.length > 200) {
        await fsp.mkdir(getOcrRootDir(), { recursive: true })
        await fsp.writeFile(target, content, 'utf-8')
        return target
      }
    } catch {}
  }

  return target
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

let loadedRecSession: ort.InferenceSession | null = null
let loadedRecModelPath: string | null = null
let ocrDictCache: string[] | null = null

async function getOcrDict(): Promise<string[]> {
  if (ocrDictCache && ocrDictCache.length > 0) return ocrDictCache
  const candidates = [
    path.join(getOcrRootDir(), 'pp-ocrv4-mobile', 'ppocr_keys_v1.txt'),
    path.join(getOcrRootDir(), 'pp-ocrv4-server', 'ppocr_keys_v1.txt'),
    path.join(__dirname, 'assets', 'ppocr_keys_v1.txt'),
    path.join(process.cwd(), 'electron/assets/ppocr_keys_v1.txt'),
    path.join(process.cwd(), 'scripts/ppocr_keys_v1.txt'),
  ]
  for (const c of candidates) {
    try {
      const raw = await fsp.readFile(c, 'utf-8')
      if (raw && raw.length > 500) {
        ocrDictCache = raw.split(/\r?\n/)
        return ocrDictCache
      }
    } catch {}
  }
  return []
}

async function getRecSession(modelId: string): Promise<ort.InferenceSession | null> {
  const isServer = modelId === 'pp-ocrv4-server'
  const fileName = isServer ? 'ch_PP-OCRv4_rec_server_infer.onnx' : 'ch_PP-OCRv4_rec_infer.onnx'
  const modelPath = path.join(getModelDir(modelId), fileName)
  try {
    const stat = await fsp.stat(modelPath)
    if (stat.size < 1024 * 1024) return null
  } catch {
    return null
  }

  if (loadedRecSession && loadedRecModelPath === modelPath) {
    return loadedRecSession
  }

  try {
    const session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    })
    loadedRecSession = session
    loadedRecModelPath = modelPath
    return session
  } catch (err) {
    console.warn(`[ocr] 加载 PaddleOCR 识别模型异常:`, err)
    return null
  }
}

async function recognizeLineWithPaddle(
  session: ort.InferenceSession,
  dict: string[],
  pageImg: ReturnType<typeof nativeImage.createFromBuffer>,
  bbox: { x: number; y: number; width: number; height: number },
  imgW: number,
  imgH: number
): Promise<string | null> {
  if (!dict.length) return null

  const cropX = Math.max(0, Math.floor(bbox.x * imgW))
  const cropY = Math.max(0, Math.floor(bbox.y * imgH))
  const cropW = Math.max(4, Math.min(imgW - cropX, Math.ceil(bbox.width * imgW)))
  const cropH = Math.max(4, Math.min(imgH - cropY, Math.ceil(bbox.height * imgH)))

  if (cropW < 6 || cropH < 6) return null

  const crop = pageImg.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
  const targetH = 48
  const targetW = Math.max(32, Math.min(1280, Math.round((cropW * targetH) / cropH / 32) * 32))
  const resized = crop.resize({ width: targetW, height: targetH, quality: 'best' })
  const rawBitmap = resized.toBitmap()

  const chSize = targetH * targetW
  const tensorData = new Float32Array(3 * chSize)

  for (let h = 0; h < targetH; h++) {
    for (let w = 0; w < targetW; w++) {
      const pIdx = (h * targetW + w) * 4
      const b = rawBitmap[pIdx]
      const g = rawBitmap[pIdx + 1]
      const r = rawBitmap[pIdx + 2]
      const idx = h * targetW + w
      tensorData[idx] = (r / 255.0 - 0.5) / 0.5
      tensorData[chSize + idx] = (g / 255.0 - 0.5) / 0.5
      tensorData[2 * chSize + idx] = (b / 255.0 - 0.5) / 0.5
    }
  }

  const tensor = new ort.Tensor('float32', tensorData, [1, 3, targetH, targetW])
  const feeds: Record<string, ort.Tensor> = {}
  feeds[session.inputNames[0]] = tensor

  const outputs = await session.run(feeds)
  const outTensor = outputs[session.outputNames[0]]
  const seqLen = outTensor.dims[1]
  const numClasses = outTensor.dims[2]
  const data = outTensor.data as Float32Array

  let decoded = ''
  let lastClass = -1

  for (let t = 0; t < seqLen; t++) {
    const offset = t * numClasses
    let maxIdx = 0
    let maxVal = data[offset]
    for (let c = 1; c < numClasses; c++) {
      const val = data[offset + c]
      if (val > maxVal) {
        maxVal = val
        maxIdx = c
      }
    }

    if (maxIdx > 0 && maxIdx !== lastClass && maxIdx <= dict.length) {
      decoded += dict[maxIdx - 1]
    }
    lastClass = maxIdx
  }

  return cleanOcrText(decoded) || null
}

async function recognizePage(req: OcrRecognizeRequest): Promise<OcrRecognizeResult> {
  const startAt = Date.now()
  const page = req.page ?? 1
  const modelId = req.modelId || activeModelId

  try {
    // 1. 若有缓存，直接返回
    const cacheKey = `${req.imageDataUrl.slice(0, 80)}#${req.imageDataUrl.length}#p${page}#${modelId}`
    const cached = await getCachedOcr(cacheKey)
    if (cached && cached.lines.length > 0) {
      return { ok: true, result: cached, fromCache: true, durationMs: Date.now() - startAt }
    }

    let lines: OcrPageResult['lines'] = []

    if (process.platform === 'win32') {
      const commaIdx = req.imageDataUrl.indexOf(',')
      const b64 = commaIdx !== -1 ? req.imageDataUrl.slice(commaIdx + 1) : req.imageDataUrl
      const buf = Buffer.from(b64, 'base64')

      const tempFile = path.join(os.tmpdir(), `unyra_ocr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.png`)
      await fsp.writeFile(tempFile, buf)

      try {
        const scriptPath = await ensureWinOcrScript()
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, tempFile],
            { encoding: 'utf-8', timeout: 25000, maxBuffer: 10 * 1024 * 1024 },
            (err, out) => {
              if (err) reject(err)
              else resolve(out)
            }
          )
        })

        const rawJson = stdout.trim().startsWith('{')
          ? stdout.trim()
          : Buffer.from(stdout.trim(), 'base64').toString('utf-8')
        const parsed = JSON.parse(rawJson)

        if (parsed && Array.isArray(parsed.lines)) {
          lines = parsed.lines.map((l: { text: string; bbox: { x: number; y: number; width: number; height: number }; words?: Array<{ text: string; bbox: { x: number; y: number; width: number; height: number } }> }) => ({
            text: cleanOcrText(l.text),
            bbox: {
              x: Number(l.bbox.x) || 0,
              y: Number(l.bbox.y) || 0,
              width: Number(l.bbox.width) || 0.1,
              height: Number(l.bbox.height) || 0.02,
            },
            words: Array.isArray(l.words)
              ? l.words.map((w) => ({
                  text: w.text,
                  bbox: {
                    x: Number(w.bbox.x) || 0,
                    y: Number(w.bbox.y) || 0,
                    width: Number(w.bbox.width) || 0.01,
                    height: Number(w.bbox.height) || 0.01,
                  },
                }))
              : undefined,
          }))
        }

        // 若当前模型已配置并下载 PaddleOCR 深度识别模型，对各行文本框执行 PaddleOCR 高精度推理强化
        const recSession = await getRecSession(modelId)
        if (recSession && lines.length > 0) {
          const dict = await getOcrDict()
          if (dict.length > 0) {
            const pageImg = nativeImage.createFromBuffer(buf)
            const { width: imgW, height: imgH } = pageImg.getSize()

            for (const line of lines) {
              try {
                const paddleText = await recognizeLineWithPaddle(recSession, dict, pageImg, line.bbox, imgW, imgH)
                if (paddleText && paddleText.length > 0) {
                  line.text = paddleText
                }
              } catch (recErr) {
                console.warn(`[ocr] PaddleOCR 行识别异常:`, recErr)
              }
            }
          }
        }
      } catch (ocrErr) {
        console.warn(`[ocr] OCR 推理处理异常:`, ocrErr)
      } finally {
        await fsp.rm(tempFile, { force: true }).catch(() => {})
      }
    }

    // 构造页面文本结构
    const result: OcrPageResult = {
      page,
      lines,
      fullText: lines.map((l) => l.text).join('\n'),
      modelId,
      createdAt: Date.now(),
    }

    if (lines.length > 0) {
      await setCachedOcr(cacheKey, result)
    }

    return { ok: true, result, fromCache: false, durationMs: Date.now() - startAt }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/* ---------- 注册 IPC 通道 ---------- */

export function registerOcrIpc(): void {
  ipcMain.handle('ocr:modelStatus', () => getModelStatus())
  ipcMain.handle('ocr:downloadModel', (e, req: OcrDownloadRequest) => downloadModel(e.sender, req))
  ipcMain.handle('ocr:cancelDownload', () => {
    if (inflightController) {
      inflightController.abort()
      inflightController = null
      return true
    }
    return false
  })
  ipcMain.handle('ocr:setActiveModel', (_e, modelId: string) => {
    activeModelId = modelId
    return true
  })
  ipcMain.handle('ocr:chooseModel', () => chooseModel())
  ipcMain.handle('ocr:removeModel', (_e, modelId: string) => removeModel(modelId))
  ipcMain.handle('ocr:revealModel', async () => {
    const dir = getOcrRootDir()
    await fsp.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
    return true
  })
  ipcMain.handle('ocr:recognize', (_e, req: OcrRecognizeRequest) => recognizePage(req))
  ipcMain.handle('ocr:getCache', (_e, key: string) => getCachedOcr(key))
  ipcMain.handle('ocr:setCache', (_e, key: string, data: OcrPageResult) => setCachedOcr(key, data))
}
