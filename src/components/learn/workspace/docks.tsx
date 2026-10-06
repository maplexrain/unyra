/*
 * 这个文件负责：顶栏里那三块「我今天的节奏」的数据接线——
 * 番茄钟（PomodoroDock）、打卡（CheckinDock）、有效阅读（ReadingDock）。
 *
 * 三块的共同点是「自给自足的小块」：各自的时钟只让这一小块每秒重渲染，
 * 不会把整个学习区（正文 + 对话栏）一起带上；数据仍然来自 store（它是唯一真相），
 * 这里只负责把数据算成那三个纯展示按钮要的形状。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Eye, ShieldCheck } from 'lucide-react'
import type { LearnStore } from '../../../learn/types'
import { nodeById } from '../../../learn/graph'
import PomodoroButton, { type FocusMonitors } from '../PomodoroButton'
import CheckinButton, { type CheckinGoalTab } from '../CheckinButton'
import ReviewButton, { type ReviewGoalTab, type ReviewTaskRow, type ReviewUpcomingRow } from '../ReviewButton'
import ReadingButton, {
  type ReadingDayCell,
  type ReadingNodeRow,
  type ReadingScopeTab,
} from '../ReadingButton'
import {
  lastBrowseAtOf,
  readingDay,
  readingIndex,
  readingOfGoal,
  studyDayOf,
} from '../../../learn/reading'
import {
  MIN_DAY_MS,
  calendarLabel,
  chancesLeft,
  checkinCalendar,
  checkinDay,
  checkinEligible,
  checkinOfGoal,
  remainingText,
  streakOf,
} from '../../../learn/checkin'
import { REVIEW_DAY_MS, REVIEW_STAGE_LABEL, dueEntriesOf } from '../../../learn/review'
import {
  DEFAULT_FOCUS_MINUTES,
  DEFAULT_GROUPS,
  pomodoroStatus,
} from '../../../learn/pomodoro'
import { useClock } from '../../../lib/clock'
import { useReadingDay, useReadingPulse } from '../../../lib/readingPulse'
import { t } from '../../../i18n'
import { supportsImage } from '../../../ai/settings'
import {
  ensureStream,
  getStream,
  guardSnapshot,
  stopStream,
  subscribeGuard,
  subscribeGuardStreams,
} from '../../../agent/guardRuntime'

/** 严格专注勾选的持久化：下次打开 tip 还记得上次勾了什么（与「下一段多长」同一种待遇） */
const MONITORS_KEY = 'moji-focus-monitors'

function loadMonitors(): FocusMonitors {
  try {
    const raw = JSON.parse(localStorage.getItem(MONITORS_KEY) ?? '{}') as Partial<FocusMonitors>
    return { screen: raw.screen === true, camera: raw.camera === true }
  } catch {
    return { screen: false, camera: false }
  }
}

/**
 * 番茄钟入口。
 *
 * 时钟与倒计时**只在这一小块里**每秒重渲染：放到学习区那一层，等于每秒把正文与
 * 对话栏一起重画一遍。数据仍然来自 store（它是唯一真相），这里只负责算「还剩多久」。
 *
 * 三个设置（一段多长、做几组、勾哪几路监控）是**这个组件自己的 state**：它们是
 * 「下一次开始」的参数，不是学习数据，没有理由进 store；跑起来之后以会话里的那一份
 * 为准（面板上会锁住不让改）。勾选监控会当场起媒体流——实时画面就出现在 tip 里，
 * 用户对着它把摄像头角度调好、确认没拍到不该拍的东西，再点开始。
 *
 * 到点收尾调一次 onTick：记账落在 store 上、提醒走全局 toast——两者都不该由这个
 * 展示块自己决定。守卫的判定与动作（暂停/警告/熔断）同样不在这里：Dock 只显示状态。
 */
