/**
 * 设置 → 外观：主题配色分区。
 *
 * 从 AppearancePanel 拆出的展示组件：只负责主题分组卡片网格的展示与选择回调，
 * 状态与回调由门面 AppearancePanel 持有并逐项传入。
 */

import { Check } from 'lucide-react'
import {
  THEME_LABEL,
  THEME_SWATCH,
  isDarkTheme,
  type Appearance,
  type ThemeMode,
} from '../../lib/appearance'
import { t } from '../../i18n'

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
    hint: '低眩光夜读、荧光赛博与高对比黑度',
    modes: ['graphite', 'navy', 'contrast', 'black', 'cyber'],
  },
]

interface Props {
  theme: ThemeMode
  onChange: (patch: Partial<Appearance>) => void
  onToast: (msg: string) => void
  /** 当前子 tab 是否处于高亮态（由门面按 highlightSubTab 计算） */
  highlighted: boolean
  /** 高亮动画用的 key（由门面按 highlightSubTab 计算） */
  highlightKey: string
}

export function AppearanceThemeSection({
  theme,
  onChange,
  onToast,
  highlighted,
  highlightKey,
}: Props) {
  const handleThemeChange = (m: ThemeMode) => {
    onChange({ theme: m })
    onToast(t('已切换至「{0}」主题', t(THEME_LABEL[m])))
  }

  return (
    <section id="settings-section-theme" className="flex flex-col gap-4 scroll-mt-4">
      <div>
        <div
          key={highlightKey}
          className={`flex items-center gap-1.5 text-[13px] font-medium text-ink-strong ${
            highlighted ? 'moji-setting-highlight' : ''
          }`}
        >
          <span>{t('主题配色')}</span>
          <span className="text-[11px] font-normal text-ink-faint">
            ({t('当前：{0}', t(THEME_LABEL[theme]))})
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
                const isSelected = theme === m
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
                          <span className="font-medium text-[#2e2a25]">{t('浅')}</span>
                          <span className="font-medium text-[#e6e0d4]">{t('深')}</span>
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
  )
}
