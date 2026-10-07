/**
 * 长期记忆（沙箱里的 mind.*）：跨对话有效的判断与偏好，按**学习目标**归档。
 *
 * 边界写在最前面（也是需求明确的约束）：记忆**绝不**被拼进系统提示词或任何消息。
 * 系统提示词一字不变是前缀缓存命中的前提（见 learn/ai 的说明），把一份会增长的
 * 记忆塞进去，等于让上下文每一轮都漂移；更根本的是，记忆该由 agent 自己决定
 * 何时取用——它得先想起「我有记忆」这件事，教学才有连续性。
 *
 * 因此这里只提供读写，并把「什么时候该看一眼记忆」写进提示词（learn/ai 的
 * EXECUTE_GUIDE），数据本身永远不出现在 agent 没有主动请求的上下文里。
 *
 * 存储跟着 LearnStore 走（store.minds，state.json）：记忆是学习数据的一部分，
 * 与对话、试卷同生命周期；单目标条目有上限，防失控。
 */
import type { MindEntry, MindStore, LearnStore } from './types'
import type { MindOps } from '../agent/tools'

/** 每个目标最多留多少条：超过时挤掉最旧的——记忆是判断，不是日志 */
export const MIND_MAX_ENTRIES = 200
/** 单条正文上限：一条记忆说一件事，写不下的拆成几条 */
export const MIND_MAX_CHARS = 4_000

export const mindsOf = (store: LearnStore, goalId: string): MindEntry[] => store.minds?.[goalId] ?? []

/**
 * 写入（或覆盖）一条记忆，返回新的 store。
 * 给了 key 且已有同 key 条目时覆盖（同主题只有一条最新判断）；否则新建。
 */
export function writeMind(
  store: LearnStore,
  goalId: string,
  input: { key?: string; text: string },
): LearnStore {
  const text = input.text.trim().slice(0, MIND_MAX_CHARS)
  if (!text) return store
  const key = input.key?.trim().slice(0, 80) || undefined
  const list = mindsOf(store, goalId)
  const now = Date.now()
  const existing = key ? list.find((m) => m.key === key) : undefined
  let next: MindEntry[]
  if (existing) {
    next = list.map((m) => (m.id === existing.id ? { ...m, text, updatedAt: now } : m))
  } else {
    const entry: MindEntry = {
      id: crypto.randomUUID(),
      ...(key ? { key } : {}),
      text,
      createdAt: now,
      updatedAt: now,
    }
    next = [entry, ...list]
    if (next.length > MIND_MAX_ENTRIES) next = next.slice(0, MIND_MAX_ENTRIES)
  }
  return { ...store, minds: { ...(store.minds ?? {}), [goalId]: next } }
}

/** 删除一条（按 id 或 key）；没有目标条目时原样返回 */
export function deleteMind(store: LearnStore, goalId: string, idOrKey: string): LearnStore {
  const list = mindsOf(store, goalId)
  const next = list.filter((m) => m.id !== idOrKey && m.key !== idOrKey)
  if (next.length === list.length) return store
  return { ...store, minds: { ...(store.minds ?? {}), [goalId]: next } }
}

/**
 * 按覆盖写一条（记忆管理页的编辑用）：条目身份与 key 都不动，只换正文。
 *
 * 不走 writeMind——它按 key 认条目，没有 key 的条目会被它当成新增而非改写。
 */
export function updateMind(store: LearnStore, goalId: string, id: string, text: string): LearnStore {
  const clipped = text.trim().slice(0, MIND_MAX_CHARS)
  if (!clipped) return store
  const list = mindsOf(store, goalId)
  if (!list.some((m) => m.id === id)) return store
  const next = list.map((m) => (m.id === id ? { ...m, text: clipped, updatedAt: Date.now() } : m))
  return { ...store, minds: { ...(store.minds ?? {}), [goalId]: next } }
}

/** 清空一个目标的全部记忆 */
export function clearMinds(store: LearnStore, goalId: string): LearnStore {
  if (!mindsOf(store, goalId).length) return store
  return { ...store, minds: { ...(store.minds ?? {}), [goalId]: [] } }
}