export function PomodoroDock({
  store,
  onStart,
  onStop,
  onTick,
  onOpenGuard,
}: {
  store: LearnStore
  onStart: (focusMinutes: number, groups: number, monitors: FocusMonitors) => void
  onStop: () => void
  onTick: () => void
  onOpenGuard: () => void
}) {
  // 秒针走 useClock：只有这一小块订阅它，正文与对话栏不会被每秒带着重渲
  const now = useClock(1000)
  const status = pomodoroStatus(store, now)
  const [focusMinutes, setFocusMinutes] = useState(DEFAULT_FOCUS_MINUTES)
  const [groups, setGroups] = useState(DEFAULT_GROUPS)
  const [monitors, setMonitors] = useState<FocusMonitors>(loadMonitors)
  // 已经过了点、但还没收尾：收尾一次（onTick 会把这一段翻过去，所以只会走一次）
  const over = status.over
  useEffect(() => {
    if (over) onTick()
  }, [over, onTick])

  /** 勾/去一路监控：当场起停媒体流（预览跟着亮/熄），起不来就退回未勾。
      先算好下一份再 set：updater 要保持纯净（起停流与落 localStorage 都是副作用） */
  const toggleMonitor = (kind: 'screen' | 'camera') => {
    const next = { ...monitors, [kind]: !monitors[kind] }
    setMonitors(next)
    try {
      localStorage.setItem(MONITORS_KEY, JSON.stringify(next))
    } catch {
      // 存不进去就只活在本场会话里，不碍事
    }
    if (next[kind]) {
      void ensureStream(kind).then((stream) => {
        if (!stream) setMonitors((cur) => (cur[kind] ? { ...cur, [kind]: false } : cur))
      })
    } else {
      stopStream(kind)
    }
  }

  // 守卫的会话与媒体流都是模块级单例（agent/guardRuntime）：这里只订阅它的快照
  const guard = useSyncExternalStore(subscribeGuard, guardSnapshot)
  const guardOn = guard.session?.state === 'running' || guard.session?.state === 'paused'
  // 勾了监控但当前模型看不了图：严格专注发不了画面，提前说清，别等点了开始才扑空
  const strictHint = useMemo(
    () =>
      monitors.screen || monitors.camera
        ? supportsImage()
          ? null
          : t('当前的模型不支持看图——严格专注需要能看图的模型，换一个或关闭勾选。')
        : null,
    [monitors.screen, monitors.camera],
  )
  const previews =
    monitors.screen || monitors.camera ? (
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {monitors.screen && <GuardPreviewTile kind="screen" />}
        {monitors.camera && <GuardPreviewTile kind="camera" />}
      </div>
    ) : null
  const guardStatus = guardOn ? (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-seal/30 bg-seal/5 px-2.5 py-1.5">
      <ShieldCheck size={13} className="shrink-0 text-seal" />
      <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
        {guard.session!.state === 'paused'
          ? t('守卫暂停中——等你回来')
          : t('守卫当值 · 已看 {0} 眼', guard.session!.rounds.length)}
      </span>
      <button
        type="button"
        onClick={onOpenGuard}
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-seal-deep transition hover:bg-seal/10"
      >
        <Eye size={11} /> {t('查看守卫')}
      </button>
    </div>
  ) : null

  const cur = status.session
  return (
    <PomodoroButton
      running={cur ? { phase: cur.phase, index: cur.index, groups: cur.groups, focusMinutes: cur.focusMinutes } : null}
      remainingMs={status.remainingMs}
      phaseMs={status.phaseMs}
      focusMinutes={focusMinutes}
      groups={groups}
      onFocusMinutes={setFocusMinutes}
      onGroups={setGroups}
      onStart={() => onStart(focusMinutes, groups, monitors)}
      onStop={onStop}
      monitors={monitors}
      onMonitorToggle={toggleMonitor}
      previews={previews}
      guardStatus={guardStatus}
      paused={status.paused}
      strictHint={strictHint}
    />
  )
}

/**
 * 严格专注 tip 里的一块实时画面（屏幕或摄像头）。
 *
 * 媒体流在守卫运行时手里（它才是抽帧的来源）；这里只挂一个观众 <video>——
 * tile 卸了（tip 收起）流还在，守卫照常工作。没有流时给一块暗底占位：
 * 权限没批、设备被占、或者会话已经收掉（媒体流随会话结束全部停掉）。
 */
