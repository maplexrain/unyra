/**
 * 顶栏的赞助/打赏入口按钮与悬停浮层。
 * 展示微信赞赏码与温和真诚的致意，并提供应用内查看赞助者名单的快捷入口。
 */

import { ExternalLink, Heart } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'
import { openSponsorsTab } from '../../lib/sponsorDoc'
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
            className={`w-[316px] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-xl ${panelProps.className}`}
          >
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
            <p className="my-2.5 text-[12px] leading-relaxed text-ink-soft">
              {t(
                '如果你觉得「归一」对你的学习和思考有所帮助，欢迎赞助支持后续的功能研发与维护。',
              )}
            </p>

            {/* 赞赏码卡片区：带有金色/暖朱砂柔和发光光晕效果 */}
            <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-xl border border-line/50 bg-paper/50 p-3 shadow-2xs dark:bg-paper/30">
              {/* 背景背光呼吸发光层 */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-4 rounded-full bg-gradient-to-tr from-amber-500/25 via-rose-500/25 to-yellow-400/30 blur-2xl opacity-80 animate-pulse"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute h-36 w-36 rounded-full bg-amber-400/20 blur-xl"
              />

              {/* 赞赏码本体 */}
              <div className="relative z-10 overflow-hidden rounded-xl border border-line/50 bg-white/95 p-1.5 shadow-md dark:bg-white">
                <img
                  src={sponsorQr}
                  alt={t('Maxwell 的赞赏码')}
                  className="h-40 w-40 object-contain"
                  loading="eager"
                />
              </div>
              <span className="relative z-10 mt-2 text-[11px] font-medium text-ink-faint">
                {t('微信扫一扫 · 赞助支持 ☕')}
              </span>
            </div>

            {/* 赞助备注提示：一行温和的小提示 */}
            <p className="mt-2 text-center text-[11px] text-ink-faint">
              {t('赞赏时可备注想留在致谢名单上的称呼或联系方式')}
            </p>

            {/* 应用内打开赞助者名单超链接按钮 */}
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                openSponsorsTab()
              }}
              title={t('在应用内打开赞助者名单文件')}
              className="mt-2.5 flex w-full items-center justify-between rounded-lg border border-line bg-card/80 px-3 py-1.5 text-[11.5px] font-medium text-ink-soft transition hover:border-rose-500/30 hover:bg-rose-500/[0.07] hover:text-rose-600 dark:hover:text-rose-400"
            >
              <span className="flex items-center gap-1.5">
                <Heart size={13} className="fill-rose-500 text-rose-500" />
                <span>{t('查看赞助者名单与致谢记录')}</span>
              </span>
              <span className="flex items-center gap-1 text-[11px] opacity-75">
                <span>{t('在应用内打开')}</span>
                <ExternalLink size={12} />
              </span>
            </button>

            {/* 底部暖心结语 */}
            <div className="mt-2.5 flex items-center justify-between border-t border-line/30 pt-1.5 text-[10.5px] text-ink-faint">
              <span>{t('感谢相遇，愿好运常伴！')}</span>
              <span className="text-seal/80 font-serif">Made with ❤️ by Maxwell</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
