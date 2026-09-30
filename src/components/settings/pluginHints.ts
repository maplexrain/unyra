/**
 * 这个文件负责：插件列表里那一行说明文字的拼装（内置还是哪个文件、做了什么、此刻什么状态）。
 */

import { formatBytes } from '../../lib/update'
import { t } from '../../i18n'
import { type PluginStatus } from '../../lib/plugins'

/** 一行说明：是内置还是哪个文件、这个插件做了什么、此刻什么状态 */
export function pluginHint(p: PluginStatus): string {
  const parts: string[] = []
  if (p.kind === 'user' && p.file) parts.push(p.file, formatBytes(p.bytes ?? 0))
  else parts.push(t('内置'))
  if (p.summary.length) parts.push(p.summary.join(' · '))
  parts.push(pluginStateText(p))
  return parts.join(' · ')
}

function pluginStateText(p: PluginStatus): string {
  if (p.enabled && p.active) return t('已装载')
  if (p.enabled) return p.error ? t('装载失败') : t('重启后装载')
  return p.active ? t('已停用，重启后卸载') : t('未启用')
}
