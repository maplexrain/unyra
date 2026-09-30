import { useEffect, useRef, useState } from 'react'

/**
 * 折叠区的开合状态：`open` 是视觉上的开合，`shown` 决定内容**挂不挂在 DOM 上**。
 *
 * 为什么要分两个状态——收起的内容也参与排版。流式写作时思考文本每个 chunk 都在长，
 * 一个几十万字的隐藏文本节点会跟着每次 chunk 重排一遍，几十毫秒就这么烧掉
 * （见 preview.lastLineOf 的注释，那条教训就是为这种场景立的）。所以收起时不渲染，
 * 展开时才挂。
 *
 * 但「收起即卸载」会杀死收起动画：moji-fold 的高度过渡要内容还在场才播得出来。
 * 于是展开**立刻**挂载（toggle 里同步 setShown，与 1fr 同一帧提交，过渡从 0fr 起
 * 才有东西可展），收起**等过渡播完**（0.22s，见 styles/motion.css）再卸载。
 */
export function useFold(): { open: boolean; shown: boolean; toggle: () => void } {
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(false)
  const timer = useRef<number | null>(null)
  // 卸载时清掉还没播完的定时器：不然它会在组件死后触发一次无害但莫名的 setState
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (next) setShown(true)
    else timer.current = window.setTimeout(() => setShown(false), 240)
  }
  return { open, shown, toggle }
}
