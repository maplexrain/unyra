/**
 * 用量统计页：token 花在哪、花得值不值，一页看完。
 *
 * 数据源是 ai/usageLog 的逐请求台账（每次完成的请求记一条：谁、哪个模型、
 * 干什么、多少 token、多久）。这一页是纯读的：过滤（时间 / 提供商 / 模型 / 用途）
 * → 聚合（总量卡、按天、按模型、按用途）→ 画出来。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Cpu,
  Layers,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import { USAGE_PAGE_SIZE as PAGE_SIZE, getPageNumbers, paginateRecords } from './usagePagination'
import { clearUsageLog, getUsageRecords, subscribeUsageLog, type UsageRecord } from '../../ai/usageLog'
import {
  byModel,
  byPurpose,
  dailyBuckets,
  filterRecords,
  sortModelRows,
  totalsOf,
  type DayBucket,
  type ModelSortKey,
  type UsageFilter,
} from '../../ai/usageStats'
import type { UsagePurpose } from '../../ai/types'
import { t } from '../../i18n'

/** 用途的展示名（台账里存的是键，给人看的名字在这里） */
const PURPOSE_LABEL: Record<UsagePurpose, string> = {
  chat: '导师对话',
  guard: '专注守卫',
  title: '会话标题',
  annotate: '注解释义',
  exam: '试卷',
  test: '连接测试',
  other: '其他',
}

/** 用途标签的主题配色（与 theme.css 语义色适配） */
const PURPOSE_STYLE: Record<UsagePurpose, string> = {
  chat: 'bg-seal/12 text-seal-deep border-seal/30',
  guard: 'bg-warn/15 text-warn-deep border-warn/30',
  title: 'bg-anno-blue/15 text-anno-blue border-anno-blue/30',
  annotate: 'bg-ok/15 text-ok-deep border-ok/30',
  exam: 'bg-anno-purple/15 text-anno-purple border-anno-purple/30',
  test: 'bg-line/70 text-ink-soft border-line',
  other: 'bg-line/50 text-ink-faint border-line/60',
}

/** 用途进度条专属色板（更丰富的视觉层次） */
const PURPOSE_COLOR: Record<UsagePurpose, string> = {
  chat: '#d97706',
  guard: '#ea580c',
  title: '#2563eb',
  annotate: '#059669',
  exam: '#9333ea',
  test: '#78716c',
  other: '#64748b',
}

/** 时间范围的粒度与每日图的补零天数（null = 「全部」，只画有数据的天） */
type Range = 'today' | '7d' | '30d' | 'all'
const RANGE_LABEL: Record<Range, string> = { today: '今天', '7d': '近 7 天', '30d': '近 30 天', all: '全部' }
const RANGE_DAYS: Record<Range, number | null> = { today: 1, '7d': 7, '30d': 30, all: null }

/** 「今天」= 本地时区的零点起；「近 N 天」含今天在内往回数 N 天（与每日图的补零口径一致） */
const sinceOf = (range: Range, now: number): number | null => {
  if (range === 'all') return null
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (range === 'today') return start.getTime()
  return start.getTime() - ((range === '7d' ? 7 : 30) - 1) * 86_400_000
}

/** 量级感优先：1234 → 1.2k，12345678 → 12M（统计页要一眼看大小，不是逐位读数） */
const fmtTok = (n: number): string => {
  if (n >= 10_000_000) return (n / 1_000_000).toFixed(0) + 'M'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1000).toFixed(0) + 'k'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(Math.round(n))
}

const fmtPct = (r: number | null): string => (r === null ? '—' : (r * 100).toFixed(1) + '%')

