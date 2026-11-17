/**
 * 顶栏的日程入口（鼠标经过即展开今日日程）+ **到点提醒弹层**。
 *
 * 两块内容共用一颗按钮，但时机不同：
 * - **悬停 tip**：今天还剩什么，以及「手动安排日程」那颗按钮（点开日程页签）；
 * - **提醒弹层**：到点时自动出现（不靠悬停），上面是事项本身与两颗收场按钮
 *   （知道了 / 隔一阵再提醒）。此时顶栏整体在渐变呼吸（见 styles/workspace.css
 *   的 .moji-schedule-glow，类挂在 Topbar 上，由工作区按 ringing 传下去）。
 *
 * 组件是纯展示的：今日清单、当前时刻、正在响的那一条与全部回调都由 props 传入。
 * 它不读 store、不碰音频——提醒引擎在 workspace/useScheduleFlow，铃声在 lib/scheduleSound。
 */

import { BellRing, CalendarClock, CalendarPlus, Check, ChevronRight, Clock } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import {
  SCHEDULE_SNOOZE_CHOICES,
  isMissed,
  timeTextOf,
  type ScheduleItem,
} from '../../learn/schedule'
import { t } from '../../i18n'

/** 指针离开后延后这么久再收：按钮与面板之间有一道 pt-1 的缝（与专注模式一致） */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐 */
const PANEL_EXIT_MS = 160
/** tip 里最多列几条：再多就不叫「简单显示今日日程」了 */
const TIP_ROWS = 5

export interface ScheduleButtonProps {
  /** 今天的全部日程（含已完成的；按开始时间升序） */
  today: ScheduleItem[]
  /** 当前时刻（由工作区每秒推一次；只用来算「已错过 / 进行中」） */
  now: number
  /** 此刻正在响的那一条；null = 没在响 */
  ringing: ScheduleItem | null
  /** 打开日程安排页签（tip 里的「手动安排日程」与提醒弹层里的「打开日程表」都走它） */
  onOpen: () => void
  /** 用户确认（知道了） */
  onComplete: (id: string) => void
  /** 隔一阵再提醒（分钟） */
  onSnooze: (id: string, minutes: number) => void
}

