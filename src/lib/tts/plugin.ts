/**
 * 语音合成 (TTS) 功能性插件登记与守卫。
 */

import { registerPlugin } from '../plugins'
import '../functionalPlugins'

export const TTS_PLUGIN_ID = 'voice.tts'

registerPlugin({
  id: TTS_PLUGIN_ID,
  category: 'functional',
  name: '语音合成 (TTS)',
  builtin: true,
  defaultEnabled: true,
  configurable: true,
})
