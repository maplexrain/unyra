/*
 * 本文件负责：考试窗口的**开考指引台**（intro 阶段那一屏）——卷面属性、紧凑 4 项指标条、
 * 考场守则提示、「到点强制交卷」开关与开始 / 退出按钮。纯展示组件：逐项 props +
 * 内联回调，开始与退出的动作由宿主（ExamWindow.tsx 门面）传进来。
 *
 * 原样搬自 ExamWindow.tsx（注释一并带走）。
 */
import { Award, Play, ShieldCheck, X } from 'lucide-react'
import Switch from '../Switch'
import type { ExamWindowState } from '../../learn/useExamBridge'
import { EXAM_KIND_LABEL, EXAM_LEVEL_LABEL, EXAM_PASS_RATIO } from '../../learn/exam'
import { t } from '../../i18n'

/** 紧凑开考指引台 */
export function IntroScreen({
  state,
  forceSubmit,
  onForceSubmit,
  onStart,
  onQuit,
}: {
  state: ExamWindowState
  forceSubmit: boolean
  onForceSubmit: (v: boolean) => void
  onStart: () => void
  onQuit: () => void
}) {
  const limit = state.minutes > 0 ? t('{0} 分钟', state.minutes) : t('不限时')
  const passScore = Math.round(state.totalPoints * EXAM_PASS_RATIO)

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-[480px] rounded-xl border border-line-strong bg-card p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-seal/10 text-seal">
            <Award size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-line/60 px-1.5 py-px text-[10.5px] font-medium text-ink-soft">
                {t(EXAM_KIND_LABEL[state.kind])}
              </span>
              <span className="rounded bg-line/60 px-1.5 py-px text-[10.5px] font-medium text-ink-soft">
                {t(EXAM_LEVEL_LABEL[state.level])}
              </span>
              <span className="rounded bg-seal/10 px-1.5 py-px text-[10.5px] font-medium text-seal-deep">
                {limit}
              </span>
            </div>
            <h1 className="mt-1 truncate text-[16px] font-bold text-ink-strong">{state.title}</h1>
          </div>
        </div>

        {/* 紧凑 4 项指标条 */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('题量')}</div>
            <div className="mt-0.5 text-[14px] font-bold text-ink-strong tabular-nums">
              {state.questions.length} <span className="text-[10px] font-normal text-ink-faint">{t('题')}</span>
            </div>
          </div>
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('满分')}</div>
            <div className="mt-0.5 text-[14px] font-bold text-ink-strong tabular-nums">
              {state.totalPoints} <span className="text-[10px] font-normal text-ink-faint">{t('分')}</span>
            </div>
          </div>
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('时限')}</div>
            <div className="mt-0.5 text-[13px] font-bold text-ink-strong">{limit}</div>
          </div>
          <div className="rounded border border-line/70 bg-paper/40 p-2 text-center">
            <div className="text-[10px] text-ink-faint">{t('及格标准')}</div>
            <div className="mt-0.5 text-[14px] font-bold text-ok-deep tabular-nums">
              {passScore} <span className="text-[10px] font-normal text-ink-faint">{t('分')}</span>
            </div>
          </div>
        </div>

        {/* 守则提示 */}
        <div className="mt-3.5 rounded-lg border border-line bg-paper/30 p-3">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-strong">
            <ShieldCheck size={13} className="text-seal" />
            <span>{t('考试须知与考场守则')}</span>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1 text-[11px] leading-relaxed text-ink-soft">
            <li>· {t('开始后窗口会全屏，归一主窗口会盖上一层黑遮罩，避免一边答题一边翻文档。')}</li>
            <li>· {t('一旦开始，只有**交卷**与**放弃**两条路；放弃直接记 0 分，不判分也不写错题讲解。')}</li>
            <li>· {t('每题用时按你**落定答案的先后**推算（这一笔减上一笔），不用你配合任何计时动作。')}</li>
            <li>· {t('作答与切屏次数都会被记下来，导师据此判断你的薄弱项。')}</li>
          </ul>
        </div>

        {state.minutes > 0 && (
          <div className="mt-3 rounded-lg border border-line bg-paper/50 px-3 py-2 text-[11.5px]">
            <Switch
              on={forceSubmit}
              onChange={onForceSubmit}
              label={t('到点强制交卷')}
              hint={t('关掉它可以继续作答：超时多久、哪几笔是超时答的都会被记下来，不会因此判你作弊')}
            />
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-seal px-4 py-2 text-[12px] font-semibold text-paper shadow-2xs transition hover:bg-seal-deep active:scale-[0.99]"
          >
            <Play size={13} fill="currentColor" />
            {t('开始考试')}
          </button>
          <button
            type="button"
            onClick={onQuit}
            className="flex items-center justify-center gap-1 rounded-lg border border-line bg-paper/60 px-3.5 py-2 text-[12px] text-ink-soft transition hover:bg-line/60 hover:text-ink"
          >
            <X size={13} />
            {t('退出（什么都不发生）')}
          </button>
        </div>
      </div>
    </div>
  )
}
