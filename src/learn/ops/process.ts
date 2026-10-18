/**
 * 学习过程那一组 ops 的宿主实现：阅读事实、注意力、上下文压缩、番茄钟。
 *
 * 从 learn/agentOps 拆出来（见 docs/refactor-plan.md 3.5）：它们都是「读事实 / 写账本」的
 * 纯 store 逻辑，与文档、资源那几组没有耦合，所以合成一处。
 */

import type { AttentionOps, CompactOps, PomodoroOps, ReadingOps } from '../../agent/tools'
import type { AgentOpsDeps } from './deps'
import type { LearnStore } from '../types'
import { nodeById } from '../graph'
import { resolveNode, type PathScope } from '../paths'
import {
  SECTION_REACHED,
  readingDay,
  readingIndex,
  readingLine,
  readingOf,
  readingOfGoal,
  sessionsOf,
  studyDayOf,
  type SectionRead,
} from '../reading'
import { ATTENTION_LABEL, attentionOf } from '../attention'
import { buildSummary } from '../compact'
import { formatClock, pomodoroDays, pomodoroStatus, restMsOf } from '../pomodoro'

/* ---------- reading / attention / pomodoro：学习过程那一组 ---------- */

/** 回给模型的时间：ISO 前 16 位够读，也不用它解析毫秒 */
const stampOf = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

/** 毫秒 → 「x 分钟」（给模型看的都是分钟级，秒没有意义） */
const minutesOf = (ms: number): number => Math.round(ms / 60_000)

/**
 * reading.*：有效阅读的**事实**。
 *
 * 一条口径要写进返回值里（否则模型会把 reach=0.3 当成「读了一点」）：
 * reach 是「这一节进入过视口的比例」，0.6 以上才算读到；ms 是摊到这一节的有效毫秒。
 */
export function createReadingOps(deps: AgentOpsDeps): ReadingOps {
  const scope = (): PathScope => ({ goalId: deps.goalId(), currentNodeId: deps.nodeId() })
  const titleOf = (nodeId: string): string | undefined => nodeById(deps.getLatest(), nodeId)?.title
  const sectionView = (s: SectionRead) => ({
    section: s.text,
    read: s.reach >= SECTION_REACHED,
    reach: s.reach,
    minutes: minutesOf(s.ms),
    ...(s.marks.length ? { marks: s.marks } : {}),
    ...(s.fuzzy ? { note: '正文里的标题后来被改写过，这一节是按位置认领的' } : {}),
  })

  return {
    get: (path) => {
      const store = deps.getLatest()
      const target = path ? null : deps.nodeId()
      const node = path
        ? (() => {
            const r = resolveNode(store, scope(), path)
            return r.ok ? r.value : null
          })()
        : target
          ? nodeById(store, target)
          : null
      const nodeId = node?.id ?? ''
      // 阅读账按目标分开（见 learn/reading 的 ReadingBook）：读的永远是**这个节点所属目标**那一本
      const rec = nodeId ? readingOf(readingOfGoal(store.reading, node?.goalId ?? ''), nodeId) : undefined
      if (!rec) {
        return {
          node: node?.title ?? '',
          reading: '还没有阅读记录（这份文档一次都没被有效读过）',
          note: '没记录与「读了 0 秒」是两件事：前者是根本没打开过。',
        }
      }
      const docs = Object.entries(rec.docs).map(([doc, d]) => ({
        doc,
        activeMinutes: minutesOf(d.activeMs),
        done: !!d.doneAt,
        ...(d.words ? { words: d.words } : {}),
        sections: d.sections.slice(0, 40).map(sectionView),
      }))
      const main = rec.docs.teaching
      return {
        node: node?.title ?? '',
        activeMinutes: minutesOf(rec.activeMs),
        opens: rec.opens,
        lastAt: stampOf(rec.lastAt),
        line: readingLine(rec),
        docs,
        unread: (main?.sections ?? []).filter((s) => s.reach < SECTION_REACHED).map((s) => s.text),
        note: 'unread 是还没读到的节；reach 到 ' + SECTION_REACHED + ' 才算读到。',
      }
    },
    list: () => {
      const store = deps.getLatest()
      const goalId = deps.goalId()
      const ids = store.nodes.filter((n) => n.goalId === goalId).map((n) => n.id)
      const rows = readingIndex(readingOfGoal(store.reading, goalId), titleOf, ids).map((r) => ({
        nodeId: r.nodeId,
        node: r.title,
        activeMinutes: minutesOf(r.activeMs),
        lastAt: stampOf(r.lastAt),
        opens: r.opens,
        docs: r.docs.map((d) => ({ doc: d.doc, read: d.read + '/' + d.total, done: d.done, minutes: minutesOf(d.activeMs) })),
        unread: r.unread.slice(0, 12),
      }))
      if (!rows.length) return { nodes: [], note: '当前目标还没有任何阅读记录' }
      return { nodes: rows, note: '按最后阅读时间从近到远；unread 是教学文档里还没读到的节。' }
    },
    day: (day) => {
      const now = Date.now()
      const key = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : studyDayOf(now)
      const store = deps.getLatest()
      // 这一天说的是**当前目标**：阅读账按目标分开（见 learn/reading 的 ReadingBook）
      const book = readingOfGoal(store.reading, deps.goalId())
      const summary = readingDay(book, key)
      const sessions = sessionsOf(book, { since: now - 86_400_000 })
        .filter((s) => s.day === key)
        .map((s) => ({
          nodeId: s.nodeId,
          node: titleOf(s.nodeId) ?? s.nodeId,
          doc: s.doc,
          minutes: minutesOf(s.activeMs),
          from: stampOf(s.from),
          to: stampOf(s.to),
          sections: s.sections.filter((x) => x.reach >= SECTION_REACHED).map((x) => x.text).slice(0, 20),
          breaks: s.breaks.length,
        }))
      return {
        day: key,
        activeMinutes: minutesOf(summary?.activeMs ?? 0),
        marks: summary?.marks ?? 0,
        nodes: (summary?.nodes ?? []).map((id) => ({ nodeId: id, node: titleOf(id) ?? id })),
        sessions,
        note: '只算当前这个目标的阅读；学习日从凌晨四点算起（23:40 学的那半小时属于前一天）。',
      }
    },
  }
}

