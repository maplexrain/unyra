/**
 * 阅读记录的秒级落盘（崩溃兜底）。
 *
 * 采集器的节奏是「1 秒心跳累加 → 30 秒结算 → 500ms 防抖落盘」。正常离开都有兜底：
 * 切文档 / 切页签 / 关窗都会补一次结算，关窗还有同步落盘（见 useReadingTracker 与
 * useLearnStore）。但**进程被强杀、断电、崩溃**时，最后那一段还没结算的读数只在内存里，
 * 会整段丢掉——最多 30 秒。
 *
 * 所以这里加一条旁路：把「还没确认落盘的东西」每秒写进一个很小的文件（几百字节），
 * 下次启动折回 store。为什么不干脆每秒结算一次：结算是把整个 store 重新摊平、比对、
 * 再写盘（不只是 state.json，还有全部文档的差分），一秒一次等于拿十几毫秒 CPU 换一秒钟的
 * 数据安全；而这个旁路文件只写当前这一小段。
 *
 * 文件里按 sessionId 分条，每条两样东西：
 * - **live**：还没结算的那一段——它**从来没有进过 store**，折回去一定不会算两遍；
 * - **chunks**：已经交给 store、但可能还没落盘的那几段（结算时间 + 那份增量）。
 *   结算与落盘之间有 500ms 防抖窗口，崩在这儿的话 store 里那份改动同样只在内存里。
 *
 * 折叠规则（启动时跑一次，见 learn/store.ts 的 hydrateLearnStore）：
 * - live 一律折；
 * - chunk 只在「比 store 里那次会话的最后更新时间（session.to）还新」时折——
 *   否则说明它已经落过盘了，再折一遍就是算两遍。这一步不需要另外记「上次落盘是什么时候」，
 *   会话记录里的 to 每次结算都会被写成结算时刻。
 * 折完把文件删掉：同一份数据不该折第二次。
 *
 * 全是纯函数，规则可以单独验（见 tests/readingJournal.test.ts）。
 */
import { applyReadingDelta, type ReadingDelta, type ReadingStore } from './reading'

export const JOURNAL_FILE = 'reading-tick.json'
/** 文件版本：结构变了就换号，老文件按「读不懂就当没有」处理 */
export const JOURNAL_VERSION = 1
/** 一个会话最多留几段没确认的增量（结算到落盘之间最多一两段，留几段只是保险） */
export const MAX_CHUNKS = 4
/** 文件里最多留几个会话：旧的那些几乎肯定已经落盘，留着只是让文件变大 */
export const MAX_ENTRIES = 8

export interface JournalChunk {
  /** 结算时刻：与 store 里 session.to 比大小，判断它落盘了没有 */
  at: number
  delta: ReadingDelta
}

export interface JournalEntry {
  sessionId: string
  day: string
  nodeId: string
  doc: string
  /** 还没结算的那一段；没有就是 null */
  live: ReadingDelta | null
  /** 已交给 store、还等落盘的几段（按时间先后） */
  chunks: JournalChunk[]
}

export interface ReadingJournal {
  version: number
  entries: JournalEntry[]
}

export function emptyJournal(): ReadingJournal {
  return { version: JOURNAL_VERSION, entries: [] }
}

/**
 * 读进来的东西一律当不可信：这个文件是崩溃兜底，写它的时候进程可能正好被杀，
 * 半截 JSON 是常态。读不懂就当作没有——为了一个兜底文件把应用卡在启动上是本末倒置。
 */
export function parseJournal(raw: unknown): ReadingJournal {
  if (!raw || typeof raw !== 'object') return emptyJournal()
  const obj = raw as { version?: unknown; entries?: unknown }
  if (obj.version !== JOURNAL_VERSION || !Array.isArray(obj.entries)) return emptyJournal()
  const entries: JournalEntry[] = []
  for (const item of obj.entries) {
    const e = item as Partial<JournalEntry>
    if (!e || typeof e.sessionId !== 'string' || !e.sessionId) continue
    const live = isDelta(e.live) ? e.live : null
    const chunks: JournalChunk[] = []
    if (Array.isArray(e.chunks)) {
      for (const c of e.chunks) {
        const chunk = c as Partial<JournalChunk>
        if (chunk && typeof chunk.at === 'number' && isDelta(chunk.delta)) {
          chunks.push({ at: chunk.at, delta: chunk.delta })
        }
      }
    }
    if (!live && !chunks.length) continue
    entries.push({
      sessionId: e.sessionId,
      day: typeof e.day === 'string' ? e.day : '',
      nodeId: typeof e.nodeId === 'string' ? e.nodeId : '',
      doc: typeof e.doc === 'string' ? e.doc : '',
      live,
      chunks: chunks.slice(-MAX_CHUNKS),
    })
  }
  return { version: JOURNAL_VERSION, entries: entries.slice(-MAX_ENTRIES) }
}

/** 形状够不够用（不做逐字段校验：折回去时 applyReadingDelta 自己会挡掉空增量） */
function isDelta(v: unknown): v is ReadingDelta {
  if (!v || typeof v !== 'object') return false
  const d = v as Partial<ReadingDelta>
  return typeof d.nodeId === 'string' && typeof d.doc === 'string' && typeof d.at === 'number'
}

export function journalEmpty(journal: ReadingJournal): boolean {
  return !journal.entries.some((e) => e.live || e.chunks.length)
}

/** 换掉同一个 sessionId 的那一条（没有就加），并裁掉过老的会话 */
export function upsertEntry(journal: ReadingJournal, entry: JournalEntry): ReadingJournal {
  const rest = journal.entries.filter((e) => e.sessionId !== entry.sessionId)
  return { version: JOURNAL_VERSION, entries: [...rest, entry].slice(-MAX_ENTRIES) }
}

/**
 * 把旁路里的东西折回记录。
 *
 * 关键在于**只折 store 里还没有的**：live 永远没有（它没结算过），chunk 则要跟那次会话的
 * to 比一比——比它旧就说明已经落过盘了。
 */
export function foldJournal(reading: ReadingStore, journal: ReadingJournal): ReadingStore {
  let out = reading
  for (const entry of journal.entries) {
    for (const chunk of entry.chunks) {
      const seenTo = out.sessions.find((s) => s.id === entry.sessionId)?.to ?? 0
      if (chunk.at <= seenTo) continue
      out = applyReadingDelta(out, chunk.delta)
    }
    if (entry.live) out = applyReadingDelta(out, entry.live)
  }
  return out
}
