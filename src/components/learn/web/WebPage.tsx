/**
 * 一枚网页页签（拆自 WebTabLayer 的「一枚网页页签」一节）：
 * 常驻挂载的 <webview> 宿主——src 只在挂载那一刻取一次（见 WebTabLayer 文件头）；
 * did-* / page-* 事件桥把加载态、地址、标题、图标回写进页签活信息，
 * 并把元素登记进模块级 webviewRegistry 供宿主侧（browser.* 实现等）取用。
 */
import { useEffect, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import type { FileNodeEntity, WebTabMeta } from '../../../learn/types'
import type { WebTab } from './WebTabLayer'
import { buildApplyPureModeScript } from '../../../learn/web/guestPureMode'
import { buildJumpToElementScript } from '../../../learn/web/guestJump'
import { recordWebHistory, updateWebHistoryMeta } from '../../../learn/web/webHistory'
import { t } from '../../../i18n'
import { registerWebview } from '../../../learn/web/webviewRegistry'
import BlankWebPage from './BlankWebPage'

/**
 * allowpopups 必须落**字符串**：@types/react 把它声明成 boolean，但 React 运行时对
 * 非自定义未知元素的布尔属性「只警告、不写 DOM」——属性没上元素，webview 就封死
 * 弹窗通道，target=_blank 的链接（Bing/百度的搜索结果全是）点击一律无效。
 */
const ALLOW_POPUPS = 'true' as unknown as boolean

export default function WebPage({
  tab,
  active,
  m,
  onMeta,
  onCommitUrl,
  fileNode,
  onAutoCache,
  pendingJumpsRef,
  onDomMutation,
  onNavigateReset,
}: {
  tab: WebTab
  active: boolean
  m: WebTabMeta | undefined
  onMeta: (tabId: string, patch: Partial<WebTabMeta>) => void
  onCommitUrl: (tabId: string, url: string) => void
  fileNode?: FileNodeEntity
  onAutoCache?: (
    nodeId: string,
    patch: { domFilter?: string; whitelist?: string[]; blacklist?: string[]; pureMode?: boolean; cachedContent?: string; cachedAt?: number; title?: string },
  ) => void
  pendingJumpsRef?: { current: Map<string, string> }
  onDomMutation?: (tabId: string) => void
  onNavigateReset?: (tabId: string) => void
}) {
  // 挂载那一刻的地址，之后永远不变（见文件头的说明）；起始页还没有地址
  const [src] = useState(tab.ref.url)
  const wvRef = useRef<WebviewTag | null>(null)
  const id = tab.id

  useEffect(() => {
    const wv = wvRef.current
    if (!src || !wv) return
    const navState = (): Partial<WebTabMeta> => {
      try {
        return { canBack: wv.canGoBack(), canFwd: wv.canGoForward() }
      } catch {
        return {}
      }
    }
    const onStart = (): void => {
      onNavigateReset?.(id)
      onMeta(id, { loading: true, error: null })
    }
    const onStopLoad = (): void => {
      onMeta(id, { loading: false, ...navState() })

      // 1. 纯净模式与 DOM 过滤（黑白名单）
      const pureEnabled = fileNode ? (fileNode.pureMode !== false) : (m?.pureMode ?? false)
      const whitelist = fileNode?.whitelist ?? m?.whitelist ?? (fileNode?.domFilter ? [fileNode.domFilter] : (m?.domFilter ? [m.domFilter] : []))
      const blacklist = fileNode?.blacklist ?? m?.blacklist ?? []
      if (pureEnabled) {
        void wv.executeJavaScript(buildApplyPureModeScript({ whitelist, blacklist }, true))
      }

      // 2. 网页内容自动缓存至节点
      if (fileNode && onAutoCache) {
        void wv.executeJavaScript(`(() => {
          const article = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
          return article ? article.innerText.slice(0, 100000) : '';
        })()`).then((res) => {
          if (typeof res === 'string' && res.trim()) {
            onAutoCache(fileNode.id, { cachedContent: res.trim(), cachedAt: Date.now() })
          }
        }).catch(() => {})
      }

      // 3. 超链接元素选择器跳转
      const pendingSel = pendingJumpsRef?.current?.get(id)
      if (pendingSel && pendingJumpsRef?.current) {
        pendingJumpsRef.current.delete(id)
        void wv.executeJavaScript(buildJumpToElementScript(pendingSel))
      }
    }
    const onNavigate = (e: Event): void => {
      onNavigateReset?.(id)
      const url = (e as unknown as { url?: string }).url ?? ''
      onMeta(id, { url, loading: false, error: null, ...navState() })
      // 主框架地址回写进页签（重启回到离开时的那一页）；页内跳转（hash）只改活信息
      if (/^https?:/i.test(url)) {
        onCommitUrl(id, url)
        recordWebHistory(url)
      }
    }
    const onNavigateInPage = (e: Event): void => {
      const url = (e as unknown as { url?: string }).url
      onMeta(id, { ...(url ? { url } : {}), ...navState() })
    }
    const onTitle = (e: Event): void => {
      const title = (e as unknown as { title?: string }).title
      if (title) {
        onMeta(id, { title })
        const currentUrl = m?.url || tab.ref.url
        if (currentUrl) updateWebHistoryMeta(currentUrl, { title })
        if (fileNode && !fileNode.titleCustomized) {
          onAutoCache?.(fileNode.id, { title })
        }
      }
    }
    const onFavicon = (e: Event): void => {
      const favicon = (e as unknown as { favicons?: string[] }).favicons?.[0]
      if (favicon) {
        onMeta(id, { favicon })
        const currentUrl = m?.url || tab.ref.url
        if (currentUrl) updateWebHistoryMeta(currentUrl, { favicon })
      }
    }
    const onFail = (e: Event): void => {
      const d = e as unknown as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean }
      // -3 是「被打断」（换地址、停加载），子框架加载失败也犯不着打扰
      if (d.errorCode === -3 || d.isMainFrame === false) return
      onMeta(id, { loading: false, error: d.errorDescription || t('无法打开这个地址') })
    }
    const onGone = (): void => onMeta(id, { loading: false, error: t('这个页面崩溃了') })
    // 网页全屏（视频那一类）：webview 元素自己顶满窗口
    const onEnterFs = (): void => {
      wv.style.position = 'fixed'
      wv.style.inset = '0'
      wv.style.zIndex = '60'
      wv.style.width = '100vw'
      wv.style.height = '100vh'
    }
    const onLeaveFs = (): void => {
      wv.style.position = ''
      wv.style.inset = ''
      wv.style.zIndex = ''
      wv.style.width = '100%'
      wv.style.height = '100%'
      wv.style.display = 'flex'
    }

    // 监听 guest 页面内 MutationObserver 上报的动态 DOM 变化
    const onConsole = (e: Event): void => {
      const d = e as unknown as { message?: string }
      if (typeof d?.message === 'string' && d.message.includes('__UNYRA_PAGE_MUTATION__')) {
        onDomMutation?.(id)
      }
    }

    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStopLoad)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigateInPage)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('page-favicon-updated', onFavicon)
    wv.addEventListener('did-fail-load', onFail)
    wv.addEventListener('render-process-gone', onGone)
    wv.addEventListener('enter-html-full-screen', onEnterFs)
    wv.addEventListener('leave-html-full-screen', onLeaveFs)
    wv.addEventListener('console-message', onConsole)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStopLoad)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigateInPage)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('page-favicon-updated', onFavicon)
      wv.removeEventListener('did-fail-load', onFail)
      wv.removeEventListener('render-process-gone', onGone)
      wv.removeEventListener('enter-html-full-screen', onEnterFs)
      wv.removeEventListener('leave-html-full-screen', onLeaveFs)
      wv.removeEventListener('console-message', onConsole)
    }
  }, [src, id, onMeta, onCommitUrl, onDomMutation, onNavigateReset])

  const shellStyle = {
    position: 'absolute' as const,
    inset: 0,
    visibility: active ? ('visible' as const) : ('hidden' as const),
    pointerEvents: active ? ('auto' as const) : ('none' as const),
  }

  if (!src) {
    if (!active) return null
    return (
      <div style={shellStyle} className="h-full w-full overflow-y-auto bg-card">
        <BlankWebPage onOpenUrl={(targetUrl) => onCommitUrl(id, targetUrl)} />
      </div>
    )
  }
  return (
    <div style={shellStyle}>
      <webview
        ref={(el) => {
          wvRef.current = (el as WebviewTag | null) ?? null
          registerWebview(id, (el as WebviewTag | null) ?? null)
        }}
        src={src}
        partition="persist:web"
        allowpopups={ALLOW_POPUPS}
        style={{ display: 'flex', width: '100%', height: '100%' }}
      />
      {m?.error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/95">
          <p className="max-w-[70%] break-all text-center text-[12.5px] text-ink-soft">{m.error}</p>
          <button
            type="button"
            onClick={() => wvRef.current?.reload()}
            className="rounded-md border border-line px-3 py-1 text-[12px] text-ink transition hover:bg-line/50"
          >
            {t('重试')}
          </button>
        </div>
      )}
    </div>
  )
}
