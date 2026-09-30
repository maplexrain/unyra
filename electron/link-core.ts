/**
 * 外链的判定：点了一个链接，该让应用自己走、交给系统浏览器、还是干脆拦掉。
 *
 * 为什么要有这一层：markdown 里的链接是 `<a href="https://…">`（**没有 target**），
 * 点下去就是一次主框架导航——不拦的话整个应用界面会被那个网页顶掉，
 * 用户看到的正是「外链在应用内打开了」。这里给出纯判定（用例钉得住），
 * 真正的拦截在 electron/main.ts 的 hardenLinks 里。
 */

/** allow = 应用自己走（刷新、页内锚点、应用自己的页面）；open = 交给系统浏览器；block = 拦掉 */
export type LinkAction = 'allow' | 'open' | 'block'

/** 能交给系统浏览器的协议：http/https 是网页，mailto 是邮件（系统自己会挑邮件客户端） */
const OPENABLE = new Set(['http:', 'https:', 'mailto:'])

function parse(raw: string): URL | null {
  try {
    return new URL(String(raw ?? ''))
  } catch {
    return null
  }
}

/**
 * 这一次跳转该怎么办。
 *
 * current 是**发起跳转那一页**的地址（主框架或子框架），target 是链接指向的地址。
 * 判定顺序有意：先放行「应用自己」，再放行「系统浏览器」，其余一律拦掉——
 * file:、data:、blob:、about:、llm-proxy: 这些都不该被网页导航带走。
 */
export function linkAction(current: string, target: string): LinkAction {
  const raw = String(target ?? '').trim()
  if (!raw) return 'block'
  // 页内锚点：同一份文档里的跳转（地址只差一个 hash），放行
  if (raw.startsWith('#')) return 'allow'
  const url = parse(raw) ?? parse(joinUrl(current, raw))
  if (!url) return 'block'
  const cur = parse(current)

  // 目标是 file:// 时只放行「同一个文件」（打包运行时的刷新），别的 file: 一律拦掉。
  // 注意判据只看**目标**协议：应用自己在 file:// 下运行时，外链仍然是 http(s)，要照常放出去
  if (url.protocol === 'file:') {
    return cur && url.href === cur.href ? 'allow' : 'block'
  }
  // 应用自己的页面（同源同协议）：刷新、Vite 的整页热重载走的都是这条
  if (cur && url.protocol === cur.protocol && url.origin === cur.origin && url.origin !== 'null') return 'allow'
  if (OPENABLE.has(url.protocol)) return 'open'
  return 'block'
}

/** 这个地址能不能交给系统浏览器（openExternal 之前再过一道，别把 file: 之类递给系统） */
export function canOpenExternal(url: string): boolean {
  const u = parse(url)
  return !!u && OPENABLE.has(u.protocol)
}

function joinUrl(base: string, rel: string): string {
  try {
    return new URL(rel, base || undefined).toString()
  } catch {
    return ''
  }
}