export function GuardPreviewTile({ kind }: { kind: 'screen' | 'camera' }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [version, setVersion] = useState(0)
  // 流的来去由 toggle / 会话收尾触发：订阅它，来了就挂上、断了就熄灭
  useEffect(() => subscribeGuardStreams(() => setVersion((n) => n + 1)), [])
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const stream = getStream(kind)
    if (video.srcObject !== stream) video.srcObject = stream
    if (stream) void video.play().catch(() => {})
  }, [version, kind])
  return (
    <div className="relative aspect-video overflow-hidden rounded-md border border-line bg-black/80">
      <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
      <span className="absolute bottom-1 left-1.5 rounded bg-black/55 px-1 py-px text-[9.5px] text-white/90">
        {kind === 'screen' ? t('屏幕') : t('摄像头')}
      </span>
      {!getStream(kind) && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/50">
          {t('等待画面…')}
        </span>
      )}
    </div>
  )
}

/**
 * 打卡入口。
 *
 * 资格、日历格子都在这里算好再交给纯展示的 CheckinButton：
 * 组件不读 store、不算日期，于是它的行为完全可预期（要改口径只改这一处）。
 * 「今天是周几」与「现在展开哪个目标」是唯二由外面管的事——前者因为它不解析日期，
 * 后者因为 tab 的默认落点要看「正在读哪门课」。
 */
export function CheckinDock({ store, onCheckin }: { store: LearnStore; onCheckin: (goalId: string) => void }) {
  /*
   * 一秒一次：每一行都要说「还差多久」，那就得每秒都在动。
   *
   * 判定本身只读 store，而 store 每 30 秒才结算一次、还是 patchQuiet 写的（不触发渲染），
   * 所以除了自己刷新，还要把「已结算但快照看不到的」与「还没结算的」补进 extraMs——
   * 不补的话数字会憋住，只有切文档才会跳一下（那正是用户报的现象）。
   *
   * 打卡**按目标分开**（见 learn/checkin 的 CheckinBook）：每个目标一本账、一道门槛，
   * 判定与「还差几分钟」都各算各的。脉搏与发布值都带 goalId，所以正在读的那一段
   * 只会补到它所属的那个目标上。
   */
  const now = useClock(1000)
  const pulse = useReadingPulse()
  const published = useReadingDay()
  const day = studyDayOf(now)
  const activeGoalId = store.activeGoalId ?? ''
  // 用户点选的 tab；没点过（null）时跟着「正在读的那门课」走
  const [tabId, setTabId] = useState<string | null>(null)

  /** 某个目标**已经落盘**的今日时长 */
  const settledMsOf = (goalId: string): number => readingDay(readingOfGoal(store.reading, goalId), day)?.activeMs ?? 0
  /** 某个目标今天此刻的真实时长：已落盘 + 刚结算发布的那份 + 还没结算的脉搏 */
  const liveMsOf = (goalId: string): number => {
    const settled = settledMsOf(goalId)
    const pub = published.day === day && published.goalId === goalId ? Math.max(published.ms, settled) : settled
    const live = pulse.sessionId && pulse.goalId === goalId ? pulse.unsentMs : 0
    return pub + live
  }
  const titleOf = (id: string): string | undefined => nodeById(store, id)?.title

  /*
   * 目标 tab 按**最近浏览时间**降序（与有效阅读的过滤栏同一条规则）：
   * 最近在读的那门课排最前——翻 tip 的人大概率正是要找它。
   */
  const goalsByRecent = [...store.goals].sort(
    (a, b) => lastBrowseAtOf(readingOfGoal(store.reading, b.id)) - lastBrowseAtOf(readingOfGoal(store.reading, a.id)),
  )

  const tabs: CheckinGoalTab[] = goalsByRecent.map((goal) => {
    const checkin = checkinOfGoal(store.checkin, goal.id)
    // 还没落盘的那一段补进来，只补当前正在读的那个目标（别的目标没有在跑的一节）
    const extraMs = goal.id === activeGoalId ? Math.max(0, liveMsOf(goal.id) - settledMsOf(goal.id)) : 0
    const e = checkinEligible(readingOfGoal(store.reading, goal.id), checkin, { now, titleOf, extraMs })
    const done = !!checkinDay(checkin, day)?.passed
    const left = chancesLeft(checkin, day)
    const need = Math.max(0, MIN_DAY_MS - e.activeMs)
    const streak = streakOf(checkin, now)
    const cells = checkinCalendar(checkin, now)
    return {
      goalId: goal.id,
      label: goalTitle(store, goal.id),
      state: done ? 'done' : e.ok ? 'ready' : 'hint',
      // 能打的时候不写字（账头那行是按钮）；其余情况一律说清「差什么」。
      // 考试通道带来的打卡要点名——「怎么过的」比「过了」更值得说
      note: done
        ? checkinDay(checkin, day)?.exam
          ? t('今天已打卡（首次考试及格）')
          : t('今天已打卡')
        : left <= 0
          ? t('今天的次数用完了')
          : e.ok
            ? ''
            : need > 0
              ? t('还差 {0}', remainingText(need))
              : (e.reason ?? t('还不能打卡')),
      streak: streak.current,
      best: streak.best,
      calendar: cells,
      monthLabel: calendarLabel(cells),
    }
  })

  // 选中的目标可能刚被删掉：退回「正在读的那门」，再退回第一本
  const selectedId = tabId && tabs.some((t) => t.goalId === tabId)
    ? tabId
    : tabs.some((t) => t.goalId === activeGoalId)
      ? activeGoalId
      : (tabs[0]?.goalId ?? '')

  // getDay() 是 0=周日；日历表头从周一起排，换算成 0=周一
  const todayWeekday = (new Date(now).getDay() + 6) % 7
  return (
    <CheckinButton
      tabs={tabs}
      selectedId={selectedId}
      onSelect={setTabId}
      todayWeekday={todayWeekday}
      onCheckin={onCheckin}
    />
  )
}

