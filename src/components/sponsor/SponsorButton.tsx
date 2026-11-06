/**
 * 顶栏的赞助/打赏入口按钮与悬停浮层。
 * 改为两栏设计：
 * - 第一栏：展示微信赞赏码与温和真诚的致意，并提供应用内查看赞助者名单的快捷入口；
 * - 第二栏：展示赞助名单与排序控制（默认按日期降序，最上方显示最近赞助日期）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpDown, Calendar, ExternalLink, Heart, RotateCw, Sparkles } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'
import {
  fetchLatestSponsorsMarkdown,
  getInitialSponsorsMarkdown,
  openSponsorsTab,
  parseSponsorsMarkdown,
} from '../../lib/sponsorDoc'
import sponsorQr from '../../assets/sponsor-qrcode.png'

/** 指针离开后延后关：按钮与浮层间有缝，避免半路断掉 */
const HOVER_CLOSE_MS = 120
/** 退场动画时长 */
const MENU_EXIT_MS = 160

export default function SponsorButton() {
  const { open, setOpen, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: MENU_EXIT_MS,
    buttonOpens: true,
  })

  // 赞助者名单 Markdown 文本（优先本地缓存秒开，并动态与 GitHub 仓库保持同步）
  const [sponsorsMd, setSponsorsMd] = useState<string>(() => getInitialSponsorsMarkdown())
  // 排序模式：默认 'desc' 降序（最新赞助在最上面）
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [syncing, setSyncing] = useState(false)

  const syncFromGitHub = useCallback(() => {
    setSyncing(true)
    void fetchLatestSponsorsMarkdown().then((res) => {
      setSyncing(false)
      if (res.ok && res.content) {
        setSponsorsMd(res.content)
      }
    })
  }, [])

  // 展开浮层时自动从 GitHub 仓库拉取最新名单
  useEffect(() => {
    if (!mounted) return
    syncFromGitHub()
  }, [mounted, syncFromGitHub])

  // 解析名单为结构化列表
  const items = useMemo(() => parseSponsorsMarkdown(sponsorsMd), [sponsorsMd])

  // 计算最近一次的赞助日期
  const latestDate = useMemo(() => {
    if (!items.length) return ''
    const dates = items.map((i) => i.date).filter(Boolean)
    dates.sort((a, b) => b.localeCompare(a))
    return dates[0] || ''
  }, [items])

  // 根据当前排序状态组织展示列表
  const sortedItems = useMemo(() => {
    const list = [...items]
    list.sort((a, b) => {
      if (!a.date && !b.date) return 0
      if (!a.date) return 1
      if (!b.date) return -1
      return sortOrder === 'desc' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
    })
    return list
  }, [items, sortOrder])

  return (
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={t('赞助支持')}
        {...buttonProps}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`group relative flex h-8 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2 text-[12px] font-medium transition-all duration-150 ${
          open
            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
            : 'text-ink-soft hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400'
        }`}
      >
        <Heart
          size={14}
          className={`transition-transform duration-200 group-hover:scale-110 ${
            open ? 'fill-rose-500 text-rose-500' : 'text-rose-500/80 group-hover:text-rose-500'
          }`}
        />
        <span className="hidden font-medium sm:inline">{t('赞助')}</span>
      </button>

      {mounted && (
        <div className="absolute right-0 top-full z-30 pt-1.5">
          <div
            role="dialog"
            aria-label={t('赞助支持')}
            className={`w-[600px] max-w-[95vw] rounded-2xl border border-line-strong/70 bg-card/95 p-4 shadow-2xl backdrop-blur-xl ${panelProps.className}`}
          >
            <div className="flex divide-x divide-line/40">
              {/* 第一栏：当前的内容 */}
              <div className="flex-1 min-w-0 pr-4 flex flex-col justify-between">
                <div>
                  {/* 头部标题 */}
                  <div className="flex items-center gap-2 border-b border-line/40 pb-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/12 text-rose-500">
                      <Heart size={13} className="fill-rose-500" />
                    </span>
                    <span className="text-[13px] font-semibold text-ink-strong">
                      {t('支持「归一 unyra」')}
                    </span>
                  </div>

                  {/* 适度、真诚的简短说明 */}
                  <p className="my-2 text-[11.5px] leading-relaxed text-ink-soft">
                    {t(
                      '如果你觉得「归一」对你的学习和思考有所帮助，欢迎赞助支持后续的功能研发与维护。',
                    )}
                  </p>

                  {/* 赞赏码卡片区：带有金色/暖朱砂柔和发光光晕效果 */}
                  <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-line/50 bg-paper/50 p-2.5 shadow-2xs dark:bg-paper/30">
                    {/* 背景背光呼吸发光层 */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-4 rounded-full bg-gradient-to-tr from-amber-500/25 via-rose-500/25 to-yellow-400/30 blur-2xl opacity-80 animate-pulse"
                    />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute h-32 w-32 rounded-full bg-amber-400/20 blur-xl"
                    />

                    {/* 赞赏码本体 */}
                    <div className="relative z-10 overflow-hidden rounded-xl border border-line/50 bg-white/95 p-1 shadow-md dark:bg-white">
                      <img
                        src={sponsorQr}
                        alt={t('Maxwell 的赞赏码')}
                        className="h-32 w-32 object-contain"
                        loading="eager"
                      />
                    </div>
                    <span className="relative z-10 mt-1.5 text-[10.5px] font-medium text-ink-faint">
                      {t('微信扫一扫 · 赞助支持 ☕')}
                    </span>
                  </div>

                  {/* 赞助备注提示：一行温和的小提示 */}
                  <p className="mt-1.5 text-center text-[10.5px] text-ink-faint">
                    {t('赞赏时可备注想留在致谢名单上的称呼或联系方式')}
                  </p>
                </div>

                <div className="mt-2 space-y-1.5">
                  {/* 应用内打开赞助者名单超链接按钮 */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      openSponsorsTab()
                    }}
                    title={t('在应用内打开赞助者名单文件')}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-card/80 px-2.5 py-1 text-[11px] font-medium text-ink-soft transition hover:border-rose-500/30 hover:bg-rose-500/[0.07] hover:text-rose-600 dark:hover:text-rose-400"
                  >
                    <span className="flex items-center gap-1.5">
                      <Heart size={12} className="fill-rose-500 text-rose-500" />
                      <span>{t('查看赞助者名单与致谢记录')}</span>
                    </span>
                    <span className="flex items-center gap-1 text-[10.5px] opacity-75">
                      <span>{t('在应用内打开')}</span>
                      <ExternalLink size={11} />
                    </span>
                  </button>

                  {/* 底部暖心结语 */}
                  <div className="flex items-center justify-between border-t border-line/30 pt-1.5 text-[10px] text-ink-faint">
                    <span>{t('感谢相遇，愿好运常伴！')}</span>
                    <span className="text-seal/80 font-serif">Made with ❤️ by Maxwell</span>
                  </div>
                </div>
              </div>

              {/* 第二栏：赞助名单 */}
              <div className="flex-1 min-w-0 pl-4 flex flex-col justify-between">
                <div>
                  {/* 头部标题与排序切换按钮 */}
                  <div className="flex items-center justify-between border-b border-line/40 pb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <Sparkles size={13} />
                      </span>
                      <span className="text-[13px] font-semibold text-ink-strong">
                        {t('赞助名单')}
                      </span>
                      <span className="rounded-full bg-line/50 px-1.5 py-0.2 text-[10px] font-mono text-ink-faint">
                        {sortedItems.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* GitHub 刷新同步按钮 */}
                      <button
                        type="button"
                        onClick={syncFromGitHub}
                        disabled={syncing}
                        className="flex items-center gap-1 rounded-md border border-line/60 bg-card px-1.5 py-0.5 text-[10.5px] text-ink-soft transition hover:border-line-strong hover:text-ink active:scale-95 disabled:opacity-50"
                        title={t('从 GitHub 仓库重新获取最新赞助者名单')}
                      >
                        <RotateCw
                          size={11}
                          className={`text-ink-faint ${syncing ? 'animate-spin text-seal' : ''}`}
                        />
                        <span>{syncing ? t('同步中...') : t('刷新')}</span>
                      </button>

                      {/* 排序按钮：默认降序排序（最新在前），点击切换升降序 */}
                      <button
                        type="button"
                        onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                        className="flex items-center gap-1 rounded-md border border-line/60 bg-card px-1.5 py-0.5 text-[10.5px] text-ink-soft transition hover:border-line-strong hover:text-ink active:scale-95"
                        title={
                          sortOrder === 'desc'
                            ? t('当前：按日期降序（最新在上），点击切换升序')
                            : t('当前：按日期升序（最早在上），点击切换降序')
                        }
                      >
                        <ArrowUpDown size={11} className="text-ink-faint" />
                        <span>{sortOrder === 'desc' ? t('最新在前') : t('最早在前')}</span>
                      </button>
                    </div>
                  </div>

                  {/* 最上面显示最近的赞助日期 */}
                  <div className="mt-2 flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/[0.04] px-2.5 py-1.5 text-[11px] text-ink-soft">
                    <div className="flex items-center gap-1.5 font-medium text-rose-600 dark:text-rose-400">
                      <Calendar size={12} className="shrink-0" />
                      <span>{t('最近赞助日期')}</span>
                    </div>
                    <span className="font-mono font-medium text-ink-strong">
                      {latestDate || '—'}
                    </span>
                  </div>

                  {/* 赞助名单滚动列表 */}
                  <div className="mt-2 max-h-[225px] overflow-y-auto space-y-1.5 pr-1">
                    {sortedItems.length === 0 ? (
                      <div className="flex h-32 flex-col items-center justify-center text-[11px] text-ink-faint">
                        <Heart size={20} className="mb-1 text-ink-faint/40" />
                        <span>{syncing ? t('正在从 GitHub 同步最新名单...') : t('暂无赞助记录')}</span>
                      </div>
                    ) : (
                      sortedItems.map((item, idx) => (
                        <div
                          key={`${item.name}-${item.date}-${idx}`}
                          className="flex items-center justify-between rounded-lg border border-line/40 bg-paper/40 p-1.5 px-2 text-[11.5px] transition hover:border-line hover:bg-paper/80"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500/10 text-[10px] font-bold text-rose-500">
                              {item.name.slice(0, 1)}
                            </span>
                            <span
                              className="truncate font-medium text-ink-strong max-w-[100px]"
                              title={item.name}
                            >
                              {item.name}
                            </span>
                            <span className="rounded-sm bg-line/40 px-1 py-0.2 text-[9.5px] text-ink-faint">
                              {item.channel}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">
                            {item.date}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 第二栏底部说明 */}
                <div className="mt-2 flex items-center justify-between border-t border-line/30 pt-1.5 text-[9.5px] text-ink-faint">
                  <span>{t('源自 GitHub 官方仓库')}</span>
                  <span>{t('持续同步更新中')}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
