/**
 * work 页签顶部的**工作流程条**：把 work 实际跑过的 execute 步骤按时间铺开。
 *
 * 它回答的是「这个 work 现在做到哪了」——不是最终交付，也不是聊天。
 * work 的详情仍然在下面的 mind 列表里（每条思考 / 工具调用可展开）；
 * 这一条只是让用户不必先点开每一步，就能看到整条执行链路。
 */
import { ChevronRight, Loader2 } from 'lucide-react'
import type { WorkSession } from '../../../agent/types'
import { t } from '../../../i18n'

export function WorkFlowStrip({ work, running }: { work: WorkSession; running: boolean }) {
  const trace = work.execTrace
  if (!trace.length && !running) return null
  return (
    <div
      data-work-flow
      className="mb-3 rounded-xl border border-line/60 bg-card/55 px-3 py-2"
    >
      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-soft">
        {running ? (
          <Loader2 size={12} className="animate-spin text-seal-deep" />
        ) : (
          <ChevronRight size={12} className="text-seal" />
        )}
        <span className="font-semibold">{t('工作流程')}</span>
        <span className="text-ink-faint">{trace.length ? t('{0} 步', trace.length) : t('等待第一步')}</span>
        {running && <span className="ml-auto text-[10.5px] text-seal-deep">{t('执行中')}</span>}
      </div>
      {trace.length > 0 && (
        <ol className="moji-scroll-thin mt-1.5 flex items-center gap-1 overflow-x-auto pb-0.5 text-[11px] text-ink-faint">
          {trace.map((step, i) => (
            <li key={String(step.at) + '-' + i} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight size={10} className="shrink-0 opacity-40" />}
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-line/70 px-1 text-[10px] tabular-nums text-ink-soft">
                {i + 1}
              </span>
              <span className="max-w-[220px] truncate text-ink-soft" title={step.title}>
                {step.title}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
