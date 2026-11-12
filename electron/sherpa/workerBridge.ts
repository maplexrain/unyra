/**
 * Sherpa-ONNX 离线推理后台工作线程桥接器 (workerBridge)。
 *
 * 为什么需要工作线程：
 * 1. 无论是 SenseVoiceSmall 的语音识别（rec.decode）还是 VITS 的语音合成（instance.generate），
 *    都是原生的 C++ 密集运算；
 * 2. 如果直接在 Electron 主线程同步执行，会霸占 Node.js 事件循环几百毫秒甚至数秒，
 *    导致渲染进程的所有 IPC 响应挂起、UI 掉帧甚至窗口无响应；
 * 3. 将推理搬入独立的 Worker 线程，主线程事件循环保持 0 毫秒冻结，渲染进程丝滑不卡顿。
 */

import { Worker } from 'node:worker_threads'

interface AsrJobRequest {
  modelPath: string
  tokensPath: string
  language: string
  gpu: boolean
  sampleRate: number
  samples: Float32Array
}

interface TtsJobRequest {
  modelPath: string
  lexiconPath: string
  tokensPath: string
  ruleFsts?: string
  text: string
  sid: number
  speed: number
}

interface PendingJob {
  resolve: (val: any) => void
  reject: (err: any) => void
  timer: NodeJS.Timeout
}

let workerInstance: Worker | null = null
let nextJobId = 1
const pendingJobs = new Map<number, PendingJob>()

/**
 * 内联 Worker 代码：
 * 采用 eval 方式启动，避免打包成 asar 归档后外部 worker 脚本路径丢失的问题。
 */
const WORKER_SCRIPT = `
  const { parentPort } = require('node:worker_threads');
  let sherpa = null;
  let cachedRecognizer = null;
  let cachedRecognizerKey = '';
  const cachedTtsInstances = new Map();

  function getSherpa() {
    if (sherpa) return sherpa;
    const mod = require('sherpa-onnx-node');
    sherpa = mod.OfflineRecognizer ? mod : (mod.default || mod);
    return sherpa;
  }

  parentPort.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    const { id, type, payload } = msg;

    if (type === 'reset') {
      if (payload?.kind === 'asr') {
        cachedRecognizer = null;
        cachedRecognizerKey = '';
      } else if (payload?.kind === 'tts') {
        if (payload?.id) cachedTtsInstances.delete(payload.id);
        else cachedTtsInstances.clear();
      }
      return;
    }

    try {
      const s = getSherpa();

      if (type === 'asr') {
        const { modelPath, tokensPath, language, gpu, sampleRate, samples } = payload;
        const key = modelPath + '|' + language + '|' + (gpu ? 'gpu' : 'cpu');

        if (!cachedRecognizer || cachedRecognizerKey !== key) {
          const OfflineRecognizer = s.OfflineRecognizer;
          cachedRecognizer = new OfflineRecognizer({
            featConfig: { sampleRate: 16000, featureDim: 80 },
            modelConfig: {
              senseVoice: { model: modelPath, language, useInverseTextNormalization: 1 },
              tokens: tokensPath,
              numThreads: 2,
              provider: gpu
                ? (process.platform === 'darwin' ? 'coreml' : (process.platform === 'win32' ? 'directml' : 'cpu'))
                : 'cpu',
              debug: false,
            },
          });
          cachedRecognizerKey = key;
        }

        const stream = cachedRecognizer.createStream();
        stream.acceptWaveform({ sampleRate, samples });
        cachedRecognizer.decode(stream);
        const result = cachedRecognizer.getResult(stream);
        const text = (result?.text ?? '').trim();

        parentPort.postMessage({ id, ok: true, text });
      } else if (type === 'tts') {
        const { modelPath, lexiconPath, tokensPath, ruleFsts, text, sid, speed, instanceKey } = payload;
        let tts = cachedTtsInstances.get(instanceKey);

        if (!tts) {
          const OfflineTts = s.OfflineTts;
          const config = {
            model: {
              vits: {
                model: modelPath,
                lexicon: lexiconPath,
                tokens: tokensPath,
              },
              numThreads: 2,
              debug: false,
            },
          };
          if (ruleFsts) {
            config.ruleFsts = ruleFsts;
          }
          tts = new OfflineTts(config);
          cachedTtsInstances.set(instanceKey, tts);
        }

        const res = tts.generate({
          text,
          sid: sid || 0,
          speed: speed || 1.0,
          enableExternalBuffer: false,
        });

        if (!res || !res.samples || res.samples.length === 0) {
          throw new Error('离线模型未生成有效音频采样');
        }

        parentPort.postMessage({
          id,
          ok: true,
          samples: res.samples,
          sampleRate: res.sampleRate,
        });
      }
    } catch (err) {
      parentPort.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  });
`

function ensureWorker(): Worker {
  if (workerInstance) return workerInstance

  const w = new Worker(WORKER_SCRIPT, { eval: true })

  w.on('message', (msg: any) => {
    if (!msg || typeof msg !== 'object' || !msg.id) return
    const job = pendingJobs.get(msg.id)
    if (!job) return

    clearTimeout(job.timer)
    pendingJobs.delete(msg.id)

    if (msg.ok) {
      job.resolve(msg)
    } else {
      job.reject(new Error(msg.error || '推理失败'))
    }
  })

  w.on('error', (err) => {
    console.error('[SherpaWorker] 工作线程发生错误：', err)
    // 唤醒所有排队中的任务并标记失败
    for (const job of pendingJobs.values()) {
      clearTimeout(job.timer)
      job.reject(err)
    }
    pendingJobs.clear()
    workerInstance = null
  })

  w.on('exit', (code) => {
    if (code !== 0) {
      console.warn(`[SherpaWorker] 工作线程退出，退出码：${code}`)
    }
    workerInstance = null
  })

  workerInstance = w
  return w
}

/** 在后台工作线程中执行 ASR 语音识别 */
export async function runAsrInWorker(req: AsrJobRequest, timeoutMs = 60_000): Promise<{ text: string }> {
  const w = ensureWorker()
  const id = nextJobId++

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingJobs.delete(id)
      reject(new Error(`语音识别超时 (${timeoutMs}ms)`))
    }, timeoutMs)

    pendingJobs.set(id, { resolve, reject, timer })
    w.postMessage({ id, type: 'asr', payload: req })
  })
}

/** 在后台工作线程中执行 TTS 语音合成 */
export async function runTtsInWorker(
  req: TtsJobRequest & { instanceKey: string },
  timeoutMs = 60_000,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  const w = ensureWorker()
  const id = nextJobId++

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingJobs.delete(id)
      reject(new Error(`语音合成超时 (${timeoutMs}ms)`))
    }, timeoutMs)

    pendingJobs.set(id, { resolve, reject, timer })
    w.postMessage({ id, type: 'tts', payload: req })
  })
}

/** 重置对应类型的缓存实例（如删除模型后清理） */
export function resetWorkerModel(kind: 'asr' | 'tts', id?: string): void {
  if (!workerInstance) return
  workerInstance.postMessage({ type: 'reset', payload: { kind, id } })
}

/** 销毁工作线程 */
export function terminateSherpaWorker(): void {
  if (workerInstance) {
    for (const job of pendingJobs.values()) {
      clearTimeout(job.timer)
      job.reject(new Error('工作线程被终止'))
    }
    pendingJobs.clear()
    workerInstance.terminate().catch(() => {})
    workerInstance = null
  }
}
