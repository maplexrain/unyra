import { useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  ChevronDown,
  Clock,
  Compass,
  Globe,
  Search,
} from 'lucide-react'
import { loadWebHistory, type WebHistoryEntry } from '../../../learn/web/webHistory'
import { normalizeWebInput } from '../../../learn/webUrl'
import { t } from '../../../i18n'

export interface SearchEngine {
  id: string
  name: string
  desc: string
  homeUrl: string
  searchUrl: (q: string) => string
  badgeColor: string
  icon: ReactNode
}

/** 8 大主流搜索引擎与学术/代码专业检索入口 */
export const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: 'google',
    name: 'Google',
    desc: '全球探索与学术',
    homeUrl: 'https://www.google.com',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    badgeColor: '#4285F4',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          fill="#EA4335"
        />
      </svg>
    ),
  },
  {
    id: 'bing',
    name: 'Bing',
    desc: '微软必应智能搜索',
    homeUrl: 'https://www.bing.com',
    searchUrl: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
    badgeColor: '#008373',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path
          d="M5.4 2v17.5l5.2-3 2.5 3.5 5.5-3.2v-7.1l-7.3-2.5v-5.2l-5.9 0z"
          fill="#008373"
        />
      </svg>
    ),
  },
  {
    id: 'baidu',
    name: '百度',
    desc: '中文资讯与检索',
    homeUrl: 'https://www.baidu.com',
    searchUrl: (q) => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`,
    badgeColor: '#2932E1',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="#2932E1">
        <path d="M4.5 10.5c.8 0 1.5-.7 1.5-1.5S5.3 7.5 4.5 7.5 3 8.2 3 9s.7 1.5 1.5 1.5zm4-3c.8 0 1.5-.7 1.5-1.5S9.3 4.5 8.5 4.5 7 5.2 7 6s.7 1.5 1.5 1.5zm7 0c.8 0 1.5-.7 1.5-1.5S16.3 4.5 15.5 4.5 14 5.2 14 6s.7 1.5 1.5 1.5zm4 3c.8 0 1.5-.7 1.5-1.5S18.8 7.5 18 7.5 16.5 8.2 16.5 9s.7 1.5 1.5 1.5zM12 9c-3.3 0-5.5 2.5-5.5 5.5 0 2.5 1.8 4.5 4.5 4.5.8 0 1.8-.3 2.5-.8.5.5 1.2.8 2 .8 2.2 0 3.5-1.8 3.5-3.8 0-3.3-2.8-6.2-7-6.2z" />
      </svg>
    ),
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    desc: '注重隐私的安全搜索',
    homeUrl: 'https://duckduckgo.com',
    searchUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
    badgeColor: '#DE5833',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <circle cx="12" cy="12" r="10" fill="#DE5833" />
        <path
          d="M16.5 13.5c-.8 1.5-2.5 2.5-4.5 2.5s-3.7-1-4.5-2.5c1.2-.5 2.8-.8 4.5-.8s3.3.3 4.5.8z"
          fill="#FFF"
        />
        <circle cx="9.5" cy="10" r="1.5" fill="#FFF" />
        <circle cx="14.5" cy="10" r="1.5" fill="#FFF" />
      </svg>
    ),
  },
  {
    id: 'github',
    name: 'GitHub',
    desc: '开源技术与代码仓库',
    homeUrl: 'https://github.com',
    searchUrl: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`,
    badgeColor: '#24292F',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        />
      </svg>
    ),
  },
  {
    id: 'wikipedia',
    name: '维基百科',
    desc: '多语言自由知识宝库',
    homeUrl: 'https://zh.wikipedia.org',
    searchUrl: (q) => `https://zh.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
    badgeColor: '#636466',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M12.09 13.62l2.36-6.42h1.65l-3.32 8.7h-1.38L8.76 9.87l-2.6 6.03H4.81L1.5 7.2h1.66l2.36 6.4 2.1-5.06-1.44-1.34h3.63l-.78 1.34 1.88 5.08 1.18-3.08-1.08-1.26.17-.68h3.33l-.76 1.34 2.1 5.37 2.39-6.71H22l-4.14 10.5h-1.37l-2.7-6.97z" />
      </svg>
    ),
  },
  {
    id: 'arxiv',
    name: 'arXiv',
    desc: '前沿科学与AI预印论文',
    homeUrl: 'https://arxiv.org',
    searchUrl: (q) => `https://arxiv.org/search/?query=${encodeURIComponent(q)}&searchtype=all`,
    badgeColor: '#B31B1B',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <rect width="24" height="24" rx="5" fill="#B31B1B" />
        <path
          d="M6 17l4-5-4-5h2.5l2.7 3.5L14 7h2.5l-4 5 4 5H15l-2.8-3.7L9.5 17H6z"
          fill="#FFF"
        />
      </svg>
    ),
  },
  {
    id: 'deepl',
    name: 'DeepL',
    desc: '高质精准学术机器翻译',
    homeUrl: 'https://www.deepl.com/translator',
    searchUrl: (q) => `https://www.deepl.com/translator#zh/en/${encodeURIComponent(q)}`,
    badgeColor: '#0F2B46',
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <rect width="24" height="24" rx="5" fill="#0F2B46" />
        <path
          d="M7 6h5a5 5 0 015 5v2a5 5 0 01-5 5H7V6zm3 3v6h2a2 2 0 002-2v-2a2 2 0 00-2-2h-2z"
          fill="#0F9BD1"
        />
      </svg>
    ),
  },
]

