import { Flame } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'

/**
 * 顶栏的「打卡」入口：鼠标经过向下展开一张 tab 布局的 tip。
 *
 * 打卡**按学习目标分开**（见 learn/checkin 的 CheckinBook）：每个目标一条连续天数、
 * 一道门槛、一次机会。tip 与「有效阅读」同一套布局（需求）：**左边是目标 tab 栏**，
 * 右边是**当前目标那一本独立的打卡账**——状态、连续天数、日历。打卡的日历合不了
 * （两门课混在一张月历上，「打过卡」就成了谁也不是的那天），所以这里没有「全部」档，
 * 每个 tab 就是一本账。
 *
 * 与打卡、番茄钟同一套时序（见 UserMenu 的注释）：wrapper 上 no-drag + relative，
 * 离开有 90ms 宽限（按钮与面板之间有一道 pt-1 的缝），退场动画播完才卸载。
 *
 * 组件是**纯展示**的：每个目标的状态（ready / done / hint）、连续天数、日历格子、
 * 月份标题全部由 props 传入。它不读 store、不发请求、不管计时、也不碰 Date——
 * 「今天」这件事由父组件算好，这里只认「数组最后一个是今天」这一条约定（见 layoutWeeks）。
 */

export interface CheckinCalendarDay {
  /** 这一格的日期。本组件只拿它当 key，不做任何日期解析 */
  day: string
  /** 格子里的数字（几号） */
  label: number
  /** 过了 / 考了没过 / 有学习日但没打卡 */
  state: 'passed' | 'failed' | 'none'
  /** 是不是今天（加一圈描边）；不给也不影响，位置本身已经说明了它是最后一格 */
  today?: boolean
}

/** 目标 tab 栏里的一档：一个目标 = 一本独立的打卡账 */
export interface CheckinGoalTab {
  goalId: string
  /** tab 与账头上显示的名字 */
  label: string
  /** 这一目标此刻的状态：ready=现在就能打卡；done=今天已打过；hint=还差什么（note 里说） */
  state: 'ready' | 'done' | 'hint'
  /** done / hint 时的说明文字（ready 时是空串——那一行的右侧是打卡按钮） */
  note: string
  /** 连续打卡天数（当前 / 历史最长） */
  streak: number
  best: number
  /** 这一目标的日历账（早 → 晚，最后一个是今天），父组件算好 */
  calendar: CheckinCalendarDay[]
  /** 日历标题，例如 '2026 年 9 月' */
  monthLabel: string
}

export interface CheckinButtonProps {
  /** 每个目标一档（父组件已按最近浏览时间降序排好） */
  tabs: CheckinGoalTab[]
  /** 当前展开哪个目标的账 */
  selectedId: string
  /** 点某个目标 tab */
  onSelect: (goalId: string) => void
  /**
   * 今天是周几（0=周一 … 6=周日）。缺省 6（周日）。
   *
   * 本组件不解析日期，所以「今天落在哪一列」只能由父组件告诉它；不给时按周日算，
   * 那是「最后一个是今天」这条约定的自然结果（见 layoutWeeks）。
   */
  todayWeekday?: number
  /** 点「打卡」——父组件会把它变成对导师的一次请求 */
  onCheckin: (goalId: string) => void
}

/** 指针离开后延后这么久再收：按钮与面板之间有一道 pt-1 的缝，立刻收会在半路上被关掉 */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐（0.14s；留宽一点，动画播完才卸载） */
const TIP_EXIT_MS = 160
/** 表头从周一起排；格子对齐也按「一周的最后一天是周日」倒推（见 layoutWeeks） */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
/** 最多铺 5 周：更早的记录回答不了「今天还差什么」，而 60~90 天全铺开会把 tip 撑成一堵墙 */
const MAX_WEEKS = 5
/** tab 栏最多露出多高：目标多过这个数就在栏内滚动、滚动条藏掉（与有效阅读的过滤栏同一条规则） */
const TABS_MAX_H = 300

/**
 * 把格子排成整周。
 *
 * 日期怎么对齐：本组件不解析日期（不碰 Date 就不会被时区、跨零点、数据是几点生成的
 * 这些事影响），它只认「数组最后一个是今天」+ 父组件给的 todayWeekday（0=周一）。
 * 于是让今天正好落在它该在的那一列，前面缺的用空位补齐——行数永远是整周，
 * 看起来就是一页翻到今天的日历，而不是一个悬在半空的方块。
 */
function layoutWeeks(calendar: CheckinCalendarDay[], todayWeekday: number): (CheckinCalendarDay | null)[][] {
  // 只留最近几周：再往前的日子对「今天还差什么」没有帮助，却要占掉同样的宽度
  const recent = calendar.slice(-MAX_WEEKS * WEEKDAYS.length)
  // 让最后一格（今天）落在 todayWeekday 那一列
  const gap = (todayWeekday + 1 - (recent.length % WEEKDAYS.length) + WEEKDAYS.length) % WEEKDAYS.length
  const cells: (CheckinCalendarDay | null)[] = [...Array.from({ length: gap }, () => null), ...recent]
  const rows: (CheckinCalendarDay | null)[][] = []
  for (let i = 0; i < cells.length; i += WEEKDAYS.length) rows.push(cells.slice(i, i + WEEKDAYS.length))
  return rows
}

