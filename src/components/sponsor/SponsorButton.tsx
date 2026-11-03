/**
 * 顶栏的赞助/打赏入口按钮与悬停浮层。
 * 展示微信赞赏码与真诚的独立开发说明，并引导赞助者留下联系方式或名字以便登上鸣谢名单。
 */

import { Coffee, Heart, Sparkles } from 'lucide-react'
import { useHoverMenu } from '../../lib/hoverMenu'
import { t } from '../../i18n'
import sponsorQr from '../../assets/sponsor-qrcode.jpg'

/** 指针离开后延后关：按钮与浮层间有缝，避免半路断掉 */
const HOVER_CLOSE_MS = 120
/** 退场动画时长 */
const MENU_EXIT_MS = 160

export default function SponsorButton() {
  const { open, mounted, wrapProps, buttonProps, panelProps } = useHoverMenu({
    closeMs: HOVER_CLOSE_MS,
    exitMs: MENU_EXIT_MS,
    buttonOpens: true,
  })

  return (
    <div className="no-drag relative shrink-0" {...wrapProps}>
      <button
        type="button"
        title={t('赞助支持作者')}
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
            className={`w-[336px] rounded-2xl border border-line-strong/70 bg-card/95 p-3.5 shadow-2xl backdrop-blur-xl ${panelProps.className}`}
          >
            {/* 头部标题与徽标 */}
            <div className="flex items-center justify-between border-b border-line/40 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/12 text-rose-500">
                  <Coffee size={14} />
                </span>
                <span className="text-[13px] font-semibold text-ink-strong">
                  {t('支持 Moji Notes 独立开发')}
                </span>
              </div>
              <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10.5px] font-medium text-rose-600 dark:text-rose-400">
                {t('持续打磨')}
              </span>
            </div>

            {/* 真诚平实的心声寄语 */}
            <div className="my-2.5 space-y-1.5 text-[12px] leading-relaxed text-ink-soft">
              <p>
                {t(
                  '你好，我是作者 Maxwell。Moji Notes 是我利用业余时间从零构思、一人独立开发维护的项目，致力于打造安静、纯粹且专注的学习思考体验。',
                )}
              </p>
              <p>
                {t(
                  '如果你觉得它对你的学习或工作有所帮助，欢迎请我喝杯咖啡。你的每一份心意与支持，都是我抵御疲倦、持续优化性能与加速功能迭代的最实在底气。',
                )}
              </p>
            </div>

            {/* 赞赏码卡片区 */}
            <div className="relative flex flex-col items-center justify-center rounded-xl border border-line/50 bg-paper/50 p-3 shadow-2xs dark:bg-paper/30">
              <div className="overflow-hidden rounded-lg border border-line/60 bg-white p-1 shadow-xs">
                <img
                  src={sponsorQr}
                  alt={t('Maxwell 的赞赏码')}
                  className="h-44 w-44 object-cover"
                  loading="eager"
                />
              </div>
              <span className="mt-2 text-[11px] font-medium text-ink-faint">
                {t('微信扫一扫 · 为作者加杯咖啡 ☕')}
              </span>
            </div>

            {/* 赞助备注与致谢名单说明 */}
            <div className="mt-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-2.5 text-[11px] leading-relaxed text-ink-soft">
              <div className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                <Sparkles size={12} className="shrink-0" />
                <span>{t('赞助者备注与特别致谢')}</span>
              </div>
              <p className="mt-1 text-ink-soft">
                {t(
                  '赞赏时请在微信备注中留下您的【联系方式（微信/邮箱）】或【想留在致谢名单上的称呼】。后续软件将在「关于」中上线特别鸣谢名单，认真记下每一位同路者。',
                )}
              </p>
            </div>

            {/* 底部暖心结语 */}
            <div className="mt-2.5 flex items-center justify-between pt-1 text-[10.5px] text-ink-faint">
              <span>{t('感谢相遇，愿好运常伴！')}</span>
              <span className="text-seal/80 font-serif">Made with ❤️ by Maxwell</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
