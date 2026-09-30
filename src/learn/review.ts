/**
 * 复习（review）：间隔复习的计划账——「间隔复习 + 主动提取 + 反馈 + 针对薄弱项调整」里
 * 负责排期的那一环。
 *
 * 计划挂在**节点本身**（KnowledgeNode.review，与 node.outline / node.learning 同款）：
 * 节点状态**首次**变为「已掌握」时由系统自动创建（钩子在 setNodeStatus 与 nodeOps.update，
 * 见 ensureReviewPlan），五个默认阶段（+1/+3/+7/+14/+30 天）一次铺好。两条产品规矩落在
 * 数据形状上：到了期没做**不自动顺延**（doneAt 不写就一直是待复习），完成更靠后的阶段时
 * 更早未完成的阶段「并入」（mergedInto）——拖了几天没来的人不必补三次课。
 *
 * 合并复习：强相关的节点（同父、前后置、常一起用）经导师问过用户后打上同一个 groupId，
 * 后续阶段整组一起复习。它是纯标记——每个节点自己的阶段账照旧，组只是「一起做」的约定。
 *
 * **不 import graph**：graph 的 setNodeStatus 要用 ensureReviewPlan 落钩子，这里若反过来
 * import graph 就成环了。全 store 的扫描（dueEntriesOf / 合并候选）只用 nodes.find 就够，
 * 关系判断（父子 / 前后置）留给 ops 层（见 ops/review.ts）。
 */
import type {
  KnowledgeNode,
  LearnStore,
  ReviewExtraTask,
  ReviewPlan,
  ReviewStage,
  ReviewStageState,
} from './types'

export const REVIEW_DAY_MS = 86_400_000

/** 默认复习阶段（顺序即推进顺序）；这是默认计划，不是绝对规则 */
export const REVIEW_STAGES: readonly ReviewStage[] = ['d1', 'd3', 'd7', 'd14', 'd30']

/** 各阶段的默认间隔（学习完成日 + N 天） */
export const REVIEW_STAGE_OFFSET: Record<ReviewStage, number> = { d1: 1, d3: 3, d7: 7, d14: 14, d30: 30 }

export const REVIEW_STAGE_LABEL: Record<ReviewStage, string> = {
  d1: '+1 天 · 回忆',
  d3: '+3 天 · 理解',
  d7: '+7 天 · 应用',
  d14: '+14 天 · 迁移',
  d30: '+30 天 · 长期保持',
}

/** 各阶段的复习侧重（给复习工作流的一句话；完整规矩在工作流指令里） */
export const REVIEW_STAGE_GOAL: Record<ReviewStage, string> = {
  d1: '确认还能从记忆里提取核心知识：简答复述为主，不看教学内容，不生成试卷',
  d3: '先主动回忆，再用少量低难度题确认是否真正理解（每题标注考察点）',
  d7: '先主动回忆，再用变式应用题检查能否把知识用到新问题（每题标注考察点）',
  d14: '隐藏考察点，用陌生情境让他自己识别并调用知识（不再标注考察点）',
  d30: '一个短的综合任务：核心回忆 + 实际应用 + 陌生情境迁移，确认长期保持',
}

/** 认得出就认：阶段既可以是 key 也可以是中文说法（模型与测试都会写） */
export function reviewStageOf(v: unknown): ReviewStage | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if ((REVIEW_STAGES as readonly string[]).includes(s)) return s as ReviewStage
  const hit = REVIEW_STAGES.find((x) => REVIEW_STAGE_LABEL[x] === v.trim())
  if (hit) return hit
  if (s === '1天' || s === '一天' || s === '+1') return 'd1'
  if (s === '3天' || s === '三天' || s === '+3') return 'd3'
  if (s === '7天' || s === '七天' || s === '+7') return 'd7'
  if (s === '14天' || s === '两周' || s === '+14') return 'd14'
  if (s === '30天' || s === '一个月' || s === '+30') return 'd30'
  return null
}

/* ---------- 计划的建立 ---------- */

/** 一份新计划：五个阶段按学习完成时刻 + 默认间隔铺好 */
export function createReviewPlan(at: number): ReviewPlan {
  return {
    createdAt: at,
    stages: REVIEW_STAGES.map((stage) => ({ stage, dueAt: at + REVIEW_STAGE_OFFSET[stage] * REVIEW_DAY_MS })),
  }
}

/** 补充复习的 id：同一条计划里可能加好几条，落账要认得出是哪一条 */
export function newExtraId(at: number): string {
  return 're_' + at.toString(36) + Math.random().toString(36).slice(2, 6)
}

/**
 * 节点状态变为「已掌握」时的钩子：没有计划、或上一轮已全部完成，就建（重启）一份。
 * 幂等——重复调用不会重建；学习到一半的计划不会被覆盖。
 */
