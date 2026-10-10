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
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ${
          dueCount > 0 ? 'text-ink' : open ? 'text-ink' : 'text-ink-soft hover:text-ink'
        }`}
      >
        <div className={`relative flex items-center justify-center ${dueCount > 0 ? 'text-seal' : open ? 'text-ink' : 'text-ink-faint group-hover:text-ink'}`}>
          <Repeat size={14} />
          {dueCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-seal opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-seal" />
            </span>
          )}
        </div>
        <span className={`shrink-0 ${dueCount > 0 ? 'font-medium text-ink' : ''}`}>{t('复习')}</span>
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            className={`min-h-[320px] w-[500px] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md ${panelProps.className}`}
          >
            {/* --- 顶部卡片：标题与待复习总数 --- */}
            <div className="flex items-center justify-between gap-3 border-b border-line/40 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-seal/10 text-seal">
                  <Repeat size={14} />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink-strong">{t('间隔复习')}</span>
                    <span className="text-[11px] text-ink-faint">
                      · {t('艾宾浩斯记忆模型')}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-ink-faint">
                    {backlogCount > 0 ? t('{0} 个节点尚未安排计划', backlogCount) : t('掌握节点自动排期，逾期不顺延')}
                  </div>
                </div>
              </div>

              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border ${
                  dueCount > 0
                    ? 'border-seal/30 bg-seal/10 text-seal-deep shadow-2xs'
                    : 'border-line/40 bg-line/30 text-ink-faint'
                }`}
              >
                {dueCount > 0 ? t('{0} 项待复习', dueCount) : t('暂无到期复习')}
              </span>
            </div>

            <div className="mt-3 flex gap-3">
              {/* --- 左：目标选择列表 --- */}
              <div className="w-[136px] shrink-0 border-r border-line/50 pr-2.5">
                <div className="mb-1.5 px-1 text-[10.5px] font-medium text-ink-faint">
                  {t('目标列表')}
                </div>
                <div className="space-y-1 overflow-y-auto moji-scroll-none" style={{ maxHeight: TABS_MAX_H }}>
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
                        className={`flex w-full items-center justify-between gap-1.5 rounded-lg px-2 py-1.5 text-left transition-all ${
                          active
                            ? 'bg-seal/12 text-seal-deep font-medium border-l-2 border-seal shadow-2xs'
                            : 'text-ink-soft hover:bg-line/40 hover:text-ink'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate text-[11.5px]">{tab.label}</span>
                        {tab.due.length > 0 && (
                          <span className="shrink-0 rounded-full bg-seal/15 px-1.5 py-0.2 text-[10px] font-medium tabular-nums text-seal-deep">
                            {tab.due.length}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* --- 右：复习清单与未来排期 --- */}
              <div className="flex min-w-0 flex-1 flex-col justify-between">
                {selected ? (
                  <>
                    <div className="space-y-2.5">
                      {/* 到期复习项 */}
                      <div>
                        <div className="mb-1 flex items-center justify-between px-0.5">
                          <span className="text-[11px] font-medium text-ink-strong">{t('今日到期待复习')}</span>
                          <span className="text-[10px] text-ink-faint tabular-nums">{t('共 {0} 项', selected.due.length)}</span>
                        </div>
                        {selected.due.length ? (
                          <div className="max-h-[150px] space-y-1.5 overflow-y-auto moji-scroll-none pr-0.5">
                            {selected.due.map((row) => (
                              <div
                                key={row.key}
                                className="group flex items-center justify-between gap-2 rounded-xl border border-line/50 bg-paper/40 p-2 transition-all hover:bg-card hover:border-line-strong/60 dark:bg-paper/20"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[12px] font-medium text-ink group-hover:text-ink-strong">
                                    {row.title}
                                  </div>
                                  <div className="mt-1 flex items-center gap-1.5">
                                    <span className="rounded bg-line/50 px-1 py-0.2 text-[9.5px] text-ink-soft">
                                      {row.stageLabel}
                                    </span>
                                    <span
                                      className={`text-[10px] tabular-nums font-medium ${
                                        row.overdueDays > 0 ? 'text-warn-deep' : 'text-seal'
                                      }`}
                                    >
                                      {row.overdueDays > 0 ? t('逾期 {0} 天', row.overdueDays) : t('今天到期')}
                                    </span>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpen(false)
                                    onReview(row.nodeIds[0])
                                  }}
                                  className="flex shrink-0 items-center gap-1 rounded-lg bg-seal px-2.5 py-1 text-[11px] font-medium text-white shadow-2xs transition-all hover:bg-seal-deep active:scale-[0.98]"
                                >
                                  {t('开始复习')}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-line/40 bg-paper/30 py-4 px-3 text-center dark:bg-paper/20">
                            <span className="text-[11.5px] text-ink-soft">{t('此目标暂无到期复习任务')}</span>
                          </div>
                        )}
                      </div>

                      {/* 接下来两周 */}
                      {selected.upcoming.length > 0 && (
                        <div className="rounded-xl border border-line/40 bg-paper/30 p-2 dark:bg-paper/20">
                          <div className="mb-1 px-1 text-[10.5px] font-medium text-ink-faint">
                            {t('未来两周安排')}
                          </div>
                          <div className="max-h-[90px] space-y-1 overflow-y-auto moji-scroll-none">
                            {selected.upcoming.map((row, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[11px] transition-all hover:bg-line/30"
                              >
                                <span className="min-w-0 flex-1 truncate text-ink-soft">{row.title}</span>
                                <span className="shrink-0 text-[10px] tabular-nums text-ink-faint">
                                  {row.stageLabel} · {row.when}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 待补建复习计划 */}
                      {selected.backlog.length > 0 && (
                        <div className="rounded-xl border border-line/40 bg-paper/30 p-2 dark:bg-paper/20">
                          <div className="mb-1 px-1 text-[10.5px] font-medium text-ink-faint">
                            {t('已掌握但未建计划')}
                          </div>
                          <div className="max-h-[80px] space-y-1 overflow-y-auto moji-scroll-none">
                            {selected.backlog.map((row) => (
                              <div
                                key={row.nodeId}
                                className="flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 text-[11px]"
                              >
                                <span className="min-w-0 flex-1 truncate text-ink-soft">{row.title}</span>
                                <button
                                  type="button"
                                  onClick={() => onBackfill(row.nodeId)}
                                  className="shrink-0 rounded-md bg-seal/10 px-2 py-0.5 text-[10px] font-medium text-seal-deep transition-all hover:bg-seal/20"
                                >
                                  {t('补建计划')}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <p className="mt-2.5 rounded-xl bg-line/20 p-2 text-[10px] leading-relaxed text-ink-faint border border-line/30">
                      {t('复习在对话区进行：先主动回忆，导师再针对性核验。错题将自动归入弱项记忆池。')}
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl bg-paper/40 py-8 px-4 text-center dark:bg-paper/20">
                    <Repeat size={24} className="text-ink-faint mb-1.5 opacity-50" />
                    <p className="text-[11.5px] text-ink-soft">
                      {t('暂无学习目标')}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-ink-faint">
                      {t('新建目标并掌握节点后，将自动安排复习周期。')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
