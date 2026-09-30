/**
 * 「正在工作」的波浪条：4 条竖长方形，高度依次起伏。
 *
 * 用在两处等待最明显的地方——Agent loop 跑着的时候，以及教学文档还没落地、
 * 文档区一片空白的时候。它的作用不是装饰，是让用户相信「没卡住，在等 AI」。
 *
 * 动画在 motion.css（.moji-wave）：用 scaleY 而不是高度，避免每帧重排。
 * 这里只负责把序号铺成延迟，形成「一波接一波」的观感。
 */

/** 5 条：少而克制，仍能看出波峰从这头推到那头；再多就变成进度条了 */
const COUNT = 5

/** 相邻两条的相位差。波峰在 5 × 120ms 里推过这一行，接着下一波（周期见 motion.css，与文字高光同为 2.1s） */
const STEP_MS = 120

interface Props {
  /** 颜色跟着字号走（currentColor），这里一般只给文字色 */
  className?: string
}

export default function WaveBars({ className = '' }: Props) {
  return (
    <span className={`moji-wave ${className}`} aria-hidden="true">
      {Array.from({ length: COUNT }, (_, i) => (
        <i key={i} style={{ animationDelay: `${i * STEP_MS}ms` }} />
      ))}
    </span>
  )
}
