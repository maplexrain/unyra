/**
 * 设置 → 外观：界面语言分区。
 *
 * 从 AppearancePanel 拆出的展示组件：负责语言卡片网格与语言包目录操作按钮，
 * 状态与回调由门面 AppearancePanel 持有并逐项传入。
 */

import { Check, FilePlus, FolderOpen, Languages, RefreshCw } from 'lucide-react'
import {
  LOCALES,
  LOCALE_LABEL,
  t,
  type Locale,
  createEmptyLocaleTemplate,
  openLocalesDir,
  loadCustomLocalesFromDisk,
} from '../../i18n'
import { changeUiLocale } from '../../lib/uiLocale'

const LOCALE_INFO: Record<string, { sub: string }> = {
  zh: { sub: '中文 (简体)' },
  en: { sub: 'English' },
}

interface Props {
  locale: Locale
  onToast: (msg: string) => void
  /** 当前子 tab 是否处于高亮态（由门面按 highlightSubTab 计算） */
  highlighted: boolean
  /** 高亮动画用的 key（由门面按 highlightSubTab 计算） */
  highlightKey: string
}

export function AppearanceLocaleSection({
  locale,
  onToast,
  highlighted,
  highlightKey,
}: Props) {
  return (
    <section id="settings-section-locale" className="flex flex-col gap-2.5 rounded-xl border border-line bg-card/60 p-3.5 scroll-mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          key={highlightKey}
          className={`flex items-center gap-1.5 text-[13px] font-medium text-ink-strong ${
            highlighted ? 'moji-setting-highlight' : ''
          }`}
        >
          <Languages size={14} className="text-seal" />
          <span>{t('界面语言')}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await openLocalesDir()
              onToast(t('已打开语言包目录 (locales)'))
            }}
            title={t('在系统文件管理器中打开语言包目录')}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink hover:border-line-strong hover:bg-card/90 transition cursor-pointer"
          >
            <FolderOpen size={12} className="text-seal" />
            <span>{t('打开语言包目录')}</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              const res = await createEmptyLocaleTemplate()
              if (res.ok) {
                onToast(t('已生成空白语言包模板 template.json，可填写后保存生效'))
              } else {
                onToast(t('创建模板失败：{0}', res.error || '未知原因'))
              }
            }}
            title={t('生成包含全部应用词条且译文为空的 JSON 模板')}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink hover:border-line-strong hover:bg-card/90 transition cursor-pointer"
          >
            <FilePlus size={12} className="text-seal" />
            <span>{t('新建空白语言包')}</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              const list = await loadCustomLocalesFromDisk()
              onToast(t('语言包已刷新，共加载 {0} 个扩展语言', list.length))
            }}
            title={t('重新扫描 locales 目录并加载')}
            className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink hover:border-line-strong hover:bg-card/90 transition cursor-pointer"
          >
            <RefreshCw size={12} className="text-seal" />
            <span>{t('刷新')}</span>
          </button>
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        {t('语言跟机器走，对所有用户生效；支持在 locales/ 目录下放入 JSON 语言包进行扩展。')}
      </p>

      <div className="mt-1 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {LOCALES.map((l) => {
          const isSelected = locale === l
          const info = LOCALE_INFO[l] || { sub: t('自定义语言包 · {0}', l) }
          return (
            <button
              key={l}
              type="button"
              onClick={() => changeUiLocale(l)}
              className={`flex items-center justify-between rounded-lg border p-2.5 text-left transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-seal/50 ${
                isSelected
                  ? 'border-seal/60 bg-seal/10 font-medium text-seal-deep ring-1 ring-seal/20'
                  : 'border-line bg-card text-ink hover:border-line-strong hover:bg-card/90'
              }`}
            >
              <div className="flex flex-col">
                <span className="text-[12.5px] font-medium">{LOCALE_LABEL[l] || l}</span>
                {info?.sub && (
                  <span className="text-[10.5px] text-ink-faint">{info.sub}</span>
                )}
              </div>
              {isSelected && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-seal text-white">
                  <Check size={10} className="stroke-[3]" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
