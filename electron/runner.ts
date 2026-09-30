/**
 * 代码块的「伪编译产物」与「运行时的联网出口」。
 *
 * 这一层只干两件主进程才做得成的事：
 *
 * 1. **产物的持久化**（\`{root}/runcache.json\`）。伪编译的结果必须活过重启——
 *    它是花了一次模型请求换来的，丢了就得再花一次。为什么放主进程而不是渲染层的
 *    localStorage：它与插件目录一样属于**数据目录**，用户换一份数据目录就该换一批产物，
 *    而且这份文件本身要能看懂、能备份、能手动删。
 *
 * 2. **联网出口**。渲染层那个执行沙箱（见 src/run/RunnerRuntime.js）是一个 Web Worker，
 *    它受页面的 CSP 管着（connect-src 只放 llm-proxy:），自己发不出任何外部请求——
 *    这是好事：联网因此只有一条路，就是这里。谁要联网、联到哪，先由渲染层问过用户
 *    （每运行一次问一次，见 src/lib/codeRun.ts），同意了才转到这里发出去。
 *
 * 键是「代码内容 + 语言」的指纹（见 src/lib/codeArtifacts.ts）：同一段代码在
 * 两篇文档里共用一份产物，代码改了就是另一个键——于是「重新编译」这颗按钮
 * 不需要任何额外的状态，看有没有这个键命中即可。
 */
import { ipcMain, net } from 'electron'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { t } from './i18n'
import { currentRoot } from './storage'

import type {
  CodeArtifact, SilentMark,
} from '../shared/ipc'

// CodeArtifact / SilentMark 原先在这里也写了一份（与 electron/preload.ts、
// src/lib/native.ts、src/lib/codeArtifacts.ts 逐字重复）：现在统一用 shared/ipc.ts，
// 并按原样转出去（本文件与 electron/preload.ts 原先都导出了它们）。
export type {
  CodeArtifact, SilentMark,
}

/** 产物文件（数据根下，与 plugins/ 同级） */
const CACHE_FILE = 'runcache.json'

/**
 * 条目上限。产物是「一次模型请求」的化石，攒着不删会一直长；
 * 留最近 200 条（按落盘时刻淘汰最旧的）足够覆盖用户手上正在看的文档。
 */
const MAX_ITEMS = 200

/** 单份编译产物的上限：编译结果是一段可读的 JS，64KB 已经很宽裕 */
const MAX_JS_BYTES = 64 * 1024
const MAX_CODE_BYTES = 64 * 1024
const MAX_NOTE_CHARS = 2000

/** 一次联网请求的响应体上限与超时 */
const MAX_BODY_BYTES = 1024 * 1024
const MAX_REQ_BYTES = 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

/** 只认这几种方法：沙箱里的代码是「取数据」，不是「操作服务」 */
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])

type Result = { ok: true } | { ok: false; error: string }

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const isMissing = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'

interface CacheFile {
  version: 1
  items: Record<string, CodeArtifact>
  silent: Record<string, SilentMark>
}

const cachePath = (): string => path.join(currentRoot(), CACHE_FILE)

/**
 * 读整份产物表。读不出来（首次、手改坏了、半个文件）一律当空——
 * 产物是**缓存**，丢了最多重编一次，绝不该因此让文档打不开。
 */
async function readCache(): Promise<CacheFile> {
  try {
    const raw = JSON.parse(await fsp.readFile(cachePath(), 'utf-8')) as Partial<CacheFile>
    const items: Record<string, CodeArtifact> = {}
    for (const [key, value] of Object.entries(raw?.items ?? {})) {
      const item = normalizeArtifact(value)
      if (item && isKey(key)) items[key] = item
    }
    const silent: Record<string, SilentMark> = {}
    for (const [key, value] of Object.entries(raw?.silent ?? {})) {
      const mark = normalizeSilent(value)
      if (mark && isKey(key)) silent[key] = mark
    }
    return { version: 1, items, silent }
  } catch (err) {
    if (!isMissing(err)) console.warn('[coderun] 产物表读不出来，按空的算', err)
    return { version: 1, items: {}, silent: {} }
  }
}

/** 键的形状：渲染层算出来的十六进制指纹。渲染层传进来的东西一律按不可信处理 */
const isKey = (key: unknown): key is string => typeof key === 'string' && /^[0-9a-f]{8,64}$/.test(key)

function normalizeArtifact(value: unknown): CodeArtifact | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  if (typeof o.js !== 'string' || !o.js.trim()) return null
  if (Buffer.byteLength(o.js, 'utf-8') > MAX_JS_BYTES) return null
  const code = typeof o.code === 'string' ? o.code.slice(0, MAX_CODE_BYTES) : ''
  return {
    code,
    languageId: typeof o.languageId === 'string' && o.languageId ? o.languageId : null,
    js: o.js,
    note: typeof o.note === 'string' ? o.note.slice(0, MAX_NOTE_CHARS) : '',
    model: typeof o.model === 'string' ? o.model : '',
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(),
  }
}

function normalizeSilent(value: unknown): SilentMark | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  const code = typeof o.code === 'string' ? o.code.slice(0, MAX_CODE_BYTES) : ''
  if (!code.trim()) return null
  return {
    code,
    languageId: typeof o.languageId === 'string' && o.languageId ? o.languageId : null,
    reason: typeof o.reason === 'string' ? o.reason.slice(0, MAX_NOTE_CHARS) : '',
    at: typeof o.at === 'number' && Number.isFinite(o.at) ? o.at : Date.now(),
  }
}

