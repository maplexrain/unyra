import { triggerShortcutAction } from './shortcuts'

/**
 * 「导师输入框聚焦、侧栏展开与消息发送」的全局接线：
 *
 * 供 Vim 冒号命令 :agent 以及各处调用；Ctrl+Q 现在归 fixside 折叠，不再走这里。
 */
let target: (() => void) | null = null
let agentToggle: (() => void) | null = null
let agentExpand: (() => void) | null = null
let messageSender: ((msg: string) => void) | null = null
let pendingMessage: string | null = null

/** 登记聚焦实现；返回带身份校验的清理函数（传 null 注销） */
export function setAgentFocusHandler(fn: (() => void) | null): () => void {
  target = fn
  return () => {
    if (fn && target === fn) target = null
  }
}

/** 请求把光标放进输入框；返回是否真的有人接 */
export function focusAgentInput(): boolean {
  if (!target) return false
  target()
  return true
}

/** 登记侧栏展开与切换实现（通常由 LearnWorkspace 注入） */
export function setAgentToggleHandler(handlers: { toggle?: () => void; expand?: () => void } | null): void {
  agentToggle = handlers?.toggle ?? null
  agentExpand = handlers?.expand ?? null
}

/** 登记消息发送实现（通常由 Composer 注入）；返回带身份校验的清理函数 */
export function setAgentMessenger(fn: ((msg: string) => void) | null): () => void {
  messageSender = fn
  if (messageSender && pendingMessage) {
    const msg = pendingMessage
    pendingMessage = null
    messageSender(msg)
  }
  return () => {
    if (fn && messageSender === fn) messageSender = null
  }
}

/** 切换导师栏展开 / 收起 */
export function toggleAgentPanel(): boolean {
  if (agentToggle) {
    agentToggle()
    return true
  }
  return triggerShortcutAction('agent.focus')
}

/** 确保导师栏展开 */
export function expandAgentPanel(): void {
  if (agentExpand) {
    agentExpand()
  } else {
    toggleAgentPanel()
  }
}

/** 直接向导师发送消息（自动展开侧栏并提交） */
export function sendAgentMessage(msg: string): boolean {
  expandAgentPanel()
  focusAgentInput()

  if (messageSender) {
    messageSender(msg)
    return true
  }

  pendingMessage = msg
  return true
}
