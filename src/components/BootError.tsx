/**
 * 启动失败时的兜底页面。
 *
 * 最常见的一种是「在浏览器里打开了 dist/index.html」——渲染层拿不到原生桥，
 * 所有文件读写都无从谈起（见 src/lib/native.ts）。这时给一句能照着做的提示，
 * 比白屏强。
 */
import { t } from '../i18n'

export default function BootError({ error }: { error: unknown }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-[14px] font-medium text-ink">{t('应用启动失败')}</div>
      <p className="max-w-[420px] text-[12px] leading-relaxed text-ink-soft">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <p className="text-[11px] text-ink-faint">{t('桌面应用请用 npm run electron:dev 启动。')}</p>
    </div>
  )
}
