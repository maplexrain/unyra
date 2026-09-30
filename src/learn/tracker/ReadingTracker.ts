/**
 * 这个文件负责什么：阅读采集器本体（ReadingTracker）——一场阅读的开合、心跳与停表判定、
 * 每一拍记到哪一节、结算与旁路落盘。节段的几何与增量清点在 tracker/sections.ts，
 * 事件接线在 tracker/heartbeat.ts，「四层节奏 / 什么时候才计时」的说明在 useReadingTracker.ts。
 */
import { publishReadingPulse } from '../../lib/readingPulse'
import { MAX_CHUNKS, type JournalChunk } from '../readingJournal'
import { rememberJournalEntry } from '../store'
import {
  BEAT_MS,
  IDLE_MS,
  RESUME_GRACE_MS,
  SETTLE_MS,
  studyDayOf,
  warmupDone,
  type BreakKind,
  type MarkKind,
  type MinuteTick,
  type ReadingBreak,
  type ReadingDelta,
} from '../reading'
import { advanceSent, liveSections, measureSections, type Layout, type SectionState } from './sections'

/**
 * 「这会儿没法读」的停表原因；'write' 是 agent 正在写这份文档（看字冒出来不是阅读）。
 * 「能读、但看不出在读」（静默超时、切回来还没碰文档、在别处打字）不走这里，走 waiting。
 */
type PauseKind = Extract<BreakKind, 'blur' | 'hidden' | 'tab' | 'write'>

interface TrackerOpts {
  nodeId: string
  /** 这个节点属于哪个目标（阅读账按目标分开，见 learn/reading 的 ReadingBook） */
  goalId: string
  doc: string
  /** 取正文根与滚动容器：给的是**函数**而不是元素，因为渲染期不能读 ref */
  body: () => HTMLElement | null
  scroll: () => HTMLElement | null
  /** 今天这个标签页有没有阅读记录（门槛的一半，见 learn/reading 的 readToday） */
  knownToday: () => boolean
  onDelta: (delta: ReadingDelta) => void
}

const EMPTY_TICK = (): MinuteTick => ({ ms: 0, chars: 0, marks: 0, gaps: 0 })

/**
 * 采集器本体。导出只为一件事：让用例能直接驱动它（打开 / 切走 / 打字 / 切回主位
 * 这些时序在界面上点不出来，而它的每个方法都收 now，可以拿假时钟一秒一秒地推）。
 * 见 tests/readingGate.test.ts。
 */
export class ReadingTracker {
  private sessionId = crypto.randomUUID()
  private minuteStart = Date.now()
  private lastBeat = Date.now()
  /**
   * 当前这段「阅读证据」到什么时候为止。
   *
   * 证据有两种来路，宽度不一样（见文件头「什么时候才计时」）：
   * - 文档区里的一次交互 → now + IDLE_MS（读到一半停手 60 秒才停表，静读照算）；
   * - 打开 / 切到这份文档、把文档切回主位、宽限重启 → now + RESUME_GRACE_MS（只给 20 秒，
   *   这 20 秒里没有一次文档区交互就停）。
   */
  private runUntil = 0
  /** 上面那个期限到点后按哪种原因停（idle = 读着读着静默了，away = 压根没在读） */
  private runKind: 'idle' | 'away' = 'idle'
  /**
   * 正在等一次文档区交互（表不走）。
   *
   * 四种情况会落到这里：切回来但还没碰文档、在应用里做别的（对话栏打字、点侧栏）、
   * 静默超时、宽限用完。它和 pause 是两回事——pause 是「这会儿没法读」（失焦、隐藏、
   * 不在主位、AI 在写），waiting 是「能读，但看不出在读」。
   */
  private waiting = false
  private waitingSince = 0
  private waitKind: 'idle' | 'away' = 'away'
  /** 文档栏在不在中间主位；不在时窄栏里的交互与时间都不作数（见 setMain） */
  private mainOk = true
  private lastSettle = Date.now()
  /**
   * 已交给 store、但可能还没落盘的几段（结算时刻 + 那份增量）。
   * 结算到落盘之间有 500ms 防抖窗口，崩在那儿时 store 里那份改动也只在内存里，
   * 所以旁路文件要连它们一起留着（见 learn/readingJournal）。
   */
  private chunks: JournalChunk[] = []
  /** 已经发出去的分钟桶数：未发的桶从第 minuteCount 个开始 */
  private minuteCount = 0
  private pending: MinuteTick[] = []
  private pendingMs = 0
  private breaks: ReadingBreak[] = []
  private pause: PauseKind | null = null
  private pausedAt = 0
  private sections = new Map<string, SectionState>()
  /** 文档里的节顺序（本轮几何的口径） */
  private order: string[] = []
  private layout: Layout[] = []
  private current: string | null = null
  private opened = false
  private words = 0
  /** 这一场累计的有效毫秒（已结算的 + 还没结算的）：文档区那条 4px 进度条读它 */
  private totalMs = 0
  /**
   * 热身期：今天还没读过的标签页，先不写、也不显示，等「动过 + 读够 20 秒」再一起算。
   * 注意它只是**不结算**：期间的时间照常往缓冲区里累，过线的那一刻整段都算数
   * （门槛不是折扣，见 learn/reading 的 warmupDone）。
   */
  private provisional: boolean
  /** 在这一页上真的动过（滚动 / 点击 / 按键 / 选中正文） */
  private interacted = false

