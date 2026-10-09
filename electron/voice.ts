/**
 * 语音识别：模型的下载 + SenseVoiceSmall 的推理，**整条链都在主进程**。
 *
 * 为什么不像从前那样把引擎放进渲染层：
 *
 * 1. **没有能进渲染层的浏览器包**。2026-11 查过一圈：npm 上的 sherpa-onnx 是 Node 目标的
 *    wasm（胶水里 require("fs")，Vite 打不进去），transformers.js 不支持 SenseVoice，
 *    官方的浏览器 wasm 构建只发在 GitHub release 里、要自己 vendor 十几 MB 进仓库。
 * 2. 推理走 **sherpa-onnx 的原生构建**：SenseVoice 的前端（80 维 fbank、LFR、CMVN、
 *    CTC 贪心解码）全在里面，是官方那份实现——自己重写一遍 DSP 才是真正会出错的地方。
 * 3. **模型 228 MB**：落盘比「读进渲染进程内存再喂给 WASM」省一半内存；
 *    音频本来就只有几秒，一次 IPC 传过去就完事。
 * 4. CSP 也不让渲染层直连外网，下载本来就得在这儿。
 *
 * 代价与它换来的东西：打包时要带上 `sherpa-onnx-node` 与 `sherpa-onnx-win-x64`
 * （约 23 MB 的原生二进制，见 electron-builder.yml 的 files / asarUnpack），
 * 换来的是「不解 DLL 依赖、不碰 SharedArrayBuffer」。
 *
 * 音频仍然只在这一趟里存在：渲染层录完一段 PCM 递过来，解完就丢，不写盘、不留存。
 * 模型放在 appdata 的 voice-models/ 下——它是**机器上的公共资源**，不属于任何用户，
 * 换个用户、换个数据目录都还在（也不该每个用户各存一份 228 MB）。
 */

import { app, dialog, ipcMain, shell, type WebContents } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from './i18n'

import type {
  VoiceDownloadResult,
  VoiceModelStatus,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from '../shared/ipc'

export type {
  VoiceDownloadResult, VoiceModelStatus, VoiceTranscribeRequest, VoiceTranscribeResult,
}

/** 模型目录名（appdata 下） */
const MODEL_DIR = path.join('voice-models', 'sensevoice-small')
/** 主模型：SenseVoiceSmall 的 int8 量化 ONNX（sherpa-onnx 导出，228 MB） */
const MODEL_ONNX = 'model.int8.onnx'
/** 词表（SentencePiece 的 tokens.txt） */
const MODEL_TOKENS = 'tokens.txt'

/** 一次识别最多吃多长的音频：超过就只解前 120 秒（防一段录音把内存与时间吃光） */
const MAX_SECONDS = 120

/**
 * 模型有哪些文件、各自多大。
 *
 * 体积是**「下完了没有」的唯一判据**：断流留下的半个文件绝不能当成可用模型——
 * 那会在加载时才炸，报出来的还是一句看不懂的 onnx 错误。留 2% 的余量：
 * 源站哪天重新导出一次，体积差一点点也不该让用户重新下载。
 */
const FILES: Array<{ name: string; bytes: number }> = [
  { name: MODEL_ONNX, bytes: 239233841 },
  { name: MODEL_TOKENS, bytes: 315894 },
]
const SIZE_TOLERANCE = 0.98

/**
 * 模型从哪来：官方源 + 一个国内镜像。
 *
 * huggingface.co 在中国大陆常常连不上，而这份模型的用户多半就在那儿；hf-mirror.com
 * 是同一份文件（实测两者体积逐字节一致）。两个源**同时探一下、谁先应答就用谁**：
 * 挨个试等于每次下载都先白卡十秒超时，并发探测的代价只是一个 HEAD。
 */
const SOURCES: Array<{ name: string; base: string }> = [
  {
    name: 'HuggingFace 官方',
    base: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/',
  },
  {
    name: 'hf-mirror 镜像',
    base: 'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/',
  },
]

const modelDir = (): string => path.join(app.getPath('userData'), MODEL_DIR)
const filePath = (name: string): string => path.join(modelDir(), name)

/* ---------- 状态 ---------- */

async function sizeOf(file: string): Promise<number> {
  try {
    return (await fsp.stat(file)).size
  } catch {
    return 0
  }
}

const doneOf = (bytes: number, expect: number): boolean => bytes >= expect * SIZE_TOLERANCE

async function statusOf(): Promise<VoiceModelStatus> {
  const files = await Promise.all(
    FILES.map(async (f) => {
      const bytes = await sizeOf(filePath(f.name))
      return { name: f.name, bytes, expect: f.bytes, done: doneOf(bytes, f.bytes) }
    }),
  )
  return {
    dir: modelDir(),
    path: filePath(MODEL_ONNX),
    exists: files.every((f) => f.done),
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    totalBytes: files.reduce((n, f) => n + f.expect, 0),
    files,
    url: SOURCES[0].base,
    sources: SOURCES.map((s) => t(s.name)),
  }
}

/* ---------- 下载 ---------- */

/** 正在下的那一次；非空表示已经在下，重复点不再起第二个连接 */
let inflight: AbortController | null = null

/**
 * 从某个源下**一个文件**；失败抛异常（含一句能读的中文）。
 *
 * 先写 .part、下完再改名：中途断网/关窗都不会留下一个「看着像模型」的半个文件。
 * 进度按**全部文件的总量**折算（received 是这一次 + 之前几次文件的总和），
 * 所以界面上的百分比从头到尾是单调的，不必自己再拼。
 */
async function fetchOne(
  sender: WebContents,
  source: { name: string; base: string },
  file: { name: string; bytes: number },
  alreadyBytes: number,
  totalBytes: number,
  ac: AbortController,
): Promise<number> {
  const url = source.base + file.name
  const res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
  const part = filePath(file.name) + '.part'
  await fsp.mkdir(modelDir(), { recursive: true })
  const handle = await fsp.open(part, 'w')
  let received = 0
  let lastSent = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk)
      received += chunk.length
      // 每 1 MB 报一次就够了：进度条不需要更细，事件太多反而卡渲染进程
      if (received - lastSent >= 1024 * 1024) {
        lastSent = received
        if (!sender.isDestroyed()) {
          const all = alreadyBytes + received
          sender.send('voice:modelProgress', {
            received: all,
            total: totalBytes,
            percent: totalBytes ? Math.round((all / totalBytes) * 100) : 0,
            note: t('正在下载 {0}…', file.name),
          })
        }
      }
    }
  } finally {
    await handle.close()
  }
  if (!doneOf(received, file.bytes)) {
    throw new Error(
      t('{0} 只下回来 {1} MB（应有 {2} MB），不像是完整文件', file.name, Math.round(received / 1024 / 1024), Math.round(file.bytes / 1024 / 1024)),
    )
  }
  await fsp.rename(part, filePath(file.name))
  return received
}

