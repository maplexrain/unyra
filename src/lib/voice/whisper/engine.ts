/**
 * 渲染进程里的语音转文字引擎：whisper.cpp + WASM，模型 ggml-base-q5_1.bin。
 *
 * 用法（调用方负责下载与缓存模型，本模块**不含任何下载逻辑**）：
 *
 * ```ts
 * const engine = createWhisperEngine()
 * await engine.init((p) => console.log(p.phase, p.loaded, p.total))
 * await engine.loadModel(modelBytes)          // Uint8Array，整个 ggml-base-q5_1.bin
 * const text = await engine.transcribe(pcm)   // Float32Array，16 kHz 单声道
 * engine.dispose()
 * ```
 *
 * 三条容易踩的行为约定，调用方按这个写就不会错：
 *
 * - **串行排队**：同一时刻只跑一次转写。第二次调用不会被打断也不会被丢掉，
 *   它排在队尾，等前面那次结束后原样执行。实时场景里「每秒把更长的 buffer
 *   再喂一次」不会互相打架，但会**排长队**——单线程 base q5_1 的实时率约
 *   0.65x（11 秒音频跑约 17 秒，见 README），所以调用方应当自己限流：
 *   上一次没回来就不要再发新的。真要「只保留最新一次」，请在调用方做丢弃。
 * - **进度回调只在 init 里给**：loadModel 没有回调参数，但它会继续用 init
 *   传进来的那个回调上报 `phase: 'model'` 与 `phase: 'ready'`。
 * - **dispose 之后不可复用**：再调 init/loadModel/transcribe 一律抛错。
 */
import { t } from '../../../i18n'
import {
  createContext,
  describe,
  ensureRuntime,
  modelFsPath,
  releaseContext,
  removeModel,
  transcribePcm,
  writeModel,
  type WhisperHandle,
  type WhisperWasmRuntime,
} from './runtime'

export interface LoadProgress {
  phase: 'init' | 'model' | 'ready'
  loaded: number
  total: number
}

export interface TranscribeOptions {
  language?: string
}

export interface WhisperEngine {
  /** options.gpu：走 WebGPU 后端（跑不起来时调用方负责退回 CPU） */
  init(onProgress?: (p: LoadProgress) => void, options?: { gpu?: boolean }): Promise<void>
  loadModel(bytes: Uint8Array): Promise<void>
  transcribe(pcm: Float32Array, opts?: TranscribeOptions): Promise<string>
  isReady(): boolean
  dispose(): void
}

/** 引擎要求的采样率。pcm 必须是这个采样率的单声道 Float32。 */
const SAMPLE_RATE = 16000

/**
 * 比这还短的音频直接当空处理。whisper 会把输入补齐到 30 秒再编码，几十个采样点
 * 喂进去照样要跑满一次编码器（约 2 秒），实时场景下这是纯浪费；而且这么短的片段
 * 结果基本是幻觉，不如返回空串。0.1 秒远低于调用方说的「几百毫秒」下限。
 */
const MIN_SAMPLES = SAMPLE_RATE / 10

const DISPOSED_MESSAGE = '语音识别引擎已释放（dispose），请重新创建引擎。'
const NOT_READY_MESSAGE =
  '语音识别引擎尚未就绪：请先 await init() 并 await loadModel(bytes)。'

/** whisper 对纯噪声/静音常吐出的标记，按「纯文本」的要求清掉。 */
const NON_SPEECH_TAG =
  /[[(]\s*(blank_audio|silence|music|sound|noise|inaudible|applause|laughter|beep|static|click|wind|breathing|indistinct)\s*[\])]/gi

let nextEngineId = 1

function report(
  onProgress: ((p: LoadProgress) => void) | undefined,
  progress: LoadProgress,
): void {
  if (!onProgress) return
  try {
    onProgress(progress)
  } catch {
    // 调用方的回调抛错不该把加载流程带走。
  }
}

/**
 * whisper.cpp 认 'auto'/'en'/'zh' 这类短码。
 *
 * **不给语言 ≠ 自动检测**：whisper.cpp 的 C 层默认值是 'en'（`whisper_full_default_params`
 * 里写死的），不显式传 'auto' 它就一路拿英文解码器往上套——对着中文话筒说中文，
 * 出来的是一串「用英文字母拼中文音」的东西。所以这里缺省就是 'auto'，**不返回 null**。
 */
function normalizeLanguage(language: string | undefined): string {
  if (typeof language !== 'string') return 'auto'
  const trimmed = language.trim()
  return trimmed || 'auto'
}

/** 去掉首尾空白与非语音标记；只剩标点也算空。 */
function cleanText(raw: string): string {
  if (typeof raw !== 'string') return ''
  const collapsed = raw
    .replace(NON_SPEECH_TAG, ' ')
    .replace(/[\u266a\u266b]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!/[\p{L}\p{N}]/u.test(collapsed)) return ''
  return collapsed
}

