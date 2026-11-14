/**
 * PCM 采样 → 16 位单声道 WAV 的编码器（STT 专用）。
 *
 * 录音链路（src/lib/voice/session）送过来的是 16 kHz 单声道 Float32 采样，
 * 而 DeepSeek ASR 与 OpenAI 兼容的 /audio/transcriptions 都只收「16 位 PCM WAV」
 * 这一种通用形态——编码在这里做，一次 44 字节的 RIFF 头 + 逐样本 clamp 量化。
 * 旧本地推理时代这活儿由 sherpa 的音频归一化模块代劳，那段栈随本地推理退役了。
 */

/** 把一段 16 kHz 单声道 Float32 采样编码成 16 位 PCM WAV */
export function encodeWavFromFloat32(samples: Float32Array, sampleRate: number): Buffer {
  const pcm = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    // clamp 到 [-1, 1] 再量化：录音增益偶尔会顶到 1.2 之类，超界样本直接削平
    const v = Math.max(-1, Math.min(1, samples[i]))
    pcm.writeInt16LE(Math.round(v * 0x7fff), i * 2)
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // fmt 块长度
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // 单声道
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // 字节率 = rate × 2 字节
  header.writeUInt16LE(2, 32) // 块对齐
  header.writeUInt16LE(16, 34) // 位深
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}