  /**
   * **文档区里**的一次交互：滚动、点正文、按键、选中。
   *
   * 一举三得：热身门槛那一半（动过）、当前这段证据续到 60 秒后、以及把「等交互」解除。
   * 只有发生在文档区里的动作算数——在对话栏打字不算（见 aside）。
   */
  docActive(now = Date.now()): void {
    // 文档不在主位：窄栏里的滚动、点击一律不作数（那段时间本来就不算阅读）
    if (!this.mainOk) return
    this.interacted = true
    this.endWaiting(now)
    this.runUntil = now + IDLE_MS
    this.runKind = 'idle'
  }

  /**
   * **别处**的一次交互（在对话栏打字、点侧栏、滚对话栏）：立刻停表，等下一次文档区交互。
   *
   * 这条正是「给导师打字时暂停」：敲键盘的地方不在文档区，表就停。
   */
  aside(now = Date.now()): void {
    this.beginWaiting(now, 'away')
  }

  /**
   * 窗口回到前台（焦点回来 / 从隐藏变可见）：**只**结束「失焦」那一段中断，不接着计时。
   *
   * 切回来这个动作本身只说明窗口又被拿回前台了，不说明要读——所以先落到「等一次交互」。
   * 这正是过去那段白送的时间（回来就恢复计时）被拿掉的地方。
   */
  wake(now = Date.now()): void {
    if (this.pause === 'blur' || this.pause === 'hidden') this.close(now)
    this.beginWaiting(now, 'away')
  }

  /**
   * 这份文档此刻处在什么状态：主位、当前页签（在看预览）、agent 有没有正在写。
   *
   * 三个开关一起交进来而不是分三个方法，是为了**只有一个地方维护 mainOk**——
   * 「导师栏抢过主位、又还回来」这种来回一旦漏掉一次赋值，窄栏的判定就会永远卡在
   * 「不算数」上：明明在主位、明明在滚，计时一动不动（这一版就这么错过一次）。
   *
   * 判定顺序也是固定的：不在主位 → 一律不算（窄栏里跟读的时间丢）；
   * 在主位但当前读不了（不是当前页签 / AI 正在写）→ 停表；在主位且能读 → 给一段宽限
   * （切回来、切回主位都是明确的选择，不必先交互，但宽限里没交互就停）。
   */
  setReadable(readable: { main: boolean; active: boolean; busy: boolean }, now = Date.now()): void {
    this.mainOk = readable.main
    if (!readable.main) {
      this.beginWaiting(now, 'away')
      return
    }
    if (!readable.active || readable.busy) {
      this.suspend(readable.busy ? 'write' : 'tab')
      return
    }
    /*
     * 能读了：**先把停表解除**（记成一次中断），再给一段宽限。
     *
     * 这一句是这一版最容易漏的地方：停表有两条命（pause 与 waiting），解除也必须成对。
     * 漏了「解除 pause」的后果是——AI 写完这份文档、或者你切走页签又切回来之后，
     * 表永远停在 pause 上，怎么滚都不再计时（真出过一次）。
     */
    this.close(now)
    this.startGrace(now)
  }

