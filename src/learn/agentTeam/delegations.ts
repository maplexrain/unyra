/**
 * 智能体团队的**委托注册表**（team.* 的宿主大脑）：
 * 谁把什么任务委托给了谁、排到第几位、谁在跑、交付结果怎么传回委托者、
 * 目标空闲时怎么被系统启动、awake 怎么自启动。
 *
 * 状态机（一条委托）：
 *   pending →（目标空闲，系统启动它的一轮）→ running → complete → done
 *   running →（收口但没 complete）→ 记一次失败尝试 → pending（needsRemind，空闲时以
 *             「提醒」口径再启动）；连续 MAX_ATTEMPTS 轮没收口 → failed（作废并告知委托者）
 *
 * 三条编排通道：
 * - **插队**（delegate）：从队尾往前找插入位——仍在允许期内（preemptibleUntil > now）
 *   的委托可以被新委托越过，碰到已到期的即停。新委托自己声明「多久之内允许被插队」。
 * - **交付回传**（complete）：委托者空闲 → 直接激活一轮（deliver）；运行中 → 交付全文
 *   进注入缓冲，由委托者当前轮的单次 loop 边界注入（team-delivery 片段 + runtime 的
 *   介入通道，镜像纪律见 learn/agent/history）；若这一轮没再进下一跳就收口了，缓冲
 *   在收口通知里转激活。
 * - **空闲启动 / 自启动**：目标有未处理委托、或收口没 complete → 收口通知里立即接续
 *   （提醒口径）；awake 布防在本轮收口才开始计时，期间有过任何新启动则失效。
 *
 * 注册表**只在内存里**（与等待队列同一条待遇）：委托指向的两端会话都各有自己的持久层，
 * 这里丢的只是编排账；应用重启后未完成的委托不再被系统接续，可在对话里重新委托。
 */

import { loadAgentSettings } from '../../agent/settings'
import { AGENT_TEAM_IDS, agentNameOf, type AgentProfileId } from '../../agent/agentProfile'

/** 一条委托：谁交给谁、做什么、排到哪了、交付了什么 */
export interface AgentDelegation {
  id: string
  fromAgent: AgentProfileId
  fromConversationId: string
  toAgent: AgentProfileId
  toConversationId: string
  /** 委托所属的学习目标：承接会话还不存在时，启动那一轮靠它落目标（free 委托无目标，给空串） */
  goalId: string
  /**
   * 承接轮冲着哪个节点来（可选）：判卷这类「活长在某个节点上」的委托要靠它装配考试
   * 工具（api.exam.* 只在 target.nodeId 上装配，见 rigTurnTools）。省略 = 目标级一轮。
   */
  nodeId?: string
  /** 委托指令全文：目标那一轮的 user 指令就是它 */
  instruction: string
  status: 'pending' | 'running' | 'done' | 'failed'
  createdAt: number
  /** 在此时间戳之前允许被后续委托插队（team.delegate 的 preemptible 参数） */
  preemptibleUntil: number
  /** 被启动过几次：收口没 complete 记一次；超过上限判失败，防僵尸循环 */
  attempts: number
  /** 收口没 complete 时置位：下次空闲启动用「提醒」口径，不重投全量指令 */
  needsRemind: boolean
  startedAt?: number
  completedAt?: number
  result?: string
}

/** 启动一轮的名义：处理委托 / 提醒未收口 / 交付回传激活 / 自启动 */
export type DelegationTurnKind = 'process' | 'remind' | 'deliver' | 'awake'

/**
 * 宿主派发器：注册表只管账，**启动一轮**永远是宿主（useAgent）的事——它认得
 * 目标会话属于哪位声部、该走导师轮还是自由聊天轮。经 getter 取用（宿主每次渲染
 * 刷新一份，注册表每次都拿到最新闭包，与 uiRef / effortGuard 探针同一条纪律）。
 */
