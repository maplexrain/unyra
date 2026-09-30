import { Repeat } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'

/**
 * 顶栏的「复习」入口：鼠标经过向下展开一张 tab 布局的 tip（与打卡 / 有效阅读同一套布局）。
 *
 * 复习计划挂在**节点**上（见 learn/review）：节点首次变「已掌握」时系统自动铺好
 * +1/+3/+7/+14/+30 五个阶段，到了期没做也保持待复习（不自动顺延）。tip 只回答三件事——
 * **现在到期的是哪些**（合并组收成一行）、**接下来两周还有什么**、
 * **哪些已掌握的节点还没计划**（补建入口，给较早创建的节点）。
 *
 * 与打卡同一套时序（wrapper no-drag + 90ms 离开宽限 + 退场动画播完才卸载）。
 * 组件是**纯展示**的：到期行、未来安排、补建清单、逾期天数全部由 props 传入；
 * 它不读 store、不发请求、不碰 Date。
 */

/** 一条到期待复习：单节点或一个合并组（组里 nodeIds 有多个，开始复习从第一个进） */
export interface ReviewTaskRow {
  key: string
  nodeIds: string[]
  /** 单节点标题；合并组是「A 等 N 个（合并复习）」 */
  title: string
  /** 阶段名（如「+3 天 · 理解」）或「补充复习」 */
  stageLabel: string
  /** 逾期天数：0 = 今天到期 */
  overdueDays: number
}

export interface ReviewUpcomingRow {
  title: string
  stageLabel: string
  /** 「9 月 30 日」这样的短日期，父组件算好 */
  when: string
}

export interface ReviewBacklogRow {
  nodeId: string
  title: string
}

export interface ReviewGoalTab {
  goalId: string
  label: string
  due: ReviewTaskRow[]
  upcoming: ReviewUpcomingRow[]
  backlog: ReviewBacklogRow[]
}

export interface ReviewButtonProps {
  /** 每个目标一档（父组件已按最近浏览时间降序排好） */
  tabs: ReviewGoalTab[]
  /** 当前展开哪个目标的账 */
  selectedId: string
  onSelect: (goalId: string) => void
  /** 点「开始复习」——父组件会启动内置工作流「复习」（nodeId 是这行的主节点） */
  onReview: (nodeId: string) => void
  /** 给已掌握但还没计划的节点补一份计划（系统动作，不走导师） */
  onBackfill: (nodeId: string) => void
}

/** 指针离开后延后这么久再收（与打卡一致） */
const HOVER_CLOSE_MS = 90
/** 退场时长，与 index.css 的 .moji-wipe-corner-out 对齐 */
const TIP_EXIT_MS = 160
/** tab 栏最多露出多高：目标多过这个数就在栏内滚动、滚动条藏掉 */
const TABS_MAX_H = 300

function dueText(row: ReviewTaskRow): string {
  return row.overdueDays <= 0 ? t('{0} · 今天到期', row.stageLabel) : t('{0} · 逾期 {1} 天', row.stageLabel, row.overdueDays)
}