  /** 打开 / 切到这份文档、文档切回主位：给一段「不必先交互」的宽限 */
  startGrace(now = Date.now()): void {
    this.endWaiting(now)
    this.runUntil = now + RESUME_GRACE_MS
    this.runKind = 'away'
    // 从这里重新起拍：中间隔着一段停表时，别让下一拍把那一整段当成「睡过去了」
    this.lastBeat = now
  }

  private beginWaiting(now: number, kind: 'idle' | 'away'): void {
    if (this.waiting) return
    this.waiting = true
    this.waitingSince = now
    this.waitKind = kind
    this.lastBeat = now
    this.publish()
  }

  private endWaiting(now: number): void {
    if (!this.waiting) return
    this.recordBreak(this.waitingSince, now, this.waitKind)
    this.waiting = false
    this.waitingSince = 0
    this.lastBeat = now
    this.publish()
  }

  /** 构造参数不用 TS 的参数属性：本项目开了 erasableSyntaxOnly，那种写法不被允许 */
  private opts: TrackerOpts

  constructor(opts: TrackerOpts) {
    this.opts = opts
    this.provisional = !opts.knownToday()
    // 打开 / 切到这份文档：先给一段宽限（这 20 秒里有交互就接着走，没有就停）
    this.runUntil = Date.now() + RESUME_GRACE_MS
    this.runKind = 'away'
  }

  setWords(words: number): void {
    this.words = words
  }

  /** 量一次几何（实现见 tracker/sections.ts 的 measureSections） */
  measure(): void {
    const body = this.opts.body()
    const scroll = this.opts.scroll()
    if (!body || !scroll) return
    this.layout = measureSections(body, scroll, this.words, this.sections)
    this.order = this.layout.map((l) => l.key)
  }

  /** 一秒一次：累加有效时间、归属到当前节、按需结算 */
  beat(now = Date.now()): void {
    const dt = now - this.lastBeat
    this.lastBeat = now
    // 第一次进到这里时正文 DOM 才刚挂上（挂载期的 effect 早于它）：量一次几何
    if (!this.layout.length) this.measure()
    if (dt <= 0) return
    if (this.pause) return
    // 睡过去了（合盖、进程被挂起）：这一段不算阅读，只把表拨回来
    if (dt > 5 * BEAT_MS) return
    /*
     * 没有阅读证据（切回来还没碰文档、在应用里做别的、宽限用完）：表不走。
     * 这一段在结束（或结算）时收成一次 break——它把「连续阅读」切开，
     * 但既不算被打断也不算卡住（见 learn/reading 的 BreakKind）。
     */
    if (this.waiting) return
    if (now > this.runUntil) {
      // 空档从证据到期那一刻算起，不是从这一拍算起
      this.beginWaiting(this.runUntil, this.runKind)
      return
    }
    this.attribute(dt, now)
    // 门槛：过了才写、才显示（过线那一刻之前这段时间照常算，见 provisional 的说明）
    if (this.provisional) {
      if (warmupDone({ knownToday: this.opts.knownToday(), interacted: this.interacted, activeMs: this.totalMs })) {
        this.provisional = false
        this.publish()
      }
    }
    // 旁路：把「还没确认落盘的那一段」写出去。放结算之前——结算会把它挪进 chunks，
    // 而 chunks 与 live 是在同一次写里刷新的（顺序错了会留下重叠的一小段，折回来就多算了）
    this.syncJournal(now)
    if (!this.provisional && now - this.lastSettle >= SETTLE_MS) this.settle(now)
  }

