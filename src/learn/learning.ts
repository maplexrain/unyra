/**
 * 学习状态的纯函数：规范化、增删改、以及给提示词与界面看的那几句话。
 *
 * 单独成一个模块的理由与 agentOps 一样：这些是纯粹的「状态 → 状态」变换，
 * 与 React、与磁盘都无关，抽出来才能在 Node 里直接测（见 scripts/agent-ops.test.ts）。
 *
 * **不 import graph**：graph 要用这里的 withLearning 落写操作，这里若反过来 import graph
 * 就成环了。因此这一层只认「一个节点」，不认「一张图」——深度、前置这些图上的事
 * 留在 graph 里算（见 knowledgeDepth）。
 */
import type {
  CheckKind,
  CheckRecord,
  KnowledgeNode,
  LearningState,
  MistakeRecord,
  SelfReport,
} from './types'
import { CHECK_KIND_LABEL, MAX_CHECKS, MAX_MISTAKES, SELF_REPORTS, SELF_REPORT_LABEL } from './types'
import { t } from '../i18n'

/* ---------- 认得出就认（沙箱那侧传进来的都是模型写的字符串） ---------- */

/** 四档自评：英文 key 与中文说法都认，认不出回 null（调用方据此报错） */
export function selfReportOf(v: unknown): SelfReport | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if ((SELF_REPORTS as readonly string[]).includes(s)) return s as SelfReport
  const hit = SELF_REPORTS.find((x) => SELF_REPORT_LABEL[x] === v.trim())
  if (hit) return hit
  // 说话不必照着我们的措辞：几个同义说法一并认下来，认不出才报错
  if (s === '会' || s === '已掌握' || s === '完全掌握' || s === '熟练') return 'mastered'
  if (s === '半熟' || s === '不熟' || s === '了解' || s === '学过但忘了') return 'familiar'
  if (s === '不会' || s === '没学过' || s === '空白') return 'unknown'
  if (s === '不确定' || s === '说不准' || s === '模糊') return 'unsure'
  return null
}

export function isSelfReport(v: unknown): v is SelfReport {
  return typeof v === 'string' && (SELF_REPORTS as readonly string[]).includes(v)
}

/** 三种检验：探针 / 考试 / 回忆，中英文都认 */
export function checkKindOf(v: unknown): CheckKind | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (s === 'probe' || s === 'exam' || s === 'recall' || s === 'review') return s as CheckKind
  if (s === '探针' || s === '提问' || s === '随口一问') return 'probe'
  if (s === '考试' || s === '试卷' || s === '测验' || s === '小测') return 'exam'
  if (s === '回忆' || s === '主动回忆' || s === '复述') return 'recall'
  if (s === '复习' || s === '间隔复习') return 'review'
  return null
}

/**
 * 错误说法的归一化键：去掉所有空白再转小写。
 * 「漏乘内部导数」与「漏乘 内部导数」是同一类错误，不该记成两条。
 */
export function mistakeKey(pattern: string): string {
  return pattern.trim().toLowerCase().replace(/[\s\u3000]+/g, '')
}

/** 掌握度：只收 0~100 的有限数，四舍五入到整数（界面上不显示 62.5% 这种精度） */
export function clampMastery(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.max(0, Math.min(100, Math.round(v)))
}

/* ---------- 读盘时的规范化 ---------- */

/** 一串字符串：只留非空项，去重，截断过长的（模型偶尔会回一整段话） */
function strList(v: unknown, max = 12, clip = 80): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    const s = item.trim()
    if (!s) continue
    const cut = s.length > clip ? s.slice(0, clip) : s
    if (!out.includes(cut)) out.push(cut)
    if (out.length >= max) break
  }
  return out.length ? out : undefined
}

function normalizeMistake(raw: unknown): MistakeRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const pattern = typeof r.pattern === 'string' ? r.pattern.trim() : ''
  if (!pattern) return null
  const count = typeof r.count === 'number' && Number.isFinite(r.count) ? Math.max(1, Math.floor(r.count)) : 1
  const cause = typeof r.cause === 'string' ? r.cause.trim() : ''
  const at = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Date.now())
  return {
    pattern: pattern.length > 120 ? pattern.slice(0, 120) : pattern,
    count,
    ...(cause ? { cause: cause.length > 200 ? cause.slice(0, 200) : cause } : {}),
    firstAt: at(r.firstAt),
    lastAt: at(r.lastAt),
    // 已修复时刻也读回来：复习里「答对了旧薄弱项」标记的是它，丢了就白修了
    ...(typeof r.fixedAt === 'number' && Number.isFinite(r.fixedAt) ? { fixedAt: r.fixedAt } : {}),
  }
}