/**
 * 下载模型：先探源，再按文件顺序下完每一个。
 *
 * 一个源失败就换下一个，**从当前这个文件重来**（前面的文件已经落地了，不重下）。
 * 取消（用户点了取消）是另一种情况：当场返回，不再试下一个源。
 */
async function download(sender: WebContents): Promise<VoiceDownloadResult> {
  if (inflight) return { ok: false, error: t('已经在下一次了') }
  const ac = new AbortController()
  inflight = ac
  const total = FILES.reduce((n, f) => n + f.bytes, 0)
  const failures: string[] = []
  try {
    const ordered = await orderSources(ac.signal)
    let doneBytes = 0
    for (const file of FILES) {
      const have = await sizeOf(filePath(file.name))
      if (doneOf(have, file.bytes)) {
        doneBytes += have
        continue
      }
      let ok = false
      for (const source of ordered) {
        try {
          if (!sender.isDestroyed()) {
            sender.send('voice:modelProgress', {
              received: doneBytes,
              total,
              percent: Math.round((doneBytes / total) * 100),
              note: t('正在从{0}下载 {1}…', t(source.name), file.name),
            })
          }
          const bytes = await fetchOne(sender, source, file, doneBytes, total, ac)
          doneBytes += bytes
          ok = true
          break
        } catch (err) {
          await fsp.rm(filePath(file.name) + '.part', { force: true })
          if (ac.signal.aborted) return { ok: false, error: t('已取消') }
          const msg = err instanceof Error ? err.message : String(err)
          failures.push(t('{0}：{1}', t(source.name), msg))
        }
      }
      if (!ok) {
        return {
          ok: false,
          error: t('每个下载源都不通——{0}。也可以在这台机器上用「用本机文件」挑一份下好的模型目录', failures.join(t('；'))),
        }
      }
    }
    if (!sender.isDestroyed()) {
      sender.send('voice:modelProgress', { received: total, total, percent: 100, note: '' })
    }
    return { ok: true, bytes: total, source: failures.length ? t('备用源') : t(ordered[0]?.name ?? '') }
  } finally {
    inflight = null
  }
}

/**
 * 探测下载源，按「能用的排在前面」返回。
 *
 * 每个源发一个 HEAD，谁先 200 谁排第一；探测失败的排后面（万一它只是探测被挡、
 * 真下载能过，留着当备选比直接扔掉好）。全都探不通时按原顺序返回，让真正的下载去报错。
 */