  /** 把这一拍的时长记到「占视口面积最大的那一节」头上，并累计新滚过的字数 */
  private attribute(dt: number, now: number): void {
    const scroll = this.opts.scroll()
    const body = this.opts.body()
    if (!scroll || !body || !this.layout.length) return
    const bodyTop = body.getBoundingClientRect().top - (scroll.getBoundingClientRect().top - scroll.scrollTop)
    const viewTop = scroll.scrollTop
    const viewBottom = viewTop + scroll.clientHeight
    let best: Layout | null = null
    let bestOverlap = 0
    let chars = 0
    for (const sec of this.layout) {
      const top = bodyTop + sec.top
      const bottom = top + sec.height
      const overlap = Math.min(viewBottom, bottom) - Math.max(viewTop, top)
      if (overlap <= 0) continue
      const fraction = Math.min(1, overlap / sec.height)
      const state = this.sections.get(sec.key)
      if (state) {
        // 只算**新**滚过的部分：回看不会把 pace 刷高（>25 字/秒就是扫读的信号）
        if (fraction > state.reach) {
          chars += (fraction - state.reach) * sec.chars
          state.reach = fraction
        }
        if (!state.firstAt) state.firstAt = now
        state.lastAt = now
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = sec
      }
    }
    if (!best) return
    const state = this.sections.get(best.key)
    if (!state) return
    state.ms += dt
    this.current = best.key
    this.pendingMs += dt
    this.totalMs += dt
    this.publish()
    this.bucket(now).ms += dt
    this.bucket(now).chars += chars
  }

  /** 把这一场的读数交给文档区底部那条进度条（见 lib/readingPulse） */
  private publish(): void {
    // 热身期不显示：那 20 秒还没「挣到」，先亮一条进度出来会让人以为早就在算了
    if (this.provisional) return
    publishReadingPulse({
      sessionId: this.sessionId,
      goalId: this.opts.goalId,
      activeMs: this.totalMs,
      unsentMs: this.pendingMs,
      paused: !!this.pause || this.waiting,
    })
  }

  /** 取（必要时新建）某一分钟那一格 */
  private bucket(at: number): MinuteTick {
    const index = Math.floor((at - this.minuteStart) / 60_000)
    if (index < this.minuteCount) return EMPTY_TICK()
    while (this.minuteCount + this.pending.length <= index) this.pending.push(EMPTY_TICK())
    return this.pending[index - this.minuteCount]
  }

  /** 交互印记：比时长可靠得多的「真的读了」证据 */
  mark(kind: MarkKind): void {
    const now = Date.now()
    const state = this.current ? this.sections.get(this.current) : null
    if (state) {
      if (!state.marks.includes(kind)) state.marks.push(kind)
      state.lastAt = now
    }
    this.bucket(now).marks += 1
  }

  /** 停表；换一种原因时先把上一段收尾 */
  suspend(kind: PauseKind, at = Date.now()): void {
    if (this.pause) {
      if (this.pause === kind) return
      this.close(at)
    }
    this.pause = kind
    this.pausedAt = at
    this.publish()
    /*
     * 停表那一刻结算一次：把这一段的读数立刻交给 store。
     *
     * 「切页签」正是走这条路（页签常驻之后隐藏的那一片**不会卸载**，
     * 原来靠卸载时的强制结算就不发生了）。不结算的话，这段读数要等用户切回来才进 store，
     * 顶栏与打卡进度在别处看就是「少了一截」。
     * keepPause = true：停表继续有效，别把它当成「又开始读了」。
     */
    this.settleUpTo(at, true, true)
    // 顺手把旁路刷一次：停表之后不再有心跳，最后那零点几秒否则要等到下次启动才发现丢了
    this.syncJournal(at)
  }

  /** 收尾一段停表：记成一次中断（这是 fragmentation 的唯一来源） */
  private close(at: number): void {
    const kind = this.pause
    this.pause = null
    if (!kind) return
    this.recordBreak(this.pausedAt, at, kind)
  }

  /** 把 [at, endAt) 记成一次 break（顺带数一次这一分钟的中断） */
  private recordBreak(at: number, endAt: number, kind: BreakKind): void {
    const ms = Math.max(0, endAt - at)
    if (ms <= 0) return
    // 早于这一场开头的丢掉：那是上一场的事
    if (at < this.minuteStart) return
    // 「没在读」那一类不到一秒的不记：点一下对话栏又马上回来，不该留一条空档
    if ((kind === 'idle' || kind === 'away') && ms < 1000) return
    this.breaks.push({ at, ms, kind })
    const gap = this.bucket(at)
    if (gap) gap.gaps += 1
  }

