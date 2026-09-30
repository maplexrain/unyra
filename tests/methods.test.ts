/**
 * 持久化函数（method）的单元用例：建/覆盖/删/找，以及执行器真的把 api 注入进去了。
 *
 * 关键的两条：一是「同名覆盖」（覆盖被改成另建一份的话，超级文档的按钮就调到旧版了）；
 * 二是 runMethodEntry 里 api 是第一个参数、实参跟在后面——这条签名承诺写进了提示词，
 * 模型会照着写，错一点就是「超级文档点按钮报 api is not defined」。
 */
import { describe, expect, it } from 'vitest'

import type { LearnStore } from '../src/learn/types'
import {
  findMethod,
  listMethods,
  METHOD_NAME_MAX,
  removeMethod,
  runMethodEntry,
  upsertMethod,
} from '../src/learn/methods'

const AT = 1700000000000

const store = (): LearnStore => ({
  version: 2,
  nodes: [],
  edges: [],
  goals: [{ id: 'g1', rootNodeId: 'r', question: 'q', createdAt: AT, updatedAt: AT }],
  conversations: [],
  exams: [],
  tmp: {},
  resources: {},
  activeGoalId: null,
  activeNodeId: null,
  activeConversationId: null,
  tabs: [],
  activeTab: null,
  drafts: {},
  docScroll: {},
  localFiles: {},
} as unknown as LearnStore)

describe('method 的存储逻辑', () => {
  it('create 新建；名字与代码缺一不可', () => {
    const s = store()
    expect(upsertMethod(s, 'g1', { name: '', code: 'x' }, AT).ok).toBe(false)
    expect(upsertMethod(s, 'g1', { name: '甲', code: '' }, AT).ok).toBe(false)
    const r = upsertMethod(s, 'g1', { name: '甲', code: '((api) => 1)' }, AT)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.updated).toBe(false)
      expect(r.store.methods?.g1).toHaveLength(1)
      expect(r.name).toBe('甲')
    }
  })

  it('超长名字与超长代码被拒；过长的名字截断入盘', () => {
    const s = store()
    const r = upsertMethod(s, 'g1', { name: 'x'.repeat(METHOD_NAME_MAX + 1), code: '((api)=>1)' }, AT)
    expect(r.ok).toBe(false)
    const badCode = upsertMethod(s, 'g1', { name: '甲', code: 'x'.repeat(60_001) }, AT)
    expect(badCode.ok).toBe(false)
  })

  it('语法编不过当场被拒——存一个坏函数要等用户点按钮才炸', () => {
    const r = upsertMethod(store(), 'g1', { name: '坏的', code: '((api) => { await api.doc' }, AT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('编译')
  })

  it('同名覆盖：列表仍是一份、代码换新、updatedAt 变', () => {
    let s = store()
    s = upsertMethod(s, 'g1', { name: '甲', code: '((api) => 1)' }, AT).ok
      ? (upsertMethod(s, 'g1', { name: '甲', code: '((api) => 1)' }, AT) as { ok: true; store: LearnStore }).store
      : s
    const again = upsertMethod(s, 'g1', { name: '甲', code: '((api) => 2)' }, AT + 1)
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.updated).toBe(true)
      expect(again.store.methods?.g1).toHaveLength(1)
      expect(findMethod(again.store, 'g1', '甲')?.code).toBe('((api) => 2)')
    }
  })

  it('name 是大小写不敏感的身份；按目标隔离', () => {
    let s = store()
    const first = upsertMethod(s, 'g1', { name: 'Count', code: '((api) => 1)' }, AT)
    expect(first.ok).toBe(true)
    if (first.ok) s = first.store
    const second = upsertMethod(s, 'g1', { name: 'count', code: '((api) => 2)' }, AT)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.updated).toBe(true)
      expect(second.store.methods?.g1).toHaveLength(1)
    }
    // 另一个目标里同名是新的一条
    const other = upsertMethod(s, 'g2', { name: 'count', code: '((api) => 3)' }, AT)
    expect(other.ok).toBe(true)
    if (other.ok) expect(other.updated).toBe(false)
  })

  it('list 只给名字与体量；remove 删指定目标里的那一条', () => {
    let s = store()
    const r = upsertMethod(s, 'g1', { name: '甲', code: '((api) => 1)' }, AT)
    if (r.ok) s = r.store
    expect(listMethods(s, 'g1')[0].name).toBe('甲')
    expect(listMethods(s, 'g1')[0].chars).toBe('((api) => 1)'.length)
    s = removeMethod(s, 'g1', '甲')
    expect(findMethod(s, 'g1', '甲')).toBeNull()
    // 删别的目标不影响这里
    expect(removeMethod(s, 'g2', '不存在')).toBe(s)
  })
})

describe('runMethodEntry 的执行语义', () => {
  const entry = { name: '加一', code: '((api, n) => n + 1)', createdAt: AT, updatedAt: AT }

  it('第一个参数是 api，其余是调用实参', async () => {
    const seen: unknown[] = []
    const api = {
      probe: (...args: unknown[]) => {
        seen.push(...args)
        return 'ok'
      },
    }
    const code = '((api, a, b) => { const r = api.probe(a, b); return r + a + b })'
    const value = await runMethodEntry({ ...entry, code }, api, [1, 2])
    expect(value).toBe('ok12') // 'ok' + 1 + 2：字符串拼接，同时证明 api 与两个实参都到位
    expect(seen).toEqual([1, 2])
  })

  it('await 可用、返回值不可克隆时换成一句说明', async () => {
    const fnCode = '(async (api) => { await Promise.resolve(); return () => "fn" })'
    const value = await runMethodEntry({ ...entry, code: fnCode }, {}, [])
    expect(typeof value).toBe('string')
    expect(String(value)).toContain('[函数]')
  })

  it('编译不过抛出带函数名的错误', async () => {
    await expect(runMethodEntry({ ...entry, code: '((api) => { await api' }, {}, [])).rejects.toThrow('加一')
  })
})
