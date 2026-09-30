/**
 * 伪编译产物的**渲染层**这一半：算键、查、存，以及「等导师交货」的那几笔登记。
 *
 * 键是「语言 + 代码内容」的指纹，不带文档身份：同一段代码在两篇文档里共用一份产物
 * （本来也是同一份东西），代码改一个字就是另一个键——于是界面上那颗「编译 / 重新编译」
 * 按钮不需要任何额外状态，看这个键命中与否即可（见 lib/codeBlockMenu）。
 *
 * 真身在主进程的数据目录里（`{root}/runcache.json`，见 electron/runner.ts）。
 * 这里多存一份内存表，是因为按钮的状态要在**同步**路径上问出来
 * （DOM 一挂上就得知道这块代码有没有产物），而 IPC 是异步的。
 *
 * 编译本身由**超级导师的工作流**做（见 learn/workflows 的「伪编译」），产物回来时
 * 只有一句 api.code.save({ key, js, note })——宿主在这里按指纹记着「哪段代码、什么语言」，
 * 交货时按 key 取回来补全，模型不必把代码原文再抄一遍。
 */
import { t } from '../i18n'
import { native, type CodeArtifact } from './native'

import type { SilentMark } from '../../shared/ipc'

// SilentMark 原先在这里也写了一份（与 electron/runner.ts、electron/preload.ts、
// src/lib/native.ts 逐字重复）：现在统一用 shared/ipc.ts 那一份，并按原样转出去。
export type { SilentMark }

