/**
 * Execute API 文档页（智能体设置 → Execute API）。
 *
 * 数据**只从 apiRegistry 派生**：签名、一句话作用、完整用法、参数、返回与示例都在
 * `src/agent/sandbox/apiRegistry.ts` 登记，这里不做第二份手写文档。页面按组导航 +
 * 搜索过滤，适合当规范文档查阅；legacy 组照常列出并标注「旧写法」。
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Database,
  FileJson2,
  Filter,
  Hash,
  Search,
  TerminalSquare,
} from 'lucide-react'
import { exposedGroups, type ApiDoc, type ApiGroupDoc } from '../../agent/sandbox/apiRegistry'
import { t } from '../../i18n'

const GROUPS = exposedGroups()

/** 组键 → 文档里的调用前缀：core 是裸顶层函数，其余是 api.<组> */
function apiPrefix(groupKey: string): string {
  return groupKey === 'core' ? 'api' : `api.${groupKey}`
}

/** 单条 API 的完整可复制名。注册表已经存了 full，这里只做展示，不再二次拼 api. */
function apiName(group: ApiGroupDoc, api: ApiDoc): string {
  return group.key === 'core' ? `api.${api.name}` : `api.${api.full}`
}

function includesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query)
}

function apiMatches(api: ApiDoc, query: string): boolean {
  if (!query) return true
  return [api.full, api.signature, api.summary, api.usage, api.params, api.returns, api.example, ...(api.examples ?? [])]
    .filter(Boolean)
    .some((part) => includesQuery(String(part), query))
}

function groupMatches(group: ApiGroupDoc, query: string): boolean {
  if (!query) return true
  return [group.key, group.label, group.intro, group.usage, group.example ?? ''].some((part) =>
    includesQuery(String(part), query),
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        })
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line/70 bg-paper px-1.5 py-1 text-[10.5px] text-ink-faint transition-colors hover:border-seal/40 hover:text-seal"
      title={t('复制 {0}', label)}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? t('已复制') : t('复制')}
    </button>
  )
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-line/70 bg-[#11151b]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.12em] text-white/45">
          <TerminalSquare className="h-3 w-3" />
          {label}
        </span>
        <CopyButton text={code} label={label} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[11.5px] leading-relaxed text-[#dfe7ee]">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function Detail({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-md border border-line/60 bg-paper-deep/25 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
        {icon}
        {title}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-soft">{body}</div>
    </div>
  )
}

