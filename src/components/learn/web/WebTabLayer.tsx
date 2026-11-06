import { useEffect, useMemo, useRef, useState } from 'react'
import type { WebviewTag } from 'electron'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Languages, Loader2, RotateCw, Sparkles, Star, X } from 'lucide-react'
import type { FileNodeEntity, LearnTab, TabRef, WebTabMeta } from '../../../learn/types'
import { buildApplyPureModeScript } from '../../../learn/web/guestPureMode'
import { buildJumpToElementScript } from '../../../learn/web/guestJump'
import { normalizeWebInput } from '../../../learn/webUrl'
import { isElectron, native, type WebTranslatePayload } from '../../../lib/native'
import { getLocale, t } from '../../../i18n'
import { setAddressFocus } from './addressFocus'
import { registerWebview, webviewByWcId, webviewOf } from '../../../learn/web/webviewRegistry'
import {
  recordWebHistory,
  removeWebHistoryEntry,
  searchWebHistory,
  updateWebHistoryMeta,
} from '../../../learn/web/webHistory'
import { translateBatch, translateSingle, type TranslationEngine } from '../../../learn/web/translator'
import {
  buildClearTranslationsScript,
  buildExtractBlocksScript,
  buildInsertTranslationsScript,
  buildSelectionPopupScript,
  buildStartDomObserverScript,
  buildStopDomObserverScript,
  buildToggleTranslationsScript,
  buildUnmarkTranslatingScript,
} from '../../../learn/web/guestTranslate'
import { openExternalLink } from '../../../lib/externalLink'
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
  fileNodes?: FileNodeEntity[]
  onUpdateFileNode?: (
    nodeId: string,
    patch: { domFilter?: string; pureMode?: boolean; cachedContent?: string; cachedAt?: number },
  ) => void
  pendingJumpsRef?: { current: Map<string, string> }
}

const BTN =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent'

/**
 * allowpopups 必须落**字符串**：@types/react 把它声明成 boolean，但 React 运行时对
 * 非自定义未知元素的布尔属性「只警告、不写 DOM」——属性没上元素，webview 就封死
 * 弹窗通道，target=_blank 的链接（Bing/百度的搜索结果全是）点击一律无效。
 */
const ALLOW_POPUPS = 'true' as unknown as boolean