export interface AgentTeamDispatcher {
  /** 该会话有没有活着的轮 */
  isConversationRunning: (conversationId: string) => boolean
  /**
   * 这位声部「当前」的会话（委托承接与状态查询都落在它上面）；没有则 null。
   * goalId 是委托发起方所在的目标；**fromAgent 给定时解析的是委托会话**
   * （dv:<承接声部>:<委托者声部>:<goalId>，按委托者分会、同委托者复用，见
   * learn/agentTeam/voiceConvs）；free 不挂目标，忽略 goalId 取最近活跃的那段。
   */
  resolveTargetConversation: (agent: AgentProfileId, goalId?: string | null, fromAgent?: AgentProfileId) => string | null
  /** 启动一轮（不堵塞调用方）：kind 决定指令口径，text 由 delegationTurnText 生成 */
  startTurn: (req: { conversationId: string; kind: DelegationTurnKind; delegation?: AgentDelegation }) => void
}

let dispatcherGetter: (() => AgentTeamDispatcher | null) | null = null

export function setAgentTeamDispatcher(next: (() => AgentTeamDispatcher | null) | null): void {
  dispatcherGetter = next
}

/** 测试专用：清空全部注册表状态（委托 / 队列 / 注入缓冲 / awake） */
export function resetAgentTeamRegistry(): void {
  delegations.clear()
  for (const id of AGENT_TEAM_IDS) queues[id] = []
  deliveryBuffer.clear()
  awakeArmed.clear()
  for (const timer of awakeTimers.values()) clearTimeout(timer)
  awakeTimers.clear()
}

function dispatcherOf(): AgentTeamDispatcher | null {
  return dispatcherGetter?.() ?? null
}

/** 收口没 complete 的失败尝试上限：超过即作废（告知委托者），绝不无限循环 */
const MAX_ATTEMPTS = 3

/* ---------- 注册表 ---------- */

const delegations = new Map<string, AgentDelegation>()
/** 各声部的**待处理**队列（front = 下一个处理）；running 不在列 */
const queues: Record<AgentProfileId, string[]> = Object.fromEntries(
  AGENT_TEAM_IDS.map((id) => [id, []]),
) as unknown as Record<AgentProfileId, string[]>
/** 等待跳边界注入的交付（键 = 委托者会话） */
const deliveryBuffer = new Map<string, Array<{ delegationId: string; text: string }>>()
/** 已布防的自启动意图（键 = 会话）：本轮收口才开始计时 */
const awakeArmed = new Map<string, { fireAt: number }>()
const awakeTimers = new Map<string, ReturnType<typeof setTimeout>>()

const excerpt = (s: string, n = 80): string => (s.length > n ? s.slice(0, n) + '…' : s)

function displayNameOf(agent: AgentProfileId): string {
  return agentNameOf(loadAgentSettings().profiles?.[agent], agent)
}

/** 各类启动轮的指令全文（mark 由宿主按 kind 给，分界条在界面上可见） */
export function delegationTurnText(kind: DelegationTurnKind, d?: AgentDelegation): string {
  if (kind === 'process' && d) {
    return (
      '【委托任务（' + d.id.slice(0, 8) + '，来自「' + displayNameOf(d.fromAgent) + '」）】\n' +
      d.instruction +
      '\n\n（这是另一位智能体委托给你的任务，用户此刻未必在场。做完就 api.team.complete({ result: 交付全文 }) 收口；' +
      '有做不到的部分在交付里如实说明，不要空等。）'
    )
  }
  if (kind === 'remind' && d) {
    return (
      '【系统提醒：委托 ' + d.id.slice(0, 8) + ' 尚未收口】\n来自「' + displayNameOf(d.fromAgent) + '」的委托：' +
      excerpt(d.instruction) +
      '\n\n你上一轮结束了但没有调 api.team.complete。检查工作是否已经交付：已交付就调用 api.team.complete({ result: 交付全文 })；' +
      '没做完就继续做完再收口。'
    )
  }
  if (kind === 'deliver' && d) {
    return (
      '【委托交付（' + d.id.slice(0, 8) + '）】\n你此前委托给「' + displayNameOf(d.toAgent) + '」的任务已有交付结果：\n\n' +
      (d.result ?? '') +
      '\n\n（这是委托交付回传，属于你自己的任务上下文，不要当作用户发言。请基于它继续你的工作，或把它汇报给用户。）'
    )
  }
  return (
    '【系统自启动】你在上一轮设置了延迟自启动。检查有没有未完成的委托（api.team.status）或没收尾的工作，' +
    '继续推进或向用户汇报；无事可做就简要说明并收口。'
  )
}

