/**
 * 智能体页的默认通道：群聊。
 *
 * 组件的初始 groupOpen 只看挂载时的激活页签：从 work 页签直接进来先看 work，
 * 其余情况打开页面先落在群聊。页面已经挂载后再切换激活页签（外部宿主唤起另一段
 * 会话、运行中的 ask 弹回来等）则退出群聊，避免群聊盖住正在等待处理的内容。
 *
 * 独立成 hook 是为了守住 AgentSlot 的文件体积红线，不改变行为。
 */
import { useEffect, useRef, useState } from 'react'
import type { AgentTabRef } from '../../../learn/types'

export function useGroupDefaultOpen(
  activeAgentTab: AgentTabRef,
  activeAgentTabId: string | null,
): [boolean, (open: boolean) => void] {
  const [groupOpen, setGroupOpen] = useState(() => activeAgentTab.kind !== 'work')
  const lastAgentTabIdRef = useRef(activeAgentTabId)
  useEffect(() => {
    if (lastAgentTabIdRef.current === activeAgentTabId) return
    lastAgentTabIdRef.current = activeAgentTabId
    setGroupOpen(false)
  }, [activeAgentTabId])
  return [groupOpen, setGroupOpen]
}
