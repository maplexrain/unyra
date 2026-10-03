/**
 * 柱形频谱可视化的纯数学层（渲染在 SystemAudioWave，采集在 loopback）。
 *
 * 单独拆出来不为别的：这一层数学不碰 DOM，才能在 vitest 里钉住行为——频段
 * 分得对不对、值取没取对、峰值落不落得回来，都是肉眼验收不了的东西。
 */

/** 柱数：400px 宽、2px 缝时柱宽约 6px，疏密正好 */
export const BAR_COUNT = 50

/** 频段整形：字节频谱本身是 dB 刻度，再压一道 gamma，柱高分布更好看 */
export const GAMMA = 1.4

/** 频段下限（Hz）：再低只有嗡嗡的直流与电源噪声 */
const MIN_HZ = 30
/** 频段上限（Hz）：音乐能量几乎都在这以下 */
const MAX_HZ = 15000

/**
 * 把频点分给每一根柱：**对数分布**——低频柱窄（几个频点一根）、高频柱宽
 * （几十个频点一根），音乐能量的分布才是均匀铺开的。返回半开区间
 * [start, end)，柱与柱首尾相接不重叠；跳过 0 号频点（直流分量）。
 */
export function barRanges(
  sampleRate: number,
  binCount: number,
  barCount: number,
): Array<[number, number]> {
  const binHz = sampleRate / 2 / binCount
  const minBin = Math.max(1, MIN_HZ / binHz)
  const maxBin = Math.min(binCount - 1, MAX_HZ / binHz)
  const ratio = Math.pow(maxBin / minBin, 1 / barCount)

  const ranges: Array<[number, number]> = []
  let start = Math.max(1, Math.floor(minBin))
  for (let i = 0; i < barCount; i++) {
    let end = Math.floor(minBin * Math.pow(ratio, i + 1))
    // 低频段挤不下（对数步长小于一个频点）时至少认一个频点，柱间才不留空档
    if (end <= start) end = start + 1
    ranges.push([start, Math.min(end, binCount)])
    start = ranges[i][1]
  }
  return ranges
}

/**
 * 从一帧字节频谱（0..255，dB 整形）里给每根柱取值：段内取**峰值**而不是均值
 * （高频段几十个频点一平均就平掉了），再压一道 gamma。
 */
export function sampleBars(
  freq: Uint8Array,
  ranges: Array<[number, number]>,
  out: Float32Array,
): void {
  const n = Math.min(ranges.length, out.length)
  for (let i = 0; i < n; i++) {
    const [start, end] = ranges[i]
    let peak = 0
    for (let b = start; b < end && b < freq.length; b++) {
      if (freq[b] > peak) peak = freq[b]
    }
    out[i] = Math.pow(peak / 255, GAMMA)
  }
}

/**
 * 柱高的重力：**上升即时、下降缓慢**——频谱本身抖得厉害，直接画会乱闪；
 * 涨就一步到顶，跌按 fall 每帧线性回落（且不低于目标），就是经典音频
 * 可视化那副「跳上去、飘下来」的样子。
 */
export function applyGravity(shown: Float32Array, target: Float32Array, fall: number): void {
  for (let i = 0; i < shown.length; i++) {
    const t = target[i]
    shown[i] = t > shown[i] ? t : Math.max(t, shown[i] - fall)
  }
}
