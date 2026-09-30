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
        className={'flex h-8 items-center gap-1.5 rounded-md px-1.5 transition ' + (open ? 'bg-line/70' : 'hover:bg-line/70')}
      >
        <BookOpen size={14} className={todayMs > 0 ? 'text-seal' : 'text-ink-faint'} />
        {/* 12.5px 而不是 12px：顶栏这一行里其它几个字都是 12.5px，差半个像素时
            文字的顶边会差 0.37px——眼睛看不出来，但量得出来，而且没有理由不一致 */}
        <span className={'hidden text-[12.5px] tabular-nums sm:inline ' + (todayMs > 0 ? 'text-ink-soft' : 'text-ink-faint')}>
          {/* mm:ss：这一栏要让人看见它正在走（见 readingClockText）。
              跳字（RollingDigits）只动变了的那一位，所以「走」看得出来，又不会整串在闪 */}
          {todayMs > 0 ? <RollingDigits text={readingClockText(todayMs)} /> : t('阅读')}
        </span>
      </button>

      {mounted && (
        // pt-1 是桥：那 4px 缝必须落在本组件内，否则指针穿过去就会触发 mouseleave
        <div className="absolute right-0 top-full z-30 pt-1">
          <div
            role="menu"
            className={
              'min-h-[300px] w-[560px] rounded-lg border border-line-strong bg-card p-2.5 shadow-[0_8px_28px_rgba(31,27,23,0.18)] ' +
              panelProps.className
            }
          >
            <div className="flex items-baseline gap-2 px-0.5">
              <span className="text-[15px] font-medium text-ink-strong">
                {todayMs > 0 ? <RollingDigits text={readingClockText(todayMs)} /> : t('今天还没开始')}
              </span>
              <span className="text-[11px] text-ink-faint">
                {scopeId === 'all' ? t('全部目标') : scopeLabel}
              </span>
              <span className="ml-auto text-[11px] text-ink-faint">
                {weekMinutes > 0 ? t('最近一周 {0} 分', weekMinutes) : ''}
              </span>
            </div>
            <div className="mt-0.5 px-0.5 text-[11px] text-ink-faint">{t('只算「窗口在前台、页签在主位、真的在读」的时间')}</div>

            <div className="mt-2.5 flex gap-3">
              {/* --- 左：过滤栏（竖排）。选哪一档只影响右边那份统计。
                      目标多过一栏时在栏内滚动、不把面板撑长；滚动条藏掉（moji-scroll-none），
                      那条位置本来就窄，滚轮与触控板照常用 --- */}
              <div className="w-[128px] shrink-0 border-r border-line pr-2">
                <div
                  className="space-y-0.5 overflow-y-auto moji-scroll-none"
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
                        className={
                          'flex w-full items-baseline gap-1.5 rounded-md px-2 py-1 text-left transition ' +
                          (active ? 'bg-seal/12 text-seal-deep' : 'text-ink-soft hover:bg-line/50 hover:text-ink')
                        }
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px]">{tab.label}</span>
                        <span className="shrink-0 text-[10.5px] tabular-nums opacity-80">{tabMinutes(tab.todayMs)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* --- 右：这一档的按节点统计（每页 10 条、按最近阅读时间降序）+ 最近一周 --- */}
              <div className="min-w-0 flex-1">
                {empty ? (
                  <p className="rounded-md bg-paper-deep/50 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft">
                    {t('这一档还没有阅读记录。打开一份文档读一会儿，这里会出现读了多久、读到哪一节。')}
                  </p>
                ) : (
                  <>
                    <div className="min-h-[196px] space-y-0.5">
                      {pageRows.map((row) => (
                        <button
                          key={row.nodeId}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setOpen(false)
                            onOpenNode(row.nodeId)
                          }}
                          className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left transition hover:bg-line/50"
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{row.title}</span>
                          <span className="w-[64px] shrink-0 truncate text-right text-[10.5px] text-ink-faint">
                            {scopeId === 'all' ? (row.goal ?? '') : ''}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">{t('{0} 分钟', row.minutes)}</span>
                          <span className="w-[60px] shrink-0 text-right text-[10.5px] text-ink-faint">
                            {row.done ? t('读完') : row.progress}
                          </span>
                        </button>
                      ))}
                    </div>
                    {pageCount > 1 && (
                      <div className="flex items-center justify-between px-2 pt-1 text-[10.5px] text-ink-faint">
                        <button
                          type="button"
                          disabled={safe <= 0}
                          onClick={() => setPage(Math.max(0, safe - 1))}
                          className={'rounded px-1.5 py-0.5 transition ' + (safe <= 0 ? 'opacity-40' : 'hover:bg-line/50 hover:text-ink')}
                        >
                          {t('‹ 上一页')}
                        </button>
                        <span className="tabular-nums">{t('{0} / {1} 页 · 共 {2} 个节点', safe + 1, pageCount, nodes.length)}</span>
                        <button
                          type="button"
                          disabled={safe >= pageCount - 1}
                          onClick={() => setPage(Math.min(pageCount - 1, safe + 1))}
                          className={'rounded px-1.5 py-0.5 transition ' + (safe >= pageCount - 1 ? 'opacity-40' : 'hover:bg-line/50 hover:text-ink')}
                        >
                          {t('下一页 ›')}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* 最近七天：柱子按峰值归一，今天用封泥色标出来。
                    总量（需求里那句「最近一周阅读总时长」）在上面右上角，这里画的是它的形状 */}
                <div className="mt-2 flex items-end gap-1 border-t border-line pt-2">
                  {week.map((d) => (
                    <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={t('{0} 日 · {1} 分钟', d.label, d.minutes)}>
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: Math.max(2, Math.round((d.minutes / peak) * 20)) + 'px',
                          background: d.today ? 'var(--color-seal)' : 'var(--color-line-strong)',
                          opacity: d.minutes > 0 ? (d.today ? 0.85 : 0.7) : 0.35,
                        }}
                      />
                      <span className={'text-[9.5px] tabular-nums ' + (d.today ? 'text-seal' : 'text-ink-faint')}>{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