/**
 * 落盘。写请求串成一条链：编排里同时点两次「编译」、或两个代码块先后编完，
 * 都会走到这里，各自的「读—改—写」交叠就会丢掉一份产物。
 */
let writeChain: Promise<unknown> = Promise.resolve()

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const next = writeChain.then(job, job)
  writeChain = next.catch(() => {})
  return next
}

async function writeCache(cache: CacheFile): Promise<Result> {
  const entries = Object.entries(cache.items).sort((a, b) => b[1].at - a[1].at)
  const kept = entries.slice(0, MAX_ITEMS)
  const items: Record<string, CodeArtifact> = {}
  for (const [key, value] of kept) items[key] = value
  // 无输出标记同样限量：它是结论不是缓存，但也没道理无限长
  const marks = Object.entries(cache.silent).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ITEMS)
  const silent: Record<string, SilentMark> = {}
  for (const [key, value] of marks) silent[key] = value
  try {
    await fsp.mkdir(currentRoot(), { recursive: true })
    await fsp.writeFile(cachePath(), JSON.stringify({ version: 1, items, silent }, null, 2), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: t('产物写不进去：{0}', errText(err)) }
  }
}

/** 全量表：产物 + 无输出标记（渲染层启动时拉一次，之后本地维护） */
async function listArtifacts(): Promise<
  { ok: true; items: Record<string, CodeArtifact>; silent: Record<string, SilentMark> } | { ok: false; error: string }
> {
  try {
    const cache = await readCache()
    return { ok: true, items: cache.items, silent: cache.silent }
  } catch (err) {
    return { ok: false, error: errText(err) }
  }
}

/** 记下「这段代码没有输出」（导师判定的结论，落盘；见 src/lib/codeArtifacts） */
async function putSilent(key: unknown, value: unknown): Promise<Result> {
  if (!isKey(key)) return { ok: false, error: t('键不合法') }
  const mark = normalizeSilent(value)
  if (!mark) return { ok: false, error: t('无输出标记不合法（缺 code）') }
  return enqueue(async () => {
    const cache = await readCache()
    cache.silent[key] = mark
    return writeCache(cache)
  })
}

async function putArtifact(key: unknown, value: unknown): Promise<Result> {
  if (!isKey(key)) return { ok: false, error: t('产物键不合法') }
  const item = normalizeArtifact(value)
  if (!item) return { ok: false, error: t('产物不合法（缺 js 或太大了）') }
  return enqueue(async () => {
    const cache = await readCache()
    cache.items[key] = item
    return writeCache(cache)
  })
}

async function clearArtifacts(): Promise<Result> {
  return enqueue(() => writeCache({ version: 1, items: {}, silent: {} }))
}

/* ---------- 联网出口 ---------- */

export type FetchReply =
  | { ok: true; status: number; statusText: string; headers: Array<[string, string]>; body: string; truncated: boolean }
  | { ok: false; error: string }

/**
 * 替沙箱发一次请求。
 *
 * 为什么不让 Worker 自己 fetch：CSP 的 connect-src 只放 llm-proxy:（见 electron/csp.ts），
 * Worker 里的 fetch 会在发出之前就被拦掉，报出来的还是一句看不懂的 CSP 违规。
 * 走主进程这条路，限制只有我们自己写的那几条：只认 http/https、只认常见方法、
 * 响应体截到 1MB、20 秒超时。**这里不做「用户同不同意」的判断**——那是渲染层
 * 弹窗的事（见 src/lib/codeRun.ts），主进程只负责「同意了就发」。
 */
async function runFetch(url: unknown, init: unknown): Promise<FetchReply> {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: t('只能访问 http/https 地址') }
  }
  const o = (init && typeof init === 'object' ? init : {}) as Record<string, unknown>
  const method = typeof o.method === 'string' ? o.method.toUpperCase() : 'GET'
  if (!METHODS.has(method)) return { ok: false, error: t('不支持的方法：{0}', method) }

  const headers: Record<string, string> = {}
  if (o.headers && typeof o.headers === 'object') {
    for (const [k, v] of Object.entries(o.headers as Record<string, unknown>)) {
      if (typeof v === 'string') headers[k] = v
    }
  }
  let body: string | undefined
  if (typeof o.body === 'string' && method !== 'GET' && method !== 'HEAD') {
    if (Buffer.byteLength(o.body, 'utf-8') > MAX_REQ_BYTES) return { ok: false, error: t('请求体太大了（上限 1MB）') }
    body = o.body
  }

  try {
    const res = await net.fetch(url, {
      method,
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    // 读的时候也掐上限：一个几百 MB 的响应不该把应用拖死
    const buf = Buffer.from(await res.arrayBuffer())
    const truncated = buf.byteLength > MAX_BODY_BYTES
    const slice = truncated ? buf.subarray(0, MAX_BODY_BYTES) : buf
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
      body: slice.toString('utf-8'),
      truncated,
    }
  } catch (err) {
    return { ok: false, error: t('请求失败：{0}', errText(err)) }
  }
}

/* ---------- IPC 注册 ---------- */

export function registerRunnerIpc(): void {
  ipcMain.handle('runner:artifacts', () => listArtifacts())
  ipcMain.handle('runner:putArtifact', (_e, key: unknown, value: unknown) => putArtifact(key, value))
  ipcMain.handle('runner:putSilent', (_e, key: unknown, value: unknown) => putSilent(key, value))
  ipcMain.handle('runner:clearArtifacts', () => clearArtifacts())
  ipcMain.handle('runner:fetch', (_e, url: unknown, init: unknown) => runFetch(url, init))
}