export function ensureReviewPlan(store: LearnStore, nodeId: string, now: number): LearnStore {
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node || node.status !== 'mastered') return store
  if (node.review && !planIsComplete(node.review)) return store
  const next: KnowledgeNode = { ...node, review: createReviewPlan(now), updatedAt: now }
  return { ...store, nodes: store.nodes.map((n) => (n.id === nodeId ? next : n)) }
}

/* ---------- 到期与完成（纯函数，作用于一份计划） ---------- */

/** 到期比较按**本地日**：跨时区移动或半夜复习都不该把「+1 天」算歪 */
export function dayStartOf(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isDueDay(dueAt: number, now: number): boolean {
  return dayStartOf(now) >= dayStartOf(dueAt)
}

/** 逾期几天（0 = 今天到期）；负数没意义，调用方只拿它显示「逾期 N 天」 */
export function overdueDaysOf(dueAt: number, now: number): number {
  return Math.max(0, Math.round((dayStartOf(now) - dayStartOf(dueAt)) / REVIEW_DAY_MS))
}

const undone = (s: ReviewStageState): boolean => !s.doneAt && !s.mergedInto

/**
 * 到期未完成的阶段里**最晚**的那一档：用户十天才回来，就按「当前窗口」这一档复习，
 * 更早的跳过即并入（见 completeStagePlan）。「到了期仍保持待复习」这条规矩就是
 * 这个判据——isDueDay 对逾期永远为真，不看不消失。
 */
export function dueStageOf(
  plan: ReviewPlan,
  now: number,
): { stage: ReviewStage; dueAt: number; overdueDays: number } | null {
  let hit: ReviewStageState | null = null
  for (const s of plan.stages) if (undone(s) && isDueDay(s.dueAt, now)) hit = s
  if (!hit) return null
  return { stage: hit.stage, dueAt: hit.dueAt, overdueDays: overdueDaysOf(hit.dueAt, now) }
}

/** 第一个还没完成的阶段（「下次复习」说的是它，未到期也返回） */
export function pendingStageOf(plan: ReviewPlan): ReviewStageState | null {
  return plan.stages.find(undone) ?? null
}

/**
 * 这个节点「正在进行」的复习阶段：到期就用到期的（可逾期的最晚档），没到期用下一档。
 * 合并判定看的是它——两个「都在 +3 阶段」的节点，哪怕一个还差两天到期也可以并。
 */
export function activeStageOf(
  plan: ReviewPlan,
  now: number,
): { stage: ReviewStage; dueAt: number; overdueDays: number } | null {
  const due = dueStageOf(plan, now)
  if (due) return due
  const pending = pendingStageOf(plan)
  return pending ? { stage: pending.stage, dueAt: pending.dueAt, overdueDays: 0 } : null
}

/** 到期的补充复习（没有就 null） */
export function dueExtraOf(plan: ReviewPlan, now: number): ReviewExtraTask | null {
  return plan.extra?.find((t) => !t.doneAt && isDueDay(t.dueAt, now)) ?? null
}

/** 这份计划还有没有到期待完成的（阶段或补充）——红点与面板行的判据 */
export function planHasDue(plan: ReviewPlan, now: number): boolean {
  return !!dueStageOf(plan, now) || !!dueExtraOf(plan, now)
}

/** 计划是否走完了（阶段全完成或并入、补充任务全完成）——全部完成后状态再变 mastered 会重启一轮 */
export function planIsComplete(plan: ReviewPlan): boolean {
  return plan.stages.every((s) => !undone(s)) && (plan.extra ?? []).every((t) => !!t.doneAt)
}

/** 完成一个阶段：更早还没完成的阶段全部「并入」这一次，历史只留最近几条 */
export function completeStagePlan(
  plan: ReviewPlan,
  stage: ReviewStage,
  entry: { at: number; items: number; missed: number; note?: string },
): ReviewPlan {
  const at = REVIEW_STAGES.indexOf(stage)
  const stages = plan.stages.map((s) => {
    if (s.stage === stage) {
      const history = [...(s.history ?? []), { ...entry, ...(entry.note ? { note: entry.note } : {}) }].slice(-3)
      return { ...s, doneAt: entry.at, history }
    }
    if (undone(s) && REVIEW_STAGES.indexOf(s.stage) < at) return { ...s, mergedInto: stage }
    return s
  })
  return { ...plan, stages }
}

/** 把一个阶段顺延几天（agent 动态调整的口子；至少一天，最多 30 天） */
export function postponeStage(plan: ReviewPlan, stage: ReviewStage, days: number, now: number): ReviewPlan {
  const step = Math.max(1, Math.min(30, Math.round(days)))
  return {
    ...plan,
    stages: plan.stages.map((s) =>
      s.stage === stage && !s.doneAt && !s.mergedInto ? { ...s, dueAt: Math.max(dayStartOf(now), dayStartOf(s.dueAt)) + step * REVIEW_DAY_MS } : s,
    ),
  }
}

/** 针对薄弱点追加一条补充复习 */
export function extendPlan(plan: ReviewPlan, task: ReviewExtraTask): ReviewPlan {
  return { ...plan, extra: [...(plan.extra ?? []), task] }
}

/* ---------- 合并复习组 ---------- */

/** 合并组：给每个参与计划打上同一个 groupId（后续阶段整组一起复习） */
export function mergePlansAt(store: LearnStore, nodeIds: readonly string[], groupId: string, now: number): LearnStore {
  const set = new Set(nodeIds)
  return {
    ...store,
    nodes: store.nodes.map((n) =>
      set.has(n.id) && n.review ? { ...n, review: { ...n.review, groupId }, updatedAt: now } : n,
    ),
  }
}

/** 退出合并组（互逆操作；只动这一个节点，别人的组原样保留） */
export function splitPlanFromGroup(store: LearnStore, nodeId: string, now: number): LearnStore {
  return {
    ...store,
    nodes: store.nodes.map((n) => {
      if (n.id !== nodeId || !n.review?.groupId) return n
      const review = { ...n.review }
      delete review.groupId
      return { ...n, review, updatedAt: now }
    }),
  }
}

/** 同组还有谁（含自己；按节点的 groupId 找，节点没删过的都在） */
export function groupMemberIdsOf(store: LearnStore, groupId: string): string[] {
  return store.nodes.filter((n) => n.review?.groupId === groupId).map((n) => n.id)
}

/** 与 nodeId 同一 groupId 的成员（ nodeId 自己在首位）；没有组就只有它自己 */
export function reviewGroupOf(store: LearnStore, nodeId: string): string[] {
  const self = store.nodes.find((n) => n.id === nodeId)
  const gid = self?.review?.groupId
  if (!gid) return nodeId ? [nodeId] : []
  const members = groupMemberIdsOf(store, gid)
  return members.includes(nodeId) ? [nodeId, ...members.filter((m) => m !== nodeId)] : members
}

/* ---------- 全 store 的查询（红点 / 面板 / 候选） ---------- */

/** 一条待复习项：单节点或一个合并组（组里每个成员各自落账） */
export interface ReviewDueEntry {
  /** 面板行的 key：组 id 或节点 id */
  key: string
  nodeIds: string[]
  goalId: string
  /** 到期的阶段；null = 这是一条到期的补充复习 */
  stage: ReviewStage | null
  extraId?: string
  dueAt: number
  overdueDays: number
  grouped: boolean
}

const stageOrder = (s: ReviewStage): number => REVIEW_STAGES.indexOf(s)

/**
 * 全部到期待复习项（合并组收成一条，dueAt 取组内最早；阶段取组内最靠后到期的）。
 * 孤儿计划（节点已删）自然不会出现——扫描的就是活节点。
 */
export function dueEntriesOf(store: LearnStore, now: number): ReviewDueEntry[] {
  const singles: ReviewDueEntry[] = []
  const groups = new Map<string, { goalId: string; nodeIds: string[]; stages: Array<{ stage: ReviewStage; dueAt: number }> }>()
  for (const node of store.nodes) {
    const plan = node.review
    if (!plan) continue
    const due = dueStageOf(plan, now)
    const extra = dueExtraOf(plan, now)
    const push = (stage: ReviewStage | null, dueAt: number, extraId?: string) => {
      if (plan.groupId) {
        const g = groups.get(plan.groupId) ?? { goalId: node.goalId, nodeIds: [], stages: [] }
        if (!g.nodeIds.includes(node.id)) g.nodeIds.push(node.id)
        if (stage && !g.stages.some((x) => x.stage === stage)) g.stages.push({ stage, dueAt })
        groups.set(plan.groupId, g)
        return
      }
      singles.push({
        key: extraId ? node.id + ':' + extraId : node.id,
        nodeIds: [node.id],
        goalId: node.goalId,
        stage,
        ...(extraId ? { extraId } : {}),
        dueAt,
        overdueDays: overdueDaysOf(dueAt, now),
        grouped: false,
      })
    }
    if (due) push(due.stage, due.dueAt)
    else if (extra) push(null, extra.dueAt, extra.id)
  }
  const groupEntries: ReviewDueEntry[] = []
  for (const [gid, g] of groups) {
    // 组的阶段账：取最靠后到期的阶段为代表（成员各自 record 自己的那一档）
    const latest = g.stages.slice().sort((a, b) => stageOrder(b.stage) - stageOrder(a.stage))[0]
    const earliest = g.stages.slice().sort((a, b) => a.dueAt - b.dueAt)[0]
    if (!latest || !earliest) continue
    groupEntries.push({
      key: gid,
      nodeIds: g.nodeIds,
      goalId: g.goalId,
      stage: latest.stage,
      dueAt: earliest.dueAt,
      overdueDays: overdueDaysOf(earliest.dueAt, now),
      grouped: true,
    })
  }
  return [...singles, ...groupEntries].sort((a, b) => a.dueAt - b.dueAt)
}

/** 可合并候选：与 nodeId 处于同一「进行中」阶段、还没在同一组里的其它节点（关系判断留给 ops 层） */
export function mergeCandidatesOf(
  store: LearnStore,
  nodeId: string,
  now: number,
): Array<{ nodeId: string; stage: ReviewStage; dueAt: number }> {
  const self = store.nodes.find((n) => n.id === nodeId)
  const active = self?.review ? activeStageOf(self.review, now) : null
  if (!self || !active) return []
  const gid = self.review?.groupId ?? null
  const out: Array<{ nodeId: string; stage: ReviewStage; dueAt: number }> = []
  for (const node of store.nodes) {
    if (node.id === nodeId || node.goalId !== self.goalId) continue
    if (node.review?.groupId && node.review.groupId === gid) continue
    const st = node.review ? activeStageOf(node.review, now) : null
    if (st && st.stage === active.stage) out.push({ nodeId: node.id, stage: st.stage, dueAt: st.dueAt })
  }
  return out
}

/* ---------- 读盘的规范化 ---------- */

/** 一串数字里的整数（不认就回 null） */
const intOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null

/**
 * 把磁盘上（或导入文件里）的那一份收成合法计划；读不出来回 undefined——
 * 「没有计划」与「有空计划」在界面上是一回事，不区分。
 * 缺了的阶段补默认档：老版本数据或手改的数据也能读回来继续用。
 */
export function normalizeReviewPlan(raw: unknown): ReviewPlan | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const now = Date.now()
  const seen = new Set<string>()
  const stages: ReviewStageState[] = []
  if (Array.isArray(r.stages)) {
    for (const item of r.stages) {
      if (!item || typeof item !== 'object') continue
      const m = item as Record<string, unknown>
      const stage = reviewStageOf(m.stage)
      if (!stage || seen.has(stage)) continue
      seen.add(stage)
      const state: ReviewStageState = {
        stage,
        dueAt: typeof m.dueAt === 'number' && Number.isFinite(m.dueAt) ? m.dueAt : now,
      }
      if (typeof m.doneAt === 'number' && Number.isFinite(m.doneAt)) state.doneAt = m.doneAt
      const merged = reviewStageOf(m.mergedInto)
      if (merged && merged !== stage) state.mergedInto = merged
      if (Array.isArray(m.history)) {
        const history: NonNullable<ReviewStageState['history']> = []
        for (const h of m.history) {
          if (!h || typeof h !== 'object') continue
          const hm = h as Record<string, unknown>
          const at = typeof hm.at === 'number' && Number.isFinite(hm.at) ? hm.at : 0
          if (!at) continue
          const items = intOf(hm.items) ?? 0
          const missed = intOf(hm.missed) ?? 0
          const note = typeof hm.note === 'string' ? hm.note.trim().slice(0, 300) : ''
          history.push({ at, items, missed, ...(note ? { note } : {}) })
        }
        if (history.length) state.history = history.slice(-3)
      }
      stages.push(state)
    }
  }
  if (!stages.length) return undefined
  for (const stage of REVIEW_STAGES) {
    if (!seen.has(stage)) stages.push({ stage, dueAt: now + REVIEW_STAGE_OFFSET[stage] * REVIEW_DAY_MS })
  }
  stages.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage))
  const out: ReviewPlan = {
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : now,
    stages,
  }
  if (typeof r.groupId === 'string' && r.groupId.trim()) out.groupId = r.groupId.trim().slice(0, 64)
  if (Array.isArray(r.extra)) {
    const extra: ReviewExtraTask[] = []
    for (const item of r.extra) {
      if (!item || typeof item !== 'object') continue
      const m = item as Record<string, unknown>
      const focus = typeof m.focus === 'string' ? m.focus.trim() : ''
      if (!focus) continue
      extra.push({
        id: typeof m.id === 'string' && m.id.trim() ? m.id.trim().slice(0, 40) : newExtraId(now),
        focus: focus.slice(0, 200),
        dueAt: typeof m.dueAt === 'number' && Number.isFinite(m.dueAt) ? m.dueAt : now,
        ...(typeof m.doneAt === 'number' && Number.isFinite(m.doneAt) ? { doneAt: m.doneAt } : {}),
        ...(typeof m.note === 'string' && m.note.trim() ? { note: m.note.trim().slice(0, 300) } : {}),
      })
    }
    if (extra.length) out.extra = extra.slice(-20)
  }
  return out
}
