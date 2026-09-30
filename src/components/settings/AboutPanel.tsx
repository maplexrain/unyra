/**
 * 这个文件负责：「关于」分页：版本号 + 数据在哪 + 图标。
 */

import Logo from '../Logo'
import { pane } from '../Pane'
import { t } from '../../i18n'

/* ---------- 关于分页 ---------- */

/**
 * 「关于」分页：版本号 + 数据在哪 + 图标。
 *
 * 为什么要有这一页：此前界面上**没有任何版本信息**，用户反馈问题时说不清是哪一版；
 * 而版本号只有 package.json 一处真值，构建时注入成 __APP_VERSION__（见 vite.config.ts）。
 *
 * 图标用 components/Logo 的内联 SVG（跟主题换色），不再引用位图。
 */
export function AboutPanel({ onToast }: { onToast: (msg: string) => void }) {
  const copy = (text: string, label: string) => {
    void navigator.clipboard
      .writeText(text)
      .then(() => onToast(t('{0}已复制', label)))
      .catch(() => onToast(t('复制失败，请手动选中后复制')))
  }

  return (
    <div className={pane(5, true)}>
      <section className="flex items-center gap-3">
        <Logo size={48} />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink-strong">{t('归一 Unyra · 探索式学习')}</div>
          <div className="mt-0.5 text-[12px] text-ink-soft">{t('版本 {0} · 本地优先：数据全部存在你自己的机器上', __APP_VERSION__)}</div>
        </div>
      </section>

      <section>
        <div className="mb-2 text-ink-soft">{t('版本')}</div>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2.5 text-[12px] leading-relaxed">
          <code className="rounded bg-paper-deep px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-ink-strong">
            {__APP_VERSION__}
          </code>
          <button
            type="button"
            onClick={() => copy(__APP_VERSION__, t('版本号'))}
            className="rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-line/60 hover:text-ink"
          >
            {t('复制')}
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
          {t('反馈问题时请带上这个版本号；升级时数据目录不动，新旧版本可以混着用。有没有新版本、怎么升级，见「更新」分页。')}
        </p>
      </section>

      <div className="rounded-lg border border-line bg-card/60 px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        {t('教学文档、对话与资源全部存在这台机器上（目录见「存储」分页，卸载程序不会删除）。反馈问题时请带上「版本」里的版本号。')}
      </div>
    </div>
  )
}