const fmtMs = (ms: number): string =>
  ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`

/** yyyy-mm-dd → M-d（图轴上嫌年份与补零占地方） */
const fmtDay = (day: string): string => {
  const [, m, d] = day.split('-')
  return `${Number(m)}-${Number(d)}`
}

const fmtClock = (ts: number): string => {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 模型明细表的列（键对应 ModelSortKey；label 在组件里现取——语言切换要跟着走） */
const MODEL_COLS: Array<{ key: ModelSortKey | 'tokens'; sort: ModelSortKey | null }> = [
  { key: 'model', sort: 'model' },
  { key: 'requests', sort: 'requests' },
  { key: 'input', sort: 'input' },
  { key: 'output', sort: 'output' },
  { key: 'tokens', sort: 'tokens' },
  { key: 'hitRate', sort: 'hitRate' },
  { key: 'ms', sort: 'ms' },
]

export default function UsagePanel() {
  const records = useSyncExternalStore(subscribeUsageLog, getUsageRecords)
  const [range, setRange] = useState<Range>('30d')
  const [now, setNow] = useState(() => Date.now())
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [purpose, setPurpose] = useState<'' | UsagePurpose>('')
  const [sortKey, setSortKey] = useState<ModelSortKey>('tokens')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [confirmClear, setConfirmClear] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!confirmClear) return
    const id = window.setTimeout(() => setConfirmClear(false), 5000)
    return () => window.clearTimeout(id)
  }, [confirmClear])

  const providers = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of records) if (!map.has(r.providerId)) map.set(r.providerId, r.provider)
    return [...map.entries()]
  }, [records])

  const models = useMemo(() => {
    const set = new Set<string>()
    for (const r of records) if (!providerId || r.providerId === providerId) set.add(r.model)
    return [...set].sort()
  }, [records, providerId])

  const view = useMemo(() => {
    const filter: UsageFilter = {
      since: sinceOf(range, now),
      providerId: providerId || null,
      model: model || null,
      purpose: purpose || null,
    }
    const filtered = filterRecords(records, filter)
    const totals = totalsOf(filtered)
    const buckets = dailyBuckets(filtered, RANGE_DAYS[range], now)
    const topModels = byModel(filtered).sort((a, b) => b.tokens - a.tokens)
    const modelRows = sortModelRows(byModel(filtered), sortKey, sortDir)
    const purposes = byPurpose(filtered)
    const recent = filtered.slice().reverse()
    return { totals, buckets, topModels, modelRows, purposes, recent }
  }, [records, range, now, providerId, model, purpose, sortKey, sortDir])

  const { totals, buckets, topModels, modelRows, purposes, recent } = view
  const totalRecent = recent.length
  const { totalPages, safePage: currentPage, pagedItems: pagedRecent } = useMemo(
    () => paginateRecords(recent, page, PAGE_SIZE),
    [recent, page],
  )

  const pickRange = (r: Range) => {
    setRange(r)
    setNow(() => Date.now())
    setPage(1)
  }

  const pickProvider = (id: string) => {
    setProviderId(id)
    setModel('')
    setPage(1)
  }

  const pickModel = (m: string) => {
    setModel(m)
    setPage(1)
  }

  const pickPurpose = (p: '' | UsagePurpose) => {
    setPurpose(p)
    setPage(1)
  }

  const toggleSort = (key: ModelSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1))
      return
    }
    setSortKey(key)
    setSortDir(key === 'model' ? 1 : -1)
  }

  const maxModelTok = Math.max(1, ...topModels.map((r) => r.tokens))
  const maxPurposeTok = Math.max(1, ...purposes.map((p) => p.tokens))

  if (records.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-card/60 shadow-xs">
          <Coins size={26} className="text-seal/60" />
        </div>
        <p className="text-[13.5px] font-medium text-ink-strong">{t('还没有用量记录')}</p>
        <p className="max-w-[420px] text-[11.5px] leading-relaxed text-ink-faint">
          {t('从这一版开始，每次 AI 请求的 token 数、缓存命中率与耗时都会记在这里（跟着当前用户走）。')}
        </p>
      </div>
    )
  }

  return (
    <div className="relative min-h-0 min-w-0 flex-1 bg-paper/30">
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {/* 顶部过滤控制台 */}
        <header className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line/80 bg-card/75 px-5 py-2.5 shadow-2xs backdrop-blur-md">
          {/* 时间范围分段药丸 */}
          <div className="flex items-center rounded-lg border border-line/70 bg-paper/70 p-0.5 shadow-2xs">
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => pickRange(r)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-all ${
                  range === r
                    ? 'bg-seal text-paper shadow-xs'
                    : 'text-ink-soft hover:bg-line/40 hover:text-ink'
                }`}
              >
                {t(RANGE_LABEL[r])}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-line/60 mx-0.5 hidden sm:block" />

          {/* 提供商筛选 */}
          <select
            value={providerId}
            onChange={(e) => pickProvider(e.target.value)}
            className="h-7.5 max-w-[150px] rounded-lg border border-line bg-paper/90 px-2.5 text-[11.5px] text-ink outline-none transition-all hover:border-line-strong focus:border-seal/60"
          >
            <option value="">{t('全部提供商')}</option>
            {providers.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          {/* 模型筛选 */}
          <select
            value={model}
            onChange={(e) => pickModel(e.target.value)}
            className="h-7.5 max-w-[180px] rounded-lg border border-line bg-paper/90 px-2.5 text-[11.5px] text-ink outline-none transition-all hover:border-line-strong focus:border-seal/60"
          >
            <option value="">{t('全部模型')}</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          {/* 用途筛选 */}
          <select
            value={purpose}
            onChange={(e) => pickPurpose(e.target.value as '' | UsagePurpose)}
            className="h-7.5 max-w-[130px] rounded-lg border border-line bg-paper/90 px-2.5 text-[11.5px] text-ink outline-none transition-all hover:border-line-strong focus:border-seal/60"
          >
            <option value="">{t('全部用途')}</option>
            {(Object.keys(PURPOSE_LABEL) as UsagePurpose[]).map((p) => (
              <option key={p} value={p}>
                {t(PURPOSE_LABEL[p])}
              </option>
            ))}
          </select>

          {/* 清空台账 */}
          <button
            type="button"
            onClick={() => {
              if (confirmClear) {
                clearUsageLog()
                setConfirmClear(false)
                setPage(1)
              } else {
                setConfirmClear(true)
              }
            }}
            className={
              confirmClear
                ? 'ml-auto flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg border border-warn/40 bg-warn/15 px-3 text-[11.5px] font-medium text-warn-deep transition-all'
                : 'ml-auto flex h-7.5 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[11.5px] text-ink-faint transition hover:bg-line/40 hover:text-ink'
            }
          >
            <Trash2 size={12} className={confirmClear ? 'animate-pulse' : ''} />
            {confirmClear ? t('再点一次确认清空') : t('清空记录')}
          </button>
        </header>

        {recent.length === 0 && records.length > 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-ink-faint">
            {t('这个过滤条件下没有请求')}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
            {/* 总量卡组 */}
            <div className="grid shrink-0 grid-cols-2 gap-3.5 lg:grid-cols-4">
              <Stat
                icon={<Layers size={16} className="text-seal" />}
                iconBg="bg-seal/10"
                label={t('请求数')}
                value={totals.requests.toLocaleString()}
                sub={totals.estimated > 0 ? t('{0} 条为估算', totals.estimated) : undefined}
              />
              <Stat
                icon={<Coins size={16} className="text-amber-500 dark:text-amber-400" />}
                iconBg="bg-amber-500/10"
                label={t('总 token')}
                value={fmtTok(totals.tokens)}
                sub={`${t('输入')} ${fmtTok(totals.input)} · ${t('输出')} ${fmtTok(totals.output)}`}
              />
              <Stat
                icon={<Zap size={16} className="text-emerald-500 dark:text-emerald-400" />}
                iconBg="bg-emerald-500/10"
                label={t('缓存命中率')}
                value={fmtPct(totals.hitRate)}
                sub={`${fmtTok(totals.cacheRead)} / ${fmtTok(totals.input)}`}
              />
              <Stat
                icon={<Clock size={16} className="text-sky-500 dark:text-sky-400" />}
                iconBg="bg-sky-500/10"
                label={t('总耗时')}
                value={fmtMs(totals.ms)}
                sub={totals.requests ? t('平均 {0}', fmtMs(totals.ms / totals.requests)) : undefined}
              />
            </div>

            {/* 每日用量图表 */}
            <section className="shrink-0 rounded-2xl border border-line bg-card/80 p-4.5 shadow-2xs backdrop-blur-xs">
              <header className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Activity size={15} className="text-seal" />
                  <h3 className="text-[13px] font-semibold text-ink-strong">{t('每日用量')}</h3>
                </div>
                <div className="flex items-center gap-3">
                  <Legend color="#10b981" label={t('缓存命中')} />
                  <Legend color="#98928a" label={t('新算输入')} />
                  <Legend color="seal" label={t('输出')} />
                </div>
              </header>
              <DayChart buckets={buckets} />
            </section>

            {/* 模型与用途分布 */}
            <div className="grid shrink-0 gap-4 lg:grid-cols-2">
              {/* 按模型分布 */}
              <section className="rounded-2xl border border-line bg-card/80 p-4.5 shadow-2xs">
                <div className="flex items-center gap-2 mb-3">
                  <Cpu size={15} className="text-seal" />
                  <h3 className="text-[13px] font-semibold text-ink-strong">{t('按模型')}</h3>
                </div>
                <div className="flex flex-col gap-2">
                  {topModels.slice(0, 8).map((r) => {
                    const isPicked = model === r.model
                    const pctOfTotal = totals.tokens > 0 ? (r.tokens / totals.tokens) * 100 : 0
                    return (
                      <button
                        key={r.providerId + ':' + r.model}
                        type="button"
                        title={t('点按只看这个模型，再点一次取消')}
                        onClick={() => pickModel(isPicked ? '' : r.model)}
                        className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-all ${
                          isPicked
                            ? 'bg-seal/10 ring-1 ring-seal/40'
                            : 'hover:bg-line/40'
                        }`}
                      >
                        <span
                          className={`w-38 shrink-0 truncate text-[11.5px] transition-colors ${
                            isPicked ? 'font-semibold text-seal-deep' : 'text-ink group-hover:text-ink-strong'
                          }`}
                          title={`${r.provider} · ${r.model}`}
                        >
                          {r.model}
                        </span>
                        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line/60">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isPicked ? 'bg-seal' : 'bg-seal/75 group-hover:bg-seal'
                            }`}
                            style={{ width: `${(r.tokens / maxModelTok) * 100}%` }}
                          />
                        </div>
                        <span className="w-16 shrink-0 text-right text-[11px] tabular-nums font-mono text-ink-soft">
                          {fmtTok(r.tokens)}
                        </span>
                        <span className="w-12 shrink-0 text-right text-[10.5px] tabular-nums text-ink-faint">
                          {pctOfTotal.toFixed(1)}%
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* 按用途分布 */}
              <section className="rounded-2xl border border-line bg-card/80 p-4.5 shadow-2xs">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={15} className="text-seal" />
                  <h3 className="text-[13px] font-semibold text-ink-strong">{t('按用途')}</h3>
                </div>
                <div className="flex flex-col gap-2">
                  {purposes.map((p) => {
                    const barColor = PURPOSE_COLOR[p.purpose] || '#78716c'
                    const pctOfTotal = totals.tokens > 0 ? (p.tokens / totals.tokens) * 100 : 0
                    return (
                      <div key={p.purpose} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-line/20">
                        <span className="w-38 shrink-0 truncate text-[11.5px] font-medium text-ink">
                          {t(PURPOSE_LABEL[p.purpose])}
                        </span>
                        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-line/60">
                          <div
                            className="h-full rounded-full transition-all duration-300"
                            style={{
                              backgroundColor: barColor,
                              width: `${(p.tokens / maxPurposeTok) * 100}%`,
                            }}
                          />
                        </div>
                        <span className="w-16 shrink-0 text-right text-[11px] tabular-nums font-mono text-ink-soft">
                          {fmtTok(p.tokens)}
                        </span>
                        <span className="w-12 shrink-0 text-right text-[10.5px] tabular-nums text-ink-faint">
                          {pctOfTotal.toFixed(1)}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>

            {/* 模型明细表格 */}
            <section className="shrink-0 overflow-hidden rounded-2xl border border-line bg-card/80 shadow-2xs">
              <header className="border-b border-line/70 bg-card/50 px-4.5 py-3">
                <h3 className="text-[13px] font-semibold text-ink-strong">{t('模型明细')}</h3>
              </header>
              <div className="overflow-x-auto p-1.5">
                <table className="w-full min-w-[580px] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-faint font-medium">
                      {MODEL_COLS.map(({ key, sort }) => (
                        <th key={key} className="whitespace-nowrap py-2 px-3 font-medium">
                          {sort ? (
                            <button
                              type="button"
                              onClick={() => toggleSort(sort)}
                              className={`inline-flex items-center gap-1 transition hover:text-ink ${
                                sortKey === sort ? 'font-semibold text-ink-strong' : ''
                              }`}
                            >
                              {t(SORT_LABEL[key])}
                              {sortKey === sort && <span aria-hidden="true" className="text-seal">{sortDir === 1 ? '↑' : '↓'}</span>}
                            </button>
                          ) : (
                            t(SORT_LABEL[key])
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums font-mono">
                    {modelRows.map((r) => (
                      <tr key={r.providerId + ':' + r.model} className="border-b border-line/40 transition-colors hover:bg-line/25 last:border-0">
                        <td className="max-w-[220px] truncate py-2 px-3 font-sans text-ink" title={`${r.provider} · ${r.model}`}>
                          {r.model}
                        </td>
                        <td className="py-2 px-3 text-ink-soft">{r.requests}</td>
                        <td className="py-2 px-3 text-ink-soft">{fmtTok(r.input)}</td>
                        <td className="py-2 px-3 text-ink-soft">{fmtTok(r.output)}</td>
                        <td className="py-2 px-3 font-semibold text-ink">{fmtTok(r.tokens)}</td>
                        <td className="py-2 px-3">
                          <span className={r.hitRate && r.hitRate > 0 ? 'text-ok-deep font-semibold' : 'text-ink-soft'}>
                            {fmtPct(r.hitRate)}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-ink-soft">
                          {fmtMs(r.ms / Math.max(1, r.requests))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 最近请求：台账流水列表 */}
            <section className="shrink-0 overflow-hidden rounded-2xl border border-line bg-card/80 shadow-2xs">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-card/50 px-4.5 py-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-ink-strong">{t('最近请求')}</h3>
                  <span className="rounded-full border border-line/60 bg-paper/60 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-ink-soft">
                    {t('共 {0} 条', totalRecent)}
                  </span>
                  <span className="text-[10.5px] text-ink-faint">
                    {t('（每页 {0} 条，新的在前）', PAGE_SIZE)}
                  </span>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-ink-faint">
                    <span>{t('第 {0} / {1} 页', currentPage, totalPages)}</span>
                  </div>
                )}
              </header>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] text-ink-faint font-medium">
                      <th className="py-2 pl-4 pr-3">{t('时间')}</th>
                      <th className="py-2 pr-3">{t('用途')}</th>
                      <th className="py-2 pr-3">{t('模型')}</th>
                      <th className="py-2 pr-3">{t('输入')}</th>
                      <th className="py-2 pr-3">{t('输出')}</th>
                      <th className="py-2 pr-3">{t('缓存')}</th>
                      <th className="py-2 pr-4 text-right">{t('耗时')}</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {pagedRecent.map((r, idx) => (
                      <RecentRow key={`${r.ts}-${idx}`} r={r} />
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={totalRecent}
                pageSize={PAGE_SIZE}
                onChange={(next) => setPage(next)}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

/** 表头文案集中在这里：排序键与「总计」这类纯展示列共用一张表 */
const SORT_LABEL: Record<ModelSortKey, string> = {
  model: '模型',
  requests: '请求数',
  input: '输入',
  output: '输出',
  tokens: '总计',
  hitRate: '命中率',
  ms: '平均耗时',
}

function Stat({
  icon,
  iconBg,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode
  iconBg?: string
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-card/85 p-3.5 shadow-2xs transition-all hover:border-line-strong hover:shadow-xs">
      <div className="flex items-center gap-2">
        {icon && (
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${iconBg ?? 'bg-seal/10'} shadow-2xs`}>
            {icon}
          </div>
        )}
        <div className="text-[11px] font-medium tracking-wide text-ink-faint">{label}</div>
      </div>
      <div className="mt-2 text-[22px] font-bold leading-tight tabular-nums font-mono text-ink-strong">{value}</div>
      {sub && <div className="mt-1 truncate text-[11px] text-ink-faint font-mono">{sub}</div>}
    </div>
  )
}

/** 图例的一枚色点 + 名字；color 传 'seal' 用主题强调色，其余用固定色值 */
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 rounded-full ${color === 'seal' ? 'bg-seal' : ''}`}
        style={color === 'seal' ? undefined : { background: color }}
      />
      {label}
    </span>
  )
}

/**
 * 每日堆叠柱：一段一根 div，高度按当日总量占满纵轴的百分比。
 */
function DayChart({ buckets }: { buckets: DayBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.cacheRead + b.inputFresh + b.output))
  const step = Math.max(1, Math.ceil(buckets.length / 8))
  return (
    <div className="relative">
      {/* 刻度背景参考虚线 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 top-0 flex flex-col justify-between opacity-20">
        <div className="border-b border-dashed border-ink" />
        <div className="border-b border-dashed border-ink" />
        <div className="border-b border-dashed border-ink" />
      </div>

      <div className="relative flex items-end gap-1 pt-2">
        {buckets.map((b, i) => {
          const pct = (n: number): string => (n > 0 ? `${(n / max) * 100}%` : '0')
          const showLabel = i % step === 0 || (i === buckets.length - 1 && i % step !== 0)
          return (
            <div key={b.day} className="flex min-w-0 max-w-[48px] flex-1 flex-col">
              <div
                className="group flex h-40 cursor-default items-end rounded-t-sm transition-all hover:bg-line/20"
                title={`${fmtDay(b.day)} · ${t('输入')} ${fmtTok(b.cacheRead + b.inputFresh)}（${t('缓存')} ${fmtTok(b.cacheRead)}）· ${t('输出')} ${fmtTok(b.output)}`}
              >
                {/* 三段自上而下：输出 / 新算输入 / 缓存命中 */}
                <div className="flex h-full w-full flex-col justify-end gap-0.5">
                  <div className="w-full rounded-t-[3px] bg-seal shadow-2xs" style={{ height: pct(b.output) }} />
                  <div className="w-full bg-[#98928a]/90" style={{ height: pct(b.inputFresh) }} />
                  <div className="w-full rounded-b-[1px] bg-[#10b981]" style={{ height: pct(b.cacheRead) }} />
                </div>
              </div>
              <span className="mt-1.5 h-3.5 text-center text-[10px] leading-[14px] tabular-nums font-mono text-ink-faint">
                {showLabel ? fmtDay(b.day) : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RecentRow({ r }: { r: UsageRecord }) {
  const hitRate = r.input > 0 ? Math.min(1, r.cacheRead / r.input) : null
  return (
    <tr className="border-b border-line/40 transition-colors hover:bg-line/25 last:border-0">
      <td className="whitespace-nowrap py-2.5 pl-4 pr-3 text-[11.5px] font-mono text-ink-faint">{fmtClock(r.ts)}</td>
      <td className="whitespace-nowrap py-2.5 pr-3">
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10.5px] font-medium leading-none ${
            PURPOSE_STYLE[r.purpose] || 'border-line/60 bg-line/60 text-ink-soft'
          }`}
        >
          {t(PURPOSE_LABEL[r.purpose])}
        </span>
      </td>
      <td className="max-w-[200px] truncate py-2.5 pr-3 font-mono text-[11.5px] text-ink" title={`${r.provider} · ${r.model}`}>
        {r.model}
      </td>
      <td className="py-2.5 pr-3 font-mono text-[11.5px] text-ink-soft">
        {fmtTok(r.input)}
        {r.estimated && (
          <span className="ml-0.5 cursor-help text-ink-faint" title={t('本地估算 token')}>
            ≈
          </span>
        )}
      </td>
      <td className="py-2.5 pr-3 font-mono text-[11.5px] text-ink-soft">{fmtTok(r.output)}</td>
      <td className="py-2.5 pr-3 font-mono text-[11.5px]">
        <span className={hitRate && hitRate > 0 ? 'font-semibold text-ok-deep' : 'text-ink-soft'}>
          {fmtPct(hitRate)}
        </span>
      </td>
      <td className="whitespace-nowrap py-2.5 pr-4 text-right font-mono text-[11.5px] text-ink-soft">{fmtMs(r.ms)}</td>
    </tr>
  )
}

interface PaginationProps {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onChange: (page: number) => void
}

function Pagination({ page, totalPages, totalItems, pageSize, onChange }: PaginationProps) {
  const [jumpVal, setJumpVal] = useState('')
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, totalItems)
  const pageNumbers = getPageNumbers(page, totalPages)

  const handleJump = () => {
    const num = parseInt(jumpVal.trim(), 10)
    if (!isNaN(num) && num >= 1 && num <= totalPages && num !== page) {
      onChange(num)
    }
    setJumpVal('')
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 bg-card/40 px-4.5 py-3">
      <div className="text-[11.5px] tabular-nums font-mono text-ink-faint">
        {t('显示第 {0} - {1} 条，共 {2} 条', startItem, endItem, totalItems)}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
            className="flex h-7 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:bg-line/40 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            title={t('上一页')}
          >
            <ChevronLeft size={13} />
            <span>{t('上一页')}</span>
          </button>

          {pageNumbers.map((p, idx) =>
            typeof p === 'number' ? (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p)}
                className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-2 text-[11.5px] tabular-nums font-mono transition ${
                  p === page
                    ? 'bg-seal font-semibold text-paper shadow-xs'
                    : 'border border-line bg-card text-ink-soft hover:border-line-strong hover:bg-line/40 hover:text-ink'
                }`}
              >
                {p}
              </button>
            ) : (
              <span
                key={`ellipsis-${idx}`}
                className="flex h-7 min-w-[20px] select-none items-center justify-center text-[11.5px] text-ink-faint"
              >
                …
              </span>
            ),
          )}

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onChange(page + 1)}
            className="flex h-7 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-[11.5px] text-ink-soft transition hover:border-line-strong hover:bg-line/40 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
            title={t('下一页')}
          >
            <span>{t('下一页')}</span>
            <ChevronRight size={13} />
          </button>

          {totalPages > 7 && (
            <div className="ml-1.5 flex items-center gap-1 text-[11.5px] text-ink-faint">
              <span>{t('前往')}</span>
              <input
                type="text"
                inputMode="numeric"
                value={jumpVal}
                onChange={(e) => setJumpVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJump()
                }}
                onBlur={handleJump}
                placeholder={String(page)}
                className="h-7 w-11 rounded-lg border border-line bg-card px-1 text-center text-[11.5px] tabular-nums font-mono text-ink outline-none transition focus:border-seal"
              />
              <span>{t('页')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
