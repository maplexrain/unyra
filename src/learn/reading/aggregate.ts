/** 这个文件负责：阅读账的写入侧——一次结算怎么累到节 / 文档 / 节点 / 日上，明细怎么清理、记录怎么搬迁，以及热身与「今天读过」两道门槛。 */

import { matchSections, studyDayOf } from './anchor'
import { DOC_DONE_MS, DOC_DONE_REACH, MAX_DAYS, MAX_SESSIONS_PER_NODE, MAX_SESSIONS_TOTAL, WARMUP_MS } from './constants'
import type { DocReading, MarkKind, MinuteTick, NodeReading, ReadingBook, ReadingDelta, ReadingSession, ReadingStore, SectionRead } from './types'

/** 某个目标的阅读账；没有就是 undefined（读的地方一律按 `?? emptyReading()` 兜底） */
export function readingOfGoal(book: ReadingBook | undefined, goalId: string): ReadingStore | undefined {
  return goalId ? book?.byGoal?.[goalId] : undefined
}

/** 写回某个目标的那一份（其它目标原样不动） */
export function withGoalReading(book: ReadingBook | undefined, goalId: string, next: ReadingStore): ReadingBook {
  return { byGoal: { ...(book?.byGoal ?? {}), [goalId]: next } }
}

export function emptyReading(): ReadingStore {
  return { version: 1, sessions: [], nodes: {}, days: {} }
}

/**
 * 应用一次结算增量。纯函数：同一个 delta 应用两次会算两遍，所以调用方只许在
 * 「真的结算了」那一刻调一次（tracker 结算后立刻清空自己的缓冲）。
 */
export function applyReadingDelta(store: ReadingStore, delta: ReadingDelta): ReadingStore {
  if (!delta.nodeId || delta.activeMs <= 0 && !delta.sections.length && !delta.opens) return store
  const now = delta.at
  const sessions = mergeSession(store.sessions, delta)
  const nodes = { ...store.nodes }
  const prev = nodes[delta.nodeId]
  const docPrev = prev?.docs[delta.doc]

  // 逐节累加：ms 相加、reach 取最大、marks 取并集
  const merged = mergeDocSections(docPrev, delta.sections, now)
  const doc: DocReading = {
    sections: merged,
    activeMs: (docPrev?.activeMs ?? 0) + delta.activeMs,
    words: delta.words ?? docPrev?.words,
    doneAt: docPrev?.doneAt,
  }
  // 读完判定：每一节都读到过，且总时长过了下限
  if (!doc.doneAt && doc.sections.length && doc.activeMs >= DOC_DONE_MS) {
    const all = doc.sections.every((s) => s.reach >= DOC_DONE_REACH)
    if (all) doc.doneAt = now
  }

  nodes[delta.nodeId] = {
    docs: { ...(prev?.docs ?? {}), [delta.doc]: doc },
    activeMs: (prev?.activeMs ?? 0) + delta.activeMs,
    firstAt: prev?.firstAt && prev.firstAt > 0 ? prev.firstAt : now,
    lastAt: now,
    opens: (prev?.opens ?? 0) + (delta.opens ?? 0),
  }

  const days = { ...store.days }
  const dayPrev = days[delta.day]
  const marks = delta.sections.reduce((n, s) => n + s.marks.length, 0)
  const nodesOfDay = dayPrev?.nodes ?? []
  days[delta.day] = {
    day: delta.day,
    activeMs: (dayPrev?.activeMs ?? 0) + delta.activeMs,
    nodes: nodesOfDay.includes(delta.nodeId) ? nodesOfDay : [...nodesOfDay, delta.nodeId],
    marks: (dayPrev?.marks ?? 0) + marks,
  }

  return compactReading({ version: store.version, sessions, nodes, days })
}

function mergeSession(sessions: ReadingSession[], delta: ReadingDelta): ReadingSession[] {
  const at = sessions.findIndex((s) => s.id === delta.sessionId)
  if (at < 0) {
    const created: ReadingSession = {
      id: delta.sessionId,
      nodeId: delta.nodeId,
      doc: delta.doc,
      day: delta.day,
      from: delta.at,
      to: delta.at,
      activeMs: delta.activeMs,
      minutes: padMinutes(delta.minuteIndex, delta.minutes),
      breaks: [...delta.breaks],
      sections: delta.sections.map((s) => ({ ...s })),
      ...(delta.planId ? { planId: delta.planId } : {}),
    }
    return [created, ...sessions]
  }
  const prev = sessions[at]
  const minutes = [...prev.minutes]
  delta.minutes.forEach((t, i) => {
    const idx = delta.minuteIndex + i
    const base = minutes[idx] ?? { ms: 0, chars: 0, marks: 0, gaps: 0 }
    minutes[idx] = {
      ms: base.ms + t.ms,
      chars: base.chars + t.chars,
      marks: base.marks + t.marks,
      gaps: base.gaps + t.gaps,
    }
  })
  const next: ReadingSession = {
    ...prev,
    to: delta.at,
    activeMs: prev.activeMs + delta.activeMs,
    minutes,
    breaks: [...prev.breaks, ...delta.breaks].slice(-60),
    sections: mergeSectionList(prev.sections, delta.sections, delta.at),
  }
  const out = [...sessions]
  out[at] = next
  return out
}

