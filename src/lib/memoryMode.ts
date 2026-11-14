/**
 * 教学文档的**记忆模式**（DocFloat 的记忆模式按钮）：把正文里一部分块元素盖上遮罩，
 * 鼠标停在遮罩上才显示原文——主动回忆的自测模式。
 *
 * 三个量都记在 localStorage（**按文档各存一份**）：开没开、盖多大的范围（percent，
 * 0 = 全显示 / 100 = 全覆盖）、以及**随机种子**——盖住哪几块由种子决定，持久化后
 * 重开应用还是同一批遮罩，用户点「刷新随机分布」才换一批（换种子不换范围）。
 *
 * 状态变化的广播走 window CustomEvent（与 vimSettings 同一套口径）：按钮（DocFloat）
 * 与正文（useMemoryMode 的标记 effect）是两棵子树，谁改了对方都要跟上。
 */

export interface MemoryModeState {
  /** 记忆模式开着吗 */
  on: boolean
  /** 覆盖范围（%）：0 = 不遮任何元素，100 = 全覆盖 */
  percent: number
  /** 随机种子：决定盖住哪几块；持久化，刷新按钮换新种子 */
  seed: number
}

const EVENT = 'unyra:memory-mode'

/** 一份文档的记忆键（教学文档专用）：节点 id + 文档种类。按钮与正文各算一次，必须对得上 */
export function memoryDocKey(nodeId: string, kind: string, note?: string): string {
  return `${nodeId}:${kind}${note ? ':' + note : ''}`
}

function storageKey(docKey: string): string {
  return `moji:memory-mode:${docKey}`
}

const DEFAULT_PERCENT = 70

/** 读一份文档的记忆状态；没存过给默认值（70% 覆盖、随机种子） */
export function loadMemoryMode(docKey: string): MemoryModeState {
  try {
    const raw = localStorage.getItem(storageKey(docKey))
    if (raw) {
      const p = JSON.parse(raw) as Partial<MemoryModeState>
      if (typeof p.seed === 'number' && Number.isFinite(p.seed)) {
        return {
          on: p.on === true,
          percent: typeof p.percent === 'number' && Number.isFinite(p.percent) ? Math.max(0, Math.min(100, Math.round(p.percent))) : DEFAULT_PERCENT,
          seed: p.seed >>> 0,
        }
      }
    }
  } catch {
    // 容错：坏数据当没存过
  }
  return { on: false, percent: DEFAULT_PERCENT, seed: (Math.random() * 0xffffffff) >>> 0 }
}

export function saveMemoryMode(docKey: string, state: MemoryModeState): void {
  try {
    localStorage.setItem(storageKey(docKey), JSON.stringify({ ...state, seed: state.seed >>> 0 }))
  } catch {
    // 忽略 localStorage 写入异常
  }
  if (typeof window !== 'undefined') {
    queueMicrotask(() => {
      try {
        window.dispatchEvent(new CustomEvent(EVENT, { detail: { docKey, state } }))
      } catch {
        // 忽略宿主环境窗口已被卸载的情况
      }
    })
  }
}

export function subscribeMemoryMode(cb: (docKey: string, state: MemoryModeState) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ docKey: string; state: MemoryModeState }>).detail
    if (detail && typeof detail.docKey === 'string' && detail.state) cb(detail.docKey, detail.state)
  }
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

export function toggleMemoryMode(docKey: string): MemoryModeState {
  const next = { ...loadMemoryMode(docKey), on: !loadMemoryMode(docKey).on }
  saveMemoryMode(docKey, next)
  return next
}

export function setMemoryPercent(docKey: string, percent: number): MemoryModeState {
  const next = { ...loadMemoryMode(docKey), percent: Math.max(0, Math.min(100, Math.round(percent))) }
  saveMemoryMode(docKey, next)
  return next
}

/** 换一批随机分布：只换种子，范围（percent）保持用户调的值 */
export function rerollMemorySeed(docKey: string): MemoryModeState {
  const next = { ...loadMemoryMode(docKey), seed: (Math.random() * 0xffffffff) >>> 0 }
  saveMemoryMode(docKey, next)
  return next
}

/** mulberry32：小而稳的种子随机（30 位内部状态，够这里用） */
export function memoryRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 种子 + 盐 → 一条独立的随机流（每个块/每个文本节点各用各的，互不干扰） */
export function memoryHash(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * 种子驱动的洗牌：0..n-1 均匀随机打散。取前 k 个 = 在全部候选里**均匀随机**挑 k 个。
 */
export function memoryShuffle(n: number, seed: number): number[] {
  const rand = memoryRandom(seed)
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

let segmenter: Intl.Segmenter | null | undefined

/** Intl.Segmenter（Chromium 内建分词器）：中/英/日按词切，零依赖——切片就用它 */
function segmenterOf(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    try {
      segmenter = typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function'
        ? new Intl.Segmenter('zh', { granularity: 'word' })
        : null
    } catch {
      segmenter = null
    }
  }
  return segmenter
}

export interface MemChunk {
  start: number
  end: number
}

/**
 * 把一段文本切成**若干份**（词组片）：Intl.Segmenter 按词切开，连续 2~4 个词并成一片
 * （片长由种子随机），标点与空白跟在词尾巴上。没有 Segmenter 的环境整段当一片。
 * rand 来自调用方的种子流：同一种子对同一段文本永远切出同样的片。
 */
export function chunkIntoPieces(text: string, rand: () => number): MemChunk[] {
  const seg = segmenterOf()
  if (!seg) return [{ start: 0, end: text.length }]
  const parts = Array.from(seg.segment(text))
  const chunks: MemChunk[] = []
  let start: number | null = null
  let words = 0
  const need = () => 2 + Math.floor(rand() * 3)
  let want = need()
  for (const s of parts) {
    if (start === null) start = s.index
    if (s.isWordLike) words++
    if (words >= want) {
      chunks.push({ start, end: s.index + s.segment.length })
      start = null
      words = 0
      want = need()
    }
  }
  if (start !== null) chunks.push({ start, end: text.length })
  return chunks
}

/**
 * **平均的随机取样**：n 片里选 k 片——把 [0, n) 按 k 个**整数格**等分（stride ≥ 1 时
 * 相邻格严格不重叠），每格内部用种子抖动落点。盖住的片平均散布在整段里，
 * **同一片绝不会被选中两次**（旧实现用浮点步长，相邻格会撞出同一下标——同一片被包
 * 两次，文本原地重复），同一种子永远同一批落点。
 */
export function pickSpaced(n: number, k: number, rand: () => number): number[] {
  if (k <= 0 || n <= 0) return []
  const count = Math.min(n, Math.floor(k))
  const stride = n / count
  const out: number[] = []
  for (let j = 0; j < count; j++) {
    // 格子是 [floor(j*stride), floor((j+1)*stride)) 的整数区间：stride ≥ 1 时相邻格
    // 不重叠，落点天然互不相同
    const start = Math.floor(j * stride)
    const end = Math.min(n, Math.floor((j + 1) * stride))
    out.push(Math.min(end - 1, start + Math.floor(rand() * (end - start))))
  }
  return out
}
