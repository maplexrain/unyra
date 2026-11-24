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

/**
 * 群聊正文是否在 **@ 用户**：`@用户` 是稳定口径，另外兼容用户当前的显示名。
 * 这种 @ 不是投递给某位 role——它只是让群里的用户看到结论；宿主不能因为
 * 「有 @ 但没解析出 role」就报错，也不能退回默认调度龟。
 */
export function mentionsUserInGroup(text: string, userName?: string): boolean {
  if (text.includes('@用户')) return true
  const name = userName?.trim()
  return Boolean(name && text.includes('@' + name))
}

/** 正文中直接 @ 到的 role（按 role 名单顺序，去重） */
export function mentionedRoleIdsOf(text: string, roles: MentionRole[]): AgentProfileId[] {
  const mentioned = new Set<AgentProfileId>()
  for (const role of roles) {
    if (role.names.some((name) => name && text.includes('@' + name))) mentioned.add(role.id)
  }
  return roles.filter((role) => mentioned.has(role.id)).map((role) => role.id)
}

/**
 * 群聊里 @ 自己一律拒绝：它不是「自己给自己发一条流水」，而是模型把收件人写错了。
 * 显式点名自己就算错，哪怕同时 @ 了别人也不投递——否则消息里留着一枚无效 @，
 * 对方收到后还可能误以为要回给发信人。
 */
export function groupSelfMentionError(
  ids: readonly AgentProfileId[],
  selfId: AgentProfileId,
  selfName: string,
): string | null {
  if (!ids.includes(selfId)) return null
  return `群聊里不能 @ 自己（${selfName}）；请 @ 另一位成员，或直接说明要交给谁`
}
