import { AlertTriangle, CheckCircle2, Clock, Pause, Square } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { readFocusReport } from '../../learn/focusReports'
import { reportSpanLabel, type FocusReport } from '../../learn/focusGuard'
import { t } from '../../i18n'

/**
 * 专注模式报告的只读视图：一次专注（普通或严格）收场后的凭据——
 * 专注了多久、被暂停几次、警告几回、为什么熔断，以及守卫每一轮的判定。
 * 报告不进 store：按 reportId 从用户目录现读（文件丢了就说不见了，不装样子）。
 */

const OUTCOME_META: Record<FocusReport['outcome'], { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  completed: { label: '跑完了', cls: 'bg-ok/10 text-ok-deep', icon: CheckCircle2 },
  stopped: { label: '中途停止', cls: 'bg-line/60 text-ink-soft', icon: Square },
  fused: { label: '隐私熔断', cls: 'bg-seal-deep/10 text-seal-deep', icon: AlertTriangle },
}

export default function FocusReportView({ reportId }: { reportId: string }) {
  // 加载态是渲染期派生的（「这份读完了没有」），setState 只发生在磁盘读回的回调里——
  // 直接在 effect 里同步 setState 是 lint 拦的写法（会把组件踢出 React Compiler 的优化）
  const [loaded, setLoaded] = useState<{ id: string; report: FocusReport | null } | null>(null)
  useEffect(() => {
    let alive = true
    void readFocusReport(reportId).then((r) => {
      if (alive) setLoaded({ id: reportId, report: r })
    })
    return () => {
      alive = false
    }
  }, [reportId])
  const loading = loaded?.id !== reportId
  const report = loading ? null : (loaded?.report ?? null)

  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">{t('正在打开报告…')}</div>
  }
  if (!report) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <AlertTriangle size={24} className="text-ink-faint" />
        <p className="text-[13px] text-ink-soft">{t('这份报告不见了（文件被移动或删掉）。')}</p>
      </div>
    )
  }

  const meta = OUTCOME_META[report.outcome]
  const Icon = meta.icon
  const minutes = Math.round((report.endedAt - report.startedAt) / 60_000)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-6 py-6">
        {/* 头：收场方式 + 时段 + 总时长 */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium ' + meta.cls}>
            <Icon size={12} /> {meta.label}
          </span>
          <span className="font-mono text-[12px] text-ink-soft">{reportSpanLabel(report.startedAt, report.endedAt)}</span>
          <span className="text-[12px] text-ink-faint">{t('共 {0} 分钟', minutes)}</span>
        </div>

        {/* 账目：计划与完成、暂停、警告 */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t('完成专注')} value={t('{0}/{1} 组', report.completedGroups, report.groups)} />
          <Stat label={t('被暂停')} value={report.pauseCount ? t('{0} 次 · {1} 分钟', report.pauseCount, Math.round(report.pausedMs / 60_000)) : t('没有')} />
          <Stat label={t('分心警告')} value={report.warnings.length ? t('{0} 次', report.warnings.length) : t('没有')} />
          <Stat label={t('监控')} value={report.monitors.screen && report.monitors.camera ? t('屏幕 + 摄像头') : report.monitors.screen ? t('屏幕') : report.monitors.camera ? t('摄像头') : t('没开（普通专注）')} />
        </div>

        {report.fused && (
          <div className="mt-4 rounded-md border border-seal-deep/30 bg-seal-deep/5 px-3 py-2 text-[12px] leading-relaxed text-seal-deep">
            {t('因隐私保护立即熔断：{0}', report.fused.reason)}
          </div>
        )}

        {report.summary && (
          <div className="mt-4 rounded-md border border-line bg-paper-deep/30 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink">{report.summary}</div>
        )}

        {/* 时间线：暂停与警告先列（人要看的是「出过什么事」），守卫轮次随后 */}
        {(report.warnings.length > 0 || report.pauseSpans.length > 0) && (
          <Section title={t('出过的事')}>
            {report.warnings.map((w) => (
              <TimelineRow key={'w' + w.at} at={w.at} icon={<AlertTriangle size={11} className="text-warn-deep" />} text={t('分心警告：{0}', w.reason)} />
            ))}
            {report.pauseSpans.map((span, i) => (
              <TimelineRow
                key={'p' + span.at + '-' + i}
                at={span.at}
                icon={<Pause size={11} className="text-seal-deep" />}
                text={
                  span.resumedAt
                    ? t('守卫判离开，暂停 {0} 分钟', Math.max(1, Math.round((span.resumedAt - span.at) / 60_000)))
                    : t('守卫判离开，暂停到收场')
                }
              />
            ))}
          </Section>
        )}

        {report.rounds.length > 0 && (
          <Section title={t('守卫的判定（新 → 旧）')}>
            {[...report.rounds].reverse().map((r, i) => (
              <div key={r.at + '-' + i} className="flex items-start gap-2 py-1">
                <Clock size={11} className="mt-0.5 shrink-0 text-ink-faint" />
                <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{fmtClock(r.at)}</span>
                <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink">
                  {r.verdict ? r.verdict.reason || t('（无说明）') : r.reason || t('（没看懂这一轮）')}
                </span>
                <span className="shrink-0 text-[10.5px] text-ink-faint">
                  {r.screen ? t('屏') : ''}{r.screen && r.camera ? ' · ' : ''}{r.camera ? t('摄') : ''}
                </span>
              </div>
            ))}
          </Section>
        )}
        {report.rounds.length === 0 && (
          <p className="mt-6 text-[11.5px] leading-relaxed text-ink-faint">
            {t('这一场没有开监控，报告里只有计时账目。要守卫盯着，在番茄钟 tip 里勾选「监控屏幕」或「监控摄像头」。')}
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-paper-deep/30 px-2.5 py-2">
      <div className="text-[10.5px] text-ink-faint">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium text-ink">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <div className="text-[12px] font-medium text-ink-strong">{title}</div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function TimelineRow({ at, icon, text }: { at: number; icon: ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{fmtClock(at)}</span>
      <span className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink">{text}</span>
    </div>
  )
}

function fmtClock(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
