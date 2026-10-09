/**
 * sherpa-onnx-node 的最小类型声明。
 *
 * 那个包只有 JSDoc（types.js），没有 .d.ts；主进程里只用到 OfflineRecognizer 这一小块。
 * 声明**只写真正用到的成员**：写全了没人维护，写少了编译期就会提醒。
 */
declare module 'sherpa-onnx-node' {
  export class OfflineRecognizer {
    constructor(config: Record<string, unknown>)
    createStream(hotwords?: string): {
      acceptWaveform(obj: { samples: Float32Array; sampleRate: number }): void
    }
    decode(stream: unknown): void
    getResult(stream: unknown): { text?: string; [key: string]: unknown }
  }
  export const version: string
  export const onnxruntimeVersion: string
  export function readWave(filename: string): { samples: Float32Array; sampleRate: number }
}
