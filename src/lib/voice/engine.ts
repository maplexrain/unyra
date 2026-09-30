/**
 * 语音引擎的取用口：默认跑在一个 Worker 里。
 *
 * 为什么必须离开主线程：whisper 的解码是纯 CPU 的重活（base q5_1 单线程解 5 秒音频
 * 要好几秒），放在主线程会把整个界面卡住——转写还没出来，界面先僵了。
 * Worker 里跑，主线程只管画那个「正在听」的小条。
 *
 * 引擎本体在 voice/whisper/（whisper.cpp 编译出的 WASM），这一层只负责：
 * 建 worker、把模型字节送进去、把转写请求排好队、以及在 worker 起不来时退回主线程。
 * 退回主线程是最后一手：界面会卡，但功能还在，总比整块功能直接不可用强。
 */
import { t } from '../../i18n'
import { createWhisperEngine, type WhisperEngine } from './whisper/engine'

export interface VoiceEngine {
  /** 把模型交给引擎（只做一次；重复调用直接返回）。opts.gpu：试 WebGPU 后端 */
  load(bytes: Uint8Array, opts?: { gpu?: boolean }): Promise<void>
  /** 转写一段 16 kHz 单声道 PCM，返回文本（空音频返回空串） */
  transcribe(pcm: Float32Array): Promise<string>
  ready(): boolean
  /** 释放 worker / 引擎 */
  dispose(): void
  /** 现在跑在哪：worker 还是主线程（设置面板里显示，出问题时好判断） */
  where(): 'worker' | 'main'
}

/** 引擎消息协议（见 engine.worker.ts） */
interface LoadMsg { type: 'load'; model: ArrayBuffer; gpu?: boolean }
interface RunMsg { type: 'run'; id: number; pcm: Float32Array }
type FromWorker =
  | { type: 'loaded' }
  | { type: 'text'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

/* ---------- worker 版 ---------- */

class WorkerEngine implements VoiceEngine {
  private worker: Worker | null = null
  private loaded: Promise<void> | null = null
  private seq = 0
  /** 一次只跑一个：whisper 的实例不是并发安全的，而且并发也没有意义（CPU 就那么多） */
  private queue: Promise<unknown> = Promise.resolve()

  where(): 'worker' {
    return 'worker'
  }

  private ensure(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker
    return worker
  }

  load(bytes: Uint8Array, opts?: { gpu?: boolean }): Promise<void> {
    if (this.loaded) return this.loaded
    this.loaded = new Promise<void>((resolve, reject) => {
      const worker = this.ensure()
      const onMessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data
        if (msg.type === 'loaded') {
          worker.removeEventListener('message', onMessage)
          resolve()
        } else if (msg.type === 'error' && msg.id === undefined) {
          worker.removeEventListener('message', onMessage)
          reject(new Error(msg.message))
        }
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', (e) => reject(new Error(t('语音 worker 启动失败：{0}', e.message))))
      // 模型字节**转移**过去（不是复制）：57 MB 复制一份要多花几十毫秒和一份内存，
      // 转移之后主线程这一份就废了——反正引擎只需要它一次。
      // slice 是为了拿到一个「整整一块」的 ArrayBuffer：字节可能只是更大缓冲区里的一个视图，
      // 而转移的必须是整个 buffer
      const buf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
      worker.postMessage({ type: 'load', model: buf, gpu: opts?.gpu === true } satisfies LoadMsg, [buf])
    })
    // 失败要能重来：WebGPU 起不来时调用方会用同一份引擎换 CPU 再试一次，
    // 这里若把 rejected 的 promise 留着，第二次 load 直接返回那个失败结果（引擎就钉死了）
    this.loaded = this.loaded.catch((err: unknown) => {
      this.loaded = null
      throw err
    })
    return this.loaded
  }

  transcribe(pcm: Float32Array): Promise<string> {
    const run = this.queue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          const worker = this.ensure()
          const id = ++this.seq
          const onMessage = (e: MessageEvent<FromWorker>) => {
            const msg = e.data
            if (msg.type === 'text' && msg.id === id) {
              worker.removeEventListener('message', onMessage)
              resolve(msg.text)
            } else if (msg.type === 'error' && msg.id === id) {
              worker.removeEventListener('message', onMessage)
              reject(new Error(msg.message))
            }
          }
          worker.addEventListener('message', onMessage)
          const copy = new Float32Array(pcm)
          worker.postMessage({ type: 'run', id, pcm: copy } satisfies RunMsg, [copy.buffer])
        }),
    )
    // 队列不因为某一次失败就断掉：失败的那次照常往外抛，后面的接着排
    this.queue = run.catch(() => undefined)
    return run
  }

  ready(): boolean {
    return this.loaded !== null
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.loaded = null
  }
}

/* ---------- 主线程版（worker 起不来时的兜底） ---------- */

class InlineEngine implements VoiceEngine {
  private engine: WhisperEngine | null = null
  private queue: Promise<unknown> = Promise.resolve()

  where(): 'main' {
    return 'main'
  }

  async load(bytes: Uint8Array, opts?: { gpu?: boolean }): Promise<void> {
    if (!this.engine) this.engine = createWhisperEngine()
    await this.engine.init(undefined, { gpu: opts?.gpu === true })
    await this.engine.loadModel(bytes)
  }

  transcribe(pcm: Float32Array): Promise<string> {
    const run = this.queue.then(() => {
      if (!this.engine) throw new Error(t('语音引擎还没准备好'))
      return this.engine.transcribe(pcm)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  ready(): boolean {
    return this.engine?.isReady() === true
  }

  dispose(): void {
    this.engine?.dispose()
    this.engine = null
  }
}

let current: VoiceEngine | null = null

/**
 * 拿引擎（单例）。第一次调用时建 worker；建不出来就退回主线程。
 * 不做「worker 挂了自动换主线程」的迁移：模型已经加载在那一边了，重来一次的代价
 * 远大于收益，宁可第一次就选对。
 */
export function acquireEngine(): VoiceEngine {
  if (current) return current
  if (typeof Worker === 'undefined') {
    current = new InlineEngine()
    return current
  }
  try {
    // worker 是懒建的（第一次 load 时才真的 new 出来）：这里只做「能不能建」的判断，
    // 真去建一个空的会留下一个永远加载不到模型的实例（load 有「只加载一次」的记忆）
    const probe = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    probe.terminate()
    current = new WorkerEngine()
  } catch {
    current = new InlineEngine()
  }
  return current
}

/** 释放引擎（换模型、退出前用） */
export function releaseEngine(): void {
  current?.dispose()
  current = null
}