export default function ScheduleButton({
  today,
  now,
  ringing,
  onOpen,
  onComplete,
  onSnooze,
}: ScheduleButtonProps) {
  const { open, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: PANEL_EXIT_MS,
    buttonOpens: true,
  })

  const pending = today.filter((it) => !it.doneAt)
  const shown = today.slice(0, TIP_ROWS)
  const rest = today.length - shown.length

  return (
    // no-drag：本组件在顶栏的可拖拽区里；面板是浮层，上面每一寸都该响应指针
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={
          ringing
            ? t('日程提醒：{0}', ringing.title)
            : pending.length
              ? t('今天还有 {0} 项日程（悬停查看）', pending.length)
              : t('日程：悬停查看今天，点开安排')
        }
        {...buttonProps}
        aria-expanded={open || !!ringing}
        className={
          'group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ' +
          (ringing ? 'text-seal' : open ? 'text-ink' : 'text-ink-soft hover:text-ink')
        }
      >
        <span className="relative flex items-center justify-center">
          <CalendarClock
            size={14}
            className={
              ringing
                ? 'animate-pulse text-seal'
                : open
                  ? 'text-ink'
                  : 'text-ink-faint group-hover:text-ink'
            }
          />
          {/* 今日未完成数：一个点太模糊，数字才说得清「还有几件」 */}
          {!ringing && pending.length > 0 && (
            <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-seal px-0.5 text-[8.5px] font-semibold leading-none text-white">
              {pending.length > 9 ? '9+' : pending.length}
            </span>
          )}
          {ringing && (
            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal" />
            </span>
          )}
        </span>
        <span className="shrink-0 text-[12px]">{t('日程')}</span>
      </button>

      {/* ---------- 悬停 tip：今天的清单 ---------- */}
      {mounted && !ringing && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`w-[336px] rounded-lg border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            <div className="flex items-center justify-between gap-2 px-0.5">
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-seal/10 text-seal">
                  <CalendarClock size={12} />
                </span>
                <span className="text-[13px] font-semibold text-ink-strong">{t('今日日程')}</span>
              </div>
              <span className="rounded-full bg-line/50 px-2 py-0.5 text-[10.5px] font-medium text-ink-faint">
                {today.length ? t('待办 {0} · 共 {1}', pending.length, today.length) : t('空')}
              </span>
            </div>

            {shown.length ? (
              <ul className="mt-2.5 space-y-0.5">
                {shown.map((it) => {
                  const done = !!it.doneAt
                  const missed = isMissed(it, now)
                  return (
                    <li
                      key={it.id}
                      className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition hover:bg-line/40"
                    >
                      <span
                        className={
                          'w-10 shrink-0 text-right text-[11.5px] font-semibold tabular-nums ' +
                          (done ? 'text-ink-faint line-through' : 'text-ink')
                        }
                      >
                        {timeTextOf(it.startAt)}
                      </span>
                      <span
                        className={
                          'min-w-0 flex-1 truncate text-[12px] ' +
                          (done ? 'text-ink-faint line-through' : 'text-ink')
                        }
                        title={it.title}
                      >
                        {it.title}
                      </span>
                      {done ? (
                        <Check size={11} className="shrink-0 text-ok" />
                      ) : missed ? (
                        <span className="shrink-0 text-[9.5px] text-warn-deep">{t('已错过')}</span>
                      ) : (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal/70" />
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2.5 rounded-lg bg-paper/60 px-2.5 py-3 text-center text-[11px] leading-relaxed text-ink-faint">
                {t('今天还没有安排。把要做的事写下来，到点会提醒你。')}
              </p>
            )}

            {rest > 0 && (
              <button
                type="button"
                onClick={onOpen}
                className="mt-1 flex w-full items-center justify-center gap-0.5 rounded-md py-1 text-[10.5px] text-ink-faint transition hover:text-ink"
              >
                {t('还有 {0} 项', rest)}
                <ChevronRight size={10} />
              </button>
            )}

            <button
              type="button"
              onClick={onOpen}
              className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-seal text-[12px] font-medium text-white shadow-sm transition hover:bg-seal-deep active:scale-[0.99]"
            >
              <CalendarPlus size={12} />
              {t('手动安排日程')}
            </button>
          </div>
        </div>
      )}

      {/* ---------- 提醒弹层：到点自动出现 ---------- */}
      {ringing && (
        <div className="absolute right-0 top-full z-40 pt-1.5">
          <div className="moji-in-down w-[344px] rounded-lg border border-seal/45 bg-card/97 p-3.5 shadow-[0_16px_44px_rgba(31,27,23,0.28)] backdrop-blur-md">
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 animate-pulse items-center justify-center rounded-md bg-seal/15 text-seal">
                <BellRing size={12} />
              </span>
              <span className="text-[12.5px] font-semibold text-seal-deep">{t('日程提醒')}</span>
              <span className="ml-auto flex items-center gap-1 text-[10.5px] tabular-nums text-ink-faint">
                <Clock size={10} />
                {timeTextOf(ringing.startAt)}
              </span>
            </div>

            <p className="mt-2 break-words text-[15px] font-semibold leading-snug text-ink-strong">
              {ringing.title}
            </p>
            {ringing.note && (
              <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-ink-soft">
                {ringing.note}
              </p>
            )}

            <button
              type="button"
              onClick={() => onComplete(ringing.id)}
              className="mt-3 flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg bg-seal text-[12.5px] font-medium text-white shadow-sm transition hover:bg-seal-deep active:scale-[0.99]"
            >
              <Check size={13} />
              {t('知道了（标记完成）')}
            </button>

            <div className="mt-2.5">
              <div className="text-[10.5px] text-ink-faint">{t('稍后提醒')}</div>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {SCHEDULE_SNOOZE_CHOICES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onSnooze(ringing.id, m)}
                    className="h-7 rounded-lg border border-line/70 bg-paper/60 text-[11px] font-medium text-ink-soft transition hover:border-seal/40 hover:bg-seal/10 hover:text-seal-deep"
                  >
                    {t('{0} 分钟后', m)}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={onOpen}
              className="mt-2.5 flex w-full items-center justify-center gap-0.5 border-t border-line/40 pt-2 text-[10.5px] text-ink-faint transition hover:text-ink"
            >
              {t('打开日程表')}
              <ChevronRight size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
