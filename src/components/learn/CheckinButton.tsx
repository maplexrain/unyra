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
        // 展开靠指针经过；点一下也展开（键盘 Tab 过来回车走的就是这条）。
        // 不做「再点收起」——鼠标用户点的时候面板本来就已经开着，再点反而把它关了
        {...buttonProps}
        aria-expanded={open}
        className={'flex h-8 items-center gap-1.5 rounded-md px-2 transition ' + (open ? 'bg-line/70' : 'hover:bg-line/70')}
      >
        <Flame size={14} className={'shrink-0 ' + (readyCount > 0 ? 'text-seal' : 'text-ink-faint')} />
        {/* 顶栏只留入口（需求）：具体哪个目标差多少、能不能打，全在 tip 里说 */}
        <span className="shrink-0 text-[12.5px] text-ink-soft">{t('打卡')}</span>
        {/* 有目标现在就能打：点一颗小点。顶栏塞不下「是哪个目标」，但那件事得看得见 */}
        {readyCount > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal" />}
      </button>

      {mounted && (
        /*
          pt-1 这一层是「桥」：按钮与面板之间那 4px 缝必须落在本组件内，
          否则指针穿过缝的一瞬间就会触发 wrapper 的 mouseleave，面板当场收起。
          动画与外观都作用在里面真正的面板上（与 UserMenu / PomodoroButton 一致）。
        */
        <div className="absolute right-0 top-full z-30 pt-1">
          <div
            className={'min-h-[300px] w-[440px] rounded-lg border border-line-strong bg-card p-2.5 shadow-[0_8px_28px_rgba(31,27,23,0.18)] ' +
              panelProps.className}
          >
            {/* --- 1. 今天有几个目标备好了 --- */}
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <span className={'shrink-0 text-[14px] font-semibold ' + (readyCount > 0 ? 'text-ink-strong' : 'text-ink-soft')}>
                {readyCount > 0 ? t('{0} 个目标可以打卡', readyCount) : t('今天还没有能打卡的目标')}
              </span>
              <span className="min-w-0 truncate text-[11px] text-ink-faint">{t('按目标分开算')}</span>
            </div>

            <div className="mt-2.5 flex gap-3">
              {/* --- 2. 左：目标 tab 栏。每个 tab 一本独立的打卡账（需求）；
                      目标多过一栏时在栏内滚动、滚动条藏掉（与有效阅读的过滤栏同一条规则） --- */}
              <div className="w-[128px] shrink-0 border-r border-line pr-2">
                <div className="space-y-0.5 overflow-y-auto moji-scroll-none" style={{ maxHeight: TABS_MAX_H }}>
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
                        className={
                          'flex w-full items-baseline gap-1.5 rounded-md px-2 py-1 text-left transition ' +
                          (active ? 'bg-seal/12 text-seal-deep' : 'text-ink-soft hover:bg-line/50 hover:text-ink')
                        }
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px]">{tab.label}</span>
                        {mark.dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal" />}
                        {mark.text && (
                          <span
                            className={
                              'shrink-0 text-[10.5px] tabular-nums ' +
                              (tab.state === 'done' ? 'text-ok-deep' : 'opacity-80')
                            }
                          >
                            {mark.text}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* --- 3. 右：当前目标那一本账——状态、连续天数、日历 --- */}
              <div className="min-w-0 flex-1">
                {selected ? (
                  <>
                    <div className="flex min-h-[26px] items-center justify-between gap-2 px-0.5">
                      {selected.state === 'ready' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            onCheckin(selected.goalId)
                          }}
                          className="shrink-0 rounded-md bg-seal px-2.5 py-1 text-[11.5px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
                        >
                          {t('打卡')}
                        </button>
                      ) : (
                        <span
                          className={
                            'min-w-0 truncate text-[11.5px] ' +
                            (selected.state === 'done' ? 'text-ok-deep' : 'text-ink-faint')
                          }
                        >
                          {selected.note}
                        </span>
                      )}
                      {(selected.streak > 0 || selected.best > 0) && (
                        <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
                          {t('连续 {0} 天 · 最长 {1} 天', selected.streak, selected.best)}
                        </span>
                      )}
                    </div>

                    {fresh && (
                      <p className="mt-1.5 rounded-md bg-line/25 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft">
                        {t('从今天开始：在这个目标下完成导师当天的题、读够有效时长，就算打过卡（试卷第一次考试及格也算）。')}
                      </p>
                    )}
                    <div className="mt-1.5 px-0.5 text-[10.5px] text-ink-faint">{selected.monthLabel}</div>
                    <div className="mt-1 grid grid-cols-7 gap-1">
                      {WEEKDAYS.map((w) => (
                        <span key={w} className="text-center text-[10px] text-ink-faint">
                          {t(w)}
                        </span>
                      ))}
                      {weeks.map((row, ri) =>
                        row.map((cell, ci) =>
                          cell === null ? (
                            // 补位格什么都不画，但必须占住位置：否则第一行的星期就对不齐了
                            <span key={'gap-' + ri + '-' + ci} />
                          ) : (
                            <span
                              key={cell.day}
                              title={cellTitle(cell)}
                              className={'flex h-7 items-center justify-center rounded-md text-[11px] tabular-nums ' + cellClass(cell)}
                            >
                              {cell.label}
                            </span>
                          ),
                        ),
                      )}
                    </div>
                    {/* 图例：三种格子的颜色差得不算远，第一次看的人分不出那个实心块是「打过卡」还是「今天」 */}
                    <div className="mt-1.5 flex items-center gap-3 px-0.5 text-[10px] text-ink-faint">
                      <span className="flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm bg-seal" />
                        {t('打过卡')}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm bg-seal/15" />
                        {t('考了没过')}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-2.5 w-2.5 rounded-sm bg-line/25" />
                        {t('没打卡')}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="px-1.5 py-1 text-[11.5px] leading-relaxed text-ink-soft">
                    {t('还没有学习目标：新建一个目标之后，打卡就按目标分开算。')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
