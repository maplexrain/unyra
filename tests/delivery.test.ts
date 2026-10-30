/**
 * 交付记录的归一化与合并（agent/delivery）。
 *
 * 这份数据要跨会话落盘、还要直接驱动界面渲染，所以两件事必须钉住：
 * 形状不对时回 undefined（而不是塞半个对象给组件）、同一轮多次登记要合并去重。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_DELIVERY_FILES,
  emptyDelivery,
  hasDelivery,
  mergeDelivery,
  normalizeDelivery,
} from '../src/agent/delivery'

describe('normalizeDelivery', () => {
  it('空值 / 非对象 / 两项都为空 → undefined', () => {
    expect(normalizeDelivery(null)).toBeUndefined()
    expect(normalizeDelivery('x')).toBeUndefined()
    expect(normalizeDelivery({})).toBeUndefined()
    expect(normalizeDelivery({ files: [], sources: [] })).toBeUndefined()
    expect(normalizeDelivery({ files: [{ path: '   ' }] })).toBeUndefined()
  })

  it('文件按路径去重，认不出的 action 落到 updated', () => {
    const d = normalizeDelivery({
      files: [
        { path: ' 微积分/极限 ', action: 'created', note: '新建' },
        { path: '微积分/极限', action: 'deleted' },
        { path: '大纲/函数', action: '乱写' },
      ],
    })
    expect(d?.files).toEqual([
      { path: '微积分/极限', action: 'created', note: '新建' },
      { path: '大纲/函数', action: 'updated' },
    ])
  })

  it('来源只收 http(s)，按 URL 去重，标题缺省用 URL', () => {
    const d = normalizeDelivery({
      sources: [
        { title: '规范', url: 'https://example.com/spec' },
        { title: '重复', url: 'https://example.com/spec' },
        { title: '不合法', url: 'file:///c:/x' },
        { title: '  ', url: 'http://example.com/a' },
      ],
    })
    expect(d?.sources).toEqual([
      { title: '规范', url: 'https://example.com/spec' },
      { title: 'http://example.com/a', url: 'http://example.com/a' },
    ])
  })

  it('超量截断（组件一行一条，不能无限长）', () => {
    const files = Array.from({ length: MAX_DELIVERY_FILES + 5 }, (_, i) => ({ path: 'f' + i }))
    expect(normalizeDelivery({ files })?.files).toHaveLength(MAX_DELIVERY_FILES)
  })

  it('保留 goalId 与 nodeId 避免同名指针混淆', () => {
    const d = normalizeDelivery({
      files: [{ path: 'HTTP', goalId: 'goal-1', nodeId: 'node-101' }],
    })
    expect(d?.files).toEqual([
      { path: 'HTTP', action: 'updated', goalId: 'goal-1', nodeId: 'node-101' },
    ])
  })
})

describe('mergeDelivery', () => {
  it('同一轮多次登记合并去重，后到的 note 不覆盖先到的', () => {
    const acc = emptyDelivery()
    mergeDelivery(acc, normalizeDelivery({ files: [{ path: 'a', note: '第一次' }] })!)
    mergeDelivery(
      acc,
      normalizeDelivery({
        files: [{ path: 'a', note: '第二次' }, { path: 'b', action: 'deleted' }],
        sources: [{ title: 'S', url: 'https://example.com/s' }],
      })!,
    )
    expect(acc.files).toEqual([
      { path: 'a', action: 'updated', note: '第一次' },
      { path: 'b', action: 'deleted' },
    ])
    expect(acc.sources).toHaveLength(1)
    expect(hasDelivery(acc)).toBe(true)
  })

  it('mergeDelivery 合并时可补充先前缺失的 goalId 与 nodeId', () => {
    const acc = emptyDelivery()
    mergeDelivery(acc, normalizeDelivery({ files: [{ path: 'HTTP' }] })!)
    mergeDelivery(acc, normalizeDelivery({ files: [{ path: 'HTTP', goalId: 'g1', nodeId: 'n1' }] })!)
    expect(acc.files).toEqual([
      { path: 'HTTP', action: 'updated', goalId: 'g1', nodeId: 'n1' },
    ])
  })

  it('空记录不算交付（组件不渲染）', () => {
    expect(hasDelivery(emptyDelivery())).toBe(false)
    expect(hasDelivery(undefined)).toBe(false)
  })
})
