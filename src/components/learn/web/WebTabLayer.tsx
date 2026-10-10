import { useEffect, useMemo, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RotateCw, Star, X } from 'lucide-react'
import type { LearnTab, TabRef, WebTabMeta } from '../../../learn/types'
import { normalizeWebInput } from '../../../learn/webUrl'
import { isElectron, native } from '../../../lib/native'
import { t } from '../../../i18n'
import { setAddressFocus } from './addressFocus'
import { registerWebview, webviewByWcId, webviewOf } from '../../../learn/web/webviewRegistry'
import {
  recordWebHistory,
  removeWebHistoryEntry,
  searchWebHistory,
  updateWebHistoryMeta,
} from '../../../learn/web/webHistory'
import BlankWebPage from './BlankWebPage'

/** web 页签：ref 一定是 web 分支（调用方按 kind 过滤过） */
export type WebTab = LearnTab & { ref: Extract<TabRef, { kind: 'web' }> }

/**
 * 内置浏览器的页签层（guest 是 <webview>，主进程侧见 electron/app/webSession）。
 *
 * 为什么是一整层、而不是挂在页签切换的分支里：网页的**会话状态**（滚动、SPA、
 * 前进后退历史）活在 guest 渲染进程里，元素一卸载就没了。所以这一层像常驻预览
 * 一样常挂在格内容区上：切去看文档时整层 visibility 藏起来（guest 照跑、声音照放，
 * 与浏览器的后台页签一致），切回来原地出现。
 *
 * src 只在**挂载那一刻**取一次（useState 冻住），之后一切导航都走 loadURL 或页面
 * 自己点链接——React 重渲染时 src 属性永远不变：变了就等于「重导航」，页面的表单、
 * 滚动会被清空（did-navigate 回写 ref.url 的那一刻就会撞上）。
 *
 * 起始页（ref.url === ''）不挂 webview，只摆提示；地址栏回车把地址定进 ref，
 * WebPage 的 key 随之从 `id:new` 变成 `id`，重挂、此刻才取到真正的 src。
 */

interface Props {
  tabs: WebTab[]
  activeId: string | null
  /** 页签 id → 活信息（标题/图标/加载态，见 WebTabMeta）；没加载完的页签缺一条 */
  meta: Record<string, WebTabMeta>
  /** 这一格的当前页签不是 web：整层藏起来（但 guest 进程保留） */
  hidden: boolean
  onMeta: (tabId: string, patch: Partial<WebTabMeta>) => void
  /** 把当前地址回写进页签（主框架导航时，重启回到离开时的那一页） */
  onCommitUrl: (tabId: string, url: string) => void
  /** 当前地址收藏了没有（地址栏星标的实虚，见 learn/favorites）；不给就藏起这颗按钮 */
  favoriteOf?: (url: string) => boolean
  /** 星标点击：收藏 / 取消收藏当前地址；extra 是这一页的活标题与站点图标（一并记进收藏） */
  onToggleFavoriteUrl?: (url: string, extra?: { title?: string; icon?: string }) => void
}

const BTN =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent'

/**
 * allowpopups 必须落**字符串**：@types/react 把它声明成 boolean，但 React 运行时对
 * 非自定义未知元素的布尔属性「只警告、不写 DOM」——属性没上元素，webview 就封死
 * 弹窗通道，target=_blank 的链接（Bing/百度的搜索结果全是）点击一律无效。
 */
const ALLOW_POPUPS = 'true' as unknown as boolean