function ApiCard({ group, api }: { group: ApiGroupDoc; api: ApiDoc }) {
  const fullName = apiName(group, api)
  const signature = group.key === 'core' ? api.signature : `api.${api.signature}`
  return (
    <article
      data-api-full={fullName}
      className="overflow-hidden rounded-lg border border-line/70 bg-paper/80 transition-colors hover:border-line"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-[12.5px] font-semibold text-ink-strong">{fullName}</h3>
            {api.trap ? (
              <span className="rounded-sm bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                {t('有边界')}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">{api.summary}</p>
        </div>
        <CopyButton text={signature} label={t('签名')} />
      </div>

      <div className="space-y-3 px-4 py-3.5">
        <div className="flex items-start gap-2 rounded-md border border-seal/20 bg-seal/[0.045] px-3 py-2">
          <Hash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-seal/70" />
          <code className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-strong">
            {signature}
          </code>
        </div>

        <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink">{api.usage}</div>

        {api.trap ? (
          <div className="rounded-md border border-warn/25 bg-warn/[0.05] px-3 py-2 text-[11.5px] leading-relaxed text-warn">
            {api.trap}
          </div>
        ) : null}

        {(api.params || api.returns) && (
          <div className="grid gap-2 md:grid-cols-2">
            {api.params ? <Detail icon={<Filter className="h-3 w-3" />} title={t('参数')} body={api.params} /> : null}
            {api.returns ? <Detail icon={<FileJson2 className="h-3 w-3" />} title={t('返回结构')} body={api.returns} /> : null}
          </div>
        )}

        <div className="space-y-2">
          <CodeBlock code={api.example} label={t('示例')} />
          {(api.examples ?? []).map((example, index) => (
            <CodeBlock key={index} code={example} label={t('示例 {0}', String(index + 2))} />
          ))}
        </div>
      </div>
    </article>
  )
}

function GroupNav({
  vertical,
  selectedGroup,
  onSelect,
  totalApis,
}: {
  vertical: boolean
  selectedGroup: string
  onSelect: (key: string) => void
  totalApis: number
}) {
  const itemClass = (active: boolean) =>
    'flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11.5px] transition-colors ' +
    (vertical ? 'w-full ' : 'shrink-0 ') +
    (active
      ? 'border-seal/40 bg-seal/[0.07] font-semibold text-seal'
      : 'border-transparent text-ink-soft hover:border-line/70 hover:bg-paper-deep/30')

  return (
    <nav className={vertical ? 'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-2 pr-1' : 'flex gap-1 overflow-x-auto pb-1'}>
      <button type="button" onClick={() => onSelect('all')} className={itemClass(selectedGroup === 'all')}>
        <span>{t('全部 API')}</span>
        <span className="tabular-nums text-[10px] opacity-70">{totalApis}</span>
      </button>
      {GROUPS.map((group) => (
        <button key={group.key} type="button" onClick={() => onSelect(group.key)} className={itemClass(selectedGroup === group.key)}>
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">{group.key === 'core' ? t('顶层函数') : `api.${group.key}`}</span>
          </span>
          <span className="tabular-nums text-[10px] opacity-60">{group.apis.length}</span>
        </button>
      ))}
    </nav>
  )
}

export function ApiDocsTab() {
  const [selectedGroup, setSelectedGroup] = useState<string>('all')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const totalApis = useMemo(() => GROUPS.reduce((sum, group) => sum + group.apis.length, 0), [])

  const visibleGroups = useMemo(() => {
    const bySelection = selectedGroup === 'all' ? GROUPS : GROUPS.filter((group) => group.key === selectedGroup)
    if (!normalizedQuery) {
      return bySelection.map((group) => ({ group, apis: group.apis }))
    }
    return bySelection
      .map((group) => {
        if (groupMatches(group, normalizedQuery)) return { group, apis: group.apis }
        return { group, apis: group.apis.filter((api) => apiMatches(api, normalizedQuery)) }
      })
      .filter((entry) => entry.apis.length > 0)
  }, [normalizedQuery, selectedGroup])

  const visibleApiCount = useMemo(
    () => visibleGroups.reduce((sum, entry) => sum + entry.apis.length, 0),
    [visibleGroups],
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-api-docs>
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-seal/80" />
          <h1 className="truncate text-[13px] font-semibold text-ink-strong">
            {t('Execute API · 沙箱 API 文档')}
          </h1>
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-line/60 bg-paper-deep/40 px-1.5 py-0.5 text-[10px] text-ink-faint">
            <Database className="h-3 w-3" />
            <span className="tabular-nums text-ink-soft">{GROUPS.length}</span> {t('组')}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-line/60 bg-paper-deep/40 px-1.5 py-0.5 text-[10px] text-ink-faint">
            <Code2 className="h-3 w-3" />
            <span className="tabular-nums text-ink-soft">{totalApis}</span> API
          </span>
        </div>
        <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-[420px]">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索 API、签名、用法或示例…')}
              className="w-full rounded-md border border-line/70 bg-paper py-1.5 pl-8 pr-8 text-[11.5px] text-ink outline-none transition-shadow placeholder:text-ink-faint focus:border-seal/50 focus:ring-2 focus:ring-seal/10"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] text-ink-faint hover:text-ink"
              >
                {t('清空')}
              </button>
            ) : null}
          </div>
          <span className="shrink-0 text-[10.5px] tabular-nums text-ink-faint">
            {t('{0} / {1} 条', String(visibleApiCount), String(totalApis))}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4 pt-3 xl:flex-row">
        <aside className="hidden min-h-0 w-[226px] shrink-0 flex-col border-r border-line/60 pb-2 pr-3 xl:flex">
          <div className="mb-2 flex shrink-0 items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            <BookOpen className="h-3 w-3" />
            {t('API 分组')}
          </div>
          <GroupNav
            vertical
            selectedGroup={selectedGroup}
            onSelect={setSelectedGroup}
            totalApis={totalApis}
          />
        </aside>

        <div className="shrink-0 xl:hidden">
          <GroupNav
            vertical={false}
            selectedGroup={selectedGroup}
            onSelect={setSelectedGroup}
            totalApis={totalApis}
          />
        </div>

        <main className="min-w-0 flex-1 space-y-5 overflow-y-auto pb-5 pr-1">
          {visibleGroups.map(({ group, apis }) => (
            <section
              key={group.key}
              id={`api-group-${group.key}`}
              data-api-group={group.key}
              className="scroll-mt-4 overflow-hidden rounded-xl border border-line/70 bg-paper-deep/20"
            >
              <div className="border-b border-line/60 bg-paper/55 px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="rounded bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
                    {apiPrefix(group.key)}
                  </code>
                  <h2 className="text-[15px] font-bold text-ink-strong">{group.label}</h2>
                  <span className="text-[10.5px] tabular-nums text-ink-faint">
                    {t('{0} 条', String(apis.length))}
                  </span>
                  {group.legacy ? (
                    <span className="rounded-sm bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">
                      {t('旧写法')}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-soft">{group.intro}</p>
                {group.usage ? (
                  <details className="group/usage mt-2">
                    <summary className="cursor-pointer select-none text-[10.5px] font-medium text-ink-faint hover:text-ink-soft">
                      {t('展开组说明')}
                    </summary>
                    <div className="mt-1.5 whitespace-pre-wrap rounded-md border border-line/50 bg-paper/60 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                      {group.usage}
                    </div>
                  </details>
                ) : null}
                {group.legacyNote ? (
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-warn/90">{group.legacyNote}</p>
                ) : null}
              </div>
              <div className="space-y-3 p-3 md:p-4">
                {apis.map((api) => (
                  <ApiCard key={`${group.key}:${api.full}`} group={group} api={api} />
                ))}
              </div>
              {group.example ? (
                <div className="border-t border-line/60 px-3 pb-3 pt-3 md:px-4">
                  <CodeBlock code={group.example} label={t('组示例')} />
                </div>
              ) : null}
            </section>
          ))}

          {visibleGroups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line/70 px-6 py-12 text-center">
              <Search className="mx-auto h-6 w-6 text-ink-faint/70" />
              <p className="mt-2 text-[12px] font-medium text-ink-soft">{t('没有匹配的 API')}</p>
              <p className="mt-1 text-[11px] text-ink-faint">{t('换个关键词，或清空搜索查看全部注册项。')}</p>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