/**
 * 顶栏「有效阅读」入口的数据接线。
 *
 * 两个数据来源叠在一起：store 里的记录（30 秒才结算一次）与 lib/readingPulse 里
 * 那一场的脉搏（还没落盘的那一段）。不叠的话，用户读着读着点开面板，看到的会是
 * 一个「憋住不动」的数字。useClock 每 30 秒推一次重渲染，负责把跨零点的日子翻页。
 */
export function ReadingDock({ store, onOpenNode }: { store: LearnStore; onOpenNode: (nodeId: string) => void }) {
  /*
   * 一秒一次：顶栏那个数字要**当着用户的面往上走**。
   *
   * 为什么不能只读 store：阅读记录是 patchQuiet 写的（只改 ref、不重渲染），
   * 渲染快照里的阅读数据永远是旧的——只有别的动作触发一次 set（比如切文档）才会跳一下，
   * 表现就是「切了文档才更新」。所以这里三样东西叠起来：
   *   已落盘（store 快照）、刚发布的那一份（结算时发布，见 lib/readingPulse）、
   *   这一场还没结算的脉搏（每秒都在动）。三者相加就是此刻的真实读数。
   *
   * 面板里的过滤栏是需求要的那一档：**左边选目标，右边看那一档的统计**。
   * 哪一个目标都没选时（'all'）就是全部合起来——要一门课一门课地看也随时切。
   */
  const now = useClock(1000)
  const pulse = useReadingPulse()
  const published = useReadingDay()
  const day = studyDayOf(now)
  const [scope, setScope] = useState<string>('all')

  /** 某个目标**已经落盘**的今日时长 */
  const settledMsOf = (goalId: string): number => readingDay(readingOfGoal(store.reading, goalId), day)?.activeMs ?? 0
  /** 某个目标今天此刻的真实时长（含还没落盘的那一段：脉搏与发布值都带 goalId） */
  const liveMsOf = (goalId: string): number => {
    const settled = settledMsOf(goalId)
    const pub = published.day === day && published.goalId === goalId ? Math.max(published.ms, settled) : settled
    const live = pulse.sessionId && pulse.goalId === goalId ? pulse.unsentMs : 0
    return pub + live
  }

  /*
   * 目标 tab 按**最近浏览时间**降序（需求）：最近在读的那门课排最前，「全部」永远第一。
   */
  const goalsByRecent = [...store.goals].sort(
    (a, b) => lastBrowseAtOf(readingOfGoal(store.reading, b.id)) - lastBrowseAtOf(readingOfGoal(store.reading, a.id)),
  )
  const tabs: ReadingScopeTab[] = [
    { id: 'all', label: t('全部'), todayMs: store.goals.reduce((n, g) => n + liveMsOf(g.id), 0) },
    ...goalsByRecent.map((g) => ({ id: g.id, label: goalTitle(store, g.id), todayMs: liveMsOf(g.id) })),
  ]
  // 选中的目标可能已经不在了（刚删掉）：那就退回「全部」，别让面板空着
  const scopeId = tabs.some((t) => t.id === scope) ? scope : 'all'
  const scopedGoals = scopeId === 'all' ? store.goals.map((g) => g.id) : [scopeId]
  const todayMs = scopedGoals.reduce((n, id) => n + liveMsOf(id), 0)

  /*
   * 按节点的统计：**只列有阅读记录的节点**（需求），跨目标合并后按最后阅读时间倒序。
   * 用 readingIndex 而不是今天的会话——面板要的是「读到哪了」，那是累计的事实，
   * 不是今天这一天读了什么。
   */
  const withTime: Array<{ row: ReadingNodeRow; lastAt: number }> = []
  for (const goalId of scopedGoals) {
    const book = readingOfGoal(store.reading, goalId)
    const ids = store.nodes.filter((n) => n.goalId === goalId).map((n) => n.id)
    for (const r of readingIndex(book, (id) => nodeById(store, id)?.title, ids)) {
      const main = r.docs.find((d) => d.doc === 'teaching')
      withTime.push({
        lastAt: r.lastAt,
        row: {
          nodeId: r.nodeId,
          title: r.title,
          minutes: Math.round(r.activeMs / 60_000),
          progress: main && main.total ? main.read + '/' + main.total : '',
          ...(main?.done ? { done: true } : {}),
          // 看「全部」时才标出这一行属于哪个目标（只选了一个目标时那是废话）
          ...(scopeId === 'all' ? { goal: nodeGoalTitle(store, r.nodeId) } : {}),
        },
      })
    }
  }
  withTime.sort((a, b) => b.lastAt - a.lastAt)
  const nodes = withTime.map((x) => x.row)

  // 最近七天：按学习日把范围内几本账合起来（今天是活的时长，含还没落盘的那一段）
  const week: ReadingDayCell[] = Array.from({ length: 7 }, (_, i) => {
    const key = studyDayOf(now - (6 - i) * 86_400_000)
    const ms =
      key === day
        ? todayMs
        : scopedGoals.reduce((n, id) => n + (readingDay(readingOfGoal(store.reading, id), key)?.activeMs ?? 0), 0)
    return {
      day: key,
      minutes: Math.round(ms / 60_000),
      label: Number(key.slice(8, 10)),
      ...(key === day ? { today: true } : {}),
    }
  })
  return (
    <ReadingButton
      scopeId={scopeId}
      onScope={setScope}
      tabs={tabs}
      todayMs={todayMs}
      nodes={nodes}
      week={week}
      weekMinutes={week.reduce((n, d) => n + d.minutes, 0)}
      onOpenNode={onOpenNode}
    />
  )
}