export function createWhisperEngine(): WhisperEngine {
  const id = nextEngineId
  nextEngineId += 1

  let disposed = false
  let runtime: WhisperWasmRuntime | null = null
  let context: WhisperHandle | null = null
  let fsPath: string | null = null
  let onProgress: ((p: LoadProgress) => void) | undefined
  /** 转写队列的尾巴：每次 transcribe 挂到它后面，保证严格串行。 */
  let tail: Promise<unknown> = Promise.resolve()

  function assertUsable(): void {
    // 常量是模块顶层的中文原文，在这里（函数体里）才查表
    if (disposed) throw new Error(t(DISPOSED_MESSAGE))
  }

  /** 这次要不要走 WebGPU（init 里定，loadModel 建上下文时用） */
  let useGpu = false

  async function init(
    next?: (p: LoadProgress) => void,
    options?: { gpu?: boolean },
  ): Promise<void> {
    assertUsable()
    if (next) onProgress = next
    if (options?.gpu !== undefined) useGpu = options.gpu
    report(onProgress, { phase: 'init', loaded: 0, total: 1 })
    if (!runtime) runtime = await ensureRuntime()
    assertUsable()
    report(onProgress, { phase: 'init', loaded: 1, total: 1 })
  }

  async function loadModel(bytes: Uint8Array): Promise<void> {
    assertUsable()
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(t('loadModel 需要 Uint8Array（模型文件的完整字节）。'))
    }
    if (bytes.byteLength === 0) {
      throw new Error(t('loadModel 收到的模型字节为空。'))
    }

    // 没显式 init 也允许：loadModel 自己把运行时拉起来。
    if (!runtime) runtime = await ensureRuntime()
    assertUsable()

    const active = runtime
    const path = modelFsPath(id)
    const total = bytes.byteLength
    report(onProgress, { phase: 'model', loaded: 0, total })

    // 换模型时先把旧上下文放掉，否则两份模型会同时占着 wasm 堆。
    if (context) {
      const previous = context
      context = null
      try {
        releaseContext(active, previous)
      } catch {
        // 旧上下文释放失败不影响新模型加载。
      }
    }

    writeModel(active, path, bytes)
    report(onProgress, { phase: 'model', loaded: total, total })

    try {
      context = await createContext(active, path, useGpu)
    } catch (error: unknown) {
      try {
        removeModel(active, path)
      } catch {
        // 清理失败就交给下一次 loadModel 覆盖。
      }
      throw new Error(t('whisper 模型加载失败：{0}', describe(error)))
    }

    assertUsable()
    fsPath = path
    report(onProgress, { phase: 'ready', loaded: total, total })
  }

  async function runTranscribe(
    pcm: Float32Array,
    language: string | null,
  ): Promise<string> {
    if (disposed) throw new Error(t(DISPOSED_MESSAGE))
    const active = runtime
    const handle = context
    if (!active || !handle) throw new Error(t(NOT_READY_MESSAGE))

    try {
      return cleanText(await transcribePcm(active, handle, pcm, language))
    } catch (error: unknown) {
      if (disposed) throw new Error(t(DISPOSED_MESSAGE))
      throw new Error(t('语音转写失败：{0}', describe(error)))
    }
  }

  function transcribe(
    pcm: Float32Array,
    opts?: TranscribeOptions,
  ): Promise<string> {
    if (disposed) return Promise.reject(new Error(t(DISPOSED_MESSAGE)))
    if (!(pcm instanceof Float32Array)) {
      return Promise.reject(
        new Error(t('transcribe 需要 Float32Array（16 kHz 单声道，-1..1）。')),
      )
    }
    // 空音频 / 过短音频：不占用队列，直接空串。
    if (pcm.length === 0 || pcm.length < MIN_SAMPLES) return Promise.resolve('')
    if (!context) return Promise.reject(new Error(t(NOT_READY_MESSAGE)))

    // 入队前先快照：排队期间调用方很可能已经改了（甚至丢了）那个 buffer。
    const snapshot = pcm.slice()
    const language = normalizeLanguage(opts?.language)

    const run = tail.then(
      () => runTranscribe(snapshot, language),
      () => runTranscribe(snapshot, language),
    )
    // 队列本身不能被失败打断，否则一次报错会卡死后面所有调用。
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function isReady(): boolean {
    return !disposed && context !== null
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    onProgress = undefined
    const previous = context
    const active = runtime
    const path = fsPath
    context = null
    fsPath = null
    if (!previous || !active) return
    try {
      // 先放上下文再删文件，否则模型可能还在被读。
      releaseContext(active, previous)
    } catch {
      // 释放失败也要继续删文件，不然 57 MB 会一直挂在 wasm 堆里。
    }
    if (path) removeModel(active, path)
  }

  return { init, loadModel, transcribe, isReady, dispose }
}