/** 给模型看的时间：到分钟为止，够认出先后即可 */
const stamp = (ts: number): string => new Date(ts).toISOString().slice(0, 16).replace('T', ' ')

/** 把一个条目翻成回执（read/list 共用；read 带全文，list 只带摘要） */
const viewOf = (m: MindEntry, full: boolean): Record<string, unknown> => ({
  id: m.id,
  ...(m.key ? { key: m.key } : {}),
  ...(full ? { text: m.text } : { excerpt: m.text.length > 120 ? m.text.slice(0, 120) + '…' : m.text }),
  chars: m.text.length,
  updatedAt: stamp(m.updatedAt),
})

export interface MindDeps {
  getLatest: () => LearnStore
  set: (store: LearnStore) => void
  goalId: () => string
}

/** 装配出沙箱要的那一组（SandboxOptions.mind）；失败用 { error }，成功回普通对象 */
export function createMindOps(deps: MindDeps): MindOps {
  const goal = (): string => deps.goalId()

  return {
    list: () => {
      const list = mindsOf(deps.getLatest(), goal())
      return {
        count: list.length,
        note: list.length
          ? '记忆不会自动出现在上下文里：需要时用 mind.read(id) 读全文。'
          : '这个目标还没有任何记忆。值得长期记住的判断与偏好（学习者的习惯、已定下的约定）用 mind.write 存下来。',
        items: list.map((m) => viewOf(m, false)),
      }
    },

    read: (idOrKey) => {
      if (!idOrKey) return { error: '要给出要读的 id 或 key；先用 mind.list() 看有哪些' }
      const m = mindsOf(deps.getLatest(), goal()).find((x) => x.id === idOrKey || x.key === idOrKey)
      if (!m) return { error: '没有这条记忆（id 或 key 对不上）：' + idOrKey + '。用 mind.list() 核对。' }
      return viewOf(m, true)
    },

    write: (input) => {
      const src = typeof input === 'string' ? { text: input } : (input ?? {})
      const record = (src && typeof src === 'object' ? src : {}) as { key?: unknown; text?: unknown }
      const text = typeof record.text === 'string' ? record.text : ''
      if (!text.trim()) {
        return { error: 'mind.write 需要 text（要记住的内容）；写成 mind.write({ key?, text }) 或 mind.write(\'内容\')' }
      }
      const key = typeof record.key === 'string' ? record.key : undefined
      const before = mindsOf(deps.getLatest(), goal())
      deps.set(writeMind(deps.getLatest(), goal(), { text, ...(key ? { key } : {}) }))
      const after = mindsOf(deps.getLatest(), goal())
      const hit = key ? before.find((m) => m.key === key) : undefined
      return {
        ok: true,
        count: after.length,
        note: hit
          ? '已覆盖同 key 的旧记忆「' + hit.key + '」（同主题只留最新判断）。'
          : '已记下（共 ' + after.length + ' 条）。一条记忆一个主题，别把不同的事堆进同一条。',
      }
    },

    delete: (idOrKey) => {
      if (!idOrKey) return { error: '要给出要删的 id 或 key' }
      const before = mindsOf(deps.getLatest(), goal())
      const hit = before.find((m) => m.id === idOrKey || m.key === idOrKey)
      if (!hit) {
        return { error: '没有这条记忆：' + idOrKey + '。用 mind.list() 核对。' }
      }
      deps.set(deleteMind(deps.getLatest(), goal(), idOrKey))
      return { ok: true, deleted: hit.key ?? hit.id }
    },

    clear: () => {
      const count = mindsOf(deps.getLatest(), goal()).length
      deps.set(clearMinds(deps.getLatest(), goal()))
      return { ok: true, removed: count, note: count ? '已清空。' : '本来就没有记忆。' }
    },
  }
}

/** 空的 MindStore（emptyLearnStore 用；旧数据没有 minds 字段，读侧一律 ?? [] 兜底） */
export const emptyMindStore = (): MindStore => ({})
