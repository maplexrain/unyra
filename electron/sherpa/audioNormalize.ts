/**
 * 语音合成音频响度均衡与防爆音处理 (Speech Loudness Normalization & Anti-Click Limiter)
 *
 * 为什么需要做响度均衡：
 * 端侧神经网络 TTS 模型（如 VITS / MeloTTS / AISHELL-3）在按短句/分块推理时，
 * 由于音素时长、声调起伏以及说话人特征，每个句子生成的原生振幅差异极大：
 * 某些从句原生峰值仅有 0.2（RMS -25dB，极小声），而某些句子原生峰值达到 0.95（RMS -13dB，极大声）。
 * 若未经均衡直接分段播放，用户会明显感知到「每一段音量大小都不一样、忽大忽小」。
 *
 * 处理策略：
 * 1. 过滤静音段，精准计算有效语音的 RMS 能量；
 * 2. 对齐至标准语音播客响度目标（Target RMS = 0.14，约 -17 dBFS）；
 * 3. 动态软阈值限制器（Soft Limiter via tanh），防止数字削波失真；
 * 4. 首尾 5ms 毫秒级微淡入淡出（Micro Fade-in / Fade-out），消灭分段播放接缝处的直流偏置爆音与噼啪声。
 */

const TARGET_RMS = 0.14
const MIN_GAIN = 0.4
const MAX_GAIN = 3.5
const SILENCE_THRESHOLD = 0.005
const SOFT_LIMIT_THRESHOLD = 0.88

export function normalizeAudioSamples(samples: Float32Array): Float32Array {
  const len = samples.length
  if (len === 0) return samples

  // 1. 统计最大峰值与有效语音（排除静音）的能量
  let maxAbs = 0
  let sumSq = 0
  let activeCount = 0

  for (let i = 0; i < len; i++) {
    const abs = Math.abs(samples[i])
    if (abs > maxAbs) maxAbs = abs
    if (abs > SILENCE_THRESHOLD) {
      sumSq += abs * abs
      activeCount++
    }
  }

  // 若音频近乎全静音或峰值极小，原样返回避免放大微弱底噪
  if (maxAbs < 1e-4 || activeCount === 0) {
    return samples
  }

  const rms = Math.sqrt(sumSq / activeCount)
  let gain = TARGET_RMS / rms

  // 约束增益区间，避免过度压缩或过度拉升
  gain = Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain))

  // 峰值安全阈值：若放大后最高峰值超过 0.96，则相应压低增益防止破音
  if (maxAbs * gain > 0.96) {
    gain = 0.96 / maxAbs
  }

  const output = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let s = samples[i] * gain
    // 双曲正切平滑软限制器：超过 0.88 时做渐进压缩，确保绝不发生硬截断刺耳破音
    if (s > SOFT_LIMIT_THRESHOLD) {
      s = SOFT_LIMIT_THRESHOLD + (1 - SOFT_LIMIT_THRESHOLD) * Math.tanh((s - SOFT_LIMIT_THRESHOLD) / (1 - SOFT_LIMIT_THRESHOLD))
    } else if (s < -SOFT_LIMIT_THRESHOLD) {
      s = -SOFT_LIMIT_THRESHOLD + (-1 - (-SOFT_LIMIT_THRESHOLD)) * Math.tanh((s - (-SOFT_LIMIT_THRESHOLD)) / (-1 - (-SOFT_LIMIT_THRESHOLD)))
    }
    output[i] = s
  }

  // 2. 首尾微淡入淡出 (平滑接缝，消除跨分段播放时的瞬态 pop/click 声)
  const fadeSamples = Math.min(256, Math.floor(len / 4))
  for (let i = 0; i < fadeSamples; i++) {
    const factor = i / fadeSamples
    output[i] *= factor
    output[len - 1 - i] *= factor
  }

  return output
}