/**
 * 三种格子的分工：passed 是整张 tip 里**唯一的实心块**（扫一眼就知道哪天真的过了）；
 * failed 铺一层同色系浅底——它和「没学过」必须是两种脸色，那是两种不同的日子；
 * none 也给一点底色，否则它跟补位的空格子长得一模一样，第一行会看着像缺了几格。
 */
function cellClass(cell: CheckinCalendarDay): string {
  const tone =
    cell.state === 'passed'
      ? 'bg-seal text-white'
      : cell.state === 'failed'
        ? 'bg-seal/15 text-seal-deep'
        : 'bg-line/25 text-ink-soft'
  // 今天加一圈描边。passed 是实心的，所以描边必须留出底色那道缝（ring-offset）才看得见
  return cell.today ? tone + ' ring-1 ring-seal ring-offset-1 ring-offset-card' : tone
}

/** 每格的 title：格子里只有两位数，读屏和悬停需要一个说得出「哪一天、怎么了」的句子 */
function cellTitle(cell: CheckinCalendarDay): string {
  const what = cell.state === 'passed' ? t('已打卡') : cell.state === 'failed' ? t('考了没过') : t('没打卡')
  return t('{0} 日 · {1}', cell.label, what)
}

/** tab 右侧的小标记：ready 一颗实心点，done 一颗对钩，其余亮出连续天数（没有就不写） */
function tabMark(tab: CheckinGoalTab): { text?: string; dot?: boolean } {
  if (tab.state === 'ready') return { dot: true }
  if (tab.state === 'done') return { text: '✓' }
  return tab.streak > 0 ? { text: t('{0} 天', tab.streak) } : {}
}

