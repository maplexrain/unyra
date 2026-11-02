/**
 * OCR 文字识别的插件身份（功能性插件，见 lib/functionalPlugins）。
 *
 * 规范：
 * 1. 作为内置功能性插件注册，默认开启或受模型就绪守卫约束；
 * 2. 具备二级独立配置面板（settings/PluginOcrPage），提供多模型与多下载源选择；
 * 3. 对外导出 ocrPluginOn() 供 PDF 浏览等调用方同步判断可用性。
 */

import { t } from '../../i18n'
import { builtinPluginOn, registerPlugin, setPluginEnableGuard } from '../plugins'
import { ocrModelStatus } from './model'
import '../functionalPlugins'

export const OCR_PLUGIN_ID = 'ocr.recognize'

registerPlugin({
  id: OCR_PLUGIN_ID,
  category: 'functional',
  name: 'OCR 文字识别',
  builtin: true,
  defaultEnabled: false,
  configurable: true,
})

/**
 * 启用守卫：检查是否有就绪的 OCR 模型。
 * 若无可用模型，返回指引前往下载的提示信息。
 */
async function blockReason(): Promise<string | null> {
  const status = await ocrModelStatus()
  const hasReadyModel = status.models.some((m) => m.exists)
  if (hasReadyModel) return null
  return t('请先下载至少一款离线 OCR 识别模型（推荐 PP-OCRv4 极速版，约 16 MB）——点进这一项去下载。')
}

setPluginEnableGuard(OCR_PLUGIN_ID, blockReason)

/**
 * 当前 OCR 文字识别插件是否处于启用状态（同步读）。
 */
export function ocrPluginOn(): boolean {
  return builtinPluginOn(OCR_PLUGIN_ID)
}