export default function WebTabLayer({
  tabs,
  activeId,
  meta,
  hidden,
  onMeta,
  onCommitUrl,
  favoriteOf,
  onToggleFavoriteUrl,
  fileNodes,
  onUpdateFileNode,
  pendingJumpsRef,
}: Props) {
  const active = tabs.find((x) => x.id === activeId) ?? null
  const activeFileNode = active?.ref.fileNodeId && fileNodes ? fileNodes.find((f) => f.id === active.ref.fileNodeId) : undefined
  const activePureMode = activeFileNode ? (activeFileNode.pureMode !== false) : (active ? (meta[active.id]?.pureMode ?? false) : false)
  const activeDomFilter = activeFileNode?.domFilter ?? (active ? (meta[active.id]?.domFilter ?? '') : '')

  const handleTogglePure = () => {
    if (!active) return
    const next = !activePureMode
    if (active.ref.fileNodeId && onUpdateFileNode) {
      onUpdateFileNode(active.ref.fileNodeId, { pureMode: next })
    }
    onMeta(active.id, { pureMode: next })
    withActive((wv) => wv.executeJavaScript(buildApplyPureModeScript(activeDomFilter, next)))
  }

  const handleSetFilter = (newFilter: string) => {
    if (!active) return
    if (active.ref.fileNodeId && onUpdateFileNode) {
      onUpdateFileNode(active.ref.fileNodeId, { domFilter: newFilter, pureMode: true })
    }
    onMeta(active.id, { domFilter: newFilter, pureMode: true })
    withActive((wv) => wv.executeJavaScript(buildApplyPureModeScript(newFilter, true)))
  }
  // webview 元素走模块级登记表（learn/web/webviewRegistry）：browser.* 的宿主实现
  // 也从那里拿元素，两层看的是同一份，不用各自维护
  const withActive = (fn: (wv: WebviewTag) => void): void => {
    const wv = active ? webviewOf(active.id) : undefined
    if (wv) fn(wv)
  }

  const [translatingTabId, setTranslatingTabId] = useState<string | null>(null)
  const [transToast, setTransToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 记录开启动态内容变动监听的页签及所使用的翻译引擎
  const observingMapRef = useRef<Map<string, { engine: TranslationEngine }>>(new Map())
  const [observingTabIds, setObservingTabIds] = useState<Set<string>>(new Set())

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setTransToast(msg)
    toastTimerRef.current = setTimeout(() => {
      setTransToast(null)
    }, 3500)
  }

  /** 当页面 DOM 发生变动（滚动加载、SPA 跳转、动态渲染等）时触发增量翻译 */
  const handleDomMutation = async (tabId: string) => {
    const state = observingMapRef.current.get(tabId)
    if (!state) return
    const wv = webviewOf(tabId)
    if (!wv) return

    const targetLang = getLocale() === 'zh' ? 'zh-CN' : getLocale()
    try {
      const extractRes = (await wv.executeJavaScript(buildExtractBlocksScript(targetLang))) as {
        ok?: boolean
        candidates?: Array<{ id: string; text: string }>
      }
      const candidates = extractRes?.candidates || []
      if (candidates.length > 0) {
        // 出多少，翻多少，独立并发派送，无需统计进度
        void translateBatch(candidates, state.engine, {
          targetLang,
          onChunkReady: (batch) => {
            if (batch.length > 0) {
              void wv.executeJavaScript(buildInsertTranslationsScript(batch)).catch(() => {})
            }
          },
          onFailed: (failedIds) => {
            if (failedIds.length > 0) {
              void wv.executeJavaScript(buildUnmarkTranslatingScript(failedIds)).catch(() => {})
            }
          },
        })
      }
    } catch {
      // 增量动态翻译静默容错
    }
  }

  const handlePageTranslate = async (tabId: string, engine: TranslationEngine) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    try {
      setTranslatingTabId(tabId)
      // 若当前页面此前已存在译文或状态残留，先清除旧译文及标记，确保换引擎或重译时能完整扫描整页
      await wv.executeJavaScript(buildClearTranslationsScript()).catch(() => {})

      const targetLang = getLocale() === 'zh' ? 'zh-CN' : getLocale()

      const extractRes = (await wv.executeJavaScript(buildExtractBlocksScript(targetLang))) as {
        ok?: boolean
        candidates?: Array<{ id: string; text: string }>
        error?: string
      }

      if (!extractRes || !extractRes.ok) {
        showToast(t('提取网页内容失败：{0}', extractRes?.error || '未知原因'))
        setTranslatingTabId(null)
        return
      }

      const candidates = extractRes.candidates || []
      if (candidates.length === 0) {
        showToast(t('未检测到需要翻译的外文内容'))
      } else {
        // 全并发立即发出翻译任务，哪个好了就立刻挂载，不显示统计计数
        void translateBatch(candidates, engine, {
          targetLang,
          onChunkReady: (batch) => {
            if (batch.length > 0) {
              void wv.executeJavaScript(buildInsertTranslationsScript(batch)).catch(() => {})
            }
          },
          onFailed: (failedIds) => {
            if (failedIds.length > 0) {
              void wv.executeJavaScript(buildUnmarkTranslatingScript(failedIds)).catch(() => {})
            }
          },
        })
      }

      // 自动开启动态内容变动监听（MutationObserver）
      await wv.executeJavaScript(buildStartDomObserverScript()).catch(() => {})
      observingMapRef.current.set(tabId, { engine })
      setObservingTabIds(new Set(observingMapRef.current.keys()))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(t('翻译失败：{0}', msg))
    } finally {
      setTranslatingTabId(null)
    }
  }

  const handleSelectionTranslate = async (
    tabId: string,
    text: string,
    engine: TranslationEngine,
    x?: number,
    y?: number,
  ) => {
    const wv = webviewOf(tabId)
    if (!wv || !text.trim()) return
    try {
      const targetLang = getLocale() === 'zh' ? 'zh-CN' : getLocale()
      const translation = await translateSingle(text, engine, targetLang)
      if (!translation) {
        showToast(t('未能获得译文'))
        return
      }
      await wv.executeJavaScript(
        buildSelectionPopupScript({
          original: text,
          translation,
          engine,
          x: x ?? 120,
          y: y ?? 120,
        }),
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(t('翻译失败：{0}', msg))
    }
  }

  const handleToggleTranslate = async (tabId: string) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    const res = await wv.executeJavaScript(buildToggleTranslationsScript())
    if (res === 'hidden') {
      showToast(t('已隐藏双语对照'))
    } else {
      showToast(t('已恢复显示双语对照'))
    }
  }

  const handleClearTranslate = async (tabId: string) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    observingMapRef.current.delete(tabId)
    setObservingTabIds(new Set(observingMapRef.current.keys()))
    await wv.executeJavaScript(buildStopDomObserverScript()).catch(() => {})
    const count = await wv.executeJavaScript(buildClearTranslationsScript())
    showToast(t('已清除 {0} 处译文并停止动态监听', count || 0))
  }

  const handleToggleObserver = async (tabId: string) => {
    const wv = webviewOf(tabId)
    if (!wv) return
    if (observingMapRef.current.has(tabId)) {
      observingMapRef.current.delete(tabId)
      setObservingTabIds(new Set(observingMapRef.current.keys()))
      await wv.executeJavaScript(buildStopDomObserverScript()).catch(() => {})
      showToast(t('已停止动态内容监听'))
    } else {
      observingMapRef.current.set(tabId, { engine: 'fast' })
      setObservingTabIds(new Set(observingMapRef.current.keys()))
      await wv.executeJavaScript(buildStartDomObserverScript()).catch(() => {})
      showToast(t('已开启动态内容监听'))
    }
  }

  /*
    订阅主进程右键菜单发起的翻译指令
  */
  useEffect(() => {
    if (!isElectron()) return
    return native().browser.onTranslate((payload: WebTranslatePayload) => {
      const wv = webviewByWcId(payload.wcId) ?? (active ? webviewOf(active.id) : undefined)
      if (!wv) return
      const targetTab = tabs.find((t) => webviewOf(t.id) === wv) ?? active
      if (!targetTab) return

      if (payload.mode === 'toggle') {
        void handleToggleTranslate(targetTab.id)
      } else if (payload.mode === 'clear') {
        void handleClearTranslate(targetTab.id)
      } else if (payload.mode === 'selection' && payload.text) {
        void handleSelectionTranslate(
          targetTab.id,
          payload.text,
          payload.engine ?? 'fast',
          payload.x,
          payload.y,
        )
      } else if (payload.mode === 'page') {
        void handlePageTranslate(targetTab.id, payload.engine ?? 'fast')
      }
    })
  }, [active, tabs])

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
          translating={translatingTabId === active.id}
          isObserving={observingTabIds.has(active.id)}
          onTranslatePage={(engine) => void handlePageTranslate(active.id, engine)}
          onToggleTranslate={() => void handleToggleTranslate(active.id)}
          onClearTranslate={() => void handleClearTranslate(active.id)}
          onToggleObserver={() => void handleToggleObserver(active.id)}
          pureMode={activePureMode}
          domFilter={activeDomFilter}
          onTogglePureMode={handleTogglePure}
          onSetDomFilter={handleSetFilter}
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
            fileNode={tab.ref.fileNodeId && fileNodes ? fileNodes.find((f) => f.id === tab.ref.fileNodeId) : undefined}
            onAutoCache={onUpdateFileNode}
            pendingJumpsRef={pendingJumpsRef}
            onDomMutation={handleDomMutation}
            onNavigateReset={(tid) => {
              observingMapRef.current.delete(tid)
              setObservingTabIds(new Set(observingMapRef.current.keys()))
            }}
          />
        ))}
      </div>

      {transToast && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line-strong/60 bg-card/95 px-4 py-1.5 text-[12px] font-medium text-ink shadow-[0_8px_20px_rgba(0,0,0,0.12)] backdrop-blur">
          {translatingTabId && <Loader2 size={13} className="animate-spin text-seal" />}
          <span>{transToast}</span>
        </div>
      )}
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
  translating,
  isObserving,
  onTranslatePage,
  onToggleTranslate,
  onClearTranslate,
  onToggleObserver,
  pureMode,
  domFilter,
  onTogglePureMode,
  onSetDomFilter,
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
  translating?: boolean
  isObserving?: boolean
  onTranslatePage?: (engine: TranslationEngine) => void
  onToggleTranslate?: () => void
  onClearTranslate?: () => void
  onToggleObserver?: () => void
  pureMode?: boolean
  domFilter?: string
  onTogglePureMode?: () => void
  onSetDomFilter?: (newFilter: string) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const blurTimerRef = useRef<number | null>(null)
  const [openTranslateMenu, setOpenTranslateMenu] = useState(false)
  const translateMenuRef = useRef<HTMLDivElement | null>(null)
  const [openPureMenu, setOpenPureMenu] = useState(false)
  const pureMenuRef = useRef<HTMLDivElement | null>(null)
  const [filterDraft, setFilterDraft] = useState(domFilter ?? '')

  useEffect(() => {
    setFilterDraft(domFilter ?? '')
  }, [domFilter])

  useEffect(() => {
    if (!openPureMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (pureMenuRef.current && !pureMenuRef.current.contains(e.target as Node)) {
        setOpenPureMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openPureMenu])

  useEffect(() => {
    if (!openTranslateMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (translateMenuRef.current && !translateMenuRef.current.contains(e.target as Node)) {
        setOpenTranslateMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openTranslateMenu])
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

      {/* 双语翻译按钮及快捷控制下拉菜单 */}
      <div ref={translateMenuRef} className="relative">
        <button
          type="button"
          title={translating ? t('正在翻译中...') : t('双语翻译')}
          aria-label={t('双语翻译')}
          disabled={!url || translating}
          onClick={() => setOpenTranslateMenu((v) => !v)}
          className={BTN}
        >
          {translating ? <Loader2 size={13} className="animate-spin text-seal" /> : <Languages size={14} />}
        </button>
        {openTranslateMenu && (
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-line bg-card p-1 shadow-lg text-[11.5px]">
            <button
              type="button"
              onClick={() => {
                setOpenTranslateMenu(false)
                onTranslatePage?.('fast')
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink hover:bg-line/50 transition cursor-pointer"
            >
              <span>⚡</span>
              <span>{t('极速双语翻译（免费）')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenTranslateMenu(false)
                onTranslatePage?.('ai')
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink hover:bg-line/50 transition cursor-pointer"
            >
              <span>🤖</span>
              <span>{t('AI 深度双语翻译')}</span>
            </button>
            <div className="my-1 border-t border-line/60" />
            {isObserving && (
              <button
                type="button"
                onClick={() => {
                  setOpenTranslateMenu(false)
                  onToggleObserver?.()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-seal hover:bg-seal/10 transition cursor-pointer font-medium"
              >
                <span>🟢</span>
                <span>{t('动态监听中（点击停止）')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpenTranslateMenu(false)
                onToggleTranslate?.()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-soft hover:bg-line/50 hover:text-ink transition cursor-pointer"
            >
              <span>👁️</span>
              <span>{t('隐藏 / 显示双语对照')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenTranslateMenu(false)
                onClearTranslate?.()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-danger hover:bg-danger/10 transition cursor-pointer"
            >
              <span>🗑️</span>
              <span>{t('清除网页译文')}</span>
            </button>
          </div>
        )}
      </div>

      {/* 纯净阅读与 DOM 过滤配置 */}
      <div ref={pureMenuRef} className="relative">
        <button
          type="button"
          title={pureMode ? t('纯净阅读（已开启）') : t('原网页阅读')}
          aria-label={t('纯净阅读')}
          disabled={!url}
          onClick={() => setOpenPureMenu((v) => !v)}
          className={`${BTN} ${pureMode ? 'text-seal font-semibold' : ''}`}
        >
          <Sparkles size={14} className={pureMode ? 'text-seal' : ''} />
        </button>
        {openPureMenu && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-line bg-card p-2.5 shadow-lg text-[12px]">
            <div className="flex items-center justify-between pb-2 border-b border-line/60">
              <span className="font-semibold text-ink-strong">{t('纯净阅读模式')}</span>
              <button
                type="button"
                onClick={() => {
                  onTogglePureMode?.()
                }}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition cursor-pointer ${
                  pureMode ? 'bg-seal text-white' : 'bg-line text-ink-soft hover:bg-line-strong hover:text-ink'
                }`}
              >
                {pureMode ? t('已开启') : t('已关闭')}
              </button>
            </div>
            <div className="pt-2">
              <div className="text-[11px] text-ink-faint mb-1">{t('DOM 正文过滤选择器 (可选)')}</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="article, .post-content, #main"
                  value={filterDraft}
                  onChange={(e) => setFilterDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onSetDomFilter?.(filterDraft.trim())
                      setOpenPureMenu(false)
                    }
                  }}
                  className="flex-1 min-w-0 rounded border border-line bg-line/20 px-2 py-1 text-[11px] text-ink focus:outline-none focus:border-seal/60"
                />
                <button
                  type="button"
                  onClick={() => {
                    onSetDomFilter?.(filterDraft.trim())
                    setOpenPureMenu(false)
                  }}
                  className="shrink-0 rounded bg-line px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-line-strong hover:text-ink transition cursor-pointer"
                >
                  {t('应用')}
                </button>
              </div>
            </div>
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
          void openExternalLink(url)
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
    patch: { domFilter?: string; pureMode?: boolean; cachedContent?: string; cachedAt?: number },
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

      // 1. 纯净模式与 DOM 过滤
      const pureEnabled = fileNode ? (fileNode.pureMode !== false) : (m?.pureMode ?? false)
      const domFilter = fileNode?.domFilter ?? m?.domFilter
      if (pureEnabled) {
        void wv.executeJavaScript(buildApplyPureModeScript(domFilter, true))
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