async function orderSources(signal: AbortSignal): Promise<Array<{ name: string; base: string }>> {
  const probes = await Promise.all(
    SOURCES.map(async (source) => {
      const timer = new AbortController()
      const onAbort = (): void => timer.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      const timeout = setTimeout(() => timer.abort(), 5000)
      try {
        // 拿最小的那个文件探路：HEAD 大文件在某些 CDN 上会被拒
        const res = await fetch(source.base + MODEL_TOKENS, { method: 'HEAD', signal: timer.signal, redirect: 'follow' })
        return { source, ok: res.ok }
      } catch {
        return { source, ok: false }
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
      }
    }),
  )
  const good = probes.filter((p) => p.ok).map((p) => p.source)
  const bad = probes.filter((p) => !p.ok).map((p) => p.source)
  return [...good, ...bad]
}

/* ---------- 用本机文件 / 删除 / 定位 ---------- */

/**
 * 从本机挑一份模型（离线环境、或者用户早就下过）。
 *
 * 挑的是**主模型文件**，词表按「同一个目录里的 tokens.txt」找：模型目录通常是从
 * HuggingFace 整份 clone 下来的，两个文件就在一起，让人挑两次目录只会更烦。
 * 复制而不是引用：路径记在别处迟早会失效（用户挪个目录就废），复制一份一劳永逸。
 */
async function chooseModel(): Promise<{ ok: boolean; canceled?: boolean; error?: string; bytes?: number }> {
  const picked = await dialog.showOpenDialog({
    title: t('选择 SenseVoice 模型（model.int8.onnx）'),
    properties: ['openFile'],
    filters: [
      { name: t('ONNX 模型'), extensions: ['onnx'] },
      { name: t('全部文件'), extensions: ['*'] },
    ],
  })
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true }
  const from = picked.filePaths[0]
  const tokens = path.join(path.dirname(from), MODEL_TOKENS)
  try {
    const stat = await fsp.stat(from)
    const onnxExpect = FILES.find((f) => f.name === MODEL_ONNX)?.bytes ?? 0
    if (!doneOf(stat.size, onnxExpect)) {
      return {
        ok: false,
        error: t('这个文件只有 {0} MB，int8 的 SenseVoice 应该接近 {1} MB', Math.round(stat.size / 1024 / 1024), Math.round(onnxExpect / 1024 / 1024)),
      }
    }
    if ((await sizeOf(tokens)) < 1024) {
      return { ok: false, error: t('同一个目录里没有找到 tokens.txt——两份文件要放在一起') }
    }
    await fsp.mkdir(modelDir(), { recursive: true })
    await fsp.copyFile(from, filePath(MODEL_ONNX))
    await fsp.copyFile(tokens, filePath(MODEL_TOKENS))
    return { ok: true, bytes: stat.size }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('复制失败') }
  }
}

/** 删掉整个模型目录，把 228 MB 要回来；顺带把已经建好的识别器丢掉 */
async function removeModel(): Promise<{ ok: boolean; error?: string }> {
  try {
    await fsp.rm(modelDir(), { recursive: true, force: true })
    recognizer = null
    recognizerKey = ''
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : t('删除失败') }
  }
}

/* ---------- 识别 ---------- */

/** 识别语言（SenseVoice 自己的那几个；auto 让它自己判） */
const LANGUAGES = new Set(['auto', 'zh', 'en', 'ja', 'ko', 'yue'])

/** sherpa 的入口形状（原生模块没有类型，见 electron/types/sherpa-onnx-node.d.ts） */
type Sherpa = {
  OfflineRecognizer: new (config: Record<string, unknown>) => {
    createStream: () => unknown
    decode: (stream: unknown) => void
    getResult: (stream: unknown) => { text?: string }
  }
  version: string
}

let sherpa: Sherpa | null = null
let recognizer: InstanceType<Sherpa['OfflineRecognizer']> | null = null
/** 建这个识别器时用的参数：语言或后端变了就重建（它在原生那一侧是有状态的） */
let recognizerKey = ''

/**
 * 惰性加载原生模块：它要解 23 MB 的 DLL，而绝大多数启动根本用不到语音。
 * 用户第一次真的识别时才把它拉起来（那一下约 1 秒，之后常驻）。
 */