/**
 * 顶栏「复习」入口的数据接线。
 *
 * 复习计划挂在节点上（见 learn/review），但 tab 仍**按目标分**——与打卡 / 有效阅读同一套
 * 「一门课一档」的布局。到期判定是按天的事，时钟 30 秒一跳只为跨零点翻页。
 * 到期行、未来两周、待补建清单都在这里算成纯数据，交给纯展示的 ReviewButton。
 */
export function ReviewDock({
  store,
  onReview,
  onBackfill,
}: {
  store: LearnStore
  onReview: (nodeId: string) => void
  onBackfill: (nodeId: string) => void
}) {
  const now = useClock(30_000)
  const [tabId, setTabId] = useState<string | null>(null)
  const goalsByRecent = [...store.goals].sort(
    (a, b) => lastBrowseAtOf(readingOfGoal(store.reading, b.id)) - lastBrowseAtOf(readingOfGoal(store.reading, a.id)),
  )
  const entries = dueEntriesOf(store, now)
  const dayLabel = (at: number): string => {
    const d = new Date(at)
    return t('{0} 月 {1} 日', d.getMonth() + 1, d.getDate())
  }

  const tabs: ReviewGoalTab[] = goalsByRecent.map((goal) => {
    const due: ReviewTaskRow[] = entries
      .filter((e) => e.goalId === goal.id)
      .map((e) => {
        const titles = e.nodeIds.map((id) => nodeById(store, id)?.title).filter((t): t is string => !!t)
        const head = titles[0] ?? ''
        return {
          key: e.key,
          nodeIds: e.nodeIds,
          title: e.grouped ? t('{0} 等 {1} 个（合并复习）', head, e.nodeIds.length) : head,
          stageLabel: e.stage ? t(REVIEW_STAGE_LABEL[e.stage]) : t('补充复习'),
          overdueDays: e.overdueDays,
        }
      })
    // 未来 14 天内到期的阶段与补充任务（已到期的在上面那排，不重复列）
    const horizon = now + 14 * REVIEW_DAY_MS
    const upcomingRaw: Array<{ row: ReviewUpcomingRow; dueAt: number }> = []
    for (const n of store.nodes) {
      if (n.goalId !== goal.id || !n.review) continue
      for (const s of n.review.stages) {
        if (s.doneAt || s.mergedInto || s.dueAt <= now || s.dueAt > horizon) continue
        upcomingRaw.push({ dueAt: s.dueAt, row: { title: n.title, stageLabel: t(REVIEW_STAGE_LABEL[s.stage]), when: dayLabel(s.dueAt) } })
      }
      for (const extra of n.review.extra ?? []) {
        if (extra.doneAt || extra.dueAt <= now || extra.dueAt > horizon) continue
        upcomingRaw.push({ dueAt: extra.dueAt, row: { title: n.title, stageLabel: t('补充复习 · {0}', extra.focus), when: dayLabel(extra.dueAt) } })
      }
    }
    upcomingRaw.sort((a, b) => a.dueAt - b.dueAt)
    const backlog = store.nodes
      .filter((n) => n.goalId === goal.id && n.status === 'mastered' && !n.review)
      .map((n) => ({ nodeId: n.id, title: n.title }))
    return {
      goalId: goal.id,
      label: goalTitle(store, goal.id),
      due,
      upcoming: upcomingRaw.map((x) => x.row),
      backlog,
    }
  })

  // 选中的目标可能刚被删掉：退回「正在读的那门」，再退回第一本（与打卡同一套兜底）
  const selectedId = tabId && tabs.some((t) => t.goalId === tabId)
    ? tabId
    : tabs.some((t) => t.goalId === (store.activeGoalId ?? ''))
      ? (store.activeGoalId ?? '')
      : (tabs[0]?.goalId ?? '')
  return <ReviewButton tabs={tabs} selectedId={selectedId} onSelect={setTabId} onReview={onReview} onBackfill={onBackfill} />
}

/** 目标显示名：根节点的标题就是这门课的名字（节点没了才退回用户当初那句原话） */
function goalTitle(store: LearnStore, goalId: string): string {
  const goal = store.goals.find((g) => g.id === goalId)
  if (!goal) return t('未命名目标')
  return nodeById(store, goal.rootNodeId)?.title ?? goal.question
}

/** 某个节点属于哪个目标的名字（「全部」那一档里给每一行标一下） */
function nodeGoalTitle(store: LearnStore, nodeId: string): string {
  const node = nodeById(store, nodeId)
  return node ? goalTitle(store, node.goalId) : ''
}
