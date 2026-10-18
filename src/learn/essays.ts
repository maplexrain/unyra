/**
 * 随笔：**目标级**的随手记——没有标题、不按节点归属、按日期归堆的一条条短文本。
 *
 * 与笔记的区别（见 learn/notes）：笔记是**某个节点的文档**，有名字、进文档树、要保存；
 * 随笔是「学着学着脑子里冒出来的一句话」，随手写、随手翻，不占文档区的页签。
 * 因此它不挂在任何节点上，只挂在目标上——「这门课我随手记过什么」。
 *
 * 为什么没有「新建」：随笔的粒度小到不值得一次确认。窗口一开就是一个空编辑器，
 * 写下第一个字的那一刻它就成了一条（见 components/learn/essay 的说明），
 * 清空之后再写就是下一条。空文本永远不落盘，所以也不会出现「一条空白随笔」。
 *
 * 落盘：`{目标}/essay.json`（与 method.json / workflow.json / reading.json 同一层、
 * 同一条纪律——这个目标一条都没有就不写这个文件）。目标是它的生命周期：
 * 删掉目标，随笔跟着一起没。
 */

import type { EssayDockRect, EssayEntry, EssayStore, LearnStore } from './types'

/** 单条随笔的字符上限：随笔是「一句话/一小段」，不是文档。超了按上限截断而不是拒绝 */
export const ESSAY_TEXT_MAX = 20_000

/** 这个目标的随笔：**新的在前**（列表与「最近一条」都靠这个顺序） */
export function essaysOf(store: LearnStore, goalId: string): EssayEntry[] {
  return store.essays?.[goalId] ?? []
}

/** 按日期归堆用的一天：本地日历日（`2026-10-18`） */
export function dayOfEssay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** 一天的钟点（`09:12`）：列表里每一条前面那枚小字 */
export function timeOfEssay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/**
 * 列表预览：把 Markdown 抹成一行纯文字。
 *
 * 列表里要的是「这条讲什么」，不是渲染结果——`## 标题`、`**重点**`、``` 围栏
 * 原样摆进去只会占地方。抹完压成一行，太长由界面截断。
 */
