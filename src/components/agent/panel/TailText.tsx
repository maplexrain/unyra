/**
 * 单行尾巴文本：文本超出可用宽度时，**固定左边界、显示末尾**。
 *
 * 普通 `truncate` 会裁掉末尾，流式输出里用户看到的一直是开头，等于信息停在旧位置。
 * 这里量出 overflow 后把内层整体左移，末尾正好落在容器左边界，新字继续往左推——
 * 视觉上就是「一行字从左边持续滚出当前行最后几个字」。
 */
import { useLayoutEffect, useRef, useState } from 'react'

export function TailText({
  text,
  className = '',
  title,
}: {
  text: string
  className?: string
  title?: string
}) {
  const outerRef = useRef<HTMLSpanElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const measure = () => {
      const overflow = inner.scrollWidth - outer.clientWidth
      setShift(overflow > 0 ? -overflow : 0)
    }
    measure()

    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    ro.observe(inner)
    return () => ro.disconnect()
  }, [text])

  return (
    <span
      ref={outerRef}
      data-work-inline-tail="true"
      data-tail-shift={shift}
      title={title ?? text}
      className={'block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left ' + className}
    >
      <span
        ref={innerRef}
        className="inline-block max-w-none will-change-transform"
        style={shift ? { transform: `translateX(${shift}px)` } : undefined}
      >
        {text}
      </span>
    </span>
  )
}