/* ---------- 委托生命周期 ---------- */

/**
 * 登记一条委托并排队。插入位**从队尾往前找**：仍在允许期内（preemptibleUntil > now）
 * 的委托可以被越过，碰到已到期的即停——新委托落在「可越过尾段」之前、最后一条
 * 已到期委托之后（全部已到期 = 排队尾；全部未到期 = 插队到最前）。
 * 目标空闲时立即启动（不堵塞委托者进程）；忙碌则等它收口接续。
 */
export function createDelegation(input: {
  fromAgent: AgentProfileId
  fromConversationId: string
  toAgent: AgentProfileId
  toConversationId: string
  /** 委托所属目标（free 委托给空串） */
  goalId: string
  /** 承接轮冲着的节点（可选，判卷这类活长在节点上的委托要给） */
  nodeId?: string
  instruction: string
  preemptibleUntil: number
  now: number
}): { delegation: AgentDelegation; position: number } {
  const d: AgentDelegation = {
    id: crypto.randomUUID(),
    fromAgent: input.fromAgent,
    fromConversationId: input.fromConversationId,
    toAgent: input.toAgent,
    toConversationId: input.toConversationId,
    goalId: input.goalId,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    instruction: input.instruction,
    status: 'pending',
    createdAt: input.now,
    preemptibleUntil: Math.max(0, input.preemptibleUntil),
    attempts: 0,
    needsRemind: false,
  }
  delegations.set(d.id, d)
  const queue = queues[input.toAgent]
  let i = queue.length
  while (i > 0 && (delegations.get(queue[i - 1]!)?.preemptibleUntil ?? 0) > input.now) i--
  queue.splice(i, 0, d.id)
  maybeStartNext(input.toAgent)
  return { delegation: d, position: i }
}

function runningOf(agent: AgentProfileId): AgentDelegation | undefined {
  for (const d of delegations.values()) {
    if (d.status === 'running' && d.toAgent === agent) return d
  }
  return undefined
}

function runningForConversation(conversationId: string): AgentDelegation | undefined {
  for (const d of delegations.values()) {
    if (d.status === 'running' && d.toConversationId === conversationId) return d
  }
  return undefined
}

/** 目标有空闲的承接会话且队列非空 → 启动下一条；忙碌则不动（收口通知会接续） */
function maybeStartNext(agent: AgentProfileId): void {
  const host = dispatcherOf()
  if (!host) return
  const queue = queues[agent]
  if (!queue.length) return
  if (runningOf(agent)) return
  const head = delegations.get(queue[0]!)
  if (!head) {
    queue.shift()
    maybeStartNext(agent)
    return
  }
  if (!host.isConversationRunning(head.toConversationId)) startDelegation(head)
}

function startDelegation(d: AgentDelegation): void {
  const host = dispatcherOf()
  if (!host) return
  const queue = queues[d.toAgent]
  const idx = queue.indexOf(d.id)
  if (idx >= 0) queue.splice(idx, 1)
  d.status = 'running'
  d.startedAt = Date.now()
  const remind = d.needsRemind
  d.needsRemind = false
  host.startTurn({ conversationId: d.toConversationId, kind: remind ? 'remind' : 'process', delegation: d })
}

/**
 * 承接方收口一条委托：交付全文传回委托者——空闲就激活，运行中走跳边界注入。
 * id 省略时默认收口「你当前正在处理的那一条」。
 */
export function completeDelegation(input: {
  id?: string
  result: string
  byConversationId: string
}): { ok: true; delegation: AgentDelegation; delivered: 'injected' | 'activated' } | { ok: false; error: string } {
  const d = input.id ? delegations.get(input.id.trim()) : runningForConversation(input.byConversationId)
  if (!d) return { ok: false, error: '没有这条委托：' + (input.id ?? '（未给 id，且当前没有在处理的委托）') }
  if (d.toConversationId !== input.byConversationId) {
    return { ok: false, error: '这条委托不是承接给你的（承接会话不匹配），不能由你收口。' }
  }
  if (d.status !== 'running' && d.status !== 'pending') {
    return { ok: false, error: '这条委托已经结束（' + d.status + '），不需要重复收口。' }
  }
  d.status = 'done'
  d.completedAt = Date.now()
  d.result = input.result
  return { ok: true, delegation: d, delivered: deliverToDelegator(d) }
}

