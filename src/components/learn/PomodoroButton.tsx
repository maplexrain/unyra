import { Pause, Play, Square, Timer } from 'lucide-react'
import type { ReactNode } from 'react'
import { useHoverMenu } from '../../lib/hoverMenu'
import RollingDigits from './RollingDigits'
import {
  MAX_FOCUS_MINUTES,
  MAX_GROUPS,
  MIN_FOCUS_MINUTES,
  MIN_GROUPS,
  formatClock,
  phaseLabel,
  restMsOf,
  type PomodoroPhase,
} from '../../learn/pomodoro'
import { t } from '../../i18n'

/**
 * 顶栏的番茄钟入口。
 *
 * 它是一个**纯计时器**：设好「一段多长、做几组」，按下开始，剩下的交给它自己走。
 * 于是这个面板只回答四件事——现在走到哪了（进度条与大字倒计时）、开始之前能调什么
 * （时长滑块与组数）、要不要请守卫盯着（严格专注的两个勾选与实时画面）、以及怎么停。
 *
 * 组件是**纯展示**的：剩余时间、设置项与回调全部由 props 传入，
 * 它不读 store、不发请求、不持有倒计时，也不碰媒体流——预览与守卫状态是 Dock
 * 递进来的现成节点（previews / guardStatus）。计时的唯一主人是父组件。
 */

/** 严格专注勾选了哪几路监控（勾了任意一路就算严格专注，守卫按能看到的调整策略） */
export interface FocusMonitors {
  screen: boolean
  camera: boolean
}

export interface PomodoroButtonProps {
  /** 正在跑的那一段（没在跑就是 null） */
  running: { phase: PomodoroPhase; index: number; groups: number; focusMinutes: number } | null
  /** 剩余毫秒（没在跑就是 null）；到 0 之后由父组件收尾，这里不必处理 */
  remainingMs: number | null
  /** 这一段的长度（进度条的分母）；没在跑就是 null */
  phaseMs: number | null
  /** 下一次开始的专注时长（分钟）；正在跑时以 running 里的为准 */
  focusMinutes: number
  /** 下一次开始的组数；正在跑时以 running 里的为准 */
  groups: number
  onFocusMinutes: (minutes: number) => void
  onGroups: (groups: number) => void
  /** 用户点了「开始」——父组件才真正开始计时 */
  onStart: () => void
  /** 停止（停下来这一段就作废；要接着跑只能重新开始） */
  onStop: () => void
  /** 严格专注的勾选状态（跑起来之后锁住，与时长/组数一致） */
  monitors: FocusMonitors
  /** 勾/去一路监控；媒体流的起停由父组件管（勾上就有预览，取消就断流） */
  onMonitorToggle: (kind: 'screen' | 'camera') => void
  /** 勾选后出现的实时画面（屏幕/摄像头各一块；预览只为对角度防隐私，不参与计时） */
  previews: ReactNode | null
  /** 守卫运行中的状态行 + 「查看守卫」入口（只在严格专注跑起来时给） */
  guardStatus: ReactNode | null
  /** 守卫判离开、计时暂停中（回到应用一交互就自动续上） */
  paused: boolean
  /** 勾了监控但开不起来的提示（模型不支持看图之类）；null = 没问题 */
  strictHint: string | null
}

/** 指针离开后延后这么久再收：按钮与面板之间有一道 pt-1 的缝，立刻收会在半路上被关掉 */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐（0.14s；留宽一点，动画播完才卸载） */
const PANEL_EXIT_MS = 160
/** 最后一分钟才换成醒目色：这个阈值同时也是「该收尾了」的心理提示 */
const URGENT_MS = 60_000
/** 组数就是 1~6，六个都摆出来比滑块更好按（不用瞄准一个 6px 的把手） */
const GROUP_CHOICES = Array.from({ length: MAX_GROUPS - MIN_GROUPS + 1 }, (_, i) => MIN_GROUPS + i)

