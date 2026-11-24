/**
 * 群消息推送点击后，把当前目标对应的 AgentSlot 切到群聊。
 *
 * 点击发生在 App 层的全局推送里，页签打开由 useTabOpening 负责；这里只处理
 * 「页签已经落到本目标」之后选中群聊。pending 是模块级的，新挂载的 AgentSlot
 * 也要消费一次，否则点击只会打开页签、群聊页仍未选中。
 */
import { useEffect, useRef } from 'react'
import { consumeOpenGroupChat, subscribeOpenGroupChat } from '../../../learn/groupChatAttention'

export function useGroupMentionOpen(goalId: string | null, onOpen: () => void): void {
  const onOpenRef = useRef(onOpen)
  useEffect(() => {
    onOpenRef.current = onOpen
  }, [onOpen])

  useEffect(() => {
    const showGroup = () => onOpenRef.current()
    if (consumeOpenGroupChat(goalId)) showGroup()
    return subscribeOpenGroupChat((req) => {
      if (req.goalId !== goalId) return
      if (!consumeOpenGroupChat(goalId)) return
      showGroup()
    })
  }, [goalId])
}