/** 交付回传：委托者运行中 → 注入缓冲；空闲 → 激活一轮 */
function deliverToDelegator(d: AgentDelegation): 'injected' | 'activated' {
  const host = dispatcherOf()
  const text = delegationTurnText('deliver', d)
  if (host?.isConversationRunning(d.fromConversationId)) {
    const buf = deliveryBuffer.get(d.fromConversationId) ?? []
    buf.push({ delegationId: d.id, text })
    deliveryBuffer.set(d.fromConversationId, buf)
    return 'injected'
  }
  host?.startTurn({ conversationId: d.fromConversationId, kind: 'deliver', delegation: d })
  return 'activated'
}

/** 委托者当前轮的跳边界取一条待注入的交付（没有就 null） */
export function takeDeliveryInjection(conversationId: string): { delegationId: string; text: string } | null {
  const buf = deliveryBuffer.get(conversationId)
  if (!buf?.length) return null
  return buf.shift() ?? null
}

/* ---------- 状态查询 ---------- */

export function listAgents(): Array<{ id: AgentProfileId; name: string }> {
  const settings = loadAgentSettings()
  return AGENT_TEAM_IDS.map((id) => ({ id, name: agentNameOf(settings.profiles?.[id], id) }))
}

/** 一条「我发起的、还没收口」的委托的公开形状（界面「委托中」条用） */
export interface ActiveDelegationView {
  id: string
  toAgent: AgentProfileId
  /** 承接方的显示名（profile 覆盖后的，界面直接画） */
  toName: string
  status: 'pending' | 'running'
  toConversationId: string
  /** 裸数据（展开核对 / 手动干预用）：发起方与指令全文、目标归属、重试账目与时间戳 */
  fromAgent: AgentProfileId
  fromName: string
  instruction: string
  goalId: string
  nodeId?: string
  attempts: number
  createdAt: number
  startedAt?: number
  preemptibleUntil: number
}

/**
 * 某段会话（委托者视角）发起的、还没收口的委托：pending（排队等承接方空闲）与
 * running（承接方正在处理）都在列——界面在消息列表底部展示、展开看裸数据、
 * 手动激活 / 删除（见 manuallyActivateDelegation / manuallyDeleteDelegation）。
 */
export function activeDelegationsFrom(conversationId: string): ActiveDelegationView[] {
  const out: ActiveDelegationView[] = []
  for (const d of delegations.values()) {
    if (d.fromConversationId !== conversationId) continue
    if (d.status === 'pending' || d.status === 'running') {
      out.push({
        id: d.id,
        toAgent: d.toAgent,
        toName: displayNameOf(d.toAgent),
        status: d.status,
        toConversationId: d.toConversationId,
        fromAgent: d.fromAgent,
        fromName: displayNameOf(d.fromAgent),
        instruction: d.instruction,
        goalId: d.goalId,
        ...(d.nodeId ? { nodeId: d.nodeId } : {}),
        attempts: d.attempts,
        createdAt: d.createdAt,
        ...(d.startedAt ? { startedAt: d.startedAt } : {}),
        preemptibleUntil: d.preemptibleUntil,
      })
    }
  }
  // 处理中的排前面（界面先看到正在动的）
  return out.sort((a, b) => (a.status === b.status ? 0 : a.status === 'running' ? -1 : 1))
}

/* ---------- 界面管理口（手动激活 / 删除）：委托卡住的最后兜底 ---------- */

/**
 * 手动激活一条委托（「委托中」条上的按钮）：
 * - pending：提到队首立即启动（承接会话空闲才行）；
 * - running：承接轮多半已经死了（收口通知没送达 = 僵尸账）——转回「提醒」口径重启；
 *   承接会话真的还在跑则拒绝（等它收口自动接续）。
 * 同声部还挂着别的僵尸 running 账时顺手转回排队，不打断正常账目。
 */
