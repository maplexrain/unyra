/**
 * 这个文件负责什么：把「引文高亮」的登记口接上——点对话气泡里的选段时，回到文档中把对应
 * 文字闪一下（见 lib/quoteFocus）。登记的是这一份正文，所以正文一换就要重新登记。
 */
import { useEffect, type RefObject } from 'react'
import { flashQuote, setQuoteFocusHandler } from '../../../lib/quoteFocus'

/** 闪的是正文根节点里的字，定位靠源文内容（区间从引文里带过来） */
export function useQuoteHighlight({
  bodyRef,
  content,
  html,
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  content: string
  html: string
}) {
  // 注册引文高亮：点击对话气泡里的选段时，回到文档中把对应文字闪一下。
  // 依赖 html，重渲染后（DOM 已更新）重新登记，拿到的是最新的正文。
  useEffect(() => {
    setQuoteFocusHandler((q) => {
      const body = bodyRef.current
      if (body) flashQuote(body, content, q)
    })
    return () => setQuoteFocusHandler(null)
    // content 与 html 同源（html 由它渲染而来）：按源文区间定位要拿到它
  }, [html, content, bodyRef])
}
