/**
 * 「定位源码」的一次性请求（lib/docReveal）：放下 → 编辑器挂载时取走。
 *
 * 钉住三条：
 * - 身份键对不上不取（同一份文档才认，别的文档的请求不能被顺手领走）；
 * - 取过一次就没了（第二次挂载不该又跳去选同一段）；
 * - 过期的请求当没有（用户隔了很久自己点了「源码」，不该突然跳到几分钟前选过的位置）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  localRevealKey,
  nodeRevealKey,
  requestSourceReveal,
  takeSourceReveal,
} from '../src/lib/docReveal'

afterEach(() => {
  vi.useRealTimers()
})

describe('docReveal：请求的取件规矩', () => {
  it('同一份文档取得到，区间原样带回来', () => {
    const key = nodeRevealKey('n1', 'teaching')
    requestSourceReveal(key, 10, 24)
    expect(takeSourceReveal(key)).toMatchObject({ start: 10, end: 24 })
  })

  it('取过一次就没了', () => {
    const key = localRevealKey('E:/ws/a.md')
    requestSourceReveal(key, 3, 8)
    expect(takeSourceReveal(key)).not.toBeNull()
    expect(takeSourceReveal(key)).toBeNull()
  })

  it('身份键对不上就不认（别的文档的请求留在原地）', () => {
    const key = nodeRevealKey('n1', 'note', 'a')
    requestSourceReveal(key, 0, 5)
    expect(takeSourceReveal(nodeRevealKey('n1', 'note', 'b'))).toBeNull()
    expect(takeSourceReveal(key)).not.toBeNull()
  })

  it('教学文档与笔记是两个身份：同名同节点也不串', () => {
    expect(nodeRevealKey('n1', 'teaching')).not.toBe(nodeRevealKey('n1', 'note', 'teaching'))
  })

  it('过期的请求当没有，且顺手清掉', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'))
    const key = nodeRevealKey('n1', 'teaching')
    requestSourceReveal(key, 1, 2)
    vi.setSystemTime(new Date('2026-10-18T10:00:30Z'))
    expect(takeSourceReveal(key)).toBeNull()
  })
})