export default function BlankWebPage({
  onOpenUrl,
}: {
  onOpenUrl: (targetUrl: string) => void
}) {
  const [query, setQuery] = useState('')
  const [selectedEngineId, setSelectedEngineId] = useState('google')
  const [engineMenuOpen, setEngineMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const currentEngine = useMemo(
    () => SEARCH_ENGINES.find((e) => e.id === selectedEngineId) ?? SEARCH_ENGINES[0],
    [selectedEngineId],
  )

  // 最近访问历史（提取前 4 条）
  const recentHistories: WebHistoryEntry[] = useMemo(() => {
    try {
      const all = loadWebHistory()
      return all.slice(0, 4)
    } catch {
      return []
    }
  }, [])

  const handleSubmit = (overrideEngine?: SearchEngine) => {
    const raw = query.trim()
    const engine = overrideEngine ?? currentEngine
    if (!raw) return

    // 如果输入的是完整或典型网址格式，直接打开该网址
    if (/^https?:\/\//i.test(raw) || /^file:\/\//i.test(raw) || /^localhost/i.test(raw)) {
      onOpenUrl(raw)
      return
    }
    // 类似于 github.com, bing.com, arxiv.org 等典型域名无协议格式
    if (/^[a-z\d-]+(\.[a-z\d-]+)+(:\d+)?([/?#].*)?$/i.test(raw) && !raw.includes(' ')) {
      onOpenUrl(normalizeWebInput(raw))
      return
    }

    // 否则直接发起对应引擎的检索
    onOpenUrl(engine.searchUrl(raw))
  }

  const handleDialClick = (engine: SearchEngine) => {
    const raw = query.trim()
    if (raw) {
      // 搜索框中有文字：直接使用该引擎搜索
      handleSubmit(engine)
    } else {
      // 搜索框为空：打开该引擎官方主页
      onOpenUrl(engine.homeUrl)
    }
  }

  return (
    <div className="relative flex min-h-full w-full flex-col items-center justify-center px-6 py-12 select-none">
      {/* 居中主视觉区 */}
      <div className="flex w-full max-w-[660px] flex-col items-center animate-in fade-in zoom-in-95 duration-200">
        {/* 顶部轻质微徽标 */}
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-seal/10 text-seal shadow-xs">
          <Compass size={28} className="animate-spin-slow" />
        </div>

        <h1 className="mt-4 text-[21px] font-semibold tracking-tight text-ink-strong">
          {t('探索互联网')}
        </h1>
        <p className="mt-1 text-[12.5px] text-ink-soft">
          {t('输入网址直接直达，或点击快捷入口快速开启学术与知识探索')}
        </p>

        {/* 核心搜索输入框 */}
        <div className="relative mt-7 w-full">
          <div className="relative flex items-center rounded-2xl border border-line bg-card/90 shadow-sm transition-all focus-within:border-seal/60 focus-within:ring-2 focus-within:ring-seal/15 focus-within:shadow-md">
            {/* 引擎切换器 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setEngineMenuOpen((v) => !v)}
                title={t('切换搜索引擎（当前：{0}）', currentEngine.name)}
                className="flex items-center gap-1.5 rounded-l-2xl border-r border-line/70 px-3 py-2.5 text-[12px] font-medium text-ink transition hover:bg-line/40"
              >
                <span className="shrink-0">{currentEngine.icon}</span>
                <span className="hidden sm:inline-block max-w-[80px] truncate">
                  {currentEngine.name}
                </span>
                <ChevronDown size={12} className="text-ink-faint shrink-0" />
              </button>

              {/* 引擎切换下拉菜单 */}
              {engineMenuOpen && (
                <div
                  onMouseLeave={() => setEngineMenuOpen(false)}
                  className="absolute left-0 top-full z-30 mt-1.5 w-48 rounded-xl border border-line-strong/60 bg-card p-1 shadow-[0_12px_28px_rgba(31,27,23,0.22)]"
                >
                  <div className="px-2 py-1 text-[10.5px] font-medium text-ink-faint">
                    {t('选择搜索引擎')}
                  </div>
                  {SEARCH_ENGINES.slice(0, 4).map((eng) => (
                    <button
                      key={eng.id}
                      type="button"
                      onClick={() => {
                        setSelectedEngineId(eng.id)
                        setEngineMenuOpen(false)
                        inputRef.current?.focus()
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition ${
                        eng.id === selectedEngineId
                          ? 'bg-seal/10 font-medium text-seal'
                          : 'text-ink hover:bg-line/60'
                      }`}
                    >
                      <span className="shrink-0">{eng.icon}</span>
                      <span className="flex-1 truncate">{eng.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 输入文本框 */}
            <div className="relative flex flex-1 items-center px-2">
              <Search size={15} className="text-ink-faint shrink-0 ml-1" />
              <input
                ref={inputRef}
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                placeholder={t('在 {0} 中搜索，或输入网址回车直达…', currentEngine.name)}
                className="w-full bg-transparent px-2.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>

            {/* 搜索按钮 */}
            <div className="pr-1.5">
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!query.trim()}
                title={t('开始搜索（Enter）')}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink text-paper shadow-xs transition hover:bg-ink-strong disabled:pointer-events-none disabled:opacity-30"
              >
                <ArrowUp size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* 搜索引擎与学术/代码快速跳转矩阵 */}
        <div className="mt-8 w-full">
          <div className="flex items-center justify-between px-1 text-[11px] font-medium text-ink-faint">
            <span>{t('快捷入口 & 常用检索')}</span>
            <span className="text-[10px] text-ink-faint/80">
              {query.trim() ? t('点击卡片以该引擎搜索“{0}”', query.trim()) : t('点击直接直达官方主页')}
            </span>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEARCH_ENGINES.map((engine) => (
              <button
                key={engine.id}
                type="button"
                onClick={() => handleDialClick(engine)}
                title={
                  query.trim()
                    ? t('使用 {0} 搜索：{1}', engine.name, query.trim())
                    : t('打开 {0} 首页', engine.name)
                }
                className="group flex items-center gap-2.5 rounded-xl border border-line/60 bg-paper/40 p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-seal/40 hover:bg-paper hover:shadow-xs active:translate-y-0"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-card shadow-xs group-hover:scale-105 transition-transform">
                  {engine.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-ink group-hover:text-seal transition-colors">
                    {engine.name}
                  </div>
                  <div className="truncate text-[10px] text-ink-faint">
                    {engine.desc}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 最近访问记录 (如果有) */}
        {recentHistories.length > 0 && (
          <div className="mt-7 w-full border-t border-line/60 pt-5">
            <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium text-ink-faint">
              <Clock size={12} />
              <span>{t('最近访问')}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recentHistories.map((item) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => onOpenUrl(item.url)}
                  title={`${item.title}\n${item.url}`}
                  className="flex max-w-[260px] items-center gap-2 rounded-lg border border-line/50 bg-paper/30 px-2.5 py-1.5 text-left transition hover:border-line-strong hover:bg-paper"
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
                    <Globe size={12} className="shrink-0 text-ink-faint" />
                  )}
                  <span className="truncate text-[11.5px] text-ink-soft hover:text-ink">
                    {item.title || item.url}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 底部快捷按键小贴士 */}
        <div className="mt-9 flex items-center justify-center gap-5 text-[11px] text-ink-faint">
          <span>{t('Ctrl + L 聚焦顶部地址栏')}</span>
          <span className="text-line-strong">·</span>
          <span>{t('输入网址直接回车')}</span>
          <span className="text-line-strong">·</span>
          <span>{t('快捷卡片即点即搜')}</span>
        </div>
      </div>
    </div>
  )
}
