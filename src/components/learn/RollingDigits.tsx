import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { changedDigits, digitSlots } from '../../lib/digitRoll'

/**
 * 会跳字的时间。
 *
 * 为什么不用 CSS 动画配 key：那样只能让**换掉的那个字符**自己动，而时间串里
 * 同一格换个数字（9 → 0）在 DOM 上看起来毫无分别；用 anime 直接对**没换的那一格**
 * 补一次位移，才读得出「它刚刚跳了一下」。
 *
 * 三个约定：
 * 1. 只动变了的那几位（见 lib/digitRoll）：一秒里通常只有个位那两格在动。
 * 2. 只改 transform 与 opacity：不触发布局，也不会把顶栏带着重排。
 * 3. 位用「从右数」的序号当 key 与 ref：时间串变宽（59:59 → 1:00:00）时，
 *    右边那些节点仍然是同几个节点，不会被整串重挂。
 *
 * 读屏：逐字的 span 全部 aria-hidden，真正读出来的是 sr-only 那一份完整文本。
 */
export default function RollingDigits({ text, className }: { text: string; className?: string }) {
  const nodes = useRef<Record<number, HTMLSpanElement | null>>({})
  /** 上一帧的文本：只用来算「哪几位变了」，不参与渲染（读它只在 effect 里） */
  const last = useRef(text)

  useEffect(() => {
    const prev = last.current
    last.current = text
    if (prev === text) return
    for (const fromEnd of changedDigits(prev, text)) {
      const el = nodes.current[fromEnd]
      if (!el) continue
      // 从下方浮上来落位：这就是「跳字」。起点只给 0.44em，免得跨出顶栏那条 h-8 的带子
      animate(el, { y: ['0.44em', '0em'], opacity: [0.25, 1], duration: 300, ease: 'out(3)' })
    }
  }, [text])

  return (
    // 不加 inline-flex：整串字仍然按普通行内文本排版（基线、行高与没动画时一模一样），
    // 只有每一位自己是 inline-block。sr-only 那一份是绝对定位的，不占位。
    <span className={'tabular-nums ' + (className ?? '')}>
      <span className="sr-only">{text}</span>
      {digitSlots(text).map(({ ch, fromEnd }) => (
        <span
          key={fromEnd}
          aria-hidden="true"
          ref={(el) => {
            if (el) nodes.current[fromEnd] = el
            else delete nodes.current[fromEnd]
          }}
          // whitespace-pre：时间串里的那个空格也得占住位置，不然「日期 时间」会挤在一起。
          // 不写 will-change：顶栏那颗钟有近二十位，每人一层合成层太贵；300ms 的位移不值得。
          className="inline-block whitespace-pre"
        >
          {ch}
        </span>
      ))}
    </span>
  )
}
