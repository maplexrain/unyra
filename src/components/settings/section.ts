/**
 * 设置页的顶部分页（常规 / 智能体）。
 *
 * 两个面板原先各占一枚文档页签；合并后只有一枚 settings 页签，分页状态放在这里，
 * 打开「智能体设置」入口时只需切到 agent 分页，不再开第二枚页签。
 * localStorage 记住上次停在哪一页；内存订阅让已经挂着的设置页即时切换。
 */
export type SettingsSection = 'general' | 'agent'

const STORAGE_KEY = 'moji:settings:section'

function read(): SettingsSection {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'agent' ? 'agent' : 'general'
  } catch {
    return 'general'
  }
}

let current: SettingsSection = read()
const listeners = new Set<() => void>()

export function getSettingsSection(): SettingsSection {
  return current
}

export function subscribeSettingsSection(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setSettingsSection(section: SettingsSection): void {
  if (current === section) return
  current = section
  try {
    localStorage.setItem(STORAGE_KEY, section)
  } catch {
    // 隐身模式 / 存储禁用：内存态仍然生效
  }
  for (const listener of listeners) listener()
}
