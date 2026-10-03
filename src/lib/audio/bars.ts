/**
 * 柱形频谱可视化的纯数学层（渲染在 SystemAudioWave，采集在 loopback）。
 *
 * 单独拆出来不为别的：这一层数学不碰 DOM，才能在 vitest 里钉住行为——频段
 * 分得对不对、值取没取对、峰值帽落不落得回来，都是肉眼验收不了的东西。
 *
 * 一帧的完整管线（每道工序一个纯函数）：
 * sampleBars（段内取峰）→ smoothBars（段间平滑消毛刺）→
 * applyGravity（柱身快涨慢落 + 峰值帽更慢地飘）→ addBreath（静音呼吸涟漪）。
 */

/** 目标柱距（柱宽 + 间隙，px）：宽度来了先按它数出柱数，余量再均摊回每根柱 */
export const BAR_PITCH = 7

/** 柱数的上下限：再窄也不少于 8 根（不然不成谱），再宽也不多于 96 根（没有意义） */
const MIN_BARS = 8
const MAX_BARS = 96

/** 柱数按宽度现算：264px 的侧栏底带 → 37 根；侧栏拖宽拖窄都跟着走 */
export function barCount(width: number): number {
  return Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor(width / BAR_PITCH)))
}

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
 * 段间平滑（一次三点盒滤波）：相邻柱互相带一带，消掉单柱独有、邻居没有的
 * 抖毛刺——真实频谱的能量本来就该连成片。原地做，端点不动。
 */
export function smoothBars(values: Float32Array): void {
  let left = values[0]
  for (let i = 1; i < values.length - 1; i++) {
    const cur = values[i]
    values[i] = left * 0.25 + cur * 0.5 + values[i + 1] * 0.25
    left = cur
  }
}

/**
 * 柱高与峰值帽的重力，都是**上升即时、下降缓慢**：
 * - 柱身按 barFall 回落——频谱本身抖得厉害，直接画会乱闪；
 * - 帽（每根柱的历史峰值）按 capFall 回落，**比柱身慢一截**——柱子落下之后
 *   帽还悬在上面，一眼就能看出刚才的峰有多高（Monstercat 的招牌细节）。
 * 两者都不跌穿目标。shown 与 caps 都是调用方持有的可变状态。
 */
export function applyGravity(
  shown: Float32Array,
  caps: Float32Array,
  target: Float32Array,
  barFall: number,
  capFall: number,
): void {
  for (let i = 0; i < shown.length; i++) {
    const t = target[i]
    shown[i] = t > shown[i] ? t : Math.max(t, shown[i] - barFall)
    caps[i] = t > caps[i] ? t : Math.max(t, caps[i] - capFall)
  }
}

/**
 * 静音呼吸：往柱高（0..1 域）上叠一道**慢速正弦涟漪**——无声时柱子不是一排
 * 死底座，而是缓缓起伏的波，整块区域「活着在听」（语音助手待机呼吸的同一招）。
 * 幅度只有几个像素，有声音时完全被柱子盖住，所以不需要门限切换，恒叠即可。
 * 值夹在 1 以内。
 */
export function addBreath(values: Float32Array, now: number, amp: number): void {
  for (let i = 0; i < values.length; i++) {
    // 0.0016 rad/ms ≈ 4s 一个起伏周期；0.55 rad/柱 → 全程约两个半波长，从左往右游
    values[i] = Math.min(1, values[i] + amp * (0.5 + 0.5 * Math.sin(now * 0.0016 - i * 0.55)))
  }
}