function normalizeCheck(raw: unknown): CheckRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = checkKindOf(r.kind)
  if (!kind) return null
  const score = clampMastery(r.score)
  const mentioned = strList(r.mentioned)
  const missed = strList(r.missed)
  const misconceptions = strList(r.misconceptions)
  const question = typeof r.question === 'string' ? r.question.trim() : ''
  const answer = typeof r.answer === 'string' ? r.answer.trim() : ''
  const note = typeof r.note === 'string' ? r.note.trim() : ''
  return {
    kind,
    at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : Date.now(),
    ...(score !== null ? { score } : {}),
    ...(mentioned ? { mentioned } : {}),
    ...(missed ? { missed } : {}),
    ...(misconceptions ? { misconceptions } : {}),
    // 原问原答截断保存：它们是回看的线索，不是要逐字复刻的档案
    ...(question ? { question: question.slice(0, 300) } : {}),
    ...(answer ? { answer: answer.slice(0, 600) } : {}),
    ...(note ? { note: note.slice(0, 300) } : {}),
  }
}

/**
 * 沙箱那侧送进来的「一次检验」：值域先在这里挡住。
 *
 * 与 normalizeCheck 的分工：那个是读盘（读不懂就丢，静默），这个是接模型的输入
 * （读不懂要说清楚该怎么写）。kind 不认时必须报错而不是默认成探针——
 * 一次考试被记成探针，时间线就再也说不清掌握度是怎么涨上去的。
 */
export function parseCheck(raw: unknown): { ok: true; check: CheckRecord } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'state.check 需要一个对象参数，如 { kind: "probe", score: 70 }' }
  }
  const kind = checkKindOf((raw as Record<string, unknown>).kind)
  if (!kind) {
    return {
      ok: false,
      message:
        'kind 只认 probe（探针）/ exam（考试）/ recall（主动回忆）/ review（复习），收到「' +
        String((raw as Record<string, unknown>).kind ?? '') +
        '」。',
    }
  }
  const check = normalizeCheck(raw)
  if (!check) return { ok: false, message: '这条检验记录没读出来，请检查字段名' }
  return { ok: true, check }
}

/**
 * 把磁盘上（或导入文件里）的那一份收成合法的学习状态。
 * 整个对象一个字段都没有时返回 undefined——**没有状态**与「有空状态」在界面上不一样。
 */
export function normalizeLearning(raw: unknown): LearningState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: LearningState = {}

  if (isSelfReport(r.self)) {
    out.self = r.self
    out.selfBy = r.selfBy === 'user' ? 'user' : 'ai'
  }
  const mastery = clampMastery(r.mastery)
  if (mastery !== null) out.mastery = mastery
  if (typeof r.masteryNote === 'string' && r.masteryNote.trim()) {
    out.masteryNote = r.masteryNote.trim().slice(0, 300)
  }

  if (Array.isArray(r.mistakes)) {
    const list: MistakeRecord[] = []
    const seen = new Set<string>()
    for (const item of r.mistakes) {
      const m = normalizeMistake(item)
      if (!m) continue
      const k = mistakeKey(m.pattern)
      if (seen.has(k)) continue
      seen.add(k)
      list.push(m)
    }
    if (list.length) out.mistakes = list.slice(-MAX_MISTAKES)
  }

  if (Array.isArray(r.checks)) {
    const list: CheckRecord[] = []
    for (const item of r.checks) {
      const c = normalizeCheck(item)
      if (c) list.push(c)
    }
    if (list.length) out.checks = list.slice(-MAX_CHECKS)
  }

  const at = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
  const last = at(r.lastStudiedAt)
  if (last) out.lastStudiedAt = last
  const visits = at(r.visits)
  if (visits) out.visits = Math.floor(visits)

  return Object.keys(out).length ? out : undefined
}

/* ---------- 写操作（都返回新节点，不原地改） ---------- */

/** 合并一层 patch；patch 里的 undefined 表示「这一项不动」 */
export function withLearning(node: KnowledgeNode, patch: Partial<LearningState>): KnowledgeNode {
  const merged: LearningState = { ...(node.learning ?? {}) }
  for (const [k, v] of Object.entries(patch) as Array<[keyof LearningState, unknown]>) {
    if (v === undefined) continue
    ;(merged as Record<string, unknown>)[k] = v
  }
  return { ...node, learning: merged, updatedAt: Date.now() }
}

/**
 * 记一次错误。同一个 pattern 只累加次数并刷新 lastAt——**同一条错误反复出现**才是
 * 值得教学时针对的信号，记成十条一模一样的记录反而看不出来。
 *
 * cause 只在这次给了新的时才覆盖：旧成因往往比后来的补充更准。
 */
