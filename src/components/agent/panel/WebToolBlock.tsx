/**
 * 思维列表里的 DeepSeek 联网工具卡片：用户能看到 AI 搜了什么、打开了哪些页面、
 * 结果里有哪些来源。折叠态只占一行，展开后才铺来源，避免每轮搜索都把消息流刷长。
 */
import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileSearch,
  Globe2,
  Loader2,
  Search,
} from 'lucide-react'
import type { ServerToolCall, WebSearchSource } from '../../../ai/types'
import { t } from '../../../i18n'

function isSearch(call: ServerToolCall): boolean {
  return call.action.type === 'search' || call.kind === 'web_search' || call.kind === 'deep_search' ||
    call.kind === 'image_search' || call.kind === 'deep_image_search'
}

function titleOf(call: ServerToolCall): string {
  const queries = call.action.queries?.filter(Boolean) ?? []
  if (queries.length) return queries.join(' · ')
  if (call.action.type === 'find_in_page') {
    return t('在「{0}」里查找 {1}', call.page?.title || call.action.url || '', call.action.pattern || '')
  }
  if (call.action.type === 'open_page') return call.page?.title || call.action.url || t('打开网页')
  if (call.action.type === 'read_link') return call.page?.title || call.action.url || t('阅读链接')
  return call.page?.title || call.action.url || t('联网工具')
}

function kindLabel(call: ServerToolCall): string {
  if (isSearch(call)) {
    if (call.kind === 'image_search' || call.kind === 'deep_image_search') return t('图片搜索')
    if (call.kind === 'deep_search') return t('深度搜索')
    return t('联网搜索')
  }
  if (call.action.type === 'find_in_page') return t('页内查找')
  if (call.action.type === 'read_link') return t('阅读链接')
  if (call.action.type === 'open_page') return t('打开网页')
  return t('联网工具')
}

function hostOf(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 搜索结果是外部数据：只放行 http(s)，`javascript:` 之类的协议不变成可点链接。 */
function safeHttpUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

function SourceRow({ source }: { source: WebSearchSource }) {
  const href = safeHttpUrl(source.url)
  return (
    <a
      href={href}
      target={href ? '_blank' : undefined}
      rel="noreferrer"
      className="group flex min-w-0 gap-2 rounded-md px-1.5 py-1 transition hover:bg-line/35"
      title={source.url}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-line/50 text-[9px] font-semibold uppercase text-ink-faint">
        {source.siteName?.slice(0, 1) || hostOf(source.url).slice(0, 1) || '?'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-strong group-hover:text-ink">
            {source.title || source.url}
          </span>
          <ExternalLink size={10} className="shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100" />
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-ink-faint">
          <span className="shrink-0">{source.siteName || hostOf(source.url)}</span>
          {source.publishedAt ? <span className="shrink-0">· {source.publishedAt}</span> : null}
        </span>
        {source.snippet ? (
          <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-4 text-ink-soft">
            {source.snippet}
          </span>
        ) : null}
      </span>
    </a>
  )
}

export function WebToolBlock({ call }: { call: ServerToolCall }) {
  const [open, setOpen] = useState(false)
  const running = call.status === 'running'
  const failed = call.status === 'failed'
  const sources = call.sources ?? []
  const canExpand = sources.length > 0 || Boolean(call.page) || Boolean(call.error)
  const Icon = running ? Loader2 : failed ? AlertCircle : isSearch(call) ? Search : FileSearch
  const statusText = running
    ? t('进行中')
    : failed
      ? t('失败')
      : sources.length
        ? t('{0} 条来源', sources.length)
        : call.page
          ? t('已打开')
          : t('完成')

  return (
    <div
      data-web-tool="true"
      data-web-tool-kind={call.kind}
      data-web-tool-status={call.status}
      className="my-1 min-w-0 rounded-lg border border-line/70 bg-paper/40 text-[11px]"
    >
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        className="flex w-full min-w-0 items-start gap-2 px-2.5 py-2 text-left"
        aria-expanded={canExpand ? open : undefined}
      >
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-line/45 text-ink-soft">
          {running ? <Icon size={12} className="animate-spin" /> : <Icon size={12} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-semibold text-ink-strong">{kindLabel(call)}</span>
            {call.page && !isSearch(call) ? (
              <Globe2 size={10} className="shrink-0 text-ink-faint" />
            ) : null}
            <span className="min-w-0 truncate text-ink-soft" title={titleOf(call)}>
              {titleOf(call)}
            </span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-ink-faint">
            {isSearch(call) ? (
              <span className="flex items-center gap-1">
                <Search size={9} /> {t('已检索')}
              </span>
            ) : call.page?.url || call.action.url ? (
              <span className="truncate font-mono">{hostOf(call.page?.url || call.action.url)}</span>
            ) : null}
            <span className={'shrink-0 ' + (failed ? 'text-warn-deep' : running ? 'text-seal-deep' : '')}>
              {statusText}
            </span>
            {call.page?.publishedAt ? <span className="shrink-0">· {call.page.publishedAt}</span> : null}
          </span>
        </span>
        {canExpand ? (
          <ChevronDown
            size={13}
            className={'mt-0.5 shrink-0 text-ink-faint transition-transform ' + (open ? 'rotate-180' : '')}
          />
        ) : running ? null : (
          <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-seal/70" />
        )}
      </button>

      {open ? (
        <div className="moji-bloom-up-in border-t border-line/60 px-2.5 py-2">
          {call.action.pattern || call.action.url ? (
            <div className="mb-1.5 rounded-md bg-line/25 px-2 py-1 text-[10.5px] text-ink-soft">
              {call.action.pattern ? (
                <div>{t('查找：{0}', call.action.pattern)}</div>
              ) : null}
              {call.action.url ? (
                <a
                  href={safeHttpUrl(call.action.url)}
                  target={safeHttpUrl(call.action.url) ? '_blank' : undefined}
                  rel="noreferrer"
                  className="mt-0.5 block truncate font-mono text-[10px] text-seal-deep hover:underline"
                  title={call.action.url}
                >
                  {call.action.url}
                </a>
              ) : null}
            </div>
          ) : null}

          {failed ? (
            <div className="flex items-center gap-1.5 text-[11px] text-warn-deep">
              <AlertCircle size={12} />
              {call.error?.code ? t('请求失败（{0}）', call.error.code) : t('这次联网请求没有完成')}
            </div>
          ) : sources.length ? (
            <div className="max-h-[260px] space-y-0.5 overflow-y-auto pr-0.5">
              {sources.map((source, i) => (
                <SourceRow key={`${source.url}:${i}`} source={source} />
              ))}
            </div>
          ) : call.page ? (
            <SourceRow source={call.page} />
          ) : (
            <div className="text-[10.5px] text-ink-faint">
              {running ? t('正在等待结果…') : t('没有返回可见来源')}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