export function essayPreview(text: string, max = 80): string {
  const flat = text
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ') // 代码块整段不要（预览里它只剩噪声）
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接留文字
    .replace(/^[ \t]{0,3}(#{1,6}|>|[-*+]|\d+\.)[ \t]*/gm, '') // 标题/引用/列表记号
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

/** 按日期分组：日期倒序，组内也是新的在前（入参已经是新的在前，这里只负责切段） */
export function groupEssaysByDay(list: EssayEntry[]): Array<{ day: string; items: EssayEntry[] }> {
  const out: Array<{ day: string; items: EssayEntry[] }> = []
  for (const e of list) {
    const day = dayOfEssay(e.createdAt)
    const last = out[out.length - 1]
    if (last && last.day === day) last.items.push(e)
    else out.push({ day, items: [e] })
  }
  return out
}

/** 换一份随笔清单（保持「新的在前」：新增的插到最前面） */
function withList(store: LearnStore, goalId: string, list: EssayEntry[]): LearnStore {
  const next: EssayStore = { ...(store.essays ?? {}) }
  if (list.length) next[goalId] = list
  else delete next[goalId]
  return { ...store, essays: next }
}

/**
 * 写一条新的。文本为空时**什么都不做**（返回 null）——空随笔不是一条随笔，
 * 它只是「编辑器还空着」（见文件头的说明）。
 */
export function createEssay(
  store: LearnStore,
  goalId: string,
  text: string,
  at: number,
): { store: LearnStore; entry: EssayEntry } | null {
  const body = text.slice(0, ESSAY_TEXT_MAX)
  if (!body.trim()) return null
  const entry: EssayEntry = { id: crypto.randomUUID(), text: body, createdAt: at, updatedAt: at }
  /*
   * 按 createdAt 插到该在的位置（平时就是最前面）。
   * 不无脑 unshift：时钟往回跳、或某条是从别处导入的旧时间戳时，
   * 「新的在前」这个顺序得靠时间排，而不是靠「谁后写进来」。
   */
  const list = essaysOf(store, goalId)
  const spot = list.findIndex((e) => e.createdAt < entry.createdAt)
  const next = spot < 0 ? [...list, entry] : [...list.slice(0, spot), entry, ...list.slice(spot)]
  return { store: withList(store, goalId, next), entry }
}

/** 改一条（只动正文与 updatedAt；createdAt 是它归在哪一天的依据，不改） */
export function updateEssay(
  store: LearnStore,
  goalId: string,
  id: string,
  text: string,
  at: number,
): LearnStore {
  const list = essaysOf(store, goalId)
  if (!list.some((e) => e.id === id)) return store
  const body = text.slice(0, ESSAY_TEXT_MAX)
  return withList(
    store,
    goalId,
    list.map((e) => (e.id === id ? { ...e, text: body, updatedAt: at } : e)),
  )
}

/** 删一条；没有就原样返回 store（调用方不必先查） */
export function deleteEssay(store: LearnStore, goalId: string, id: string): LearnStore {
  const list = essaysOf(store, goalId)
  if (!list.some((e) => e.id === id)) return store
  return withList(
    store,
    goalId,
    list.filter((e) => e.id !== id),
  )
}

/* ---------- 读盘归一化 ---------- */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** 随笔窗口的最小尺寸（与 components/learn/essay 里的拖拽下限同一组数） */
export const ESSAY_DOCK_MIN_W = 380
export const ESSAY_DOCK_MIN_H = 300

/**
 * 随笔窗口几何的归一化。
 *
 * 只做「是不是数」的校验：**夹进视口是打开那一刻的事**——上次关应用时窗口是 1440 宽，
 * 这次可能只有 900，存下来的坐标必须当场重新夹一遍（见 EssayDock），而不是在数据层
 * 按当时的屏幕裁死。所以这里只丢掉认不出的、把宽高抬到下限。
 */
export function normalizeEssayDock(raw: unknown): EssayDockRect | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const x = typeof r.x === 'number' && Number.isFinite(r.x) ? Math.round(r.x) : null
  const y = typeof r.y === 'number' && Number.isFinite(r.y) ? Math.round(r.y) : null
  const w = typeof r.w === 'number' && Number.isFinite(r.w) ? Math.round(r.w) : null
  const h = typeof r.h === 'number' && Number.isFinite(r.h) ? Math.round(r.h) : null
  if (x === null || y === null || w === null || h === null) return undefined
  return { x, y, w: Math.max(ESSAY_DOCK_MIN_W, w), h: Math.max(ESSAY_DOCK_MIN_H, h) }
}

/**
 * 磁盘上那份 essay.json 的归一化。
 *
 * 与其它目标级数据同一条口径：**认不出的丢掉，坏数据不该拖垮整库**。
 * 目标已经不在的那些整本丢掉（那是它的随笔，目标没了随笔就该跟着没）；
 * 空文本条目也丢掉——它只可能是手改文件留下的。
 */
export function normalizeEssays(raw: unknown, aliveGoals: Set<string>): EssayStore {
  const out: EssayStore = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [goalId, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!goalId || !aliveGoals.has(goalId) || !Array.isArray(list)) continue
    const seen = new Set<string>()
    const items: EssayEntry[] = []
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const text = typeof r.text === 'string' ? r.text : ''
      if (!text.trim()) continue
      const id = typeof r.id === 'string' && r.id && !seen.has(r.id) ? r.id : crypto.randomUUID()
      seen.add(id)
      const createdAt = isNum(r.createdAt) ? r.createdAt : Date.now()
      items.push({
        id,
        text: text.slice(0, ESSAY_TEXT_MAX),
        createdAt,
        updatedAt: isNum(r.updatedAt) ? r.updatedAt : createdAt,
      })
    }
    if (!items.length) continue
    // 落盘顺序不保证，读回来按时间重排一遍：列表与「最近一条」都靠这个顺序
    items.sort((a, b) => b.createdAt - a.createdAt)
    out[goalId] = items
  }
  return out
}