export function manuallyActivateDelegation(id: string): { ok: boolean; error?: string } {
  const d = delegations.get(id.trim())
  if (!d) return { ok: false, error: '没有这条委托：注册表只在内存里，应用重启后就丢了，可以在对话里重新委托' }
  if (d.status === 'done' || d.status === 'failed') {
    return { ok: false, error: '这条委托已经结束（' + d.status + '），不能再激活' }
  }
  const host = dispatcherOf()
  if (!host) return { ok: false, error: '委托宿主尚未就绪，稍后再试' }
  if (host.isConversationRunning(d.toConversationId)) {
    return { ok: false, error: '承接会话正在运行中，等它收口后注册表会自动接续，不用手动激活' }
  }
  // 同声部挂着别的 running 僵尸账（会话明明空闲却一直 running）：转回待处理排队
  const zombie = runningOf(d.toAgent)
  if (zombie && zombie.id !== d.id) {
    zombie.status = 'pending'
    zombie.needsRemind = true
    const zombieQueue = queues[zombie.toAgent]
    if (!zombieQueue.includes(zombie.id)) zombieQueue.unshift(zombie.id)
  }
  if (d.status === 'running') {
    d.status = 'pending'
    d.needsRemind = true
  }
  const queue = queues[d.toAgent]
  const idx = queue.indexOf(d.id)
  if (idx >= 0) queue.splice(idx, 1)
  queue.unshift(d.id)
  startDelegation(d)
  return { ok: true }
}

/**
 * 手动删除一条委托（「委托中」条上的按钮）：从注册表与队列里摘掉，注入缓冲里它
 * 的交付一并作废。running 也能删——承接轮就算还活着，收口后注册表找不到这条账，
 * 它的 complete 会得到「没有这条委托」，不会留下悬挂状态。
 */
export function manuallyDeleteDelegation(id: string): { ok: boolean; error?: string } {
  const d = delegations.get(id.trim())
  if (!d) return { ok: false, error: '没有这条委托：可能已被删除' }
  delegations.delete(d.id)
  const queue = queues[d.toAgent]
  const idx = queue.indexOf(d.id)
  if (idx >= 0) queue.splice(idx, 1)
  const buf = deliveryBuffer.get(d.fromConversationId)
  if (buf) {
    const next = buf.filter((item) => item.delegationId !== d.id)
    if (next.length) deliveryBuffer.set(d.fromConversationId, next)
    else deliveryBuffer.delete(d.fromConversationId)
  }
  return { ok: true }
}

/** 一位声部的完整状态：是否在跑 / 正在处理的委托 / 未处理委托队列 */
export function agentStatus(agent: AgentProfileId, goalId?: string | null, fromAgent?: AgentProfileId): {
  id: AgentProfileId
  name: string
  conversationId: string | null
  isRunning: boolean
  processing: { id: string; from: string; startedAt: number; instruction: string } | null
  pendingCount: number
  pending: Array<{ id: string; from: string; createdAt: number; instruction: string }>
} {
  const host = dispatcherOf()
  const conv = host?.resolveTargetConversation(agent, goalId, fromAgent) ?? null
  const isRunning = conv ? (host?.isConversationRunning(conv) ?? false) : false
  const settings = loadAgentSettings()
  const running = runningOf(agent)
  const pending = queues[agent].map((id) => delegations.get(id)).filter((d): d is AgentDelegation => !!d)
  return {
    id: agent,
    name: agentNameOf(settings.profiles?.[agent], agent),
    conversationId: conv,
    isRunning,
    processing: running
      ? {
          id: running.id,
          from: displayNameOf(running.fromAgent),
          startedAt: running.startedAt ?? 0,
          instruction: running.instruction,
        }
      : null,
    pendingCount: pending.length,
    pending: pending.map((d) => ({
      id: d.id,
      from: displayNameOf(d.fromAgent),
      createdAt: d.createdAt,
      instruction: d.instruction,
    })),
  }
}

/* ---------- awake（自启动） ---------- */

