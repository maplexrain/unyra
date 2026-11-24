/**
 * 群聊目标的文本口径：正文里显式出现的 `@角色名 ` 比模型另外传的 to / mentions 更可信。
 *
 * 模型偶尔会把“@导师龟 ”同时写成 `to: "designer"`，或者把目标名记混；如果只信
 * to / mentions，收件人就会错位。这里只负责从正文里认领被 @ 的 role，宿主再以
 * 正文结果为准投递。角色名同时接受 profile 显示名与默认名，避免改名后 @ 默认名失效。
 *
 * **@ 的语法是严格的：`@名字` 后面必须紧跟一个空格（半角或全角）**。没有分隔空格的
 * `@导师龟，请…` / 句末的 `@导师龟` 都不算一次成功艾特——否则“@导师”与“@导师龟”
 * 这类前缀会互相误伤，用户也难以判断到底点没点到人。换行、制表符也不替代这个空格。
 */
import type { AgentProfileId } from '../../agent/agentProfile'

export interface MentionRole {
  id: AgentProfileId
  /** 该 role 可被 @ 的名字（profile 名 + 默认名） */
  names: string[]
}

/** `@名字` 之后必须出现的分隔符：半角空格或全角空格；换行、制表符不算 */
const MENTION_SEPARATOR = /^[ \u3000]$/

/**
 * 正文中是否出现了完整的 `@名字 `。
 *
 * 逐个出现位置检查后一位，而不是简单的 `includes`：`@导师龟，请` 不算，
 * `@导师龟`（正文结束）不算，`@导师龟\n请` 也不算；只有名字后面真的落了一个
 * 半角或全角空格才算。
 */
function hasMentionAt(text: string, name: string): boolean {
  const needle = '@' + name
  if (!name || !text.includes(needle)) return false
  let from = 0
  while (from <= text.length - needle.length) {
    const at = text.indexOf(needle, from)
    if (at < 0) return false
    const after = text.charAt(at + needle.length)
    if (after && MENTION_SEPARATOR.test(after)) return true
    from = at + 1
  }
  return false
}

/** 正文里是否出现了 `@这些名字之一 `（严格需要尾随空格） */
export function hasMentionOf(text: string, names: readonly string[]): boolean {
  return names.some((name) => name && hasMentionAt(text, name))
}

/**
 * 群聊正文是否在 **@ 用户**：`@用户 ` 是稳定口径，另外兼容用户当前的显示名。
 * 这种 @ 不是投递给某位 role——它只是让群里的用户看到结论；宿主不能因为
 * 「有 @ 但没解析出 role」就报错，也不能退回默认调度龟。
 */
export function mentionsUserInGroup(text: string, userName?: string): boolean {
  if (hasMentionOf(text, ['用户'])) return true
  const name = userName?.trim()
  return Boolean(name && hasMentionAt(text, name))
}

/** 正文中直接 @ 到的 role（按 role 名单顺序，去重） */
export function mentionedRoleIdsOf(text: string, roles: MentionRole[]): AgentProfileId[] {
  const mentioned = new Set<AgentProfileId>()
  for (const role of roles) {
    if (hasMentionOf(text, role.names)) mentioned.add(role.id)
  }
  return roles.filter((role) => mentioned.has(role.id)).map((role) => role.id)
}

/**
 * agent 在群通道里一次最多点名一位成员（role 或用户）。
 *
 * 群聊的 @ 是“把这句话交给谁”的路由信号，不是通讯录广播：一次 @ 两个人会让
 * 两边都当成自己的任务，最终各写一份。超过一人时直接拒绝，让模型自己收敛。
 */
export function groupMentionLimitError(
  ids: readonly AgentProfileId[],
  mentionsUser: boolean,
): string | null {
  const count = ids.length + (mentionsUser ? 1 : 0)
  if (count <= 1) return null
  return '群聊里一次最多只能 @ 一位成员；请只保留一个 `@名字 `，或直接说明要交给谁'
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
