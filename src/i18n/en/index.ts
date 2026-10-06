/**
 * 英文字典的聚合入口：每个接入分片一个文件（键 = 界面里的中文原文），这里合成一张表。
 *
 * 同一个键出现在多个分片时按 import 顺序后者覆盖——分片之间必须给同一个键
 * 同一个译法，scripts/i18n-check.mjs 会把不一致的键报出来。
 */
import agentUi from './agent-ui'
import focusUi from './focus-ui'
import learnShell from './learn-shell'
import learnViews from './learn-views'
import libUi from './lib-ui'
import shellUi from './shell-ui'
import stores from './stores'
import webUi from './web-ui'

export const en: Record<string, string> = {
  ...agentUi,
  ...focusUi,
  ...learnShell,
  ...learnViews,
  ...libUi,
  ...shellUi,
  ...stores,
  ...webUi,
}