function padMinutes(index: number, ticks: MinuteTick[]): MinuteTick[] {
  const out: MinuteTick[] = []
  for (let i = 0; i < index; i += 1) out.push({ ms: 0, chars: 0, marks: 0, gaps: 0 })
  return [...out, ...ticks.map((t) => ({ ...t }))]
}

/** 记录里的节与增量节合并（认领规则见 matchSections：精确 → 去编号 → 位置最近） */
function mergeDocSections(prev: DocReading | undefined, incoming: SectionRead[], now: number): SectionRead[] {
  const old = prev?.sections ?? []
  const claims = matchSections(old, incoming)
  const out: SectionRead[] = []
  const seen = new Set<string>()

  // 先按增量里的顺序把「这一版文档」的节排出来（它带着最新的 index/level/text）
  claims.forEach((claim, i) => {
    const inc = incoming[i]
    seen.add(inc.key)
    out.push(mergeOne(claim.prev, inc, now, claim.fuzzy))
  })
  // 记录里有、这一版文档没有的节：留着（文档被删节又加回来是常事），排在后面
  for (const s of old) {
    if (seen.has(s.key)) continue
    seen.add(s.key)
    out.push(s)
  }
  return out
}

function mergeOne(before: SectionRead | undefined, inc: SectionRead, now: number, fuzzy = false): SectionRead {
  if (!before) {
    return {
      ...inc,
      ms: inc.ms,
      reach: inc.reach,
      marks: [...inc.marks],
      firstAt: inc.ms > 0 || inc.reach > 0 ? now : inc.firstAt,
      lastAt: now,
    }
  }
  const marks = Array.from(new Set([...before.marks, ...inc.marks])) as MarkKind[]
  return {
    ...before,
    text: inc.text || before.text,
    index: inc.index,
    level: inc.level,
    ms: before.ms + inc.ms,
    reach: Math.max(before.reach, inc.reach),
    marks,
    firstAt: before.firstAt || (inc.ms > 0 || inc.reach > 0 ? now : 0),
    lastAt: now,
    ...(inc.fuzzy || fuzzy ? { fuzzy: true } : {}),
  }
}

/** 会话内部的节列表合并（同一场会话里文档被改写时会走到） */
function mergeSectionList(prev: SectionRead[], incoming: SectionRead[], now: number): SectionRead[] {
  return mergeDocSections({ sections: prev, activeMs: 0 }, incoming, now)
}

/**
 * 明细有界：超出的最旧会话直接丢——它们的时长与覆盖早就累进 nodes/days 里了。
 * 学习日索引只留最近 MAX_DAYS 天。
 */
export function compactReading(store: ReadingStore): ReadingStore {
  let sessions = store.sessions
  if (sessions.length > MAX_SESSIONS_TOTAL) sessions = sessions.slice(0, MAX_SESSIONS_TOTAL)
  const perNode = new Map<string, number>()
  const kept: ReadingSession[] = []
  for (const s of sessions) {
    const n = (perNode.get(s.nodeId) ?? 0) + 1
    perNode.set(s.nodeId, n)
    if (n > MAX_SESSIONS_PER_NODE) continue
    kept.push(s)
  }
  const days = Object.keys(store.days)
  let nextDays = store.days
  if (days.length > MAX_DAYS) {
    nextDays = {}
    for (const d of days.sort().slice(-MAX_DAYS)) nextDays[d] = store.days[d]
  }
  return { version: store.version, sessions: kept, nodes: store.nodes, days: nextDays }
}

/**
 * 丢掉「节点已经不在了」的阅读记录。
 *
 * 记录全按 nodeId 索引（nodes / sessions[].nodeId / days[].nodes），节点一删，这些索引
 * 就指向不存在的东西——**空索引**。它不是无害的残留：今日阅读面板里会冒出一行标题是
 * uuid、点不动的条目，agent 的 reading.list 也照报一串 uuid，分节点统计里还挂着它。
 * 所以一旦发现，就连带那条记录一起删掉（用户定的规矩）。
 *
 * 两处调用：删节点/删目标的那一刻（graph），以及每次读盘之后（store）——后者保证
 * 以前删出来的空索引在下次启动时被清干净，也兜住「删节点那一刻采集器正好在结算」这种竞态。
 *
 * **学习日的总时长与印记不动**：那是「今天读了多久」的账，时间是真花掉的，不该因为后来
 * 删了个节点就缩水（打卡资格也算在它上面）；而且 per-day per-node 的时长没有单独存过，
 * 也没有可靠的减法可做。删的只是「这一天读过哪些节点」里已经不在了的那几项。
 */
