/**
 * 全局群消息推送宿主：订阅群聊流水，只对「挂载之后新出现、且正文 @了用户」的
 * agent 群消息弹一次顶部提示。历史消息不补弹，同一个消息 id 不重复弹。
 */
import { useEffect, useRef, useState } from 'react'
import { getGroupChatMessages, subscribeGroupChat } from '../../../learn/groupChat'
import { mentionsUserInGroup } from '../../../learn/roleWork/groupTargets'
import { requestOpenGroupChat } from '../../../learn/groupChatAttention'
import { GroupMentionPush, type GroupMentionPushData } from './GroupMentionPush'

const AUTO_HIDE_MS = 8000

export function GroupMentionPushHost({ userName }: { userName?: string }) {
  const [pushList, setPushList] = useState<GroupMentionPushData[]>([])
  const push = pushList[0] ?? null
  const seenRef = useRef(new Set<string>())
  /** 只推应用启动 / 登录之后到达的新消息，不把历史群聊翻出来补弹 */
  const sinceRef = useRef(0)

  useEffect(() => {
    if (!sinceRef.current) sinceRef.current = Date.now()
    const cutoff = sinceRef.current
    const check = () => {
      const incoming: GroupMentionPushData[] = []
      for (const m of getGroupChatMessages()) {
        if (m.kind !== 'group' || m.from.kind !== 'role' || m.ts < cutoff) continue
        if (seenRef.current.has(m.id)) continue
        seenRef.current.add(m.id)
        if (!m.goalId || !mentionsUserInGroup(m.text, userName)) continue
        incoming.push({
          id: m.id,
          goalId: m.goalId,
          fromName: m.from.name?.trim() || m.from.id,
          text: m.text.trim().replace(/\s+/g, ' '),
        })
      }
      // 同一批里有多条 @用户 时逐条排队，不能只弹最后一条
      if (incoming.length) setPushList((prev) => [...prev, ...incoming])
    }
    check()
    return subscribeGroupChat(check)
  }, [userName])

  useEffect(() => {
    if (!push) return
    const timer = window.setTimeout(() => setPushList((prev) => prev.slice(1)), AUTO_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [push])

  if (!push) return null
  return (
    <GroupMentionPush
      push={push}
      onOpen={(item) => {
        requestOpenGroupChat(item.goalId, item.id)
        setPushList((prev) => prev.slice(1))
      }}
      onClose={() => setPushList((prev) => prev.slice(1))}
    />
  )
}
