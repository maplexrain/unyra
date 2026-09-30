/**
 * 语音引擎的 Worker 宿主：把 voice/whisper 的引擎搬到一个单独的线程里跑。
 *
 * 协议只有三条消息（见 engine.ts 的 ToWorker / FromWorker）：
 * load 送模型字节、run 送一段 PCM、dispose 收工。转写请求由调用方排队，
 * 这里只管「收到就做、做完回话」——whisper 的实例本身不是并发安全的。
 */

import { createWhisperEngine } from './whisper/engine'

interface LoadMsg { type: 'load'; model: ArrayBuffer; gpu?: boolean }
interface RunMsg { type: 'run'; id: number; pcm: Float32Array }
type ToWorker = LoadMsg | RunMsg | { type: 'dispose' }

const engine = createWhisperEngine()

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'load') {
    void (async () => {
      try {
        await engine.init(undefined, { gpu: msg.gpu === true })
        await engine.loadModel(new Uint8Array(msg.model))
        self.postMessage({ type: 'loaded' })
      } catch (err) {
        self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return
  }
  if (msg.type === 'run') {
    const id = msg.id
    void (async () => {
      try {
        const text = await engine.transcribe(msg.pcm)
        self.postMessage({ type: 'text', id, text })
      } catch (err) {
        self.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) })
      }
    })()
    return
  }
  engine.dispose()
}