import { compileBody } from '../agent/tools'
import type { LearnStore, MethodEntry, MethodStore } from './types'

/**
 * 目标级持久化函数（method.*）的纯逻辑与执行器。
 *
 * 它解决的是「复用」：超级文档里的按钮调 api.method.call('函数名', 实参)，
 * 宿主编译那份持久化的函数源码、注入整套沙箱 api 执行，把结果送回文档。
 * 函数体里照样能 await api.doc.read(...)，于是「统计某文档有多少个句号」
 * 这类活写一次，任何一份超级文档都能调。
 *
 * 存储与 minds 同构：按目标归档、跟着 state.json 落盘。name 就是身份
 * （同目标内唯一，create 同名**覆盖**——那正是「更新一个函数」的语义）。
 */

/** 名字的上限：够写「统计句号」也防手滑把整段代码粘进名字里 */
export const METHOD_NAME_MAX = 64
/** 单个函数体的上限：与 execute 的 body 同量级的体面上限 */
export const METHOD_CODE_MAX = 60_000

const methodsOf = (store: LearnStore, goalId: string): MethodEntry[] => store.methods?.[goalId] ?? []

/** 找一个函数（大小写不敏感；理由同 learn/notes：调用方抄写时大小写会飘） */
export function findMethod(store: LearnStore, goalId: string, name: string): MethodEntry | null {
  const key = (name ?? '').trim().toLowerCase()
  if (!key) return null
  return methodsOf(store, goalId).find((m) => m.name.toLowerCase() === key) ?? null
}

/** 清单（给 method.list 用）：只带名字、体量与更新时间，不带代码本身 */
export function listMethods(store: LearnStore, goalId: string): Array<{ name: string; chars: number; updatedAt: number }> {
  return methodsOf(store, goalId).map((m) => ({ name: m.name, chars: m.code.length, updatedAt: m.updatedAt }))
}

/** 新建 / 覆盖：返回新 store 与最终名字；校验不过时返回带原因的错误 */
export function upsertMethod(
  store: LearnStore,
  goalId: string,
  input: { name?: unknown; code?: unknown },
  at: number,
): { ok: true; store: LearnStore; name: string; updated: boolean } | { ok: false; error: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!name) return { ok: false, error: 'method.create 需要 name（函数名，调用时就靠它指名）' }
  if (name.length > METHOD_NAME_MAX) return { ok: false, error: `函数名最长 ${METHOD_NAME_MAX} 字（收到 ${name.length} 字）` }
  if (!code) return { ok: false, error: 'method.create 需要 code（匿名函数源码，如 "((api, path) => { ... })"）' }
  if (code.length > METHOD_CODE_MAX) return { ok: false, error: `函数体最长 ${METHOD_CODE_MAX} 字符（收到 ${code.length}），拆成几个小函数` }
  // 语法在创建那一刻就查：存一个编不过的函数，等超级文档点下按钮时才炸，没人能想到是这里
  const compiled = compileBody(code)
  if (!compiled.ok) return { ok: false, error: 'code 编译不过：' + compiled.content }
  const list = methodsOf(store, goalId)
  const existing = list.find((m) => m.name.toLowerCase() === name.toLowerCase())
  const entry: MethodEntry = existing
    ? { ...existing, code, updatedAt: at }
    : { name, code, createdAt: at, updatedAt: at }
  const next: MethodStore = {
    ...(store.methods ?? {}),
    [goalId]: existing ? list.map((m) => (m === existing ? entry : m)) : [...list, entry],
  }
  return { ok: true, store: { ...store, methods: next }, name: existing ? existing.name : name, updated: !!existing }
}

/** 删除一个函数；没有就原样返回 store */
export function removeMethod(store: LearnStore, goalId: string, name: string): LearnStore {
  const key = (name ?? '').trim().toLowerCase()
  const list = methodsOf(store, goalId)
  if (!key || !list.some((m) => m.name.toLowerCase() === key)) return store
  return {
    ...store,
    methods: { ...(store.methods ?? {}), [goalId]: list.filter((m) => m.name.toLowerCase() !== key) },
  }
}

/**
 * 执行一个函数：编译（upsert 时已保证能编，这里再兜一道）、注入 api、传参。
 *
 * api 由调用方给（agent 运行里是 buildApi 现建的那份；超级文档的桥是
 * buildStandaloneApi 建的常驻那份——两者都经由 createAgentOps 现取最新 store）。
 * 结果必须能结构化克隆（postMessage 要用）；带函数的返回值换成一句说明。
 */
export async function runMethodEntry(
  entry: MethodEntry,
  api: Record<string, unknown>,
  args: unknown[],
): Promise<unknown> {
  const compiled = compileBody(entry.code)
  if (!compiled.ok) throw new Error('「' + entry.name + '」的代码编译不过：' + compiled.content)
  const fn = new Function('api', 'return (' + compiled.body + ')')() as
    | ((...a: unknown[]) => unknown)
    | null
  if (typeof fn !== 'function') throw new Error('「' + entry.name + '」不是一段函数源码')
  const value = await fn(api, ...args)
  try {
    structuredClone(value)
    return value
  } catch {
    return typeof value === 'function' ? '[函数] ' + String(value).slice(0, 200) : String(value)
  }
}