export default function WebTabLayer({ tabs, activeId, meta, hidden, onMeta, onCommitUrl, favoriteOf, onToggleFavoriteUrl }: Props) {
  const active = tabs.find((x) => x.id === activeId) ?? null
  // webview 元素走模块级登记表（learn/web/webviewRegistry）：browser.* 的宿主实现
  // 也从那里拿元素，两层看的是同一份，不用各自维护
  const withActive = (fn: (wv: WebviewTag) => void): void => {
    const wv = active ? webviewOf(active.id) : undefined
    if (wv) fn(wv)
  }

  /*
    guest 里的鼠标指针事件（electron/guestPreload 上报，主进程按 wcId 转发回来）：
    在对应的 <webview> 元素上合成一枚可冒泡的 PointerEvent。合成事件不是 isTrusted
    的，但应用侧的手势（右键横划换页签那一类）全是普通监听，照常接得住——
    「网页里触发的事件冒泡到宿主」这条链的最后一段就在这里补上。
  */
  useEffect(() => {
    if (!isElectron()) return
    return native().browser.onGuestInput((p) => {
      const el = webviewByWcId(p.wcId)
      if (!el) return
      const r = el.getBoundingClientRect()
      el.dispatchEvent(
        new PointerEvent(p.type, {
          bubbles: true,
          cancelable: true,
          clientX: r.left + p.x,
          clientY: r.top + p.y,
          button: p.button,
          buttons: p.buttons,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }),
      )
    })
  }, [])

  return (
    <div
      className="flex flex-col bg-card"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        visibility: hidden ? 'hidden' : 'visible',
        pointerEvents: hidden ? 'none' : 'auto',
      }}
    >
      {active && (
        <WebToolbar
          tab={active}
          m={meta[active.id]}
          onBack={() => withActive((wv) => wv.goBack())}
          onForward={() => withActive((wv) => wv.goForward())}
          onReload={() => withActive((wv) => wv.reload())}
          onStop={() => withActive((wv) => wv.stop())}
          onAddress={(url) => {
            if (!active.ref.url) onCommitUrl(active.id, url)
            else withActive((wv) => wv.loadURL(url))
          }}
          favorited={favoriteOf ? favoriteOf(meta[active.id]?.url ?? active.ref.url) : false}
          onToggleFavorite={() => {
            const url = meta[active.id]?.url ?? active.ref.url
            if (url && onToggleFavoriteUrl) {
              onToggleFavoriteUrl(url, { title: meta[active.id]?.title, icon: meta[active.id]?.favicon })
            }
          }}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <WebPage
            key={tab.id + (tab.ref.url ? '' : ':new')}
            tab={tab}
            active={!hidden && tab.id === activeId}
            m={meta[tab.id]}
            onMeta={onMeta}
            onCommitUrl={onCommitUrl}
          />
        ))}
      </div>
    </div>
  )
}

/* ---------- 地址栏工具条 ---------- */

