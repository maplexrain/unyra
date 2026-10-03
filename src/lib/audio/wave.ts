/**
 * 波浪可视化的纯数学层（渲染在 SystemAudioWave，采集在 loopback）。
 *
 * 单独拆出来不为别的：这一层数学不碰 DOM，才能在 vitest 里钉住行为——取点
 * 铺不铺满、尖刺摊不摊给邻居、静音之后增益爬不爬回来，都是肉眼验收不了的东西。
 */

/** 波浪横向取多少个点：400px 宽度上 160 个点，间距 2.5px，描出来已是顺滑曲线 */
export const WAVE_POINTS = 160

/**
 * 把一段时域采样（-1..1）取成 count 个波形点，写入 ys：
 * 1. **均匀取点**（最近邻）：分析窗两千个采样摊到一百多个点上；
 * 2. **空间平滑**（一次三点盒滤波）：相邻点互相带一带，描线少毛刺；
 * 3. **时间平滑**：与上一帧按 follow 做 lerp——波浪是滑过去的，不是跳出来的。
 *
 * prev 传上一帧的 ys（长度一致才生效），首帧传 null。
 */
export function sampleWave(
  samples: Float32Array,
  ys: Float32Array,
  prev: Float32Array | null,
  follow: number,
): void {
  const count = ys.length
  if (count < 2 || samples.length < 2) {
    ys.fill(0)
    return
  }
  for (let i = 0; i < count; i++) {
    ys[i] = samples[Math.round((i * (samples.length - 1)) / (count - 1))]
  }
  // 空间平滑原地做：left 暂存左邻的旧值，右邻还没被改过，直接读
  let left = ys[0]
  for (let i = 1; i < count - 1; i++) {
    const cur = ys[i]
    ys[i] = left * 0.25 + cur * 0.5 + ys[i + 1] * 0.25
    left = cur
  }
  if (prev && prev.length === count) {
    for (let i = 0; i < count; i++) ys[i] = prev[i] + (ys[i] - prev[i]) * follow
  }
}

/**
 * 自适应增益：把「最近的峰值」抬到画布半高的 92%。峰值**瞬时抬升、缓慢回落**
 * （fade 是每帧的保留系数）——音乐渐弱时波浪跟着缩，停了之后又慢慢舒展开，
 * 不会一直趴成一条线。增益 clamp 在 0.9..4：大响度不削顶，底噪也放不满屏。
 *
 * peak 是调用方持有的可变状态（组件里一个对象），跨帧记住上一次的峰值。
 */
export function autoGain(peak: { value: number }, samples: Float32Array, fade: number): number {
  let max = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > max) max = a
  }
  peak.value = Math.max(peak.value * fade, max)
  const gain = 0.92 / Math.max(0.25, peak.value)
  return Math.min(4, Math.max(0.9, gain))
}