export function pruneReading(reading: ReadingStore, alive: Set<string>): ReadingStore {
  const nodes: Record<string, NodeReading> = {}
  let changed = false
  for (const [id, rec] of Object.entries(reading.nodes)) {
    if (alive.has(id)) nodes[id] = rec
    else changed = true
  }
  const sessions = reading.sessions.some((s) => !alive.has(s.nodeId))
    ? reading.sessions.filter((s) => alive.has(s.nodeId))
    : reading.sessions
  if (sessions !== reading.sessions) changed = true
  let days = reading.days
  for (const [day, d] of Object.entries(reading.days)) {
    if (!d.nodes.some((id) => !alive.has(id))) continue
    if (days === reading.days) days = { ...reading.days }
    days[day] = { ...d, nodes: d.nodes.filter((id) => alive.has(id)) }
    changed = true
  }
  // 一条空索引都没有时原样返回：调用方可以拿对象身份判断「这次有没有东西被清掉」
  return changed ? { ...reading, nodes, sessions, days } : reading
}

/**
 * 丢掉某一**份文档**的阅读记录（一份笔记 / 超级文档被删掉时用）。
 *
 * 与 pruneReading 同一个道理，粒度小一号：节点还在，只是它下面少了一份文档，那份记录
 * （`note:名字` / `sdoc:名字`）就再也没人认领了——「今天读过这份笔记」当场变成没读过，
 * 计划与 agent 的 reading.get 里也会挂着一条指向不存在文档的分支。
 *
 * **节点那条记录留着**：它的时长、打开次数是这个节点的真实经历，不因为一份笔记被删就不算数。
 */
export function pruneDocReading(reading: ReadingStore, nodeId: string, doc: string): ReadingStore {
  const rec = reading.nodes[nodeId]
  if (!rec || !rec.docs[doc]) return reading
  const docs = { ...rec.docs }
  delete docs[doc]
  return { ...reading, nodes: { ...reading.nodes, [nodeId]: { ...rec, docs } } }
}

/**
 * 把一份文档的记录搬到新名字下（笔记改名时用）。
 *
 * 与页签、暂存区同一条规矩（见 graph 的 renameNoteFile）：名字就是这份笔记的身份，
 * 名字换了而记录没换，那条记录就成了孤儿。这里**搬**而不是删——它记的是同一份文档。
 */
export function moveDocReading(
  reading: ReadingStore,
  nodeId: string,
  from: string,
  to: string,
  at: number,
): ReadingStore {
  const rec = reading.nodes[nodeId]
  const doc = rec?.docs[from]
  if (!rec || !doc || !to || from === to) return reading
  const docs = { ...rec.docs }
  delete docs[from]
  // 新名字下已经有一条（删过同名笔记留下的旧记录）：并起来，两边都不丢
  const prev = docs[to]
  docs[to] = prev ? mergedDoc(prev, doc, at) : doc
  return { ...reading, nodes: { ...reading.nodes, [nodeId]: { ...rec, docs } } }
}

/** 同一份文档的两条记录合成一条：时长相加、节按认领规则合并、读完时间留先到的那个 */
function mergedDoc(a: DocReading, b: DocReading, at: number): DocReading {
  return {
    sections: mergeDocSections(a, b.sections, at),
    activeMs: a.activeMs + b.activeMs,
    words: b.words ?? a.words,
    doneAt: a.doneAt ?? b.doneAt,
  }
}

/**
 * 这个标签页（节点 + 那一份文档）今天有没有阅读记录。
 *
 * 它是热身门槛的另一半：**今天已经读过的东西，再打开就直接算**——门槛防的是
 * 「顺手划过去」，不是「回来接着读」。查两处：今天的会话明细，以及这份文档最后
 * 一次被读到的时间戳（明细有上限，可能已经滚掉了，而 lastAt 会留下来）。
 */
export function readToday(
  store: ReadingStore | undefined,
  nodeId: string,
  doc: string,
  now = Date.now(),
): boolean {
  const day = studyDayOf(now)
  const sessions = store?.sessions ?? []
  if (sessions.some((s) => s.day === day && s.nodeId === nodeId && s.doc === doc)) return true
  const rec = store?.nodes[nodeId]?.docs[doc]
  return !!rec && rec.activeMs > 0 && studyDayOf(rec.sections[0]?.lastAt || store?.nodes[nodeId]?.lastAt || 0) === day
}

/**
 * 热身过了没有：今天没读过的东西，要**动过**且**读够 WARMUP_MS** 才开始算数。
 *
 * 注意它是「门槛」不是「折扣」：过了之后这段时间照常计入（不是从过线那一刻才开始算）。
 * 低于门槛则一秒都不记——那正是「看一眼就走」该有的待遇。
 */
export function warmupDone(input: { knownToday: boolean; interacted: boolean; activeMs: number }): boolean {
  return input.knownToday || (input.interacted && input.activeMs > WARMUP_MS)
}
