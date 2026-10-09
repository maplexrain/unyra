/**
 * 语音输入的**插件身份**（见 lib/functionalPlugins 的「功能性插件」这一类）。
 *
 * 它是一件内置功能性插件，**默认关**：模型要 228 MB，没下的人打开只会撞见一句
 * 「还没下载模型」。所以「能不能开」与模型绑在一起——没模型时开关按不动
 * （守卫见下），而二级配置页里的第一件事就是下载模型。
 *
 * 行为本身不在这一层：录音与识别在 lib/voice/session，按钮挂在导师输入框上
 * （见 components/agent/panel 的 MicButton），配置页在 settings/PluginVoicePage。
 */
import { t } from '../../i18n'
import { builtinPluginOn, registerPlugin, setPluginEnableGuard } from '../plugins'
import { VOICE_MODEL_MB, VOICE_MODEL_NAME, modelStatus } from './model'
// 登记之前必须先把这一类定义出来（registerPlugin 会去查类别）
import '../functionalPlugins'

export const VOICE_PLUGIN_ID = 'voice.input'

registerPlugin({
  id: VOICE_PLUGIN_ID,
  category: 'functional',
  name: '语音输入',
  builtin: true,
  defaultEnabled: false,
  configurable: true,
})

/**
 * 开之前的那道闸：模型没下齐就不许开。
 *
 * 返回的不是「不可用」，而是**下一步该做什么**——用户看到的每一句拦话都该能照着做，
 * 否则它就只是又一次「这个按钮坏了」。
 */
async function blockReason(): Promise<string | null> {
  const status = await modelStatus()
  if (status.exists) return null
  return t('先下载语音模型（{0}，约 {1} MB）才能打开——点进这一项去下。', VOICE_MODEL_NAME, VOICE_MODEL_MB)
}

setPluginEnableGuard(VOICE_PLUGIN_ID, blockReason)

/**
 * 语音输入此刻开着没有（同步读，渲染期就能用）。
 *
 * 读的是插件开关（启动时按 global.yaml 定下来，见 lib/plugins 的 builtinPluginOn），
 * **不是**另一个设置项：开关只有一个，就在插件列表里。
 */
export function voicePluginOn(): boolean {
  return builtinPluginOn(VOICE_PLUGIN_ID)
}
