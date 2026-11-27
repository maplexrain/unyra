/**
 * 智能体面板顶部的三个视图入口：对话 / 思维 / 网页。
 *
 * 「网页」是条件页签：只有 agent 在这段对话里开过后台浏览器，入口才出现。
 * 入口出现本身不切换视图，用户点它才进网页页。
 */
import { Globe2 } from 'lucide-react'
import { t } from '../../../i18n'

export type AgentPanelTab = 'chat' | 'mind' | 'web'

export function AgentViewTabs({
  active,
  browserCount,
  onSelect,
}: {
  active: AgentPanelTab
  browserCount: number
  onSelect: (tab: AgentPanelTab) => void
}) {
  const tabs: AgentPanelTab[] = browserCount > 0 ? ['chat', 'mind', 'web'] : ['chat', 'mind']
  return (
    <div className="flex shrink-0 items-center gap-1 px-3 py-1.5">
      {tabs.map((tab) => {
        const on = active === tab
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onSelect(tab)}
            aria-pressed={on}
            data-agent-view-tab={tab}
            className={
              'flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] transition ' +
              (on
                ? 'bg-ink-strong text-paper'
                : 'text-ink-faint hover:bg-line/50 hover:text-ink-strong')
            }
          >
            {tab === 'web' && <Globe2 size={12} className="shrink-0" />}
            {tab === 'chat' ? t('对话') : tab === 'mind' ? t('思维') : t('网页')}
            {tab === 'web' && browserCount > 1 && (
              <span className="rounded-full bg-line/60 px-1.5 text-[10px] tabular-nums text-ink-soft">
                {browserCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