async function loadSherpa(): Promise<Sherpa> {
  if (sherpa) return sherpa
  /*
   * 这一句有个坑：esbuild 把 dynamic import 原样留给 Node，而 Node 用 ESM 的规则去
   * import 一个 CJS 包时，**具名导出靠静态分析猜**——sherpa-onnx-node 交出来的是
   * `module.exports = { … }`，猜不出来，于是命名空间里只有一个 default。
   * 直接取 .OfflineRecognizer 会拿到 undefined，报出来是一句
   * 「s.OfflineRecognizer is not a constructor」（只有真跑一次识别才看得见）。
   */
  const mod = (await import('sherpa-onnx-node')) as unknown as {
    OfflineRecognizer?: unknown
    default?: unknown
  }
  const resolved = (typeof mod.OfflineRecognizer === 'function' ? mod : mod.default) as Sherpa | undefined
  if (!resolved || typeof resolved.OfflineRecognizer !== 'function') {
    throw new Error(t('语音运行时没能加载（sherpa-onnx-node 的导出形态不对）'))
  }
  sherpa = resolved
  return sherpa
}

/**
 * 拿识别器：语言或后端变了就重建一个。
 *
 * provider 传 'directml' 时，**运行时不带 GPU 版会自己退回 CPU**（sherpa 内部那条回退，
 * 实测：传 directml 也能正常出字，只是没真的用上显卡）。所以这里不拦——把偏好交给它，
 * 能不能用上由运行时决定；界面上写明「没带上 GPU 版时会自动退回 CPU」。
 */
async function recognizerFor(language: string, gpu: boolean): Promise<InstanceType<Sherpa['OfflineRecognizer']>> {
  const key = language + '|' + (gpu ? 'gpu' : 'cpu')
  if (recognizer && recognizerKey === key) return recognizer
  const s = await loadSherpa()
  recognizer = new s.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: filePath(MODEL_ONNX), language, useInverseTextNormalization: 1 },
      tokens: filePath(MODEL_TOKENS),
      // 2 线程：一段 5 秒的话在这台机器上约 0.2 秒，再多线程收益很小、还会跟界面抢核
      numThreads: 2,
      provider: gpu ? 'directml' : 'cpu',
      debug: false,
    },
  })
  recognizerKey = key
  return recognizer
}

async function transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
  const started = Date.now()
  if (!(await statusOf()).exists) return { ok: false, error: t('还没下载语音模型') }
  const samples = req.samples
  if (!samples || !samples.length) return { ok: false, error: t('这段录音是空的') }
  const rate = req.sampleRate || 16000
  const capped = samples.length > rate * MAX_SECONDS ? samples.subarray(0, rate * MAX_SECONDS) : samples
  const language = LANGUAGES.has(req.language) ? req.language : 'auto'
  try {
    const rec = await recognizerFor(language, req.gpu === true)
    const stream = rec.createStream()
    ;(stream as { acceptWaveform: (o: { sampleRate: number; samples: Float32Array }) => void }).acceptWaveform({
      sampleRate: rate,
      samples: capped,
    })
    rec.decode(stream)
    const text = (rec.getResult(stream).text ?? '').trim()
    return { ok: true, text, backend: req.gpu ? 'gpu' : 'cpu', ms: Date.now() - started }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 建识别器失败最常见的原因是模型文件坏了：说清「重新下载一次」比抛一句 onnx 报错有用
    recognizer = null
    recognizerKey = ''
    return { ok: false, error: t('识别失败：{0}', msg.split('\n')[0]) }
  }
}

/* ---------- 这台机器上有没有显卡（设置页拿它决定 GPU 开关的默认值） ---------- */

let gpuInfo: Promise<{ hasGpu: boolean; name: string }> | null = null

async function detectGpu(): Promise<{ hasGpu: boolean; name: string }> {
  try {
    const info = (await app.getGPUInfo('basic')) as { gpuDevice?: Array<{ deviceString?: string; vendorId?: number }> }
    const device = info.gpuDevice?.find((d) => (d.vendorId ?? 0) !== 0x1414) // 1414 = Microsoft 基本显示适配器
    return { hasGpu: !!device, name: device?.deviceString ?? '' }
  } catch {
    return { hasGpu: false, name: '' }
  }
}

export function registerVoiceIpc(): void {
  ipcMain.handle('voice:modelStatus', () => statusOf())
  ipcMain.handle('voice:downloadModel', (e) => download(e.sender))
  ipcMain.handle('voice:cancelDownload', () => {
    inflight?.abort()
    return true
  })
  ipcMain.handle('voice:chooseModel', () => chooseModel())
  ipcMain.handle('voice:removeModel', () => removeModel())
  ipcMain.handle('voice:transcribe', (_e, req: VoiceTranscribeRequest) => transcribe(req))
  /** 这台机器上有没有显卡（设置页用它决定「GPU 加速」的默认值） */
  ipcMain.handle('voice:gpuInfo', () => {
    gpuInfo ??= detectGpu()
    return gpuInfo
  })
  /** 在文件管理器里定位模型目录：用户想自己看看/替换时用得上 */
  ipcMain.handle('voice:revealModel', () => {
    void shell.openPath(modelDir())
    return true
  })
}
