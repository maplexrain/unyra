/**
 * 群聊 @ 名单解析（纯函数，单独成文件避免组件文件导出函数触发 fast-refresh 警告）。
 */
import type { GroupChatAgent } from './GroupChatPanel'

/** 群聊里一条消息命中了哪些 agent：只认正文里完整出现的 `@名字`（含默认名别名） */
export function mentionedAgentsOf(text: string, agents: GroupChatAgent[]): GroupChatAgent[] {
  const out: GroupChatAgent[] = []
  for (const agent of agents) {
    const names = [agent.name.trim(), ...(agent.aliases ?? []).map((x) => x.trim())].filter(Boolean)
    if (names.some((name) => text.includes('@' + name))) out.push(agent)
  }
  return out
}
