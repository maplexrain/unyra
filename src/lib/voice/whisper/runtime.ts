/**
 * whisper.cpp（WASM）运行时：加载单线程构建、把模型字节写进 Emscripten 的内存
 * 文件系统、并直接调用 wasm 导出的 embind 入口。engine.ts 只管排队与对外接口。
 *
 * ## 为什么不用 @fugood/node-whisper-wasm 的包入口（index.js）
 *
 * 包入口很好用，但它的 `WASM_CONFIG_PATHS` 里有四个**静态可分析**的
 * `new URL('./wasm/whisper-node*.{js,wasm}', import.meta.url)`，还有
 * `new URL('./worker.js', import.meta.url)`。Vite 见到这种写法会把它们全部当
 * 资源发出去 —— 实测打包产物会多出：
 *
 *   assets/whisper-node.threads-*.js      149 KB
 *   assets/whisper-node.threads-*.wasm   4.3 MB   ← 本应用永远用不了（要 SharedArrayBuffer）
 *   assets/worker-*.js                    7.6 KB
 *
 * 白搭 4.4 MB，还是每个用户都要下载的 4.4 MB。而入口里我们真正需要的逻辑只有
 * 三行：`__wasm_init_whisper` / `__wasm_transcribe` / `__wasm_free_whisper`。
 * 所以这里只深路径引入**单线程的那一份胶水**，自己调 embind。
 * 依赖版本在 package.json 里锁死（save-exact），并且下面有运行时校验兜底。
 *
 * ## 关于多线程
 *
 * 同一个包里还有 `wasm/whisper-node.threads.*`，那份用 pthread，需要
 * `new WebAssembly.Memory({ shared: true })`，也就是页面必须 cross-origin
 * isolated（响应头得有 COOP/COEP）。实测本应用的生产渲染进程：
 * `crossOriginIsolated === false`、`typeof SharedArrayBuffer === 'undefined'`，
 * 所以线程版直接出局，这里只用单线程构建。详见 README。
 */
import { t } from '../../../i18n'
import createWhisperNodeModule from '@fugood/node-whisper-wasm/wasm/whisper-node.js'
import wasmAssetUrl from '@fugood/node-whisper-wasm/wasm/whisper-node.wasm?url'

/** 依赖版本写死在这里，运行时校验用；升级依赖时如果 embind 名字变了会当场报错。 */
export const EXPECTED_PACKAGE_VERSION = '1.1.3'

/** embind 调用统一返回 `{ ok, error?, ... }`。 */
interface WasmResult {
  ok?: boolean
  error?: string
  id?: number
  result?: string
  language?: string
  isAborted?: boolean
  [key: string]: unknown
}

/** Emscripten 的 MEMFS 里我们真正用到的那几个口子。 */
export interface EmscriptenFs {
  writeFile(path: string, data: Uint8Array): void
  unlink(path: string): void
  analyzePath(path: string): { exists: boolean }
}

/** 我们实际依赖的 Emscripten Module 形状（含 whisper 的 embind 入口）。 */
export interface WhisperWasmRuntime {
  FS: EmscriptenFs
  HEAPU8: Uint8Array
  /** 包自己打的标记：true 表示跑的是 pthread 构建。 */
  __whisperNodeWasmThreads?: boolean
  /** embind 的 async 函数：返回的是 Promise，必须 await。 */
  __wasm_init_whisper(
    modelPath: string,
    useGpu: boolean,
    useFlashAttn: boolean,
  ): Promise<WasmResult>
  /** embind 的 async 函数：返回的是 Promise，必须 await。 */
  __wasm_transcribe(
    id: number,
    pcm: Float32Array,
    options: Record<string, unknown>,
  ): Promise<WasmResult>
  /** 这个是同步的（包入口也没有 await 它）。 */
  __wasm_free_whisper(id: number): void
}

/**
 * 取 wasm 字节。Vite 的 `?url` 在 `base: './'` 下给的是相对**文档**的路径
 * （`./assets/whisper-node-<hash>.wasm`），本应用的页面就在 dist 根，所以交给
 * fetch 解析即可；这里显式用 `document.baseURI` 兜底。
 *
 * 这条路在真实渲染进程里实测过（`file://` 页面 + 本应用的 CSP）：
 * fetch 返回 200，`connect-src 'self'` 与 `WebAssembly.instantiate`
 * （由 `script-src 'unsafe-eval'` 放行）都没问题。
 */
async function fetchWasmBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const url =
    typeof document !== 'undefined'
      ? new URL(wasmAssetUrl, document.baseURI).href
      : wasmAssetUrl
  let response: Response
  try {
    response = await fetch(url)
  } catch (error: unknown) {
    throw new Error(
      t(
        'wasm 资源请求失败（{0}）：{1}。若页面是 file://，请确认 Electron 允许同源 file:// fetch；若配了 CSP，请确认 connect-src 放行 \'self\'。',
        url,
        describe(error),
      ),
    )
  }
  if (!response.ok) {
    throw new Error(t('wasm 资源返回 HTTP {0}（{1}）。', response.status, url))
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new Error(t('wasm 资源是空文件（{0}）。', url))
  }
  return new Uint8Array(buffer)
}

/** 整个渲染进程共用一份 wasm 实例：它是 512 MB 起的线性内存，开两份太浪费。 */
let runtimePromise: Promise<WhisperWasmRuntime> | null = null
let wasmBytesPromise: Promise<Uint8Array<ArrayBuffer>> | null = null

