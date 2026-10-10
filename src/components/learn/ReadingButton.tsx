import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import RollingDigits from './RollingDigits'
import { t } from '../../i18n'

/**
 * 顶栏的「有效阅读」入口：鼠标经过向下展开一块面板。
 *
 * 面板分两栏（需求）：**左边是过滤栏**（「全部」+ 各个学习目标），右边是这一范围内
 * 的阅读统计——每个读过的节点一行，加上最近一周的总时长与那七根柱子。
 * 选「全部」就是所有目标合起来看。为什么要按目标分：一个人同时学几门课是常态，
 * 把两门课的时长混在一条曲线上，「今天读了两小时」就既不是这门课的、也不是那门课的
 * （见 learn/reading 的 ReadingBook）。
 *
 * 与打卡、番茄钟同一套时序（见 UserMenu 的注释）：wrapper 上 no-drag + relative，
 * 离开有 90ms 宽限（按钮与面板之间有一道 pt-1 的缝），退场动画播完才卸载。
 *
 * 组件是**纯展示**的：分钟数、节点清单、柱子、过滤栏里的选项全部由 props 传入，
 * 它只记住「现在选的是哪一档」这一个本地状态——「今天」这件事由父组件算好
 * （与 CheckinButton 同一条纪律）。
 */

/** 过滤栏里的一档：'all' 或某个目标 */
export interface ReadingScopeTab {
  id: string
  label: string
  /** 这一档今天读了多少毫秒（含还没落盘的那一段）：标签右侧那个小数字 */
  todayMs: number
}

/** 某范围内一个有阅读记录的节点 */
export interface ReadingNodeRow {
  nodeId: string
  title: string
  /** 累计有效分钟（这个节点从有记录以来） */
  minutes: number
  /** 「3/8」（读到第几节/共几节）；文档没有节结构时给空串 */
  progress: string
  /** 整份教学文档都读到了 */
  done?: boolean
  /** 属于哪个目标（选「全部」时用得上） */
  goal?: string
}

/** 最近几天里的一天（画迷你柱用） */
export interface ReadingDayCell {
  day: string
  /** 这一天的有效分钟数 */
  minutes: number
  /** 日期数字（柱子上不显示，用来说明是哪天） */
  label: number
  today?: boolean
}

export interface ReadingButtonProps {
  /** 当前选中的那一档（'all' 或目标 id） */
  scopeId: string
  onScope: (id: string) => void
  /** 过滤栏：第一项必须是「全部」，其余按目标顺序 */
  tabs: ReadingScopeTab[]
  /**
   * 这一档今天累计的有效毫秒（含还没落盘的那一段，见 lib/readingPulse）。
   *
   * 为什么收毫秒而不是分钟：这个数字每秒都在往上走，取整到分钟就看不出在动——
   * 而「在动」本身就是要给用户看的东西（他刚读了三十秒，界面得承认）。
   */
  todayMs: number
  /** 这一档里有阅读记录的节点（按最近阅读时间降序，父组件排好）；空数组表示还没读过 */
  nodes: ReadingNodeRow[]
  /** 最近 7 天（含今天），早 → 晚 */
  week: ReadingDayCell[]
  /** 这七天的总分钟数（就是需求里那句「最近一周阅读总时长」） */
  weekMinutes: number
  /** 点某一行 → 打开那个节点 */
  onOpenNode: (nodeId: string) => void
}

/** 指针离开后延后这么久再收：按钮与面板之间那道缝不能让面板半路被关掉 */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐 */
const TIP_EXIT_MS = 160
/**
 * 节点清单每页几条（需求）：翻页看，不一次性铺开。
 * 排序由父组件做好（按最近阅读时间降序），这里只负责把当前页切出来。
 */
const PAGE_SIZE = 10
/** tab 栏最多露出多高：目标多过这个数就在栏内滚动（滚动条藏掉，见 moji-scroll-none） */
const TABS_MAX_H = 300

/** 「x 分钟」的写法：不足一分钟不写 0，写成「不到 1 分钟」 */
function minutesText(minutes: number): string {
  return minutes < 1 ? t('不到 1 分钟') : t('{0} 分钟', minutes)
}

