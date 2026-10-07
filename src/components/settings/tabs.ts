/**
 * 这个文件负责：设置窗口的页签清单与「上次停在哪一页」的本地记忆（TABS / DEV_TAB / 存取页签）。
 */

import {
  AppWindow,
  Bot,
  ChartColumn,
  HardDrive,
  Info,
  Keyboard,
  Palette,
  PlugZap,
  Terminal,
  RefreshCw,
} from 'lucide-react'
import { isDevUnlocked } from '../../lib/devMode'

export type TabKey =
  | 'ai'
  | 'usage'
  | 'appearance'
  | 'input'
  | 'window'
  | 'storage'
  | 'plugins'
  | 'update'
  | 'about'
  | 'dev'

/**
 * 上次停在哪一页：记在 localStorage。开发者分页只有解锁过才允许作为「上次的选择」
 * 回来——凭据没了（换机器、清了存储）就不能凭一个存下来的键绕过口令。
 */
const TAB_STORAGE_KEY = 'moji:settings:tab'

export const loadSavedTab = (): TabKey => {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    if (v === 'dev') return isDevUnlocked() ? 'dev' : 'ai'
    const keys: TabKey[] = ['ai', 'usage', 'appearance', 'input', 'window', 'storage', 'plugins', 'update', 'about']
    return keys.includes(v as TabKey) ? (v as TabKey) : 'ai'
  } catch {
    return 'ai'
  }
}

export const saveTab = (key: TabKey): void => {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, key)
  } catch {
    // 存不下就算了：分页选择本来就是个「记得最好」的东西
  }
}

export const TABS: Array<{ key: TabKey; label: string; icon: typeof Bot }> = [
  { key: 'ai', label: '模型', icon: Bot },
  // 「用量」紧挨着模型：token 花在哪一眼就能对上「用的是哪一家」（见 settings/UsagePanel）
  { key: 'usage', label: '用量', icon: ChartColumn },
  { key: 'appearance', label: '外观', icon: Palette },
  // 「输入」= 键盘与麦克风：改键、语音转文字。它们都是「怎么把话喂进这个应用」，
  // 放在一起才找得到（教学模式那个开关在外观里，它管的是显示）
  { key: 'input', label: '输入', icon: Keyboard },
  // 「窗口」与「存储」都是**全局**设置：跟机器走、不属于任何用户，
  // 与前两项（跟着用户走、存在用户目录里）不是一回事，所以分开列在后面
  { key: 'window', label: '窗口', icon: AppWindow },
  { key: 'storage', label: '存储', icon: HardDrive },
  // 插件自成一类：用户插件跟着数据目录走（{root}/plugins/），内置插件的开关跟机器走。
  // 这一页按**类别**分组（见 lib/plugins 的 PluginCategory）——目前只有 Markdown 文档插件
  { key: 'plugins', label: '插件', icon: PlugZap },
  // 更新：开关、手动检查、安装包与下载进度都在这儿。
  // 顶栏那颗入口只在**下载完成之后**才出现，平时要问「有没有新版本」只能来这里
  { key: 'update', label: '更新', icon: RefreshCw },
  // 版本号与「这份副本是谁的」都在这儿：出问题时用户能报出准确版本
  { key: 'about', label: '关于', icon: Info },
]

/**
 * 「开发者」分页不常驻：解锁过（凭据在 localStorage 里）或这次对标题三击过，
 * 它才会出现在左侧分页列表里。见 lib/devMode。
 */
export const DEV_TAB: { key: TabKey; label: string; icon: typeof Bot } = {
  key: 'dev',
  label: '开发者',
  icon: Terminal,
}