export function withMistake(
  node: KnowledgeNode,
  input: { pattern: string; cause?: string; count?: number },
): { node: KnowledgeNode; record: MistakeRecord; fresh: boolean } {
  const pattern = input.pattern.trim()
  const key = mistakeKey(pattern)
  const add = typeof input.count === 'number' && Number.isFinite(input.count) ? Math.max(1, Math.floor(input.count)) : 1
  const now = Date.now()
  const list = [...(node.learning?.mistakes ?? [])]
  const idx = list.findIndex((m) => mistakeKey(m.pattern) === key)
  if (idx >= 0) {
    const next: MistakeRecord = { ...list[idx], count: list[idx].count + add, lastAt: now }
    // 又犯了：之前标过的「已修复」作废——修复的判定只认最近这一次表现
    delete next.fixedAt
    if (input.cause?.trim()) next.cause = input.cause.trim().slice(0, 200)
    list[idx] = next
    return { node: withLearning(node, { mistakes: list }), record: next, fresh: false }
  }
  const record: MistakeRecord = {
    pattern: pattern.slice(0, 120),
    count: add,
    ...(input.cause?.trim() ? { cause: input.cause.trim().slice(0, 200) } : {}),
    firstAt: now,
    lastAt: now,
  }
  // 满了就淘汰「最久没再犯」的那条：它离当下最远，最不可能影响下一课
  const grown = [...list, record]
  const trimmed =
    grown.length > MAX_MISTAKES
      ? grown.filter((m) => m !== [...grown].sort((a, b) => a.lastAt - b.lastAt)[0])
      : grown
  return { node: withLearning(node, { mistakes: trimmed }), record, fresh: true }
}

/** 追加一次检验；超出上限时丢最旧的那条 */
export function withCheck(node: KnowledgeNode, check: CheckRecord): KnowledgeNode {
  const list = [...(node.learning?.checks ?? []), check].slice(-MAX_CHECKS)
  return withLearning(node, { checks: list })
}

/**
 * 记一次「打开过这个知识点」。
 *
 * 只在同一天里重复打开时不刷新（visits 照加）：lastStudiedAt 的用途是「多久没碰了」，
 * 精确到分钟没有意义，而每点一次节点都改一次时间戳会让 meta.json 一直重写。
 */
export function withVisit(node: KnowledgeNode, now: number): KnowledgeNode {
  const prev = node.learning?.lastStudiedAt ?? 0
  const sameDay = new Date(prev).toDateString() === new Date(now).toDateString()
  return withLearning(node, {
    lastStudiedAt: sameDay ? prev : now,
    visits: (node.learning?.visits ?? 0) + 1,
  })
}

/* ---------- 给人看的那几句话 ---------- */

export const MASTERY_UNKNOWN = '未评估'

/** 掌握度的写法：没评估过就说没评估，不要显示 0% */
export function masteryText(mastery: number | undefined): string {
  return typeof mastery === 'number' ? mastery + '%' : MASTERY_UNKNOWN
}

/** 自评的汉字写法（带上是谁给的） */
export function selfText(state: LearningState | undefined): string {
  if (!state?.self) return '（还没问过）'
  const who = state.selfBy === 'user' ? '你确认的' : '导师推断的'
  return '「' + SELF_REPORT_LABEL[state.self] + '」（' + who + '）'
}

/** 检验记录的一行摘要：时间 + 种类 + 结论 */
export function checkLine(c: CheckRecord): string {
  const when = new Date(c.at).toISOString().slice(0, 16).replace('T', ' ')
  const head = when + ' ' + t(CHECK_KIND_LABEL[c.kind])
  const bits: string[] = []
  if (typeof c.score === 'number') bits.push(t('{0} 分', c.score))
  if (c.mentioned?.length) bits.push(t('讲到 {0} 点', c.mentioned.length))
  if (c.missed?.length) bits.push(t('漏了 {0}', c.missed.join(t('、'))))
  if (c.misconceptions?.length) bits.push(t('说错了 {0}', c.misconceptions.join(t('、'))))
  if (c.note) bits.push(c.note)
  return head + (bits.length ? t('：') + bits.join(t('；')) : '')
}

/**
 * 一个节点的学习状态压成一行，给提示词与侧栏用。
 * 没有状态时回空串——调用方据此整行不显示，而不是显示一行「（无）」。
 */
export function learningLine(node: KnowledgeNode): string {
  const st = node.learning
  if (!st) return ''
  const bits: string[] = []
  if (typeof st.mastery === 'number') bits.push('掌握度 ' + st.mastery + '/100')
  if (st.self) bits.push('自评' + SELF_REPORT_LABEL[st.self] + (st.selfBy === 'user' ? '' : '（导师推断，未确认）'))
  if (st.mistakes?.length) {
    // 已修复的不再当薄弱项摆出来（复习里答对了就翻篇；记录本身还在，翻旧账时看得到）
    const top = st.mistakes
      .filter((m) => !m.fixedAt)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
    if (top.length) bits.push('错过的：' + top.map((m) => m.pattern + ' ×' + m.count).join('、'))
  }
  if (st.lastStudiedAt) bits.push('最近学习 ' + new Date(st.lastStudiedAt).toISOString().slice(0, 10))
  return bits.join('；')
}