  /** 结算：把增量交出去，自己只留「已发过多少」的账 */
  settle(now = Date.now(), force = false): void {
    this.settleUpTo(now, force, false)
  }

  /**
   * 结算到此刻。keepPause = true 时**不结束停表**（隐藏页签、被打断时用）：
   * 停表的原因与时长还要继续记，那一段中断留给 resume / 卸载时的 close 去收尾。
   * 少了这个参数就会踩坑：settle 里的 close 会把 pause 清掉，
   * 于是「已经隐藏的页签」被当成还在读，继续往回计时。
   */
  private settleUpTo(now: number, force: boolean, keepPause: boolean): void {
    // 热身没过：一秒都不记（这是「看一眼就走」该有的待遇，见 warmupDone）
    if (this.provisional) return
    if (!force && now - this.lastSettle < SETTLE_MS) return
    if (this.pause && !keepPause) this.close(now)
    this.lastSettle = now
    /*
     * 「等交互」还没结束就被结算（切页签、关窗、打卡前催一次）：先把这一段落成一次 break，
     * 再从此刻续上一段——否则这段空档在数据里看不见，「连续阅读」会被算长。
     */
    if (this.waiting && this.waitingSince < now) {
      this.recordBreak(this.waitingSince, now, this.waitKind)
      this.waitingSince = now
    }
    const sections = liveSections(this.order, this.sections)
    const breaks = this.breaks
    const minutes = this.pending
    const activeMs = this.pendingMs
    if (activeMs <= 0 && !sections.length && !breaks.length) return
    advanceSent(sections, this.sections)
    const delta: ReadingDelta = {
      sessionId: this.sessionId,
      nodeId: this.opts.nodeId,
      doc: this.opts.doc,
      day: studyDayOf(now),
      at: now,
      activeMs,
      minuteIndex: this.minuteCount,
      minutes: minutes.map((m) => ({ ...m })),
      breaks,
      sections,
      ...(this.words ? { words: this.words } : {}),
      ...(this.opened ? {} : { opens: 1 }),
    }
    this.opts.onDelta(delta)
    this.opened = true
    this.minuteCount += minutes.length
    this.pending = []
    this.pendingMs = 0
    this.breaks = []
    // 这一段现在「交给 store 了」，但还没落盘：留在旁路里等启动时对账（见 learn/readingJournal）
    this.chunks = [...this.chunks, { at: now, delta }].slice(-MAX_CHUNKS)
    this.syncJournal(now)
  }

  /**
   * 刷新旁路文件（见 learn/readingJournal）：一秒一次、几百字节，
   * 同步更新内存那份、异步写盘。
   *
   * 热身期不写：那一段还没「挣到」，写了就等于把「看一眼就走」也记进去了。
   * 什么都没读、也没有待对账的段时不写：空闲的文档不该每秒碰一次磁盘。
   */
  private syncJournal(now: number): void {
    if (this.provisional) return
    if (this.pendingMs <= 0 && !this.chunks.length) return
    rememberJournalEntry({
      sessionId: this.sessionId,
      day: studyDayOf(now),
      nodeId: this.opts.nodeId,
      doc: this.opts.doc,
      live: this.pendingMs > 0 ? this.snapshotDelta(now) : null,
      chunks: [...this.chunks],
    })
  }

  /** 当前还没结算的那一段（只读，不改账本）：旁路文件写的就是它 */
  private snapshotDelta(now: number): ReadingDelta {
    return {
      sessionId: this.sessionId,
      nodeId: this.opts.nodeId,
      doc: this.opts.doc,
      day: studyDayOf(now),
      at: now,
      activeMs: this.pendingMs,
      minuteIndex: this.minuteCount,
      minutes: this.pending.map((m) => ({ ...m })),
      breaks: this.breaks.map((b) => ({ ...b })),
      sections: liveSections(this.order, this.sections),
      ...(this.words ? { words: this.words } : {}),
      ...(this.opened ? {} : { opens: 1 }),
    }
  }
}
