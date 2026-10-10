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
        {...buttonProps}
        aria-expanded={open}
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ${
          running ? 'text-ink' : open ? 'text-ink' : 'text-ink-soft hover:text-ink'
        }`}
      >
        <div className={`relative flex items-center justify-center ${running ? (paused ? 'text-warn-deep' : 'text-seal') : open ? 'text-ink' : 'text-ink-faint group-hover:text-ink'}`}>
          <Timer size={14} />
          {running && !paused && (
            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal" />
            </span>
          )}
        </div>
        {running ? (
          <>
            {paused && <Pause size={12} className="shrink-0 text-warn-deep animate-pulse" />}
            <span className="shrink-0 text-[12px] font-medium text-ink">
              {t(phaseLabel(running.phase))} {running.index}/{running.groups}
            </span>
            {left !== null && (
              <RollingDigits
                text={left}
                className={`shrink-0 tabular-nums font-semibold ${urgent ? 'text-warn-deep' : 'text-seal'}`}
              />
            )}
          </>
        ) : (
          <span className="shrink-0 text-[12px]">{t('专注')}</span>
        )}
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`w-[324px] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            {/* --- 顶部标题与状态标签 --- */}
            <div className="flex items-center justify-between gap-2 px-0.5">
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-md bg-seal/10 text-seal">
                  <Timer size={12} />
                </span>
                <span className="text-[13px] font-semibold text-ink-strong">{t('番茄专注')}</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                  running
                    ? running.phase === 'rest'
                      ? 'bg-ok/15 text-ok-deep'
                      : 'bg-seal/12 text-seal-deep'
                    : 'bg-line/50 text-ink-faint'
                }`}
              >
                {running ? t('第 {0}/{1} 组 · {2}', running.index, running.groups, t(phaseLabel(running.phase))) : t('就绪')}
              </span>
            </div>

            {/* --- 1. 现在走到哪了：卡片式大字时钟 + 平滑进度条 --- */}
            <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-line/50 bg-paper/50 px-3.5 py-3 dark:bg-paper/20">
              <div className={`text-3xl font-bold tracking-tight tabular-nums ${running ? (urgent ? 'text-warn-deep' : 'text-seal') : 'text-ink-strong'}`}>
                {left !== null ? <RollingDigits text={left} /> : formatClock(shownMinutes * 60_000)}
              </div>
              <div className="mt-1 text-[11px] text-ink-faint">
                {running
                  ? running.phase === 'rest'
                    ? t('休息放松中，喝口水活动一下')
                    : t('保持专注，系统正在持续记录')
                  : t('设定专注时长与组数后开启')}
              </div>
              <div className="mt-3 w-full">
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                  <div
                    className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                      running?.phase === 'rest' ? 'bg-ok' : 'bg-seal'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {running && (
                  <div className="mt-1 flex justify-between text-[10px] text-ink-faint tabular-nums">
                    <span>{running.phase === 'rest' ? t('休息阶段') : t('专注阶段')}</span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* 守卫判离开：计时冻结着，告诉用户怎么续上 */}
            {running && paused && (
              <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-[11px] leading-relaxed text-warn-deep">
                <Pause size={13} className="shrink-0 mt-0.5" />
                <span>{t('守卫发现你不在屏幕前，计时已暂停——回到应用随便点一下或敲个键就继续')}</span>
              </div>
            )}

            {/* --- 2. 时长滑块 + 组数 --- */}
            <div className="mt-3 space-y-2.5 rounded-xl border border-line/50 bg-paper/40 p-2.5 dark:bg-paper/20">
              <div>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-ink-strong">{t('一段专注多长')}</span>
                  <span className="rounded-md bg-seal/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-seal-deep">
                    {t('{0} 分钟', shownMinutes)}
                  </span>
                </div>
                <input
                  type="range"
                  min={MIN_FOCUS_MINUTES}
                  max={MAX_FOCUS_MINUTES}
                  step={5}
                  value={shownMinutes}
                  disabled={locked}
                  onChange={(e) => onFocusMinutes(Number(e.target.value))}
                  className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line/70 accent-[var(--color-seal)] disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <div className="mt-1 flex justify-between text-[10px] text-ink-faint tabular-nums">
                  <span>{MIN_FOCUS_MINUTES}m</span>
                  <span>30m</span>
                  <span>45m</span>
                  <span>{MAX_FOCUS_MINUTES}m</span>
                </div>
              </div>

              <div className="border-t border-line/40 pt-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-ink-strong">{t('做几组')}</span>
                  <span className="text-[10.5px] text-ink-faint">
                    {t('每组休息 {0} 分钟', restMinutes)}
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-6 gap-1">
                  {GROUP_CHOICES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      disabled={locked}
                      onClick={() => onGroups(n)}
                      title={t('做 {0} 组', n)}
                      className={`h-6.5 rounded-md border text-[11px] font-medium tabular-nums transition-all ${
                        n === shownGroups
                          ? 'border-seal bg-seal text-white shadow-2xs'
                          : 'border-line/70 bg-card/60 text-ink-soft hover:bg-card hover:text-ink hover:border-line-strong'
                      } ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* --- 3. 严格专注 --- */}
            {showStrict && (
              <div className="mt-2.5 rounded-xl border border-line/50 bg-paper/40 p-2.5 dark:bg-paper/20">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-medium text-ink-strong">{t('严格专注')}</span>
                  <span className="text-[10.5px] text-ink-faint">
                    {monitors.screen || monitors.camera ? t('守卫 agent 每分钟巡检') : t('勾选即开启')}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all ${
                      monitors.screen
                        ? 'border-seal/40 bg-seal/10 text-seal-deep font-medium'
                        : 'border-line/60 bg-card/40 text-ink-soft hover:bg-card hover:text-ink'
                    } ${locked ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={monitors.screen}
                      disabled={locked}
                      onChange={() => onMonitorToggle('screen')}
                      className="accent-[var(--color-seal)] rounded"
                    />
                    <span>{t('监控屏幕')}</span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all ${
                      monitors.camera
                        ? 'border-seal/40 bg-seal/10 text-seal-deep font-medium'
                        : 'border-line/60 bg-card/40 text-ink-soft hover:bg-card hover:text-ink'
                    } ${locked ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={monitors.camera}
                      disabled={locked}
                      onChange={() => onMonitorToggle('camera')}
                      className="accent-[var(--color-seal)] rounded"
                    />
                    <span>{t('监控摄像头')}</span>
                  </label>
                </div>
                {strictHint && <p className="mt-1.5 text-[10.5px] leading-relaxed text-warn-deep">{strictHint}</p>}
                {previews}
                <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
                  {t('画面仅用于实时状态判定，不落盘；若检测到隐私内容将熔断停止。')}
                </p>
              </div>
            )}
            {/* 严格专注跑起来：守卫状态 */}
            {guardStatus}

            {/* --- 4. 开始 / 停止操作按钮 --- */}
            {running ? (
              <button
                type="button"
                onClick={onStop}
                className="mt-3 flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg border border-warn/40 bg-warn/5 text-[12.5px] font-medium text-warn-deep transition-all hover:bg-warn/15 hover:border-warn active:scale-[0.99]"
              >
                <Square size={12} /> {t('停止')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onStart}
                className="mt-3 flex h-8.5 w-full items-center justify-center gap-1.5 rounded-lg bg-seal text-[12.5px] font-medium text-white shadow-sm transition-all hover:bg-seal-deep active:scale-[0.99]"
              >
                <Play size={12} className="fill-current" /> {t('开始专注')}
              </button>
            )}

            {/* --- 5. 收尾提示 --- */}
            <div className="mt-2.5 border-t border-line/40 pt-2 text-[10px] leading-relaxed text-ink-faint">
              {t('中途停止不计入有效记录，跑完的组别将自动归档。')}
              {monitors.screen || monitors.camera
                ? t('离开屏幕时自动挂起计时。')
                : running
                  ? t('后台切屏不会打断计时。')
                  : t('专注与休息交替提醒。')}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
