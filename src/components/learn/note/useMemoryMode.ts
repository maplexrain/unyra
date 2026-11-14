import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { loadMemoryMode, subscribeMemoryMode } from '../../../lib/memoryMode'
import { applyMemoryMasks, unwrapMemoryMasks } from '../../../lib/memoryMask'

/**
 * 记忆模式的**标记 effect**（教学文档的正文挂这只钩子，见 NodeNote）：
 *
 * 模式开着时，正文交给 `lib/memoryMask` 的纯 DOM 管线——把每个文本块用 Intl.Segmenter
 * 切成 2~4 词的词组片、按覆盖范围（percent）以「等距铺开 + 种子抖动」盖住其中若干片，
 * 遮罩本体是 CSS（.moji-mem-word：纸色底 + 文字透明，:hover 揭示原文）。这里只负责
 * 三件接线的事：什么时候跑、跑完把观察器挂回去、Agent 写作中挂起。
 *
 * 种子持久化：同一种子永远切同一段、盖同一批片，重开应用不打乱；「刷新随机分布」
 * 换种子重切重盖。
 */
export function useMemoryMode({
  bodyRef,
  docKey,
  suspended = false,
}: {
  bodyRef: RefObject<HTMLElement | null>
  /** 记忆键（lib/memoryMode 的 memoryDocKey）；undefined = 这份文档不支持（源码视图/笔记编辑态） */
  docKey?: string
  /** Agent 正在往这份文档里写：遮罩暂时挂起（挂着只会反复全量重切卡死主线程） */
  suspended?: boolean
}): void {
  const suspendedRef = useRef(suspended)
  const moRef = useRef<MutationObserver | null>(null)
  /** 晚绑定：观察器与订阅都经它调到最新一份 apply（react-compiler 的前向引用解法） */
  const applyRef = useRef<() => void>(() => {})

  const apply = useCallback(() => {
    // 先停观察再动 DOM：本次改动的回声不进观察器（否则 apply→mutation→apply 死循环，
    // 悬停中的遮罩还会被重建导致闪烁）
    moRef.current?.disconnect()
    const body = bodyRef.current
    if (!body) return
    // **现读现用**：状态永远从 localStorage 现取——slider 拉满的瞬间 apply 看到的就是 100
    const state = docKey ? loadMemoryMode(docKey) : { on: false, percent: 0, seed: 0 }
    body.classList.toggle('moji-memory-on', state.on)

    // 收拾上一次的标记 + 词级切片遮盖 + 代码块整块盖（纯 DOM 管线在 lib/memoryMask，
    // 自含拆旧、可单元直测）。挂起 / 关闭 / 范围为 0 的短路在这里做：管线只认 {percent, seed}
    if (state.on && state.percent > 0 && !suspendedRef.current) {
      applyMemoryMasks(body, state)
    } else {
      unwrapMemoryMasks(body)
    }

    // 重新挂上观察（apply 开头 disconnect 过：这里不挂，后续正文变化就没人看了）
    if (moRef.current) moRef.current.observe(body, { childList: true, subtree: true })
  }, [bodyRef, docKey])

  // 晚绑定：观察器与订阅永远调到最新一份 apply
  useEffect(() => {
    applyRef.current = apply
  })

  // 正文观察（一份观察器陪这份文档的正文一辈子）：内容变了 300ms 防抖重切
  //（Agent 逐字写作时别追每一条 mutation）；用户操作（slider/刷新/开关）不走这里，
  // 走下面订阅的**即时** apply——实时响应是需求口径。
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    let timer: number | undefined
    const mo = new MutationObserver(() => {
      if (timer !== undefined) return
      timer = window.setTimeout(() => {
        timer = undefined
        applyRef.current()
      }, 300)
    })
    moRef.current = mo
    mo.observe(body, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      moRef.current = null
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [bodyRef])

  // 文档键换了（换了一份文档）：立即按新状态重标；用户的每次操作（slider 拖动 /
  // 刷新分布 / 开关）也**即时**重标——实时响应是需求口径
  useEffect(() => {
    applyRef.current()
    if (!docKey) return
    return subscribeMemoryMode((key) => {
      if (key === docKey) applyRef.current()
    })
  }, [docKey])

  // 挂起状态翻转（Agent 开始/结束写作）：立即还原 / 立即把遮罩带回来
  useEffect(() => {
    suspendedRef.current = suspended
    applyRef.current()
  }, [suspended])
}
