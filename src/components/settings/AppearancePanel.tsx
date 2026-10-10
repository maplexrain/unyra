/**
 * 设置 → 外观：主题配色、界面语言与教学模式。
 */

import { Check, Languages, Palette, Presentation, Sparkles } from 'lucide-react'
import {
  THEME_LABEL,
  THEME_SWATCH,
  isDarkTheme,
  type Appearance,
  type ThemeMode,
} from '../../lib/appearance'
import { LOCALES, LOCALE_LABEL, t, useLocale } from '../../i18n'
import { changeUiLocale } from '../../lib/uiLocale'
import Switch from '../Switch'
import { pane } from '../Pane'

interface Props {
  appearance: Appearance
  onChange: (patch: Partial<Appearance>) => void
  onToast: (msg: string) => void
}

interface ThemeGroup {
  name: string
  hint: string
  modes: ThemeMode[]
}

const THEME_GROUPS: ThemeGroup[] = [
  {
    name: '系统与基础',
    hint: '支持自动根据操作系统浅色/深色切换，或固定基础纸墨',
    modes: ['system', 'light', 'dark'],
  },
  {
    name: '纸墨质感',
    hint: '模拟经典暖调古纸与极简净白',
    modes: ['sepia', 'amber', 'white'],
  },
  {
    name: '雅致色调',
    hint: '柔和舒缓的彩色雅致纸张氛围',
    modes: ['green', 'blue', 'purple', 'pink'],
  },
  {
    name: '深邃暗色',
    hint: '低眩光夜读配色与高对比黑度',
    modes: ['graphite', 'navy', 'contrast', 'black'],
  },
]

const LOCALE_INFO: Record<string, { sub: string }> = {
  'zh-CN': { sub: 'Chinese (Simplified)' },
  en: { sub: 'English' },
}

export function AppearancePanel({ appearance, onChange, onToast }: Props) {
  const locale = useLocale()

  const handleThemeChange = (m: ThemeMode) => {
    onChange({ theme: m })
    onToast(t('已切换至「{0}」主题', t(THEME_LABEL[m])))
  }

  return (
    <div className={pane(5, true)}>
      {/* 头部简介 */}
      <div className="flex items-center justify-between border-b border-line pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Palette size={16} className="text-seal" />
            <h2 className="text-[14px] font-semibold text-ink-strong">{t('外观与主题')}</h2>
          </div>
          <p className="mt-1 text-[11.5px] text-ink-soft">
            {t('自定义墨记的界面色彩、界面语言与辅助教学演示模式。')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 text-[11px] text-ok-deep">
          <Sparkles size={11} />
          <span>{t('即时生效 · 自动保存')}</span>
        </div>
      </div>

      {/* 主题选择卡片网格 */}
      <section className="flex flex-col gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-strong">
            <span>{t('主题配色')}</span>
            <span className="text-[11px] font-normal text-ink-faint">
              ({t('当前：{0}', t(THEME_LABEL[appearance.theme]))})
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {t('跟随系统只在浅色 / 深色之间自动切换；其余主题是独立配色，选定即固定。')}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {THEME_GROUPS.map((group) => (
            <div key={group.name} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[11.5px] text-ink-soft">
                <span className="font-medium text-ink">{t(group.name)}</span>
                <span className="text-[11px] text-ink-faint">· {t(group.hint)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                {group.modes.map((m) => {
                  const swatch = THEME_SWATCH[m]
                  const isSelected = appearance.theme === m
                  const isDark = isDarkTheme(m)

                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleThemeChange(m)}
                      className={`group relative flex flex-col rounded-xl border p-2 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-seal/50 ${
                        isSelected
                          ? 'border-seal bg-seal/[0.04] shadow-sm ring-1 ring-seal/20'
                          : 'border-line bg-card hover:border-line-strong hover:bg-card/90 hover:shadow-xs'
                      }`}
                    >
                      {/* 迷你微缩视觉预览框 */}
                      {m === 'system' ? (
                        <div className="relative mb-2 flex h-12 w-full overflow-hidden rounded-lg border border-line-strong/30 shadow-inner">
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                'linear-gradient(135deg, #f5f2eb 0%, #f5f2eb 50%, #17150f 50%, #17150f 100%)',
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-between px-2.5 text-[10.5px]">
                            <span className="font-medium text-[#2e2a25]">浅</span>
                            <span className="font-medium text-[#e6e0d4]">深</span>
                          </div>
                          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-black/40 px-1 py-0.5 text-[9px] text-white backdrop-blur-xs">
                            OS
                          </div>
                        </div>
                      ) : (
                        <div
                          className="relative mb-2 flex h-12 w-full flex-col justify-between overflow-hidden rounded-lg border border-black/10 p-1.5 shadow-inner dark:border-white/10"
                          style={{ backgroundColor: swatch.paper }}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className="h-2 w-2 rounded-full shadow-xs"
                              style={{ backgroundColor: swatch.accent }}
                            />
                            <span
                              className="h-1 w-5 rounded-full opacity-25"
                              style={{ backgroundColor: isDark ? '#ffffff' : '#000000' }}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <span
                              className="h-1.5 w-3/4 rounded-full opacity-20"
                              style={{ backgroundColor: isDark ? '#ffffff' : '#000000' }}
                            />
                            <span
                              className="h-1.5 w-1/2 rounded-full opacity-10"
                              style={{ backgroundColor: isDark ? '#ffffff' : '#000000' }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 卡片底部名称与选中态指示 */}
                      <div className="flex items-center justify-between px-0.5">
                        <span
                          className={`text-[12px] ${
                            isSelected ? 'font-semibold text-seal-deep' : 'font-medium text-ink'
                          }`}
                        >
                          {t(THEME_LABEL[m])}
                        </span>
                        {isSelected ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-seal text-white shadow-xs">
                            <Check size={10} className="stroke-[3]" />
                          </span>
                        ) : (
                          <span
                            className="h-2 w-2 rounded-full opacity-0 transition-opacity group-hover:opacity-60"
                            style={{ backgroundColor: swatch.accent }}
                          />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 界面语言 */}
      <section className="flex flex-col gap-2 rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-ink-strong">
          <Languages size={14} className="text-seal" />
          <span>{t('界面语言')}</span>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          {t('语言跟机器走，对所有用户生效；正文与对话内容不翻译。')}
        </p>

        <div className="mt-1 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {LOCALES.map((l) => {
            const isSelected = locale === l
            const info = LOCALE_INFO[l]
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
                  <span className="text-[12.5px] font-medium">{LOCALE_LABEL[l]}</span>
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

      {/* 教学与演示模式 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <Presentation size={15} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink-strong">{t('教学演示模式')}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t(
                  '打开后左下角常驻一块小窗，实时显示你按下的键（Ctrl + K 这样）。录屏讲课时观众看得见操作，而不是只看结果在变。它不挡点击，也不改任何按键行为。'
                )}
              </div>
            </div>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              on={appearance.teachingMode}
              onChange={(next) => onChange({ teachingMode: next })}
              label=""
            />
          </div>
        </div>
      </section>

      {/* 自动保存状态提示条 */}
      <div className="flex items-center gap-1.5 rounded-lg border border-line bg-card/50 px-3 py-2 text-[11px] text-ink-soft">
        <Check size={12} className="text-ok-deep stroke-[2.5]" />
        <span>{t('外观改动即时生效并自动保存。')}</span>
      </div>
    </div>
  )
}