export default function CheckinButton({
  tabs,
  selectedId,
  onSelect,
  todayWeekday = 6,
  onCheckin,
}: CheckinButtonProps) {
  // 浮层要等退场动画播完才卸载，所以展开状态交给 useHoverMenu 管（与 UserMenu / PomodoroButton 同一套时序）
  const { open, setOpen, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: TIP_EXIT_MS,
    buttonOpens: true,
  })

  const readyCount = tabs.filter((t) => t.state === 'ready').length
  const selected = tabs.find((t) => t.goalId === selectedId) ?? tabs[0]
  const weeks = selected ? layoutWeeks(selected.calendar, todayWeekday) : []
  /*
   * 今天以前一片空白（第一次用的人）：日历照样铺出来，只是上面多一句引导。
   * 判断只看「今天以前」，所以先把最后一个（今天）摘掉——否则今天刚打过卡的人
   * 会被当成「有历史」，那句引导就永远不出现。
   */
  const fresh = !!selected && !selected.calendar.slice(0, -1).some((d) => d.state !== 'none')

  return (
    // no-drag：本组件在顶栏的可拖拽区里。面板是浮层，它上面的每一寸都该响应指针，
    // 否则指针落到面板空白处会变成拖窗口（按钮有全局 no-drag 兜底，面板没有）
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={readyCount > 0 ? t('现在有 {0} 个目标可以打卡', readyCount) : t('打卡（按学习目标分开算）')}
        {...buttonProps}
        aria-expanded={open}
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ${
          readyCount > 0 ? 'text-ink' : open ? 'text-ink' : 'text-ink-soft hover:text-ink'
        }`}
      >
        <div className={`relative flex items-center justify-center ${readyCount > 0 ? 'text-seal' : open ? 'text-ink' : 'text-ink-faint group-hover:text-ink'}`}>
          <Flame size={14} className={readyCount > 0 ? 'fill-seal/20' : ''} />
          {readyCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal" />
            </span>
          )}
        </div>
        <span className={`shrink-0 ${readyCount > 0 ? 'font-medium text-ink' : ''}`}>{t('打卡')}</span>
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`min-h-[320px] w-[500px] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            {/* --- 顶部卡片：标题与当前可打卡总数 --- */}
            <div className="flex items-center justify-between gap-3 border-b border-line/40 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-seal/10 text-seal">
                  <Flame size={14} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink-strong">{t('目标打卡')}</span>
                    <span className="text-[11px] text-ink-faint">
                      · {t('按学习目标独立结算')}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-ink-faint">
                    {t('每日完成导师题目或达成有效阅读即可打卡')}
                  </div>
                </div>
              </div>

              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                  readyCount > 0
                    ? 'border-seal/30 bg-seal/10 text-seal-deep shadow-2xs'
                    : 'border-line/40 bg-line/30 text-ink-faint'
                }`}
              >
                {readyCount > 0 ? t('{0} 个目标可打卡', readyCount) : t('今日尚无待打卡')}
              </span>
            </div>

            <div className="mt-3 flex gap-3">
              {/* --- 左：目标选择列表 --- */}
              <div className="w-[136px] shrink-0 border-r border-line/50 pr-2.5">
                <div className="mb-1.5 px-1 text-[10.5px] font-medium text-ink-faint">
                  {t('目标账本')}
                </div>
                <div className="space-y-1 overflow-y-auto moji-scroll-none" style={{ maxHeight: TABS_MAX_H }}>
                  {tabs.map((tab) => {
                    const active = tab.goalId === selected?.goalId
                    const mark = tabMark(tab)
                    return (
                      <button
                        key={tab.goalId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => onSelect(tab.goalId)}
                        title={tab.label + (tab.note ? '（' + tab.note + '）' : '')}
                        className={`flex w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all ${
                          active
                            ? 'bg-seal/12 text-seal-deep font-medium border-l-2 border-seal shadow-2xs'
                            : 'text-ink-soft hover:bg-line/40 hover:text-ink'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-[11.5px]">{tab.label}</span>
                        {mark.dot && (
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-seal" />
                          </span>
                        )}
                        {mark.text && (
                          <span
                            className={`shrink-0 rounded px-1 py-0.5 text-[9.5px] tabular-nums ${
                              tab.state === 'done'
                                ? 'bg-ok/15 text-ok-deep font-medium'
                                : 'bg-line/40 text-ink-faint'
                            }`}
                          >
                            {mark.text}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* --- 右：目标打卡面板（状态 / 打卡按钮 / 日历） --- */}
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                {selected ? (
                  <>
                    {/* 顶部操作与连胜说明 */}
                    <div className="rounded-xl border border-line/50 bg-paper/50 p-2.5 dark:bg-paper/20">
                      <div className="flex items-center justify-between gap-2">
                        {selected.state === 'ready' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-medium text-seal-deep">{t('今日条件已达成')}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setOpen(false)
                                onCheckin(selected.goalId)
                              }}
                              className="flex items-center gap-1.5 rounded-lg bg-seal px-3 py-1 text-[11.5px] font-medium text-white shadow-sm transition-all hover:bg-seal-deep active:scale-[0.98]"
                            >
                              <Flame size={12} className="fill-current" /> {t('立即打卡')}
                            </button>
                          </div>
                        ) : (
                          <span
                            className={`min-w-0 truncate text-[11.5px] ${
                              selected.state === 'done' ? 'font-medium text-ok-deep' : 'text-ink-soft'
                            }`}
                          >
                            {selected.state === 'done' ? t('✓ 今日已打卡') : selected.note}
                          </span>
                        )}

                        {(selected.streak > 0 || selected.best > 0) && (
                          <span className="shrink-0 rounded-md bg-card/60 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-ink-soft border border-line/40">
                            {t('连续 {0} 天', selected.streak)}
                            {selected.best > 0 && <span className="text-ink-faint ml-1">({t('最高 {0}', selected.best)})</span>}
                          </span>
                        )}
                      </div>
                    </div>

                    {fresh && (
                      <p className="mt-2 rounded-xl bg-line/20 p-2 text-[10.5px] leading-relaxed text-ink-soft border border-line/30">
                        {t('从今天开始：完成导师出题、阅读达标或考试及格，均会自动记入打卡。')}
                      </p>
                    )}

                    {/* 日历模块 */}
                    <div className="mt-2.5 rounded-xl border border-line/40 bg-paper/30 p-2.5 dark:bg-paper/20">
                      <div className="mb-1.5 flex items-center justify-between px-0.5">
                        <span className="text-[11px] font-medium text-ink-strong">{selected.monthLabel}</span>
                        <span className="text-[10px] text-ink-faint">{t('最近 5 周记录')}</span>
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {WEEKDAYS.map((w) => (
                          <span key={w} className="text-center text-[10px] text-ink-faint py-0.5">
                            {t(w)}
                          </span>
                        ))}
                        {weeks.map((row, ri) =>
                          row.map((cell, ci) =>
                            cell === null ? (
                              <span key={'gap-' + ri + '-' + ci} />
                            ) : (
                              <span
                                key={cell.day}
                                title={cellTitle(cell)}
                                className={`flex h-6.5 items-center justify-center rounded-md text-[10.5px] tabular-nums transition-all ${cellClass(cell)}`}
                              >
                                {cell.label}
                              </span>
                            ),
                          ),
                        )}
                      </div>

                      {/* 图例 */}
                      <div className="mt-2 flex items-center justify-center gap-4 border-t border-line/30 pt-1.5 text-[9.5px] text-ink-faint">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-xs bg-seal" />
                          {t('已打卡')}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-xs bg-seal/20" />
                          {t('考了没过')}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-xs bg-line/40" />
                          {t('未打卡')}
                        </span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl bg-paper/40 py-8 px-4 text-center dark:bg-paper/20">
                    <Flame size={24} className="text-ink-faint mb-1.5 opacity-50" />
                    <p className="text-[11.5px] text-ink-soft">
                      {t('暂无学习目标')}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-ink-faint">
                      {t('新建目标后即可开启专属打卡账本。')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
