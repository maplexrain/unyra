import { ExternalLink, Globe } from 'lucide-react'
import { t } from '../../../i18n'

/** 网页由固定外侧栏唯一挂载时，主画布让位并给出展开入口。 */
export function FixSideWebNotice({
  pure,
  onReveal,
  onExitZen,
}: {
  pure: boolean
  onReveal: () => void
  onExitZen: () => void
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-card p-6 text-center select-none">
      <Globe size={32} className="text-seal/70" />
      <div className="text-[14px] font-semibold text-ink-strong">{t('此网页在固定外侧栏中')}</div>
      <p className="max-w-md text-[12px] text-ink-faint">
        {t('同一份页面只挂一枚 webview；展开外侧栏即可继续浏览，滚动与表单状态不会丢。')}
      </p>
      <button
        type="button"
        onClick={pure ? onExitZen : onReveal}
        className="flex items-center gap-1.5 rounded-lg bg-seal px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-seal-deep cursor-pointer"
      >
        <ExternalLink size={13} />
        {pure ? t('退出纯净阅读') : t('展开固定外侧栏')}
      </button>
    </div>
  )
}
