/**
 * 用量统计页：token 花在哪、花得值不值，一页看完。
 *
 * 数据源是 ai/usageLog 的逐请求台账（每次完成的请求记一条：谁、哪个模型、
 * 干什么、多少 token、多久）。这一页是纯读的：过滤（时间 / 提供商 / 模型 / 用途）
 * → 聚合（总量卡、按天、按模型、按用途）→ 画出来。
 *
 * 图表全是手画的 div/条形：仓里没有图表库，也不为这一页引一个——柱子要做的
 * 只是「高矮对比」，SVG 弧线与坐标轴反而是给两三张图陪葬的依赖。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Coins, Trash2 } from 'lucide-react'
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

/** 明细列表最多摆这么多条：再多是滚动的事，不是 DOM 的事 */
const RECENT_CAP = 200

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
  /**
   * 「现在」的时刻锚：渲染期不许调 Date.now()（react purity 线），挂载时取一次、
   * 换时间范围的事件里再刷一次——窗口跟着用户的动作走，不跟着每一次重渲染漂。
   */
  const [now, setNow] = useState(() => Date.now())
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [purpose, setPurpose] = useState<'' | UsagePurpose>('')
  const [sortKey, setSortKey] = useState<ModelSortKey>('tokens')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [confirmClear, setConfirmClear] = useState(false)

  // 两步确认的回退：点了「清空」却没点第二次，5 秒后回到普通按钮
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

  /** 模型选项跟着提供商走：先选了哪家，就只列那家的模型 */
  const models = useMemo(() => {
    const set = new Set<string>()
    for (const r of records) if (!providerId || r.providerId === providerId) set.add(r.model)
    return [...set].sort()
  }, [records, providerId])

  /** 过滤 → 聚合一次算齐：五个消费者（卡、三张图、两张表）吃同一份结果 */
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
    const recent = filtered.slice(-RECENT_CAP).reverse()
    return { totals, buckets, topModels, modelRows, purposes, recent }
  }, [records, range, now, providerId, model, purpose, sortKey, sortDir])

  const pickProvider = (id: string) => {
    // 换提供商时清掉模型过滤：旧模型多半不属于新提供商，留着就是个空结果
    setProviderId(id)
    setModel('')
  }

  const toggleSort = (key: ModelSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1))
      return
    }
    setSortKey(key)
    // 文字列默认升序（A 在前），数字列默认降序（大的在前）——两类列的第一眼都不一样
    setSortDir(key === 'model' ? 1 : -1)
  }

  const { totals, buckets, topModels, modelRows, purposes, recent } = view
  const maxModelTok = Math.max(1, ...topModels.map((r) => r.tokens))
  const maxPurposeTok = Math.max(1, ...purposes.map((p) => p.tokens))

  if (records.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Coins size={28} className="text-ink-faint/50" />
        <p className="text-[12.5px] text-ink-soft">{t('还没有用量记录')}</p>
        <p className="max-w-[420px] text-[11px] leading-relaxed text-ink-faint">
          {t('从这一版开始，每次 AI 请求的 token 数、缓存命中率与耗时都会记在这里（跟着当前用户走）。')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* 过滤条：时间范围是最高频的一档，做成常驻的分段钮；其余三维各一颗下拉 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
        <div className="flex items-center rounded-lg border border-line bg-card p-0.5">
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRange(r)
                setNow(Date.now())
              }}
              className={`rounded-md px-2.5 py-1 text-[11.5px] transition ${
                range === r ? 'bg-seal/10 font-medium text-seal-deep' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t(RANGE_LABEL[r])}
            </button>
          ))}
        </div>
        <select
          value={providerId}
          onChange={(e) => pickProvider(e.target.value)}
          className="h-7 max-w-[150px] rounded-lg border border-line bg-card px-2 text-[11.5px] text-ink outline-none"
        >
          <option value="">{t('全部提供商')}</option>
          {providers.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-7 max-w-[180px] rounded-lg border border-line bg-card px-2 text-[11.5px] text-ink outline-none"
        >
          <option value="">{t('全部模型')}</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as '' | UsagePurpose)}
          className="h-7 max-w-[130px] rounded-lg border border-line bg-card px-2 text-[11.5px] text-ink outline-none"
        >
          <option value="">{t('全部用途')}</option>
          {(Object.keys(PURPOSE_LABEL) as UsagePurpose[]).map((p) => (
            <option key={p} value={p}>
              {t(PURPOSE_LABEL[p])}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (confirmClear) {
              clearUsageLog()
              setConfirmClear(false)
            } else {
              setConfirmClear(true)
            }
          }}
          className={
            confirmClear
              ? 'ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-seal/10 px-2.5 text-[11.5px] font-medium text-seal-deep'
              : 'ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] text-ink-faint transition hover:bg-line/50 hover:text-ink'
          }
        >
          <Trash2 size={12} />
          {confirmClear ? t('再点一次确认清空') : t('清空记录')}
        </button>
      </div>

      {view.recent.length === 0 && records.length > 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[12.5px] text-ink-faint">
          {t('这个过滤条件下没有请求')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          {/* 总量卡：四个数回答「花了多少、值不值」 */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat
              label={t('请求数')}
              value={String(totals.requests)}
              sub={totals.estimated > 0 ? t('{0} 条为估算', totals.estimated) : undefined}
            />
            <Stat
              label={t('总 token')}
              value={fmtTok(totals.tokens)}
              sub={`${t('输入')} ${fmtTok(totals.input)} · ${t('输出')} ${fmtTok(totals.output)}`}
            />
            <Stat
              label={t('缓存命中率')}
              value={fmtPct(totals.hitRate)}
              sub={`${fmtTok(totals.cacheRead)} / ${fmtTok(totals.input)}`}
            />
            <Stat
              label={t('总耗时')}
              value={fmtMs(totals.ms)}
              sub={totals.requests ? t('平均 {0}', fmtMs(totals.ms / totals.requests)) : undefined}
            />
          </div>

          <section className="rounded-xl border border-line bg-card/60 p-3">
            <header className="mb-2 flex flex-wrap items-center gap-3">
              <h3 className="text-[12.5px] font-medium text-ink-strong">{t('每日用量')}</h3>
              <Legend color="#2e8b6e" label={t('缓存命中')} />
              <Legend color="#98928a" label={t('新算输入')} />
              <Legend color="seal" label={t('输出')} />
            </header>
            <DayChart buckets={buckets} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-line bg-card/60 p-3">
              <h3 className="text-[12.5px] font-medium text-ink-strong">{t('按模型')}</h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {topModels.slice(0, 8).map((r) => (
                  <button
                    key={r.providerId + ':' + r.model}
                    type="button"
                    title={t('点按只看这个模型，再点一次取消')}
                    onClick={() => setModel(model === r.model ? '' : r.model)}
                    className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left transition hover:bg-line/50"
                  >
                    <span
                      className="w-36 shrink-0 truncate text-[11.5px] text-ink"
                      title={`${r.provider} · ${r.model}`}
                    >
                      {r.model}
                    </span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line/60">
                      <span
                        className={`block h-full rounded-full ${model === r.model ? 'bg-seal' : 'bg-seal/70'}`}
                        style={{ width: `${(r.tokens / maxModelTok) * 100}%` }}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-ink-soft">
                      {fmtTok(r.tokens)}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-line bg-card/60 p-3">
              <h3 className="text-[12.5px] font-medium text-ink-strong">{t('按用途')}</h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {purposes.map((p) => (
                  <div key={p.purpose} className="flex items-center gap-2 px-1 py-0.5">
                    <span className="w-36 shrink-0 truncate text-[11.5px] text-ink">{t(PURPOSE_LABEL[p.purpose])}</span>
                    <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-line/60">
                      <span
                        className="block h-full rounded-full bg-[#7c8698]"
                        style={{ width: `${(p.tokens / maxPurposeTok) * 100}%` }}
                      />
                    </span>
                    <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-ink-soft">
                      {fmtTok(p.tokens)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* 模型明细：表头可点排序（文字列默认升序、数字列默认降序） */}
          <section className="rounded-xl border border-line bg-card/60">
            <h3 className="px-3 pt-3 text-[12.5px] font-medium text-ink-strong">{t('模型明细')}</h3>
            <div className="overflow-x-auto px-3 pb-3 pt-1">
              <table className="w-full min-w-[560px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] text-ink-faint">
                    {MODEL_COLS.map(({ key, sort }) => (
                      <th key={key} className="whitespace-nowrap py-1.5 pr-3 font-normal">
                        {sort ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(sort)}
                            className={`inline-flex items-center gap-0.5 transition hover:text-ink ${
                              sortKey === sort ? 'font-medium text-ink-strong' : ''
                            }`}
                          >
                            {t(SORT_LABEL[key])}
                            {sortKey === sort && <span aria-hidden="true">{sortDir === 1 ? '↑' : '↓'}</span>}
                          </button>
                        ) : (
                          t(SORT_LABEL[key])
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {modelRows.map((r) => (
                    <tr key={r.providerId + ':' + r.model} className="border-b border-line/60 last:border-0">
                      <td className="max-w-[220px] truncate py-1.5 pr-3 text-ink" title={`${r.provider} · ${r.model}`}>
                        {r.model}
                      </td>
                      <td className="py-1.5 pr-3 text-ink-soft">{r.requests}</td>
                      <td className="py-1.5 pr-3 text-ink-soft">{fmtTok(r.input)}</td>
                      <td className="py-1.5 pr-3 text-ink-soft">{fmtTok(r.output)}</td>
                      <td className="py-1.5 pr-3 font-medium text-ink">{fmtTok(r.tokens)}</td>
                      <td className="py-1.5 pr-3 text-ink-soft">{fmtPct(r.hitRate)}</td>
                      <td className="py-1.5 pr-3 text-ink-soft">
                        {fmtMs(r.ms / Math.max(1, r.requests))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 最近请求：逐条台账（最新的在前，最多 {0} 条） */}
          <section className="rounded-xl border border-line bg-card/60">
            <h3 className="px-3 pt-3 text-[12.5px] font-medium text-ink-strong">
              {t('最近请求')} <span className="text-[10.5px] font-normal text-ink-faint">{t('（最多 {0} 条，新的在前）', RECENT_CAP)}</span>
            </h3>
            <div className="overflow-x-auto px-3 pb-3 pt-1">
              <table className="w-full min-w-[620px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] text-ink-faint">
                    <th className="py-1.5 pr-3 font-normal">{t('时间')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('用途')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('模型')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('输入')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('输出')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('命中率')}</th>
                    <th className="py-1.5 pr-3 font-normal">{t('耗时')}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {recent.map((r, i) => (
                    <RecentRow key={r.ts + ':' + i} r={r} />
                  ))}
                </tbody>
              </table>
              {recent.some((r) => r.estimated) && (
                <p className="pt-2 text-[10.5px] text-ink-faint">{t('≈ 表示该条的 token 数是本地估算（服务端没回报用量）。')}</p>
              )}
            </div>
          </section>
        </div>
      )}
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-card/60 px-3 py-2.5">
      <div className="text-[10.5px] tracking-wide text-ink-faint">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold leading-tight tabular-nums text-ink-strong">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10.5px] text-ink-faint">{sub}</div>}
    </div>
  )
}

/** 图例的一枚色点 + 名字；color 传 'seal' 用主题强调色，其余用固定色值 */
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10.5px] text-ink-faint">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${color === 'seal' ? 'bg-seal' : ''}`}
        style={color === 'seal' ? undefined : { background: color }}
      />
      {label}
    </span>
  )
}

