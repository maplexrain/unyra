/**
 * 地址栏工具条（拆自 WebTabLayer 的「地址栏工具条」一节）：
 * 后退 / 前进 / 刷新停止、地址输入与历史补全下拉、双语翻译菜单、
 * 纯净阅读（白 / 黑名单）面板、收藏星标、系统浏览器打开。
 * 展示组件：逐项 props + 内联回调；导航与翻译等页签操作回调由 WebTabLayer 注入。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, Crosshair, ExternalLink, Eye, EyeOff, Globe, Languages, ListFilter, Loader2, Plus, RotateCw, Sparkles, Star, Trash2, X, Zap } from 'lucide-react'
import type { WebTabMeta } from '../../../learn/types'
import type { WebTab } from './WebTabLayer'
import { normalizeWebInput } from '../../../learn/webUrl'
import { t } from '../../../i18n'
import { setAddressFocus } from './addressFocus'
import { removeWebHistoryEntry, searchWebHistory } from '../../../learn/web/webHistory'
import type { TranslationEngine } from '../../../learn/web/translator'
import { openExternalLink } from '../../../lib/externalLink'

const BTN =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-transparent text-ink-soft transition hover:bg-line/50 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent'

export default function WebToolbar({
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
  whitelist,
  blacklist,
  onTogglePureMode,
  onUpdateFilterConfig,
  onInspectPick,
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
  whitelist?: string[]
  blacklist?: string[]
  onTogglePureMode?: () => void
  onUpdateFilterConfig?: (whitelist: string[], blacklist: string[]) => void
  onInspectPick?: (mode: 'whitelist' | 'blacklist') => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const blurTimerRef = useRef<number | null>(null)
  const [openTranslateMenu, setOpenTranslateMenu] = useState(false)
  const translateMenuRef = useRef<HTMLDivElement | null>(null)
  const [openPureMenu, setOpenPureMenu] = useState(false)
  const pureMenuRef = useRef<HTMLDivElement | null>(null)
  const [filterTab, setFilterTab] = useState<'whitelist' | 'blacklist'>('whitelist')
  const [newFilterInput, setNewFilterInput] = useState('')

  const curWhitelist = useMemo(() => {
    if (whitelist && whitelist.length > 0) return whitelist
    return domFilter ? [domFilter] : []
  }, [whitelist, domFilter])

  const curBlacklist = useMemo(() => blacklist ?? [], [blacklist])

  const handleAddFilterItem = () => {
    const trimmed = newFilterInput.trim()
    if (!trimmed) return
    if (filterTab === 'whitelist') {
      if (!curWhitelist.includes(trimmed)) {
        onUpdateFilterConfig?.([...curWhitelist, trimmed], curBlacklist)
      }
    } else {
      if (!curBlacklist.includes(trimmed)) {
        onUpdateFilterConfig?.(curWhitelist, [...curBlacklist, trimmed])
      }
    }
    setNewFilterInput('')
  }

  const handleRemoveWhitelistItem = (item: string) => {
    onUpdateFilterConfig?.(curWhitelist.filter((x) => x !== item), curBlacklist)
  }

  const handleRemoveBlacklistItem = (item: string) => {
    onUpdateFilterConfig?.(curWhitelist, curBlacklist.filter((x) => x !== item))
  }

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
              <Zap size={14} className="text-amber-500 shrink-0" />
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
              <Bot size={14} className="text-seal shrink-0" />
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
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
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
              <Eye size={14} className="text-ink-soft shrink-0" />
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
              <Trash2 size={14} className="text-danger shrink-0" />
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
          <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-line bg-card p-3 shadow-xl text-[12px]">
            {/* 顶栏：标题与开关 */}
            <div className="flex items-center justify-between pb-2 border-b border-line/60">
              <div className="flex items-center gap-1.5">
                <Sparkles size={14} className={pureMode ? 'text-seal' : 'text-ink-soft'} />
                <span className="font-semibold text-ink-strong">{t('纯净阅读模式')}</span>
              </div>
              <button
                type="button"
                onClick={onTogglePureMode}
                className={`rounded px-2.5 py-0.5 text-[11px] font-medium transition cursor-pointer ${
                  pureMode ? 'bg-seal text-white shadow-xs' : 'bg-line text-ink-soft hover:bg-line-strong hover:text-ink'
                }`}
              >
                {pureMode ? t('已开启') : t('已关闭')}
              </button>
            </div>

            {/* 白名单 / 黑名单 选项卡 */}
            <div className="mt-2.5 flex items-center gap-1 rounded-lg bg-line/30 p-0.5">
              <button
                type="button"
                onClick={() => setFilterTab('whitelist')}
                className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium transition cursor-pointer ${
                  filterTab === 'whitelist'
                    ? 'bg-card text-seal shadow-xs font-semibold'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                <ListFilter size={12} />
                <span>{t('白名单 (仅显示)')}</span>
                {curWhitelist.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-seal/15 px-1.5 text-[9.5px] font-bold text-seal">
                    {curWhitelist.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('blacklist')}
                className={`flex-1 flex items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium transition cursor-pointer ${
                  filterTab === 'blacklist'
                    ? 'bg-card text-danger shadow-xs font-semibold'
                    : 'text-ink-soft hover:text-ink'
                }`}
              >
                <EyeOff size={12} />
                <span>{t('黑名单 (隐藏)')}</span>
                {curBlacklist.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-danger/15 px-1.5 text-[9.5px] font-bold text-danger">
                    {curBlacklist.length}
                  </span>
                )}
              </button>
            </div>

            {/* 说明提示 */}
            <div className="mt-1.5 text-[10.5px] text-ink-faint leading-normal">
              {filterTab === 'whitelist'
                ? t('仅保留所选元素显示；若列表为空则显示全文（仅执行黑名单过滤）')
                : t('在页面中隐藏所选元素（消除广告、侧边栏、页眉等干扰）')}
            </div>

            {/* 选择器列表展示 */}
            <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-line/60 bg-line/10 p-1.5 space-y-1">
              {(filterTab === 'whitelist' ? curWhitelist : curBlacklist).length === 0 ? (
                <div className="py-2 text-center text-[11px] text-ink-faint">
                  {filterTab === 'whitelist' ? t('暂无白名单（显示全文）') : t('暂无黑名单项')}
                </div>
              ) : (
                (filterTab === 'whitelist' ? curWhitelist : curBlacklist).map((sel) => (
                  <div
                    key={sel}
                    className="flex items-center justify-between gap-1.5 rounded bg-card px-2 py-1 text-[11px] font-mono text-ink border border-line/40 shadow-2xs"
                  >
                    <span className="truncate" title={sel}>{sel}</span>
                    <button
                      type="button"
                      onClick={() =>
                        filterTab === 'whitelist'
                          ? handleRemoveWhitelistItem(sel)
                          : handleRemoveBlacklistItem(sel)
                      }
                      title={t('删除此项')}
                      className="text-ink-faint hover:text-red-500 transition cursor-pointer shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* 手动添加输入框 */}
            <div className="mt-2 flex items-center gap-1.5">
              <input
                type="text"
                placeholder={filterTab === 'whitelist' ? 'article, #content' : '.sidebar, .ad, header'}
                value={newFilterInput}
                onChange={(e) => setNewFilterInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddFilterItem()
                }}
                className="flex-1 min-w-0 rounded-md border border-line bg-line/20 px-2 py-1 text-[11px] text-ink focus:outline-none focus:border-seal/60 font-mono"
              />
              <button
                type="button"
                onClick={handleAddFilterItem}
                className="shrink-0 flex items-center gap-1 rounded-md bg-line px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-line-strong hover:text-ink transition cursor-pointer"
              >
                <Plus size={11} />
                <span>{t('添加')}</span>
              </button>
            </div>

            {/* 可视化拾取按钮 */}
            <button
              type="button"
              onClick={() => {
                setOpenPureMenu(false)
                onInspectPick?.(filterTab)
              }}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[11px] font-medium transition cursor-pointer ${
                filterTab === 'whitelist'
                  ? 'border-seal/30 bg-seal/10 text-seal hover:bg-seal/15'
                  : 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15'
              }`}
            >
              <Crosshair size={13} />
              <span>
                {filterTab === 'whitelist'
                  ? t('检查元素拾取加入白名单')
                  : t('检查元素拾取加入黑名单')}
              </span>
            </button>
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
