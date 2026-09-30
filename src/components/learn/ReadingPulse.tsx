import { pulseFrame, useReadingPulse } from '../../lib/readingPulse'

/**
 * 有效阅读的进度条：**文档区最左边那一条 2px**。
 *
 * 刻度是六十进制的——一分钟一格，一格一种颜色；新的一分钟从**上**长出来，
 * 把上一分钟的颜色盖掉，十格一轮回（所以十分钟看得出一圈）。
 * 它回答的是「这一场我到底读进去多久了」：停表（失焦、切走、没在文档区交互、
 * 导师栏占了主位、AI 在写）时它会暗下去但停住不动——那正是「有效」的意思。
 *
 * 三条刻意的克制（需求里那句「不能做得太扎眼」）：
 * 1. 只有 2px 宽，没有圆角、没有边框、没有文字，不占任何可感知的宽度；
 * 2. 颜色低饱和、且底下那一格只按三成透明度垫着；
 * 3. 一场阅读刚开始（还没满 1 秒有效时间）时什么都不画——不留一条空轨道在那儿等。
 *
 * 绝对定位贴着文档区左沿：它不该参与那一列的排版（多一条 2px 的轨道就会挤动正文）。
 * 它自己订阅脉搏（见 lib/readingPulse），所以每秒动的只有这一条，正文不会被带着重渲染。
 */
export default function ReadingPulse() {
  const pulse = useReadingPulse()
  const frame = pulseFrame(pulse.activeMs)
  if (!frame) return null

  return (
    <div
      className="no-print pointer-events-none absolute inset-y-0 left-0 z-10 w-[2px] overflow-hidden"
      aria-hidden="true"
    >
      {/* 底：上一条颜色垫满，新的一格从上往下把它盖掉——「覆盖」这件事要看得见 */}
      <div className="absolute inset-x-0 top-0 h-full bg-line/40" />
      {frame.previous && (
        <div
          className="absolute inset-x-0 top-0 h-full"
          style={{ background: frame.previous, opacity: 0.3 }}
        />
      )}
      <div
        className="absolute inset-x-0 top-0 transition-[height] duration-300 ease-linear"
        style={{
          height: (frame.fraction * 100).toFixed(2) + '%',
          background: frame.color,
          // 停表时暗下去：进度条停住不动已经说明了一半，颜色再收一档才不刺眼
          opacity: pulse.paused ? 0.28 : 0.72,
        }}
      />
    </div>
  )
}