/** 指纹：两轮 FNV-1a（不同种子）拼成 16 位十六进制。够短、够稳、跨平台一致 */
function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export function artifactKey(code: string, languageId: string | null): string {
  const text = (languageId ?? '') + '\u0000' + code
  const a = fnv1a(text, 0x811c9dc5)
  const b = fnv1a(text, 0x9e3779b9)
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/** 内存里的那一份（启动后拉一次） */
let cache: Map<string, CodeArtifact> | null = null
/**
 * 「无输出」标记：导师看过这段代码、判定它跑不出任何东西之后留下的记号（见下面的 submitSilent）。
 * 与产物同一张盘上、同一个键（都是「语言 + 代码内容」的指纹），但语义不同：
 * 产物是「运行这个」，标记是「这块没什么可跑的」。
 */
let silent: Map<string, SilentMark> | null = null
let loading: Promise<Map<string, CodeArtifact>> | null = null

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * 拉全量产物表。读不出来就当空的：产物是缓存，丢了大不了重编一次，
 * 绝不该让文档打不开（这与 electron/runner.ts 对坏文件的容忍是同一套取舍）。
 */
export function loadArtifacts(force = false): Promise<Map<string, CodeArtifact>> {
  if (!force && cache) return Promise.resolve(cache)
  if (!force && loading) return loading
  loading = (async () => {
    try {
      const res = await native().runner.artifacts()
      cache = new Map(Object.entries(res.ok ? res.items : {}))
      silent = new Map(Object.entries(res.ok ? (res.silent ?? {}) : {}))
    } catch {
      // 不在 Electron 里（用例、浏览器里打开 dist）：留一份内存表，行为一致
      cache = cache ?? new Map()
      silent = silent ?? new Map()
    }
    loading = null
    notifyArtifacts()
    return cache
  })()
  return loading
}

/**
 * 拿一份产物，并**核对内容**。
 *
 * 指纹理论上会撞（16 位十六进制不是密码学哈希）。撞了的后果是「另一段代码的产物
 * 跑到这一块下面去执行」，那是不能接受的；因此产物里存着原始 code，读回来时对一眼，
 * 对不上就当没有——大不了重编一次。
 */
export function artifactFor(key: string, code: string, languageId: string | null): CodeArtifact | undefined {
  const item = cache?.get(key)
  if (!item) return undefined
  if (item.code !== code) return undefined
  if ((item.languageId ?? null) !== (languageId ?? null)) return undefined
  if (!item.js.trim()) return undefined
  return item
}

/** 存一份产物；成功给 null，失败给一句能显示的话。内存表同步更新，界面不必等回执 */
export async function saveArtifact(key: string, artifact: CodeArtifact): Promise<string | null> {
  if (!cache) await loadArtifacts()
  cache?.set(key, artifact)
  notifyArtifacts()
  try {
    const res = await native().runner.putArtifact(key, artifact)
    return res.ok ? null : (res.error ?? '产物没能存下来')
  } catch (err) {
    return `产物没能存下来：${errText(err)}`
  }
}

/** 清空全部产物**与无输出标记**；成功给 null。错误串显示在设置页（那里不包 t()，在这里包） */
export async function clearArtifacts(): Promise<string | null> {
  cache = new Map()
  silent = new Map()
  pendingCompiles.clear()
  notifyArtifacts()
  try {
    const res = await native().runner.clearArtifacts()
    return res.ok ? null : (res.error ?? t('清不掉'))
  } catch (err) {
    return errText(err)
  }
}

/** 当前内存表里有几条（设置页显示用） */
export const artifactCount = (): number => cache?.size ?? 0/** 这块代码被标记为无输出了吗（界面据此收起编译与运行两颗按钮） */
export function silentFor(key: string, code: string, languageId: string | null): SilentMark | undefined {
  const mark = silent?.get(key)
  if (!mark) return undefined
  if (mark.code !== code) return undefined
  if ((mark.languageId ?? null) !== (languageId ?? null)) return undefined
  return mark
}

/** 无输出标记有几条（设置页显示用） */
export const silentCount = (): number => silent?.size ?? 0

/**
 * 导师判定「这段代码没有输出」：**立刻停止编译**，把那一块标成无输出。
 *
 * 这是「无输出」唯一的来源。标记落盘（重启后仍然不可编译、不可运行），
 * 与交货走同一条校验：key 必须对得上这一笔待编译登记。
 */
export async function submitSilent(input: {
  key: unknown
  reason: unknown
}): Promise<{ ok: true; key: string; saved: string | null } | { ok: false; error: string }> {
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  if (!key) return { ok: false, error: '缺 key：把触发那条消息里「key：」后面那串原样传回来' }
  const pending = pendingCompiles.get(key)
  if (!pending) {
    return {
      ok: false,
      error:
        '这个 key 没有对应的待编译请求（可能已经处理过、或应用重启过）。' +
        '如果这块代码确实没有输出，让用户在代码块上重新点一次「编译」，用新消息里的 key 再调一次。',
    }
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : ''
  const mark: SilentMark = {
    code: pending.code,
    languageId: pending.languageId,
    reason,
    at: Date.now(),
  }
  if (!silent) await loadArtifacts()
  silent?.set(key, mark)
  // 这一笔不必再等产物了：登记当场消掉，菜单那边的转圈跟着停
  pendingCompiles.delete(key)
  notifyArtifacts()
  let saved: string | null = null
  try {
    const res = await native().runner.putSilent(key, mark)
    saved = res.ok ? null : (res.error ?? '无输出标记没能存下来')
  } catch (err) {
    saved = `无输出标记没能存下来：${errText(err)}`
  }
  return { ok: true, key, saved }
}

/* ---------- 变化订阅 ---------- */

/**
 * 产物有动静时叫一声。代码块菜单靠它「等导师交货」：编译在对话那一侧完成，
 * 菜单手上没有任何 promise 可以 await，只能等这条通知。
 */
const listeners = new Set<() => void>()

export function subscribeArtifacts(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function notifyArtifacts(): void {
  for (const cb of listeners) {
    try {
      cb()
    } catch (err) {
      console.warn('[coderun] 产物订阅者出错', err)
    }
  }
}

/* ---------- 待编译登记 ---------- */

/**
 * 「用户点了编译、导师还没交货」的那几笔。
 *
 * 为什么要宿主记着：产物回来时模型只会给一句 { key, js, note }——**代码原文不要求它回抄**。
 * 几千行代码抄错一个空格，指纹就对不上，那块代码的「运行」永远亮不起来；
 * 而宿主本来就完整地知道是哪段代码（它就是从这个代码块上取走的）。
 *
 * 它是内存的：应用一重启就空了。重启后模型手上那一轮对话早已结束，本来也不会再来交货。
 */
const pendingCompiles = new Map<string, { code: string; languageId: string | null; at: number }>()

/** 登记一笔待编译，返回它的键（这个键要作为工作流参数交给导师，交货时再用它认领） */
export function beginCompile(code: string, languageId: string | null): string {
  const key = artifactKey(code, languageId)
  pendingCompiles.set(key, { code, languageId, at: Date.now() })
  notifyArtifacts()
  return key
}

/** 这笔编译还在等导师交货吗（菜单据此决定转不转圈） */
export const isCompiling = (key: string): boolean => pendingCompiles.has(key)

/** 现在有几笔在等交货 */
export const compilingCount = (): number => pendingCompiles.size

/**
 * 导师交货：把 key 对应的那段代码取回来，补全产物并落盘。
 *
 * 三条校验，任一条不过都回一句「该怎么办」而不是抛异常——对面是模型，
 * 它需要的是能照着改的纠正（比如「这个 key 不对，去代码块上重新点一次编译」）。
 */
export async function submitCompile(input: {
  key: unknown
  js: unknown
  note: unknown
  model: string
}): Promise<{ ok: true; key: string; chars: number; saved: string | null } | { ok: false; error: string }> {
  const key = typeof input.key === 'string' ? input.key.trim() : ''
  if (!key) {
    return { ok: false, error: '缺 key：把触发那条消息里「key：」后面那串原样传回来' }
  }
  const pending = pendingCompiles.get(key)
  if (!pending) {
    return {
      ok: false,
      error:
        '这个 key 没有对应的待编译请求（可能已经交过货、或应用重启过）。' +
        '请在代码块上重新点一次「编译」，用新消息里的 key 再调一次。',
    }
  }
  const js = typeof input.js === 'string' ? input.js.trim() : ''
  if (!js) return { ok: false, error: 'js 不能为空：把转译好的那段可执行 JavaScript 原样放进来' }
  const note = typeof input.note === 'string' ? input.note.slice(0, 2000) : ''
  const artifact: CodeArtifact = {
    code: pending.code,
    languageId: pending.languageId,
    js,
    note,
    model: input.model,
    at: Date.now(),
  }
  const saved = await saveArtifact(key, artifact)
  // 无论如何都消掉这一笔：存不进磁盘（极少见）也不该让菜单一直转圈
  pendingCompiles.delete(key)
  notifyArtifacts()
  return { ok: true, key, chars: js.length, saved }
}

/** 放弃一笔待编译（清空产物时一并清掉） */
export function dropCompile(key: string): void {
  if (pendingCompiles.delete(key)) notifyArtifacts()
}
