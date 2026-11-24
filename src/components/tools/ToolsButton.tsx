import { useState, useSyncExternalStore } from 'react'
import { BellRing, CalendarClock, Check, Clock, Crop, Calculator, Wrench } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import { toggleCalculator } from '../../lib/calculatorState'
import {
  SCHEDULE_SNOOZE_CHOICES,
  timeTextOf,
  type ScheduleItem,
} from '../../learn/schedule'
import { t } from '../../i18n'
import { bindingOf, subscribeShortcutBindings } from '../../lib/shortcuts'

/** 指针离开后延后这么久再收：按钮与面板之间有一道 pt-1 的缝（与日程/专注一致） */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐 */
const PANEL_EXIT_MS = 160

export interface ToolsButtonProps {
  /** 触发截图 */
  onScreenshot: () => void
  /** 提示消息（可选） */
  onToast?: (msg: string) => void
  /** 日程接线：今天日程、正在响日程与操作 */
  schedule?: {
    today: ScheduleItem[]
    now: number
    ringing: ScheduleItem | null
    onOpen: () => void
    onComplete: (id: string) => void
    onSnooze: (id: string, minutes: number) => void
  }
}

export default function ToolsButton({ onScreenshot, schedule }: ToolsButtonProps) {
  const { open, setOpen, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: PANEL_EXIT_MS,
    buttonOpens: true,
  })

  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const screenshotCombo = useSyncExternalStore(
    subscribeShortcutBindings,
    () => bindingOf('tools.screenshot'),
    () => bindingOf('tools.screenshot'),
  )

  const ringing = schedule?.ringing ?? null
  const pendingCount = schedule ? schedule.today.filter((it) => !it.doneAt).length : 0

  return (
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={
          ringing
            ? t('日程提醒：{0}', ringing.title)
            : t('工具箱：截图、日程、计算器')
        }
        {...buttonProps}
        aria-expanded={open || Boolean(ringing)}
        className={
          'group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ' +
          (ringing ? 'text-seal font-semibold' : open ? 'text-ink' : 'text-ink-soft hover:text-ink')
        }
      >
        <span className="relative flex items-center justify-center">
          <Wrench
            size={14}
            className={
              ringing
                ? 'animate-pulse text-seal'
                : open
                ? 'text-ink'
                : 'text-ink-faint group-hover:text-ink'
            }
          />
          {/* 未完成日程小徽标或正在响铃脉冲 */}
          {!ringing && pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-seal px-0.5 text-[8.5px] font-semibold leading-none text-white">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
          {ringing && (
            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal" />
            </span>
          )}
        </span>
        <span className="shrink-0 text-[12px]">{t('工具')}</span>
      </button>

      {/* 悬停下拉 Tip：实用工具列表（已缩小边框圆角至 rounded-lg） */}
      {mounted && !ringing && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`w-[260px] rounded-lg border border-line-strong/70 bg-card/95 p-2 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            <div className="mb-1.5 flex items-center justify-between px-2 py-0.5 text-[11px] font-medium text-ink-faint">
              <span>{t('实用工具')}</span>
            </div>

            <div className="flex flex-col gap-1">
              {/* 1. 截图选项（当前全局快捷键唤出） */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onScreenshot()
                }}
                title={t('截图（{0} 键快速唤出）', screenshotCombo)}
                className="group/item flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-line/60"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-seal/10 text-seal transition group-hover/item:bg-seal group-hover/item:text-white">
                  <Crop size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-ink-strong">{t('截图')}</span>
                    <kbd className="rounded border border-line-strong/60 bg-paper-deep/70 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft shadow-xs">
                      {screenshotCombo}
                    </kbd>
                  </div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {t('区域截屏、取色与批注')}
                  </div>
                </div>
              </button>

              {/* 2. 日程安排选项（收进工具菜单） */}
              {schedule && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    schedule.onOpen()
                  }}
                  title={t('日程安排（点开查看今日事项与排程）')}
                  className="group/item flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-line/60"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 transition group-hover/item:bg-amber-600 group-hover/item:text-white">
                    <CalendarClock size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-medium text-ink-strong">{t('日程安排')}</span>
                      {pendingCount > 0 && (
                        <span className="rounded-full bg-seal/15 px-1.5 py-0.2 text-[10px] font-semibold text-seal">
                          {t('待办 {0}', pendingCount)}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-ink-faint">
                      {t('今日日程与提醒排程')}
                    </div>
                  </div>
                </button>
              )}

              {/* 3. 计算器选项（悬浮窗口） */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  toggleCalculator()
                }}
                title={t('计算器（:calc 快速切换）')}
                className="group/item flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition hover:bg-line/60"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 transition group-hover/item:bg-sky-600 group-hover/item:text-white">
                  <Calculator size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-ink-strong">{t('计算器')}</span>
                    <kbd className="rounded border border-line-strong/60 bg-paper-deep/70 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft shadow-xs">
                      :calc
                    </kbd>
                  </div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {t('标准 / 科学 / 程序员模式')}
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 日程到点提醒弹层：不受悬停控制，正在响就常驻（已缩小边框圆角至 rounded-lg） */}
      {ringing && schedule && (
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
              <p className="mt-1 line-clamp-3 text-[12px] leading-relaxed text-ink-soft">
                {ringing.note}
              </p>
            )}

            <div className="mt-3.5 flex items-center justify-end gap-1.5">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSnoozeOpen(!snoozeOpen)}
                  className="rounded-md border border-line px-2 py-1 text-[11.5px] font-medium text-ink-soft transition hover:bg-line/60 hover:text-ink"
                >
                  {t('稍后提醒')}
                </button>
                {snoozeOpen && (
                  <div className="absolute bottom-full right-0 mb-1 z-50 w-28 rounded-md border border-line-strong bg-card py-1 shadow-lg text-[11.5px]">
                    {SCHEDULE_SNOOZE_CHOICES.map((min) => (
                      <button
                        key={min}
                        type="button"
                        onClick={() => {
                          setSnoozeOpen(false)
                          schedule.onSnooze(ringing.id, min)
                        }}
                        className="flex w-full items-center px-3 py-1 text-left text-ink hover:bg-seal/10 hover:text-seal transition"
                      >
                        {t('{0} 分钟后', min)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => schedule.onComplete(ringing.id)}
                className="flex items-center gap-1 rounded-md bg-seal px-3 py-1 text-[11.5px] font-medium text-white transition hover:bg-seal-deep shadow-xs"
              >
                <Check size={12} />
                <span>{t('知道了')}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
