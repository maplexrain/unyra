/**
 * agent 栏的页签（纯逻辑）。
 *
 * 导师对话栏从「单面板」改成「页签栏 + 每页签一份运行时」（见 components/agent/AgentTabStrip）：
 * - 一个**目标**一枚页签（上下文按目标隔离，见 graph/conversations）——打开某个目标下的
 *   文档时它的导师页签自动开好并置前；页签标题就是目标的标题；
 * - 一个**子代理会话**一枚页签——子代理允许在后台跑，页签随时可关（关页签不停任务）。
 *
 * 这里只放数据形状与纯函数：增删、激活、关闭守卫、读盘归一。界面的守卫数据
 * （目标有没有开着文档页签、导师在不在跑）由调用方算好传进来。
 */

import type { AgentTabRef } from './types'

/** 页签 id：目标级 `ga:<goalId>`、子代理 `sa:<sessionId>`。目标级页签一个目标只有一枚 */
export function agentTabKey(ref: AgentTabRef): string {
  return ref.kind === 'goal' ? 'ga:' + ref.goalId : 'sa:' + ref.sessionId
}

/** 关一枚 agent 页签被什么拦着：'none' 随便关；'docs' 文档区还开着该目标的页签；'running' 导师正在跑 */
export type AgentTabCloseBlock = 'none' | 'docs' | 'running'

/**
 * 关闭守卫。目标级页签：文档区还有它的页签时不能关（导师还在辅导看得见的东西）；
 * 这一轮还没跑完时也不能关（运行时页签禁止关闭——停了才许走）。两条同时命中时
 * 报 'docs'：先关文档是更靠前的因果。子代理页签**永远不拦**：任务在后台继续跑。
 */
export function agentTabCloseBlock(
  ref: AgentTabRef,
  ctx: { hasDocTabs: boolean; running: boolean },
): AgentTabCloseBlock {
  if (ref.kind === 'sub') return 'none'
  if (ctx.hasDocTabs) return 'docs'
  if (ctx.running) return 'running'
  return 'none'
}

/**
 * 开（或更新）一枚页签。已存在时**原位替换**（目标级页签的 conversationId 会随
 * 文档区的落点刷新），并按 activate 决定是否置前；新页签在没有任何激活项时
 * 即使不要求激活也会成为激活项——一枚孤零零的页签不该配一个空面板。
 */
export function upsertAgentTab(
  tabs: AgentTabRef[],
  active: string | null,
  ref: AgentTabRef,
  activate: boolean,
): { tabs: AgentTabRef[]; active: string | null } {
  const key = agentTabKey(ref)
  const exists = tabs.some((t) => agentTabKey(t) === key)
  const nextTabs = exists ? tabs.map((t) => (agentTabKey(t) === key ? ref : t)) : [...tabs, ref]
  return { tabs: nextTabs, active: activate ? key : (active ?? key) }
}

/**
 * 关一枚页签。关的正是激活项时，激活权交给它**原来的邻居**（右边的优先，没有就左边）——
 * 与文档区页签同一条落点规矩。
 */
export function removeAgentTab(
  tabs: AgentTabRef[],
  active: string | null,
  key: string,
): { tabs: AgentTabRef[]; active: string | null } {
  const idx = tabs.findIndex((t) => agentTabKey(t) === key)
  if (idx < 0) return { tabs, active }
  const next = tabs.filter((t) => agentTabKey(t) !== key)
  if (active !== key) return { tabs: next, active }
  const neighbor = next[Math.min(idx, next.length - 1)]
  return { tabs: next, active: neighbor ? agentTabKey(neighbor) : null }
}

/** 读盘归一化时对会话的最小视图：只用到 id、归属与子代理会话名单 */
export interface AgentTabConvView {
  id: string
  goalId: string
  subagents?: { sessions: Array<{ id: string }> } | null
}

/**
 * 读盘归一：只留还活得着的页签。目标没了的目标级页签、会话或子代理会话没了的
 * 子代理页签当场丢掉；目标级页签里存着的会话若已不在（被删过会话），回落到该目标
 * 最近的一段——页签本身不该因此丢（它的身份是目标，不是某一段对话）。
 * 激活项必须是留下的页签之一，否则回落到第一枚。
 */
export function normalizeAgentTabs(
  rawTabs: unknown,
  rawActive: unknown,
  ctx: { goals: ReadonlySet<string>; conversations: readonly AgentTabConvView[] },
): { tabs: AgentTabRef[]; active: string | null } {
  const convOf = (id: string): AgentTabConvView | undefined => ctx.conversations.find((c) => c.id === id)
  const latestConvOf = (goalId: string): AgentTabConvView | undefined =>
    [...ctx.conversations].reverse().find((c) => c.goalId === goalId)

  const tabs: AgentTabRef[] = []
  const seen = new Set<string>()
  if (Array.isArray(rawTabs)) {
    for (const raw of rawTabs) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      if (r.kind === 'goal') {
        const goalId = typeof r.goalId === 'string' ? r.goalId : ''
        if (!goalId || !ctx.goals.has(goalId) || seen.has('ga:' + goalId)) continue
        // 存着的会话必须还活着且属于这个目标；丢了就回落到该目标最近的一段（可能也没有 → null）
        const convId = typeof r.conversationId === 'string' ? r.conversationId : ''
        const conv = convId ? convOf(convId) : undefined
        const valid = conv && conv.goalId === goalId ? convId : (latestConvOf(goalId)?.id ?? null)
        seen.add('ga:' + goalId)
        tabs.push({ kind: 'goal', goalId, conversationId: valid })
      } else if (r.kind === 'sub') {
        const conversationId = typeof r.conversationId === 'string' ? r.conversationId : ''
        const sessionId = typeof r.sessionId === 'string' ? r.sessionId : ''
        if (!conversationId || !sessionId || seen.has('sa:' + sessionId)) continue
        const conv = convOf(conversationId)
        if (!conv?.subagents?.sessions.some((s) => s.id === sessionId)) continue
        seen.add('sa:' + sessionId)
        tabs.push({ kind: 'sub', conversationId, sessionId })
      }
    }
  }
  const active =
    typeof rawActive === 'string' && tabs.some((t) => agentTabKey(t) === rawActive)
      ? rawActive
      : (tabs[0] ? agentTabKey(tabs[0]) : null)
  return { tabs, active }
}

/**
 * 把归一/删除后的页签状态写回 store（纯函数版）：agentTabs / agentActiveTab 都没变时
 * 返回原 store 对象——retargetNode 这类「经常被调、多数时候无事发生」的路径不因它多出一轮变更。
 */
export function withAgentTabs<S extends { agentTabs?: AgentTabRef[]; agentActiveTab?: string | null }>(
  store: S,
  tabs: AgentTabRef[],
  active: string | null,
): S {
  const prevTabs = store.agentTabs ?? []
  const prevActive = store.agentActiveTab ?? null
  if (prevTabs === tabs && prevActive === active) return store
  return { ...store, agentTabs: tabs, agentActiveTab: active }
}