/**
 * 每日堆叠柱：一段一根 div，高度按当日总量占满纵轴的百分比。
 *
 * 柱子**封顶 44px**：天数少（比如只看「今天」）时不满铺——统计图要的是「高矮对比」，
 * 一根横贯全场的柱子只剩色块，没有信息量。日期标签长在每根柱子的正下方（而不是整行
 * justify-between）：柱子封顶之后两侧会留白，标签跟着柱子走才不会对不上。
 */
function DayChart({ buckets }: { buckets: DayBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.cacheRead + b.inputFresh + b.output))
  const step = Math.max(1, Math.ceil(buckets.length / 8))
  return (
    <div className="flex items-end gap-[3px]">
      {buckets.map((b, i) => {
        const pct = (n: number): string => (n > 0 ? `${(n / max) * 100}%` : '0')
        // 每隔 step 根标一个 + 最后一根；最后一根挨着上一个刻度时让位（两条挤在一起只会互相糊）
        const showLabel = i % step === 0 || (i === buckets.length - 1 && i % step !== 0)
        return (
          <div key={b.day} className="flex min-w-0 max-w-[44px] flex-1 flex-col">
            <div
              className="flex h-36 items-end"
              title={`${fmtDay(b.day)} · ${t('输入')} ${fmtTok(b.cacheRead + b.inputFresh)}（${t('缓存')} ${fmtTok(b.cacheRead)}）· ${t('输出')} ${fmtTok(b.output)}`}
            >
              {/* 三段自上而下：输出 / 新算输入 / 缓存命中——输入沉底，输出的一天天变化最显眼 */}
              <div className="flex h-full w-full flex-col justify-end gap-px">
                <div className="w-full rounded-t-[2px] bg-seal" style={{ height: pct(b.output) }} />
                <div className="w-full bg-[#98928a]" style={{ height: pct(b.inputFresh) }} />
                <div className="w-full bg-[#2e8b6e]" style={{ height: pct(b.cacheRead) }} />
              </div>
            </div>
            <span className="mt-1 h-3.5 text-center text-[10px] leading-[14px] tabular-nums text-ink-faint">
              {showLabel ? fmtDay(b.day) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function RecentRow({ r }: { r: UsageRecord }) {
  return (
    <tr className="border-b border-line/60 last:border-0">
      <td className="whitespace-nowrap py-1.5 pr-3 text-ink-faint">{fmtClock(r.ts)}</td>
      <td className="py-1.5 pr-3 text-ink-soft">{t(PURPOSE_LABEL[r.purpose])}</td>
      <td className="max-w-[200px] truncate py-1.5 pr-3 text-ink" title={`${r.provider} · ${r.model}`}>
        {r.model}
      </td>
      <td className="py-1.5 pr-3 text-ink-soft">
        {fmtTok(r.input)}
        {r.estimated ? '≈' : ''}
      </td>
      <td className="py-1.5 pr-3 text-ink-soft">{fmtTok(r.output)}</td>
      <td className="py-1.5 pr-3 text-ink-soft">{fmtPct(r.input > 0 ? Math.min(1, r.cacheRead / r.input) : null)}</td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-ink-soft">{fmtMs(r.ms)}</td>
    </tr>
  )
}