/**
 * 顶栏那个数字：mm:ss（超过一小时才带小时）。
 *
 * 显示到秒是故意的：这一栏要让人看见「它正在走」。tabular-nums 已经在类名里，
 * 所以数字跳动时宽度不会抖。
 */
function readingClockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0')
}

/** 过滤栏里那个小数字：不足一分钟显示 <1，一分钟以上取整 */
function tabMinutes(ms: number): string {
  const m = Math.floor(ms / 60_000)
  if (m >= 1) return t('{0} 分钟', m)
  return ms > 0 ? t('<1 分') : '—'
}

export default function ReadingButton({
  scopeId,
  onScope,
  tabs,
  todayMs,
  nodes,
  week,
  weekMinutes,
  onOpenNode,
}: ReadingButtonProps) {
  // 浮层要等退场动画播完才卸载，所以展开状态交给 useHoverMenu 管（与打卡、番茄钟同一套时序）
  const { open, setOpen, mounted, wrapProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: TIP_EXIT_MS,
  })

  const peak = Math.max(1, ...week.map((d) => d.minutes))
  const empty = nodes.length === 0 && todayMs <= 0
  const scopeLabel = tabs.find((t) => t.id === scopeId)?.label ?? t('全部')

  // 翻页（0 起）。换一档就回第一页——两份清单毫无关系，停在旧页码只会让人迷路
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE))
  const safe = Math.min(page, pageCount - 1)
  const pageRows = nodes.slice(safe * PAGE_SIZE, safe * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={empty ? t('今天还没有有效阅读') : t('今天读了 {0}', todayMs >= 60_000 ? minutesText(Math.floor(todayMs / 60_000)) : readingClockText(todayMs))}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ${
          todayMs > 0 ? 'text-ink' : open ? 'text-ink' : 'text-ink-soft hover:text-ink'
        }`}
      >
        <BookOpen size={14} className={todayMs > 0 ? 'text-seal' : open ? 'text-ink' : 'text-ink-faint group-hover:text-ink'} />
        <span className={'hidden text-[12px] tabular-nums sm:inline ' + (todayMs > 0 ? 'font-medium text-ink' : '')}>
          {todayMs > 0 ? <RollingDigits text={readingClockText(todayMs)} /> : t('阅读')}
        </span>
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            role="menu"
            className={`min-h-[320px] w-[580px] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            {/* --- 顶部卡片：标题、今日计时与统计标签 --- */}
            <div className="flex items-center justify-between gap-3 border-b border-line/40 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-seal/10 text-seal">
                  <BookOpen size={14} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink-strong">{t('有效阅读')}</span>
                    <span className="text-[11px] text-ink-faint">
                      · {scopeId === 'all' ? t('全部目标') : scopeLabel}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-ink-faint">
                    {t('仅在窗口前台且正文处于主位时计入')}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="text-right">
                  <div className="text-[16px] font-bold tabular-nums text-seal">
                    {todayMs > 0 ? <RollingDigits text={readingClockText(todayMs)} /> : '00:00'}
                  </div>
                  <div className="text-[10px] text-ink-faint">{t('今日累计')}</div>
                </div>
                {weekMinutes > 0 && (
                  <span className="rounded-full bg-paper px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-ink-soft border border-line/50">
                    {t('近 7 天 {0} 分', weekMinutes)}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-3">
              {/* --- 左：过滤栏（目标选择） --- */}
              <div className="w-[136px] shrink-0 border-r border-line/50 pr-2.5">
                <div className="mb-1.5 px-1 text-[10.5px] font-medium text-ink-faint">
                  {t('学习目标')}
                </div>
                <div
                  className="space-y-1 overflow-y-auto moji-scroll-none"
                  style={{ maxHeight: TABS_MAX_H }}
                >
                  {tabs.map((tab) => {
                    const active = tab.id === scopeId
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          setPage(0)
                          onScope(tab.id)
                        }}
                        title={tab.label}
                        className={`flex w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all ${
                          active
                            ? 'bg-seal/12 text-seal-deep font-medium border-l-2 border-seal shadow-2xs'
                            : 'text-ink-soft hover:bg-line/40 hover:text-ink'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-[11.5px]">{tab.label}</span>
                        <span className="shrink-0 text-[10px] tabular-nums opacity-75">
                          {tabMinutes(tab.todayMs)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* --- 右：节点明细列表 + 7 天趋势柱图 --- */}
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                <div>
                  {empty ? (
                    <div className="flex flex-col items-center justify-center rounded-xl bg-paper/40 py-8 px-4 text-center dark:bg-paper/20">
                      <BookOpen size={24} className="text-ink-faint mb-1.5 opacity-50" />
                      <p className="text-[12px] text-ink-soft">
                        {t('这一档暂无阅读记录')}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-ink-faint">
                        {t('在学习区打开文档阅读片刻，此处将同步更新进度。')}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="min-h-[175px] space-y-1">
                        {pageRows.map((row) => (
                          <button
                            key={row.nodeId}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setOpen(false)
                              onOpenNode(row.nodeId)
                            }}
                            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-all hover:bg-line/50"
                          >
                            <span className="min-w-0 flex-1 truncate text-[12px] text-ink group-hover:text-ink-strong">
                              {row.title}
                            </span>
                            {scopeId === 'all' && row.goal && (
                              <span className="max-w-[70px] shrink-0 truncate rounded bg-line/40 px-1 py-0.5 text-[9.5px] text-ink-faint">
                                {row.goal}
                              </span>
                            )}
                            <span className="shrink-0 rounded-md bg-paper px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-ink-soft border border-line/40">
                              {t('{0} 分钟', row.minutes)}
                            </span>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
                                row.done
                                  ? 'bg-ok/15 text-ok-deep font-medium'
                                  : 'text-ink-faint bg-line/30'
                              }`}
                            >
                              {row.done ? t('已读完') : row.progress}
                            </span>
                          </button>
                        ))}
                      </div>

                      {pageCount > 1 && (
                        <div className="mt-1 flex items-center justify-between border-t border-line/30 px-1 pt-1.5 text-[10.5px] text-ink-faint">
                          <button
                            type="button"
                            disabled={safe <= 0}
                            onClick={() => setPage(Math.max(0, safe - 1))}
                            className={`rounded-md px-2 py-0.5 transition ${
                              safe <= 0 ? 'opacity-40' : 'hover:bg-line/50 hover:text-ink'
                            }`}
                          >
                            {t('‹ 上一页')}
                          </button>
                          <span className="tabular-nums">
                            {t('{0} / {1} 页 · 共 {2} 个节点', safe + 1, pageCount, nodes.length)}
                          </span>
                          <button
                            type="button"
                            disabled={safe >= pageCount - 1}
                            onClick={() => setPage(Math.min(pageCount - 1, safe + 1))}
                            className={`rounded-md px-2 py-0.5 transition ${
                              safe >= pageCount - 1 ? 'opacity-40' : 'hover:bg-line/50 hover:text-ink'
                            }`}
                          >
                            {t('下一页 ›')}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* --- 最近七天迷你趋势图 --- */}
                <div className="mt-2.5 rounded-xl border border-line/40 bg-paper/40 p-2 dark:bg-paper/20">
                  <div className="mb-1.5 flex items-center justify-between px-0.5 text-[10px] text-ink-faint">
                    <span>{t('近 7 天每日阅读趋势')}</span>
                    <span className="tabular-nums">{t('峰值 {0} 分钟', peak)}</span>
                  </div>
                  <div className="flex items-end gap-1.5 h-7">
                    {week.map((d) => (
                      <div
                        key={d.day}
                        className="group relative flex flex-1 flex-col items-center justify-end h-full"
                        title={t('{0} 日 · {1} 分钟', d.label, d.minutes)}
                      >
                        <div
                          className={`w-full rounded-xs transition-all duration-300 ${
                            d.today
                              ? 'bg-seal shadow-2xs'
                              : d.minutes > 0
                                ? 'bg-ink-soft/40 hover:bg-ink-soft/60'
                                : 'bg-line/50'
                          }`}
                          style={{
                            height: Math.max(3, Math.round((d.minutes / peak) * 22)) + 'px',
                          }}
                        />
                        <span
                          className={`mt-1 text-[9px] tabular-nums leading-none ${
                            d.today ? 'font-bold text-seal' : 'text-ink-faint'
                          }`}
                        >
                          {d.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
