/**
 * 设置 → 外观：辅助与提示分区（教学演示模式 + 顶栏小技巧提示）。
 *
 * 从 AppearancePanel 拆出的展示组件：两个功能开关的展示，
 * 状态与回调由门面 AppearancePanel 持有并逐项传入。
 */

import { Presentation, Sparkles } from 'lucide-react'
import { type Appearance } from '../../lib/appearance'
import { t } from '../../i18n'
import Switch from '../Switch'

interface Props {
  teachingMode: boolean
  showTips?: boolean
  onChange: (patch: Partial<Appearance>) => void
  /** 当前子 tab 是否处于高亮态（由门面按 highlightSubTab 计算） */
  highlighted: boolean
  /** 高亮动画用的 key（由门面按 highlightSubTab 计算） */
  highlightKey: string
}

export function AppearanceFeaturesSection({
  teachingMode,
  showTips,
  onChange,
  highlighted,
  highlightKey,
}: Props) {
  return (
    <div id="settings-section-features" className="flex flex-col gap-3 scroll-mt-4">
      {/* 教学与演示模式 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <Presentation size={15} />
            </div>
            <div>
              <div
                key={highlightKey}
                className={`text-[13px] font-medium text-ink-strong ${
                  highlighted ? 'moji-setting-highlight' : ''
                }`}
              >
                {t('教学演示模式')}
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t('打开后左下角常驻一块小窗，实时显示你按下的键（Ctrl + K 这样）。录屏讲课时观众看得见操作，而不是只看结果在变。它不挡点击，也不改任何按键行为。')}
              </div>
            </div>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              on={teachingMode}
              onChange={(next) => onChange({ teachingMode: next })}
              label=""
            />
          </div>
        </div>
      </section>

      {/* 顶栏小技巧提示 */}
      <section className="rounded-xl border border-line bg-card/60 p-3.5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-card text-seal">
              <Sparkles size={15} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-ink-strong">{t('顶栏技巧提示')}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                {t('在应用顶栏居中显示实用隐藏小技巧与快捷键轮播。每 10 秒平滑切换，鼠标悬停时暂停播放，点击可直接跳到下一条。')}
              </div>
            </div>
          </div>
          <div className="shrink-0 pt-0.5">
            <Switch
              on={showTips !== false}
              onChange={(next) => onChange({ showTips: next })}
              label=""
            />
          </div>
        </div>
      </section>
    </div>
  )
}