export default function PomodoroButton({
  running,
  remainingMs,
  phaseMs,
  focusMinutes,
  groups,
  onFocusMinutes,
  onGroups,
  onStart,
  onStop,
  monitors,
  onMonitorToggle,
  previews,
  guardStatus,
  paused,
  strictHint,
}: PomodoroButtonProps) {
  // 浮层要等退场动画播完才卸载，所以展开状态交给 useHoverMenu 管（与 UserMenu 同一套时序）
  const { open, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: PANEL_EXIT_MS,
    buttonOpens: true,
  })

  const left = remainingMs === null ? null : formatClock(remainingMs)
  const urgent = remainingMs !== null && remainingMs <= URGENT_MS
  /*
   * 进度条按**已经走过的比例**画，而且带 1s 的线性过渡：
   * 秒针一秒跳一格，过渡把这一格连成一段连续的推进（否则它看起来像在发抖）。
   * 分母为 0（不该发生）时按 0 处理，别算出 NaN% 把宽度写坏。
   */
  const pct = phaseMs && phaseMs > 0 && remainingMs !== null ? Math.min(100, Math.max(0, ((phaseMs - remainingMs) / phaseMs) * 100)) : 0
  // 正在跑的时候不允许改设置：它们是**这一次**的参数，改了会让「第几组 / 还剩多久」失去意义
  const locked = running !== null
  const shownMinutes = running?.focusMinutes ?? focusMinutes
  const shownGroups = running?.groups ?? groups
  const restMinutes = Math.round(restMsOf(shownMinutes) / 60_000)
  // 没在跑时勾选框常驻（要开严格专注得先勾）；跑起来之后只在这一场真开了时才显示
  const showStrict = !locked || monitors.screen || monitors.camera

  return (
    // no-drag：本组件在顶栏的可拖拽区里。面板是浮层，它上面的每一寸都该响应指针，
    // 否则指针落到面板空白处会变成拖窗口（按钮有全局 no-drag 兜底，面板没有）
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={running ? t('第 {0}/{1} 组 · {2}', running.index, running.groups, t(phaseLabel(running.phase))) + (left ? t(' · 还剩 {0}', left) : '') : t('番茄钟：设好时长与组数，点开始')}
        // 展开靠指针经过；点一下也展开（键盘 Tab 过来回车走的就是这条）。
        // 不做「再点收起」——鼠标用户点的时候面板本来就已经开着，再点反而把它关了
        {...buttonProps}
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-md px-2 transition ${open ? 'bg-line/70' : 'hover:bg-line/70'}`}
      >
        <Timer size={14} className={'shrink-0 ' + (running ? 'text-seal' : 'text-ink-faint')} />
        {/*
          折叠态只说两件事：现在是什么状态（专注/休息、第几组）与还剩多久。
          以前这里还挂着一个墙上时钟（yyyy/mm/dd hh:mm:ss），它把这颗按钮撑得很长，
          而且和邻居们（有效阅读的 mm:ss、打卡的两个字）不是一个量级——
          顶栏是共用的，越短越安静越好。要看得见时间的是**倒计时**，不是现在几点。
        */}
        {running ? (
          <>
            {paused && <Pause size={12} className="shrink-0 text-warn-deep" />}
            <span className="shrink-0 text-[12.5px] text-ink">
              {t(phaseLabel(running.phase))} {running.index}/{running.groups}
            </span>
            {/* 折叠态固定用 seal + 加粗：它同时是「正在计时」的信号，不该等最后一分钟才亮起来 */}
            {left !== null && (
              <RollingDigits text={left} className={'shrink-0 text-[12.5px] font-semibold ' + (urgent ? 'text-warn-deep' : 'text-seal')} />
            )}
          </>
        ) : (
          <span className="shrink-0 text-[12.5px] text-ink-faint">{t('专注')}</span>
        )}
      </button>

      {mounted && (
        /*
          pt-1 这一层是「桥」：按钮与面板之间那 4px 缝必须落在本组件内，
          否则指针穿过缝的一瞬间就会触发 wrapper 的 mouseleave，面板当场收起。
          动画与外观都作用在里面真正的面板上（与 UserMenu 一致）。
        */
        <div className="absolute right-0 top-full z-30 pt-1">
          <div
            className={`w-[304px] rounded-lg border border-line-strong bg-card p-2.5 shadow-[0_8px_28px_rgba(31,27,23,0.18)] ${panelProps.className}`}
          >
            {/* --- 1. 现在走到哪了：大字数 + 一条进度条 --- */}
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <span className={'text-[22px] font-semibold leading-none ' + (running ? (urgent ? 'text-warn-deep' : 'text-seal') : 'text-ink-faint')}>
                {left !== null ? <RollingDigits text={left} /> : formatClock(shownMinutes * 60_000)}
              </span>
              <span className="min-w-0 truncate text-[11px] text-ink-faint">
                {running ? t('第 {0}/{1} 组 · {2}', running.index, running.groups, t(phaseLabel(running.phase))) : t('还没开始')}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/60">
              <div
                className={'h-full rounded-full transition-[width] duration-1000 ease-linear ' + (running?.phase === 'rest' ? 'bg-ok' : 'bg-seal')}
                style={{ width: pct + '%' }}
              />
            </div>

            {/* 守卫判离开：计时冻结着，告诉用户怎么续上（交互监听在守卫运行时手里） */}
            {running && paused && (
              <div className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] leading-relaxed text-warn-deep">
                {t('守卫发现你不在屏幕前，计时已暂停——回到应用随便点一下或敲个键就继续')}
              </div>
            )}

            {/* --- 2. 开始之前可以先调：时长滑块 + 组数 --- */}
            <div className="mt-2.5 rounded-md border border-line bg-paper-deep/40 px-2.5 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[12px] text-ink-strong">{t('一段专注多长')}</span>
                <span className="ml-auto text-[12px] font-medium tabular-nums text-seal-deep">{t('{0} 分钟', shownMinutes)}</span>
              </div>
              <input
                type="range"
                min={MIN_FOCUS_MINUTES}
                max={MAX_FOCUS_MINUTES}
                step={5}
                value={shownMinutes}
                disabled={locked}
                onChange={(e) => onFocusMinutes(Number(e.target.value))}
                className="mt-1.5 w-full accent-[var(--color-seal)] disabled:opacity-50"
              />
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[12px] text-ink-strong">{t('做几组')}</span>
                <span className="ml-auto text-[11px] text-ink-faint">
                  {t('每组之后休息 {0} 分钟（专注的 1/5）', restMinutes)}
                </span>
              </div>
              <div className="mt-1.5 flex gap-1">
                {GROUP_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={locked}
                    onClick={() => onGroups(n)}
                    title={t('做 {0} 组', n)}
                    className={
                      'h-6 flex-1 rounded-md border text-[11px] tabular-nums transition disabled:cursor-not-allowed ' +
                      (n === shownGroups
                        ? 'border-seal/60 bg-seal/10 font-medium text-seal-deep'
                        : 'border-line text-ink-soft enabled:hover:bg-line/50') +
                      (locked ? ' opacity-60' : '')
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* --- 3. 严格专注：勾了任意一路就是严格模式，守卫按拿到的画面调整策略 --- */}
            {showStrict && (
              <div className="mt-2 rounded-md border border-line bg-paper-deep/40 px-2.5 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] text-ink-strong">{t('严格专注')}</span>
                  <span className="ml-auto text-[11px] text-ink-faint">
                    {monitors.screen || monitors.camera ? t('守卫 agent 每分钟看一眼') : t('勾选即开启')}
                  </span>
                </div>
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    checked={monitors.screen}
                    disabled={locked}
                    onChange={() => onMonitorToggle('screen')}
                    className="accent-[var(--color-seal)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {t('监控屏幕')}
                </label>
                <label className="mt-1 flex cursor-pointer items-center gap-2 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    checked={monitors.camera}
                    disabled={locked}
                    onChange={() => onMonitorToggle('camera')}
                    className="accent-[var(--color-seal)] disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {t('监控摄像头')}
                </label>
                {strictHint && <p className="mt-1.5 text-[10.5px] leading-relaxed text-warn-deep">{strictHint}</p>}
                {previews}
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-faint">
                  {t('画面只用于判断学习状态、逐轮发给模型，不落盘；出现隐私画面会立即熔断停止专注。')}
                </p>
              </div>
            )}
            {/* 严格专注跑起来：守卫的实时状态 + 打开上下文页签的入口 */}
            {guardStatus}

            {/* --- 4. 开始 / 停止 --- */}
            {running ? (
              <button
                type="button"
                onClick={onStop}
                className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-line text-[12.5px] font-medium text-ink-soft transition hover:border-warn/50 hover:bg-warn/10 hover:text-warn-deep"
              >
                <Square size={11} /> {t('停止')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-seal text-[12.5px] font-medium text-white transition hover:bg-seal-deep"
              >
                <Play size={11} /> {t('开始专注')}
              </button>
            )}

            {/* --- 5. 收尾小字：把两条规则说清（停止作废、只有完整的专注段算数） --- */}
            <div className="my-1.5 h-px bg-line" />
            <p className="text-[10.5px] leading-relaxed text-ink-faint">
              {t('停下来这一段就不算数，要接着跑只能重新开始；只有跑完的专注段会记一笔。')}
              {monitors.screen || monitors.camera
                ? t('守卫发现你离开会自动暂停计时，回来后自动继续。')
                : running
                  ? t('切屏不打断计时。')
                  : t('到点会提醒你。')}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
