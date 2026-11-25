/**
 * 设置页的统一外壳：常规设置与全局智能体设置合并成一枚文档页签。
 *
 * 左上角是两枚顶部分页（常规 / 智能体）；两套面板各自保留原来的左栏与内容，
 * 外层只负责切换、限宽与页面底色。面板最大宽度 1000px、水平居中。
 */

import { useEffect, useSyncExternalStore } from 'react'
import { Settings2, Sparkles } from 'lucide-react'
import { globalSummary } from '../../ai/settings'
import { saveAgentSettings } from '../../agent/settings'
import { t } from '../../i18n'
import type { GroupBodyCtx } from '../learn/workspace/GroupBodyCtx'
import AgentSettingsPanel from '../AgentSettingsPanel'
import SettingsPanel from './SettingsPanel'
import { getSettingsSection, setSettingsSection, subscribeSettingsSection, type SettingsSection } from './section'

export function SettingsPage({
  ctx,
  initialSection,
}: {
  ctx: GroupBodyCtx
  /** 旧 agentSettings 页签迁移过来时强制落在智能体分页 */
  initialSection?: SettingsSection
}) {
  const section = useSyncExternalStore(subscribeSettingsSection, getSettingsSection, getSettingsSection)

  useEffect(() => {
    if (initialSection) setSettingsSection(initialSection)
  }, [initialSection])

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 justify-center bg-paper">
      <div className="flex h-full min-h-0 w-full max-w-[1000px] flex-col">
        <header
          className="flex shrink-0 items-center gap-1 border-b border-line bg-paper px-3 py-1.5"
          onClick={(e) => {
            if (e.detail >= 3) {
              window.dispatchEvent(new CustomEvent('moji:settings:dev-entry', { detail: section }))
            }
          }}
        >
          <button
            type="button"
            aria-pressed={section === 'general'}
            onClick={() => setSettingsSection('general')}
            className={
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition ' +
              (section === 'general'
                ? 'bg-card font-semibold text-ink-strong shadow-2xs ring-1 ring-line/70'
                : 'text-ink-soft hover:bg-card/50 hover:text-ink')
            }
          >
            <Settings2 size={13} className={section === 'general' ? 'text-seal' : 'text-ink-faint'} />
            <span>{t('常规')}</span>
          </button>
          <button
            type="button"
            aria-pressed={section === 'agent'}
            onClick={() => setSettingsSection('agent')}
            className={
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition ' +
              (section === 'agent'
                ? 'bg-card font-semibold text-ink-strong shadow-2xs ring-1 ring-line/70'
                : 'text-ink-soft hover:bg-card/50 hover:text-ink')
            }
          >
            <Sparkles size={13} className={section === 'agent' ? 'text-seal' : 'text-ink-faint'} />
            <span>{t('智能体')}</span>
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {section === 'general' ? (
            <SettingsPanel
              onRootChanged={ctx.onRootChanged}
              onToast={ctx.onToast}
              scheduleSound={ctx.store.schedule?.sound}
              onScheduleSoundChange={ctx.scheduleActions.setSound}
            />
          ) : (
            <AgentSettingsPanel
              settings={ctx.agentSettings}
              hasKey={ctx.hasKey}
              model={globalSummary()}
              onChange={(next) => {
                saveAgentSettings(next)
                ctx.onToast(t('超级导师设置已保存'))
              }}
              onOpenContextDebugger={() => ctx.debugWin.setOpen(true)}
              onOpenContextTrace={ctx.openContextTrace}
              flowRows={ctx.workflowRows}
              onRunWorkflow={ctx.runWorkflowRow}
              onRemoveWorkflow={ctx.removeWorkflowRow}
              goals={ctx.store.goals}
              memory={ctx.store.memory ?? { long: [], work: {} }}
              activeGoalId={ctx.activeGoalId}
              onMemoryCreate={ctx.memoryCreate}
              onMemoryUpdate={ctx.memoryUpdate}
              onMemoryDelete={ctx.memoryDelete}
              onMemoryClearWork={ctx.memoryClearWork}
              onToast={ctx.onToast}
            />
          )}
        </div>
      </div>
    </div>
  )
}