export default function ReviewButton({ tabs, selectedId, onSelect, onReview, onBackfill }: ReviewButtonProps) {
  // 浮层要等退场动画播完才卸载，所以展开状态交给 useHoverMenu 管（与打卡 / UserMenu 同一套时序）
  const { open, setOpen, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: TIP_EXIT_MS,
    buttonOpens: true,
  })

  const dueCount = tabs.reduce((n, t) => n + t.due.length, 0)
  const backlogCount = tabs.reduce((n, t) => n + t.backlog.length, 0)
  const selected = tabs.find((t) => t.goalId === selectedId) ?? tabs[0]

  return (
    // no-drag：本组件在顶栏的可拖拽区里（与打卡同一理由：面板上的每一寸都要响应指针）
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={dueCount > 0 ? t('有 {0} 项复习到期了', dueCount) : t('复习（间隔复习计划）')}
        {...buttonProps}
        aria-expanded={open}
        className={'flex h-8 items-center gap-1.5 rounded-md px-2 transition ' + (open ? 'bg-line/70' : 'hover:bg-line/70')}
      >
        <Repeat size={14} className={'shrink-0 ' + (dueCount > 0 ? 'text-seal' : 'text-ink-faint')} />
        <span className="shrink-0 text-[12.5px] text-ink-soft">{t('复习')}</span>
        {/* 存在待完成复习就点一颗红点（与打卡的可用点同一做法）：只表示「有」，不表数量 */}
        {dueCount > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-seal" />}
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1">
          <div
            className={'min-h-[300px] w-[440px] rounded-lg border border-line-strong bg-card p-2.5 shadow-[0_8px_28px_rgba(31,27,23,0.18)] ' +
              panelProps.className}
          >
            {/* --- 1. 账头 --- */}
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <span className={'shrink-0 text-[14px] font-semibold ' + (dueCount > 0 ? 'text-ink-strong' : 'text-ink-soft')}>
                {dueCount > 0 ? t('{0} 项待复习', dueCount) : t('最近没有到期复习')}
              </span>
              <span className="min-w-0 truncate text-[11px] text-ink-faint">
                {backlogCount > 0 ? t('{0} 个节点还没有计划', backlogCount) : t('到期了就保持待复习')}
              </span>
            </div>

            <div className="mt-2.5 flex gap-3">
              {/* --- 2. 左：目标 tab 栏（与打卡同一套滚动与藏滚动条的规则） --- */}
              <div className="w-[128px] shrink-0 border-r border-line pr-2">
                <div className="space-y-0.5 overflow-y-auto moji-scroll-none" style={{ maxHeight: TABS_MAX_H }}>
                  {tabs.map((tab) => {
                    const active = tab.goalId === selected?.goalId
                    return (
                      <button
                        key={tab.goalId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => onSelect(tab.goalId)}
                        title={tab.label + (tab.due.length ? t('（{0} 项待复习）', tab.due.length) : '')}
                        className={
                          'flex w-full items-baseline gap-1.5 rounded-md px-2 py-1 text-left transition ' +
                          (active ? 'bg-seal/12 text-seal-deep' : 'text-ink-soft hover:bg-line/50 hover:text-ink')
                        }
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px]">{tab.label}</span>
                        {tab.due.length > 0 && (
                          <span className="shrink-0 text-[10.5px] tabular-nums opacity-80">{tab.due.length}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* --- 3. 右：当前目标的账——到期、接下来两周、待补建 --- */}
              <div className="min-w-0 flex-1">
                {selected ? (
                  <>
                    {selected.due.length ? (
                      <div className="space-y-0.5">
                        {selected.due.map((row) => (
                          <div
                            key={row.key}
                            className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 transition hover:bg-line/40"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-[12.5px] text-ink">{row.title}</div>
                              <div className="mt-0.5 text-[10.5px] text-ink-faint">{dueText(row)}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setOpen(false)
                                onReview(row.nodeIds[0])
                              }}
                              className="shrink-0 rounded-md bg-seal px-2 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-seal-deep"
                            >
                              {t('开始复习')}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="px-1.5 py-1 text-[11.5px] leading-relaxed text-ink-soft">
                        {t('这个目标现在没有到期复习。')}
                      </p>
                    )}

                    {selected.upcoming.length > 0 && (
                      <div className="mt-2 border-t border-line pt-1.5">
                        <div className="px-1.5 text-[10.5px] text-ink-faint">{t('接下来两周')}</div>
                        <div className="mt-0.5 space-y-0.5">
                          {selected.upcoming.map((row, i) => (
                            <div key={i} className="flex items-baseline justify-between gap-2 px-1.5 py-0.5">
                              <span className="min-w-0 truncate text-[11.5px] text-ink-soft">{row.title}</span>
                              <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
                                {row.stageLabel} · {row.when}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selected.backlog.length > 0 && (
                      <div className="mt-2 border-t border-line pt-1.5">
                        <div className="px-1.5 text-[10.5px] text-ink-faint">{t('已掌握，但还没有复习计划')}</div>
                        <div className="mt-0.5 space-y-0.5">
                          {selected.backlog.map((row) => (
                            <div key={row.nodeId} className="flex items-center justify-between gap-2 px-1.5 py-0.5">
                              <span className="min-w-0 truncate text-[11.5px] text-ink-soft">{row.title}</span>
                              <button
                                type="button"
                                onClick={() => onBackfill(row.nodeId)}
                                className="shrink-0 rounded bg-seal/10 px-1.5 py-0.5 text-[10.5px] text-seal transition hover:bg-seal/20"
                              >
                                {t('补建计划')}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <p className="mt-2 rounded-md bg-line/25 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-ink-soft">
                      {t('复习在对话里进行：先不看内容主动回忆，导师再按阶段检查。完成不看对错，答错的会记进错误记忆。')}
                    </p>
                  </>
                ) : (
                  <p className="px-1.5 py-1 text-[11.5px] leading-relaxed text-ink-soft">
                    {t('还没有学习目标：新建一个目标、把节点学到「已掌握」，复习计划就会自动建起来。')}
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
