/**
 * 设置页左侧栏顶部的「常规 / 智能体」分段切换。
 *
 * 它是两套面板共用的只有一件事：把当前 section 与切换回调画成左栏里的两枚按钮。
 * 三击这里仍和旧版一样派发开发者入口事件。
 */

import { Settings2, Sparkles } from 'lucide-react'
import { t } from '../../i18n'
import type { SettingsSection } from './section'

export function SettingsSectionSwitch({
  section,
  onChange,
}: {
  section: SettingsSection
  onChange: (section: SettingsSection) => void
}) {
  const items: Array<{ key: SettingsSection; label: string; icon: typeof Settings2 }> = [
    { key: 'general', label: '常规', icon: Settings2 },
    { key: 'agent', label: '智能体', icon: Sparkles },
  ]

  return (
    <div
      role="tablist"
      aria-label={t('设置分类')}
      className="grid shrink-0 grid-cols-2 gap-0.5 rounded-lg border border-line/70 bg-card/55 p-0.5"
      onClick={(e) => {
        if (e.detail >= 3) {
          window.dispatchEvent(new CustomEvent('moji:settings:dev-entry', { detail: section }))
        }
      }}
    >
      {items.map((item) => {
        const active = section === item.key
        const Icon = item.icon
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={
              'flex h-7 items-center justify-center gap-1 rounded-md text-[11.5px] transition ' +
              (active
                ? 'bg-paper font-semibold text-ink-strong shadow-2xs'
                : 'text-ink-soft hover:bg-card hover:text-ink')
            }
          >
            <Icon size={12} className={active ? 'text-seal' : 'text-ink-faint'} />
            <span>{t(item.label)}</span>
          </button>
        )
      })}
    </div>
  )
}
