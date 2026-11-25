/**
 * 群聊输入框右侧的全局设置组：提供商 / 模型 / 思考等级、写作策略、语音输入。
 *
 * 直接复用私聊 Composer 里的三个控件，不另做一套视觉；区别只在于这里的改动
 * 一律写入**全局**设置（AI 提供商 / 思考等级、导师人格 / 文档格式），
 * 只有仍跟随全局的 agent 会在下一轮应用，单独覆盖过设置的 agent 不受影响。
 */
import { useSyncExternalStore } from 'react'
import { docFormatOf, type DocFormatId } from '../../../agent/docFormat'
import { personaOf, type PersonaId } from '../../../agent/persona'
import { loadAgentSettings, saveAgentSettings, subscribeAgentSettings } from '../../../agent/settings'
import type { VoiceSink } from '../../../lib/voice/session'
import ModelPicker from '../ModelPicker'
import StrategyPicker from '../StrategyPicker'
import MicButton from './MicButton'
import { t } from '../../../i18n'

export function GroupComposerTools({
  active,
  makeSink,
  onOpenSettings,
  onToast,
}: {
  active: boolean
  makeSink: () => VoiceSink | null
  onOpenSettings?: () => void
  onToast?: (message: string) => void
}) {
  const settings = useSyncExternalStore(subscribeAgentSettings, loadAgentSettings)

  return (
    <div data-group-composer-tools className="flex min-w-0 items-center gap-0.5">
      {/* ModelPicker 自己写全局 ai settings：提供商、模型、思考等级都在这一个入口 */}
      <ModelPicker onChanged={() => {}} />
      <StrategyPicker
        persona={settings.persona}
        onPickPersona={(id: PersonaId) => {
          saveAgentSettings({ ...settings, persona: id })
          onToast?.(t('导师人格已切到「{0}」，从下一轮开始生效', personaOf(id).label))
        }}
        docFormat={settings.docFormat}
        onPickDocFormat={(id: DocFormatId) => {
          saveAgentSettings({ ...settings, docFormat: id })
          onToast?.(t('文档格式已切到「{0}」，从下一轮开始生效', docFormatOf(id).label))
        }}
        onOpenSettings={onOpenSettings}
      />
      <MicButton active={active} makeSink={makeSink} />
    </div>
  )
}