/**
 * 布防一次自启动：**计时从本轮收口才开始**（armAwake 只记意图，见收口通知），
 * 重新布防覆盖旧意图。期间若有过新启动（onConversationTurnStarted）则失效。
 */
export function armAwake(conversationId: string, delayMs: number, now: number): { fireAt: number } {
  cancelAwake(conversationId)
  const fireAt = now + delayMs
  awakeArmed.set(conversationId, { fireAt })
  return { fireAt }
}

function cancelAwake(conversationId: string): void {
  awakeArmed.delete(conversationId)
  const timer = awakeTimers.get(conversationId)
  if (timer) {
    clearTimeout(timer)
    awakeTimers.delete(conversationId)
  }
}

/* ---------- 宿主通知（轮的开始与收口） ---------- */

/** 一轮开始了：期间启动过 → 自启动失效 */
export function onAgentTeamTurnStarted(conversationId: string): void {
  cancelAwake(conversationId)
}

/**
 * 一轮收口了。依次处理：
 * 1. 委托者视角：注入缓冲里还有未消费的交付（这一轮没再进下一跳就收口）→ 转激活；
 * 2. 承接视角：本会话名下 running 的委托——仅聊天承接方带 autoCompleteResult 即
 *    自动交付（它没有 team.*）；导师承接方收口没 complete 记一次失败尝试，到上限
 *    作废并告知委托者，否则回队首待提醒；
 * 3. awake：本轮收口时已布防的意图开始计时，到点自启动（期间被启动过就已被清掉）；
 * 4. 承接队列接续：本会话还有待处理委托 → 启动下一条（空闲启动的落点）。
 */
export function onConversationTurnClosed(
  conversationId: string,
  opts: { now?: number; autoCompleteResult?: string } = {},
): void {
  const now = opts.now ?? Date.now()
  // 1) 未消费的交付 → 转激活
  const buf = deliveryBuffer.get(conversationId)
  if (buf?.length) {
    deliveryBuffer.delete(conversationId)
    const host = dispatcherOf()
    for (const item of buf) {
      const d = delegations.get(item.delegationId)
      if (d && d.status === 'done') host?.startTurn({ conversationId, kind: 'deliver', delegation: d })
    }
  }
  // 2) 承接中的委托
  const running = runningForConversation(conversationId)
  if (running) {
    if (typeof opts.autoCompleteResult === 'string' && opts.autoCompleteResult.trim()) {
      running.status = 'done'
      running.completedAt = now
      running.result = opts.autoCompleteResult
      deliverToDelegator(running)
    } else {
      running.attempts += 1
      if (running.attempts >= MAX_ATTEMPTS) {
        running.status = 'failed'
        running.completedAt = now
        running.result = '目标代理连续 ' + MAX_ATTEMPTS + ' 轮未能收口此委托，已自动作废。'
        deliverToDelegator(running)
      } else {
        running.status = 'pending'
        running.needsRemind = true
        const queue = queues[running.toAgent]
        if (!queue.includes(running.id)) queue.unshift(running.id)
      }
    }
  }
  // 3) awake 计时
  const armed = awakeArmed.get(conversationId)
  if (armed) {
    awakeArmed.delete(conversationId)
    const delay = Math.max(0, armed.fireAt - now)
    const timer = setTimeout(() => {
      awakeTimers.delete(conversationId)
      dispatcherOf()?.startTurn({ conversationId, kind: 'awake' })
    }, delay)
    awakeTimers.set(conversationId, timer)
  }
  // 4) 承接队列接续：收口的是这位声部的委托会话（dv: 前缀按声部段认领）且它空闲
  //    → 启动下一条。委托会话按委托者分会之后，队首的 toConversationId 可能是
  //    「另一位委托者」的那段会话——按声部认领而不是按会话 id 严格相等。
  for (const agent of AGENT_TEAM_IDS) {
    const queue = queues[agent]
    if (!queue.length) continue
    const head = delegations.get(queue[0]!)
    if (!head) continue
    const owned = head.toConversationId === conversationId || conversationId.startsWith('dv:' + agent + ':')
    if (owned && !runningOf(agent)) {
      maybeStartNext(agent)
      break
    }
  }
}