function WebToolbar({
  tab,
  m,
  onBack,
  onForward,
  onReload,
  onStop,
  onAddress,
  favorited,
  onToggleFavorite,
}: {
  tab: WebTab
  m: WebTabMeta | undefined
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
  onAddress: (url: string) => void
  /** 当前地址收藏了没有；起始页（没有网址）这颗按钮置灰 */
  favorited: boolean
  onToggleFavorite: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const blurTimerRef = useRef<number | null>(null)
  // 展示值：页签自己的活 url 优先，还没收到过事件的（刚重启回来）拿 ref.url 兜底
  const url = m?.url ?? tab.ref.url
  const [draft, setDraft] = useState(url)
  const [prevUrl, setPrevUrl] = useState(url)
  if (prevUrl !== url) {
    setPrevUrl(url)
    setDraft(url)
  }

  const [openSuggestions, setOpenSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [historyKey, setHistoryKey] = useState(0)

  // 历史补全待选项
  const suggestions = useMemo(() => {
    if (!openSuggestions) return []
    return searchWebHistory(draft, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSuggestions, draft, historyKey])

  const pickSuggestion = (targetUrl: string) => {
    if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current)
    setOpenSuggestions(false)
    setDraft(targetUrl)
    onAddress(targetUrl)
  }

  const removeSuggestion = (e: React.MouseEvent, targetUrl: string) => {
    e.stopPropagation()
    e.preventDefault()
    removeWebHistoryEntry(targetUrl)
    setHistoryKey((k) => k + 1)
  }

  // Ctrl+L 的落点：光标进地址栏并全选（见 addressFocus）
  useEffect(() => {
    setAddressFocus(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
      setOpenSuggestions(true)
    })
    return () => {
      setAddressFocus(null)
      if (blurTimerRef.current) window.clearTimeout(blurTimerRef.current)
    }
  }, [])

  const loading = m?.loading ?? false

  return (
    <div className="relative flex shrink-0 items-center gap-0.5 border-b border-line px-1.5 py-1">
      <button type="button" title={t('后退')} aria-label={t('后退')} disabled={!m?.canBack} onClick={onBack} className={BTN}>
        <ArrowLeft size={14} />
      </button>
      <button type="button" title={t('前进')} aria-label={t('前进')} disabled={!m?.canFwd} onClick={onForward} className={BTN}>
        <ArrowRight size={14} />
      </button>
      {loading ? (
        <button type="button" title={t('停止加载')} aria-label={t('停止加载')} onClick={onStop} className={BTN}>
          <X size={14} />
        </button>
      ) : (
        <button type="button" title={t('刷新')} aria-label={t('刷新')} onClick={onReload} className={BTN}>
          <RotateCw size={13} />
        </button>
      )}

      {/* 地址栏与补全下拉框容器 */}
      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setOpenSuggestions(true)
            setSelectedIndex(-1)
          }}
          onFocus={(e) => {
            e.target.select()
            setOpenSuggestions(true)
          }}
          onBlur={() => {
            blurTimerRef.current = window.setTimeout(() => {
              setOpenSuggestions(false)
            }, 180)
          }}
          spellCheck={false}
          onKeyDown={(e) => {
            if (openSuggestions && suggestions.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1))
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpenSuggestions(false)
                return
              }
            }
            if (e.key === 'Enter') {
              if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                const target = suggestions[selectedIndex].url
                setOpenSuggestions(false)
                onAddress(target)
                return
              }
              setOpenSuggestions(false)
              const target = normalizeWebInput(draft)
              if (target) onAddress(target)
            }
          }}
          placeholder={t('搜索或输入网址')}
          className="h-7 w-full rounded-md border border-line bg-paper/60 px-2.5 text-[12px] text-ink outline-none transition placeholder:text-ink-faint focus:border-seal/60"
        />

        {/* 自动补全待选列表浮层 */}
        {openSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border border-line-strong/60 bg-card p-1 shadow-[0_12px_28px_rgba(31,27,23,0.18)]">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium text-ink-faint">
              <span>{t('历史访问记录')}</span>
              <span>{t('↑↓ 键切换 · 回车打开')}</span>
            </div>
            {suggestions.map((item, idx) => {
              const isSelected = idx === selectedIndex
              return (
                <div
                  key={item.url}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickSuggestion(item.url)
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`group flex items-center gap-2 rounded-lg px-2.5 py-1.5 cursor-pointer transition ${
                    isSelected ? 'bg-line/70 text-ink-strong' : 'hover:bg-line/50 text-ink'
                  }`}
                >
                  {item.favicon ? (
                    <img
                      src={item.favicon}
                      alt=""
                      className="h-3.5 w-3.5 shrink-0 rounded"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : (
                    <Globe size={13} className="shrink-0 text-ink-faint" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium">{item.title}</div>
                    <div className="truncate text-[10.5px] text-ink-faint">{item.url}</div>
                  </div>
                  {item.visitCount > 1 && (
                    <span className="shrink-0 rounded bg-line/60 px-1 py-0.2 text-[9.5px] text-ink-faint">
                      {t('{0}次', item.visitCount)}
                    </span>
                  )}
                  <button
                    type="button"
                    title={t('删除此条历史')}
                    onClick={(e) => removeSuggestion(e, item.url)}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-line hover:text-ink transition"
                  >
                    <X size={11} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/*
        收藏星标：实心 = 这一页在收藏夹里，点一下取消；空心 = 还没收藏。
        网页收藏认网址（同一网址开几枚页签都指向同一条收藏，见 learn/favorites），
        起始页没有网址，无从收藏，置灰。
      */}
      <button
        type="button"
        title={favorited ? t('取消收藏') : t('收藏此页')}
        aria-label={favorited ? t('取消收藏') : t('收藏此页')}
        disabled={!url}
        onClick={onToggleFavorite}
        className={BTN}
      >
        <Star size={14} className={favorited ? 'text-seal' : ''} fill={favorited ? 'currentColor' : 'none'} />
      </button>
      <button
        type="button"
        title={t('在系统浏览器打开')}
        aria-label={t('在系统浏览器打开')}
        disabled={!url}
        onClick={() => {
          if (isElectron()) void native().shell.openExternal(url)
        }}
        className={BTN}
      >
        <ExternalLink size={13} />
      </button>
    </div>
  )
}

/* ---------- 一枚网页页签 ---------- */

function WebPage({
  tab,
  active,
  m,
  onMeta,
  onCommitUrl,
}: {
  tab: WebTab
  active: boolean
  m: WebTabMeta | undefined
  onMeta: (tabId: string, patch: Partial<WebTabMeta>) => void
  onCommitUrl: (tabId: string, url: string) => void
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
    const onStart = (): void => onMeta(id, { loading: true, error: null })
    const onStopLoad = (): void => onMeta(id, { loading: false, ...navState() })
    const onNavigate = (e: Event): void => {
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
    }
  }, [src, id, onMeta, onCommitUrl])

  const shellStyle = {
    position: 'absolute' as const,
    inset: 0,
    visibility: active ? ('visible' as const) : ('hidden' as const),
    pointerEvents: active ? ('auto' as const) : ('none' as const),
  }

  if (!src) {
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
