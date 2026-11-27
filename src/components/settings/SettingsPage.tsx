/**
 * 设置页的统一外壳：常规设置与全局智能体设置合并成一枚文档页签。
 *
 * 「常规 / 智能体」的切换住在两套面板自己的左栏顶部（见 SettingsSectionSwitch），
 * 所以外壳只负责 section 状态与页面底色。面板占满可用宽度，不再限宽。
 */

import { useEffect, useSyncExternalStore } from 'react'
import { globalSummary } from '../../ai/settings'
import { saveAgentSettings } from '../../agent/settings'
import { t } from '../../i18n'
import { userAbsPath } from '../../lib/storage'
import type { GroupBodyCtx } from '../learn/workspace/GroupBodyCtx'
import AgentSettingsPanel from '../AgentSettingsPanel'
import SettingsPanel from './SettingsPanel'
import { SettingsSectionSwitch } from './SettingsSectionSwitch'
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

  const sectionSwitch = <SettingsSectionSwitch section={section} onChange={setSettingsSection} />

  const openFile = (rel: string, title?: string) => {
    const abs = userAbsPath(rel)
    if (!abs) {
      ctx.onToast(t('找不到这个外部文件，刷新页面后再试'))
      return
    }
    ctx.openTab({ kind: 'local', path: abs, title })
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 justify-start bg-paper">
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex min-h-0 flex-1">
          {section === 'general' ? (
            <SettingsPanel
              sectionSwitch={sectionSwitch}
              onRootChanged={ctx.onRootChanged}
              onToast={ctx.onToast}
              scheduleSound={ctx.store.schedule?.sound}
              onScheduleSoundChange={ctx.scheduleActions.setSound}
              onOpenFile={openFile}
            />
          ) : (
            <AgentSettingsPanel
              sectionSwitch={sectionSwitch}
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
