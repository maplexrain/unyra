/**
 * 群聊目标的文本口径：正文里显式出现的 `@角色名` 比模型另外传的 to / mentions 更可信。
 *
 * 模型偶尔会把“@导师龟”同时写成 `to: "designer"`，或者把目标名记混；如果只信
 * to / mentions，收件人就会错位。这里只负责从正文里认领被 @ 的 role，宿主再以
 * 正文结果为准投递。角色名同时接受 profile 显示名与默认名，避免改名后 @ 默认名失效。
 */
import type { AgentProfileId } from '../../agent/agentProfile'

export interface MentionRole {
  id: AgentProfileId
  /** 该 role 可被 @ 的名字（profile 名 + 默认名） */
  names: string[]
}

/** 正文中直接 @ 到的 role（按 role 名单顺序，去重） */
export function mentionedRoleIdsOf(text: string, roles: MentionRole[]): AgentProfileId[] {
  const mentioned = new Set<AgentProfileId>()
  for (const role of roles) {
    if (role.names.some((name) => name && text.includes('@' + name))) mentioned.add(role.id)
  }
  return roles.filter((role) => mentioned.has(role.id)).map((role) => role.id)
}