/** attention.get：把事实折成档位 + 事实句 + 建议（派生结果，可随时重算） */
export function createAttentionOps(deps: AgentOpsDeps): AttentionOps {
  return {
    get: (path) => {
      const store = deps.getLatest()
      let nodeId: string | undefined
      if (path) {
        const r = resolveNode(store, { goalId: deps.goalId(), currentNodeId: deps.nodeId() }, path)
        if (r.ok) nodeId = r.value.id
      } else if (deps.nodeId()) {
        nodeId = deps.nodeId() ?? undefined
      }
      // 注意力也只看**当前目标**这一本账：跨目标的会话节奏混在一起，评出来的不是任何一门课
      const a = attentionOf(readingOfGoal(store.reading, deps.goalId()), nodeId ? { nodeId } : {})
      return {
        scope: nodeId ? titleOf2(store, nodeId) : '整体（所有节点）',
        level: a.level,
        levelLabel: ATTENTION_LABEL[a.level],
        confidence: a.confidence,
        dims: {
          breaksPer10Min: a.dims.fragmentation,
          longestStretchMinutes: minutesOf(a.dims.continuityMs),
          charsPerSecond: a.dims.pace,
          marksPer10Min: a.dims.depth,
          decay: a.dims.decay,
          stallsPer10Min: a.dims.stalls,
        },
        line: a.line,
        advice: a.advice,
        focusMinutes: a.focusMinutes,
        sample: { sessions: a.sessions, minutes: minutesOf(a.sampleMs) },
        note:
          a.confidence === 'low'
            ? '样本还少，档位不可当真：只用 line 里的事实，专注块先按 25 分钟。'
            : '静默（stalls）是停表不是走神，多半说明那一段难；只有 breaks 才算被打断。',
      }
    },
  }
}

const titleOf2 = (store: LearnStore, nodeId: string): string => nodeById(store, nodeId)?.title ?? nodeId

/**
 * compact：把交接摘要写进当前目标的会话（见 learn/compact）。
 *
 * 只做两件事：校验成形（buildSummary）与写进 store。**应用不在这里**——
 * 「旧消息失活 + 摘要成为第一条消息」必须等本轮 loop 结束（useAgent 的 finally 里调
 * applyCompaction），否则正在跑的这一轮上下文会被从底下抽走。
 *
 * 会话按目标取：目标级上下文保证了一个目标只有一段对话（见 agent/types 的 Conversation）。
 */
export function createCompactOps(deps: AgentOpsDeps): CompactOps {
  return {
    write: (input) => {
      const store = deps.getLatest()
      const conv = store.conversations.find((c) => c.goalId === deps.goalId())
      if (!conv) return { error: '这一段对话还没落盘（没有会话可压）' }
      const out = buildSummary(input)
      if (!out.ok) return { error: out.error }
      const next = { ...conv, summary: out.summary, updatedAt: Date.now() }
      deps.set({ ...store, conversations: store.conversations.map((c) => (c.id === conv.id ? next : c)) })
      return {
        ok: true,
        at: stampOf(out.summary.at),
        tasks: out.summary.tasks.length,
        chars: out.summary.text.length,
        note:
          '摘要已记下。**本轮结束后**才生效：到那时这段对话里之前的消息全部失活，' +
          '只有这份摘要（与之后的新消息）继续进上下文。不要重复调用 compact，也不要把摘要复述给用户。',
      }
    },
  }
}

/**
 * pomodoro.*：**只读**。
 *
 * 需求定的边界：番茄钟是用户自己的计时器——一段多长、做几组、什么时候停，
 * 全在他顶栏那颗按钮上。agent 连「排计划」都没有了，能看的只有记录。
 * 所以这里只有一个 status，而且它不改 store（deps.set 一次都不调）。
 */
export function createPomodoroOps(deps: AgentOpsDeps): PomodoroOps {
  return {
    status: () => {
      const store = deps.getLatest()
      const now = Date.now()
      const s = pomodoroStatus(store, now)
      const cur = s.session
      return {
        running: cur
          ? {
              phase: cur.phase === 'focus' ? '专注' : '休息',
              round: cur.index + '/' + cur.groups,
              focusMinutes: cur.focusMinutes,
              restMinutes: Math.round(restMsOf(cur.focusMinutes) / 60_000),
              remaining: formatClock(s.remainingMs ?? 0),
              startedAt: stampOf(cur.startedAt),
            }
          : null,
        today: { rounds: s.todayRounds, minutes: s.todayMinutes },
        days: pomodoroDays(store, now, 7),
        recent: (store.pomodoro?.log ?? []).slice(0, 10).map((r) => ({
          at: stampOf(r.at),
          minutes: r.minutes,
          round: r.index + '/' + r.groups,
        })),
        note: '番茄钟是用户自己按的计时器（只读）：开始、停止、改时长都在他那边，没有对应的 api。',
      }
    },
  }
}

