/**
 * 这个文件负责：设置里多处共用的小工具：输入框基样式与三个纯函数（请求头解析与回填、上下文窗口显示）。
 */

import { t } from '../../i18n'

export const inputBase =
  'min-w-0 rounded-lg border border-line bg-card px-3 py-2 text-[12px] text-ink-strong outline-none transition placeholder:text-ink-faint focus:border-seal/60 focus:ring-2 focus:ring-seal/15'

/* ---------- 小工具 ---------- */

export function parseHeaders(text: string): { value?: Record<string, string>; error?: string } {
  const trimmed = text.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { error: t('请求头不是合法 JSON') }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: t('请求头需要是一个 JSON 对象') }
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.some(([, v]) => typeof v !== 'string')) return { error: t('请求头的值必须是字符串') }
  return { value: Object.fromEntries(entries) as Record<string, string> }
}

export const headersToText = (h?: Record<string, string>): string =>
  h && Object.keys(h).length ? JSON.stringify(h, null, 2) : ''

/** 上下文窗口展示：120000 → 120K */
export function formatContext(n: number): string {
  if (!n) return t('未填')
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}
