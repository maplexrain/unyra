/**
 * 这个文件负责：设置窗口的页签清单与「上次停在哪一页」的本地记忆（TABS / DEV_TAB / 存取页签）。
 */

import {
  Activity,
  AppWindow,
  Bell,
  Bot,
  Database,
  HardDrive,
  Info,
  Keyboard,
  Palette,
  PlugZap,
  Terminal,
  RefreshCw,
} from 'lucide-react'
import { isDevUnlocked } from '../../lib/devMode'
import { isWeb } from '../../lib/native'

export type TabKey = 'ai' | 'appearance' | 'input' | 'reminder' | 'performance' | 'window' | 'storage' | 'migration' | 'plugins' | 'update' | 'about' | 'dev'

export interface SubTab {
  key: string
  label: string
}

export interface SettingsTabItem {
  key: TabKey
  label: string
  icon: typeof Bot
  subTabs?: SubTab[]
}

/**
 * 上次停在哪一页：记在 localStorage。开发者分页只有解锁过才允许作为「上次的选择」
 * 回来——凭据没了（换机器、清了存储）就不能凭一个存下来的键绕过口令。
 */
const TAB_STORAGE_KEY = 'moji:settings:tab'

export const loadSavedTab = (): TabKey => {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY)
    if (v === 'dev') return isDevUnlocked() ? 'dev' : 'ai'
    if (isWeb() && (v === 'window' || v === 'update')) return 'ai'
    const keys: TabKey[] = isWeb()
      ? ['ai', 'appearance', 'input', 'reminder', 'performance', 'storage', 'migration', 'plugins', 'about']
      : ['ai', 'appearance', 'input', 'reminder', 'performance', 'window', 'storage', 'migration', 'plugins', 'update', 'about']
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

const ALL_TABS: SettingsTabItem[] = [
  {
    key: 'ai',
    label: '模型',
    icon: Bot,
    subTabs: [
      { key: 'providers', label: '提供商与模型' },
      { key: 'search', label: '网络搜索' },
    ],
  },
  {
    key: 'appearance',
    label: '外观',
    icon: Palette,
    subTabs: [
      { key: 'theme', label: '主题配色' },
      { key: 'background', label: '全局壁纸' },
      { key: 'typography', label: '字体与描边' },
      { key: 'locale', label: '界面语言' },
      { key: 'features', label: '辅助与提示' },
    ],
  },
  // 「输入」= 键盘与麦克风：改键、语音转文字。它们都是「怎么把话喂进这个应用」，
  // 放在一起才找得到（教学模式那个开关在外观里，它管的是显示）
  { key: 'input', label: '输入', icon: Keyboard },
  // 「提醒」= 日程到点怎么叫人。它既不是外观也不是输入：声音是**约定被履行**的凭据，
  // 与界面长什么样无关，所以单列一页（日程页底部还有一条紧凑入口，改的是同一份数据）
  { key: 'reminder', label: '提醒', icon: Bell },
  // 「性能」= 实时监控帧率、JS堆内存、活跃DOM数与卡顿诱因排查
  { key: 'performance', label: '性能', icon: Activity },
  // 「窗口」与「存储」都是**全局**设置：跟机器走、不属于任何用户，
  // 与前两项（跟着用户走、存在用户目录里）不是一回事，所以分开列在后面
  { key: 'window', label: '窗口', icon: AppWindow },
  { key: 'storage', label: '存储', icon: HardDrive },
  { key: 'migration', label: '数据迁移', icon: Database },
  // 插件自成一类：用户插件跟着数据目录走（{root}/plugins/），内置插件的开关跟机器走。
  // 这一页按**类别**分组（见 lib/plugins 的 PluginCategory）——目前只有 Markdown 文档插件
  { key: 'plugins', label: '插件', icon: PlugZap },
  // 更新：开关、手动检查、安装包与下载进度都在这儿。
  // 顶栏那颗入口只在**下载完成之后**才出现，平时要问「有没有新版本」只能来这里
  { key: 'update', label: '更新', icon: RefreshCw },
  // 版本号与「这份副本是谁的」都在这儿：出问题时用户能报出准确版本
  { key: 'about', label: '关于', icon: Info },
]

export const TABS: SettingsTabItem[] = isWeb()
  ? ALL_TABS.filter((t) => t.key !== 'window' && t.key !== 'update')
  : ALL_TABS


/**
 * 「开发者」分页不常驻：解锁过（凭据在 localStorage 里）或这次对标题三击过，
 * 它才会出现在左侧分页列表里。见 lib/devMode。
 */
export const DEV_TAB: SettingsTabItem = {
  key: 'dev',
  label: '开发者',
  icon: Terminal,
}
