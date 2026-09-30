/**
 * 有效阅读的采集器：把「这份文档真的被人读着」变成 reading 的增量。
 *
 * 为什么挂在 NodeNote 上而不是写在 store 里：判定「有效」要看的东西全在界面这一层——
 * 滚动容器、窗口焦点、页签主位、agent 是否正在流式写这份文档。store 只该收到结论。
 *
 * 四层节奏（决定了这个功能会不会拖慢应用、以及崩了会丢多少）：
 * - **1 秒心跳**：内存里累加，不碰 store、不触发渲染；
 * - **1 秒旁路**：把「还没确认落盘的那一段」写进一个小文件（几百字节，见 learn/readingJournal），
 *   进程被强杀 / 断电时下次启动折回来。没有它，最后那一段（最多 30 秒）只在内存里；
 * - **30 秒结算**：把增量交给上层（上层用 patchQuiet 写盘，不重渲染）；
 * - **离开即结算**：切文档 / 切节点 / 关窗时补一次，最后那一分钟不丢。
 *
 * 什么时候才计时（用户定的规矩）：
 * - **要有阅读证据**：最近一次交互发生在**文档区里**（滚动、点正文、按键、选中），
 *   并且离现在不到 IDLE_MS。切回来、在对话栏打字、点侧栏——都算「没有证据」，表停着；
 * - **打开 / 切到这份文档、把文档切回主位**：给 RESUME_GRACE_MS 宽限。这三个动作是
 *   明确的选择，不必先交互；但宽限里没有一次交互就停——回来不等于在读；
 * - **文档不在中间主位**（导师栏占着主位）：不算阅读，窄栏里跟读的时间直接丢。
 *
 * 停表而不是扣表：失焦、最小化、切页签、AI 正在写、没证据——这些时间**不计入**有效时长。
 * 但它们的性质不同（见 learn/reading 的 BreakKind）：只有「真的离开」算被打断
 * （fragmentation），静默是中性事实（多半是在想），「没证据」连中性事实都不算，
 * 它只把「连续阅读」在那一段切开（见 learn/attention 的文件头）。
 *
 * 这个文件负责什么：hook 本体（把采集器接到 React 上）与对外出口——采集器本体在
 * tracker/ReadingTracker.ts，节段量测在 tracker/sections.ts，事件接线在 tracker/heartbeat.ts；
 * 只搬家，导出与行为都不变。
 */
import { useCallback, useEffect, useRef } from 'react'

import type { MarkKind, ReadingDelta } from './reading'
import { ReadingTracker } from './tracker/ReadingTracker'
import { bindHeartbeat } from './tracker/heartbeat'

export interface ReadingTrackerOpts {
  nodeId: string
  /**
   * 这个节点属于哪个目标。阅读账按目标分开（见 learn/reading 的 ReadingBook），
   * 结算与脉搏都要带上它——否则那一段阅读不知道该记到谁头上。
   */
  goalId: string
  /** 记录里的文档名（见 readingDocKey） */
  doc: string
  /** 正文字符数（去掉空白）：估算覆盖与 pace */
  words: number
  /** 取正文根与滚动容器（函数而不是元素：渲染期不能读 ref，见 NodeNote 的调用处） */
  body: () => HTMLElement | null
  scroll: () => HTMLElement | null
  /** 正文内容：变了要重新量几何（agent 边写边改） */
  content: string
  /** 这份文档此刻是不是「前台」的（考试窗口开着时为 false） */
  active: boolean
  /** agent 正在写这份文档 */
  busy: boolean
  /**
   * 文档栏是不是在中间主位（导师栏占着主位时为 false）。
   *
   * 不在主位那段时间一律不算阅读——窄栏里「跟着看」的时间可以丢（用户定的）。
   * 缺省按 true：没有这个概念的调用方（探针、临时挂载点）不受影响。
   */
  mainPane?: boolean
  /**
   * 这份文档的时长要不要记账。**笔记不计**（用户定的）：笔记是动手写的地方，
   * 不是读的地方——在笔记里改半小时被算成「有效阅读」，那张阅读账就灌水了。
   * false 时连采集器都不建：不建，就没有半毫秒会流进阅读账（见下面的挂载 effect）。
   */
  count?: boolean
  /** 今天这个标签页有没有阅读记录：没有就要先过 20 秒 + 交互的门槛（见 learn/reading） */
  knownToday: () => boolean
  onDelta: (delta: ReadingDelta) => void
}

/**
 * 把采集器接到 React 上；返回几个可以手动调的动作。
 *
 * 注意会话身份只跟「节点 + 文档」有关：正文变化只重新量几何，**不换 sessionId**——
 * 否则 agent 每写一段，一场阅读就被拆成十几段，注意力那边再也算不出连续时长。
 */
export function useReadingTracker(opts: ReadingTrackerOpts): { mark: (kind: MarkKind) => void } {
  const tracker = useRef<ReadingTracker | null>(null)
  const live = useRef(opts)

  // 每次渲染后同步最新 props（不在渲染期写 ref：那是 React 编译器明令禁止的）
  useEffect(() => {
    live.current = opts
  })

  useEffect(() => {
    // 不记账的文档（笔记）连采集器都不建：没有实例，就没有任何一拍能累出时长来
    if (opts.count === false) return
    const t = new ReadingTracker({
      nodeId: opts.nodeId,
      goalId: opts.goalId,
      doc: opts.doc,
      body: () => live.current.body(),
      scroll: () => live.current.scroll(),
      knownToday: () => live.current.knownToday(),
      onDelta: (delta) => live.current.onDelta(delta),
    })
    tracker.current = t
    const unbind = bindHeartbeat(t, live)
    return () => {
      unbind()
      tracker.current = null
    }
  }, [opts.nodeId, opts.goalId, opts.doc, opts.count])

  // 正文变了：重新量几何（新章节要登记、字数要跟着更新）。
  // 容器元素不进依赖：它是 ref，首次挂载时还是 null，而 beat 的第一拍会补量一次。
  useEffect(() => {
    tracker.current?.setWords(opts.words)
    tracker.current?.measure()
  }, [opts.content, opts.words])

  /*
   * 这份文档此刻处在什么状态：能读 → 给一段宽限；不能读 → 停表。判定全在 setReadable 里
   * （三个开关一起交进去，mainOk 只有那一个地方维护——分两处写就会漏掉「抢过主位又还回来」）。
   */
  useEffect(() => {
    tracker.current?.setReadable({
      main: opts.mainPane !== false,
      active: opts.active,
      busy: opts.busy,
    })
  }, [opts.active, opts.busy, opts.mainPane])

  const mark = useCallback((kind: MarkKind) => tracker.current?.mark(kind), [])
  return { mark }
}

// 采集器本体在 tracker/ 下：原样转出，调用方（NodeNote、tests/readingGate）零改动。
export { ReadingTracker } from './tracker/ReadingTracker'
