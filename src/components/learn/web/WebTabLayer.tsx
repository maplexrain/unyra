import { useMemo } from 'react'
import type { WebviewTag } from 'electron'
import { Loader2 } from 'lucide-react'
import type { FileNodeEntity, LearnTab, TabRef, WebTabMeta } from '../../../learn/types'
import { buildApplyPureModeScript } from '../../../learn/web/guestPureMode'
import { buildInspectElementPickerScript } from '../../../learn/web/guestInspectPicker'
import { t } from '../../../i18n'
import { webviewOf } from '../../../learn/web/webviewRegistry'
import WebToolbar from './WebAddressBar'
import WebPage from './WebPage'
import { useGuestInputBridge } from './useGuestInputBridge'
import { useWebTranslate } from './useWebTranslate'

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
 *
 * 拆分结构：地址栏工具条见 WebAddressBar，单页 webview 宿主见 WebPage，
 * 翻译与动态监听机制见 useWebTranslate，guest 指针事件桥见 useGuestInputBridge。
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
    patch: { domFilter?: string; whitelist?: string[]; blacklist?: string[]; pureMode?: boolean; cachedContent?: string; cachedAt?: number },
  ) => void
  pendingJumpsRef?: { current: Map<string, string> }
}

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
  const activeWhitelist = useMemo(() => {
    if (activeFileNode?.whitelist && activeFileNode.whitelist.length > 0) return activeFileNode.whitelist
    if (active && meta[active.id]?.whitelist && meta[active.id]!.whitelist!.length > 0) return meta[active.id]!.whitelist!
    return activeDomFilter ? [activeDomFilter] : []
  }, [activeFileNode?.whitelist, active, meta, activeDomFilter])
  const activeBlacklist = useMemo(() => {
    if (activeFileNode?.blacklist) return activeFileNode.blacklist
    if (active && meta[active.id]?.blacklist) return meta[active.id]!.blacklist!
    return []
  }, [activeFileNode?.blacklist, active, meta])

  const handleTogglePure = () => {
    if (!active) return
    const next = !activePureMode
    if (active.ref.fileNodeId && onUpdateFileNode) {
      onUpdateFileNode(active.ref.fileNodeId, { pureMode: next })
    }
    onMeta(active.id, { pureMode: next })
    withActive((wv) => wv.executeJavaScript(buildApplyPureModeScript({ whitelist: activeWhitelist, blacklist: activeBlacklist }, next)))
  }

  const handleUpdateFilterConfig = (nextWhitelist: string[], nextBlacklist: string[]) => {
    if (!active) return
    const patch = {
      whitelist: nextWhitelist,
      blacklist: nextBlacklist,
      domFilter: nextWhitelist.join(', '),
      pureMode: true,
    }
    if (active.ref.fileNodeId && onUpdateFileNode) {
      onUpdateFileNode(active.ref.fileNodeId, patch)
    }
    onMeta(active.id, patch)
    withActive((wv) => wv.executeJavaScript(buildApplyPureModeScript({ whitelist: nextWhitelist, blacklist: nextBlacklist }, true)))
  }

  const handleInspectPick = (pickMode: 'whitelist' | 'blacklist' = 'whitelist') => {
    withActive(async (wv) => {
      try {
        const res = (await wv.executeJavaScript(buildInspectElementPickerScript(pickMode))) as
          | { ok: true; selector: string; mode: 'whitelist' | 'blacklist' }
          | { ok: false; cancelled?: boolean }
          | undefined
        if (res && res.ok && typeof res.selector === 'string' && res.selector.trim()) {
          const sel = res.selector.trim()
          if (pickMode === 'blacklist') {
            const next = activeBlacklist.includes(sel) ? activeBlacklist : [...activeBlacklist, sel]
            handleUpdateFilterConfig(activeWhitelist, next)
            showToast(t('已将元素加入黑名单隐藏: {0}', sel))
          } else {
            const next = activeWhitelist.includes(sel) ? activeWhitelist : [...activeWhitelist, sel]
            handleUpdateFilterConfig(next, activeBlacklist)
            showToast(t('已将元素加入白名单显示: {0}', sel))
          }
        }
      } catch (e) {
        console.warn('[web] 元素拾取失败:', e)
      }
    })
  }
  // webview 元素走模块级登记表（learn/web/webviewRegistry）：browser.* 的宿主实现
  // 也从那里拿元素，两层看的是同一份，不用各自维护
  const withActive = (fn: (wv: WebviewTag) => void): void => {
    const wv = active ? webviewOf(active.id) : undefined
    if (wv) fn(wv)
  }

  // 翻译 / 动态监听机制（整页翻译、划词、对照开关、toast），见 useWebTranslate
  const {
    translatingTabId,
    transToast,
    observingTabIds,
    showToast,
    handleDomMutation,
    handlePageTranslate,
    handleToggleTranslate,
    handleClearTranslate,
    handleToggleObserver,
    resetObserving,
  } = useWebTranslate({ tabs, active })
  // guest 指针事件桥（guestPreload 上报 → 主进程转发 → 合成 PointerEvent），见 useGuestInputBridge
  useGuestInputBridge()

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
          whitelist={activeWhitelist}
          blacklist={activeBlacklist}
          onTogglePureMode={handleTogglePure}
          onUpdateFilterConfig={handleUpdateFilterConfig}
          onInspectPick={handleInspectPick}
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
            onNavigateReset={resetObserving}
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