function bytes(): Promise<Uint8Array<ArrayBuffer>> {
  if (!wasmBytesPromise) {
    wasmBytesPromise = fetchWasmBytes().catch((error: unknown) => {
      wasmBytesPromise = null
      throw error
    })
  }
  return wasmBytesPromise
}

/** wasm 资源在打包产物里的位置，仅用于自检与日志。 */
export function wasmAssetHref(): string {
  return wasmAssetUrl
}

/**
 * 起一次 wasm 运行时（幂等）。重复调用返回同一个 Promise。
 */
export function ensureRuntime(): Promise<WhisperWasmRuntime> {
  if (!runtimePromise) runtimePromise = startRuntime()
  return runtimePromise
}

async function startRuntime(): Promise<WhisperWasmRuntime> {
  const wasm = await bytes()
  const module = (await createWhisperNodeModule({
    // 不走 Emscripten 的 locateFile+fetch，直接把已经拿到的字节编译掉。
    // 这样加载路径只有一条，出错也能给出中文原因。
    instantiateWasm(
      imports: WebAssembly.Imports,
      onSuccess: (
        instance: WebAssembly.Instance,
        _module: WebAssembly.Module,
      ) => void,
    ): WebAssembly.Exports {
      WebAssembly.instantiate(wasm, imports).then(
        (result) => onSuccess(result.instance, result.module),
        (error: unknown) => {
          // 这里抛不回 Emscripten 的 readyPromise，至少让它在控制台可见。
          console.error('[whisper] WASM 实例化失败', error)
        },
      )
      // Emscripten 期望同步返回 exports；空对象表示「稍后走回调」。
      return {}
    },
    print: () => {},
    printErr: () => {},
  })) as WhisperWasmRuntime

  if (module.__whisperNodeWasmThreads === true) {
    throw new Error(
      t(
        '加载到的是 whisper.cpp 的多线程 WASM 构建，本应用没有 SharedArrayBuffer，无法运行。请确认引入的是 wasm/whisper-node.wasm（单线程）而不是 wasm/whisper-node.threads.wasm。',
      ),
    )
  }
  if (
    typeof module.__wasm_init_whisper !== 'function' ||
    typeof module.__wasm_transcribe !== 'function' ||
    typeof module.__wasm_free_whisper !== 'function'
  ) {
    throw new Error(
      t(
        'WASM 运行时没有导出预期的 whisper 入口（__wasm_init_whisper / __wasm_transcribe / __wasm_free_whisper）。本模块针对 @fugood/node-whisper-wasm@{0} 编写，依赖被升级过的话需要同步调整。',
        EXPECTED_PACKAGE_VERSION,
      ),
    )
  }
  return module
}

/** 模型在 MEMFS 里的落地路径。每个引擎一个，互不覆盖。 */
export function modelFsPath(id: number): string {
  return '/whisper-model-' + id + '.bin'
}

/** 把模型字节写进 MEMFS，随后可以直接从里面加载，不必再走下载。 */
export function writeModel(
  runtime: WhisperWasmRuntime,
  path: string,
  modelBytes: Uint8Array,
): void {
  try {
    runtime.FS.writeFile(path, modelBytes)
  } catch (error: unknown) {
    throw new Error(t('模型写入 WASM 内存文件系统失败：{0}', describe(error)))
  }
}

/** 释放模型占的内存（MEMFS 的 unlink 会连底层数据一起放掉）。 */
export function removeModel(runtime: WhisperWasmRuntime, path: string): void {
  try {
    if (runtime.FS.analyzePath(path).exists) runtime.FS.unlink(path)
  } catch {
    // 释放失败不影响正确性，下一次写入会覆盖同一路径。
  }
}

/** 一个已加载模型在 wasm 侧的句柄。 */
export interface WhisperHandle {
  id: number
}

/**
 * 建一个 whisper 上下文。模型必须**已经**在 MEMFS 里。
 * 对应包入口里的 `initWhisper({ filePath, useGpu: false })`。
 */
export async function createContext(
  runtime: WhisperWasmRuntime,
  fsPath: string,
  /** 走 WebGPU：包里的 wasm 是否真的编译了这条后端，只有试了才知道（见 engine.ts） */
  useGpu = false,
): Promise<WhisperHandle> {
  const result = await runtime.__wasm_init_whisper(fsPath, useGpu, false)
  if (!result || result.ok === false || typeof result.id !== 'number') {
    throw new Error(t('whisper 上下文创建失败：{0}', result?.error || t('模型文件无法解析')))
  }
  return { id: result.id }
}

/** 跑一次转写。对应包入口里的 `ctx.transcribeData(pcm, options)`。 */
export async function transcribePcm(
  runtime: WhisperWasmRuntime,
  handle: WhisperHandle,
  pcm: Float32Array,
  language: string | null,
): Promise<string> {
  // 语言**一定要显式传**：wasm 那侧的默认值是 'en'（见 engine.ts 的 normalizeLanguage），
  // 缺省时给 'auto' 让它自己去判，而不是退回英文
  const options: Record<string, unknown> = { language: language || 'auto' }
  const result = await runtime.__wasm_transcribe(handle.id, pcm, options)
  if (!result || result.ok === false) {
    throw new Error(result?.error || t('whisper 推理没有返回结果'))
  }
  return typeof result.result === 'string' ? result.result : ''
}

/** 释放上下文。对应包入口里的 `ctx.release()`。 */
export function releaseContext(
  runtime: WhisperWasmRuntime,
  handle: WhisperHandle,
): void {
  runtime.__wasm_free_whisper(handle.id)
}

/** 把任意异常压成一句能读的中文尾巴。 */
export function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
