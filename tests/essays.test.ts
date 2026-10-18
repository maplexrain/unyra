/**
 * 随笔（learn/essays）的纯逻辑。
 *
 * 钉的四件事：
 * - **空文本不是一条随笔**（窗口一开就是空白编辑器，第一个字才落一条）；
 * - 按日期归堆、新的在前（列表就照这个顺序画）；
 * - 改一条只动正文与 updatedAt，createdAt 是它归在哪一天的依据，不能跟着动；
 * - 读盘时坏数据丢掉、死目标整本丢掉、空文本条目丢掉，且读回来要重新排序。
 */
import { describe, expect, it } from 'vitest'

import {
  createEssay,
  deleteEssay,
  dayOfEssay,
  essayPreview,
  ESSAY_DOCK_MIN_H,
  ESSAY_DOCK_MIN_W,
  essaysOf,
  groupEssaysByDay,
  normalizeEssayDock,
  normalizeEssays,
  timeOfEssay,
  updateEssay,
} from '../src/learn/essays'
import { emptyLearnStore } from '../src/learn/store/empty'

const AT = new Date('2026-10-18T09:12:00').getTime()

describe('随笔：写、改、删', () => {
  it('空文本不落一条（空随笔不是一条随笔）', () => {
    expect(createEssay(emptyLearnStore(), 'g1', '   \n ', AT)).toBeNull()
  })

  it('写下第一个字就成一条，插在最前面', () => {
    const first = createEssay(emptyLearnStore(), 'g1', '第一条', AT)
    expect(first?.entry.id).toBeTruthy()
    const second = createEssay(first!.store, 'g1', '第二条', AT + 1000)
    expect(essaysOf(second!.store, 'g1').map((e) => e.text)).toEqual(['第二条', '第一条'])
  })

  it('随笔不串目标', () => {
    const created = createEssay(emptyLearnStore(), 'g1', '这门课的', AT)!
    expect(essaysOf(created.store, 'g2')).toEqual([])
  })

  it('改一条：正文与 updatedAt 动，createdAt 不动（它决定归在哪一天）', () => {
    const created = createEssay(emptyLearnStore(), 'g1', '原样', AT)!
    const id = created.entry.id
    const next = updateEssay(created.store, 'g1', id, '改过', AT + 60_000)
    const entry = essaysOf(next, 'g1')[0]
    expect(entry.text).toBe('改过')
    expect(entry.createdAt).toBe(AT)
    expect(entry.updatedAt).toBe(AT + 60_000)
  })

  it('改一条不存在的：原样返回（调用方不必先查）', () => {
    const store = emptyLearnStore()
    expect(updateEssay(store, 'g1', 'nope', 'x', AT)).toBe(store)
  })

  it('删一条：列表里没有了；删光了连这个目标的键都不留（不写空文件）', () => {
    const created = createEssay(emptyLearnStore(), 'g1', '就一条', AT)!
    const id = created.entry.id
    const gone = deleteEssay(created.store, 'g1', id)
    expect(essaysOf(gone, 'g1')).toEqual([])
    expect(gone.essays?.g1).toBeUndefined()
  })
})

describe('随笔：按日期归堆与预览', () => {
  it('同一天的归一组，跨天另起一组，组内新的在前', () => {
    let store = emptyLearnStore()
    const day1 = new Date('2026-10-17T10:00:00').getTime()
    const day2 = new Date('2026-10-18T08:00:00').getTime()
    store = createEssay(store, 'g1', '昨天上午', day1)!.store
    store = createEssay(store, 'g1', '今天早上', day2)!.store
    store = createEssay(store, 'g1', '今天更早', day2 - 3600_000)!.store

    const groups = groupEssaysByDay(essaysOf(store, 'g1'))
    expect(groups.map((g) => g.day)).toEqual(['2026-10-18', '2026-10-17'])
    expect(groups[0].items.map((e) => e.text)).toEqual(['今天早上', '今天更早'])
  })

  it('日期与钟点按本地时区算', () => {
    expect(dayOfEssay(AT)).toBe('2026-10-18')
    expect(timeOfEssay(AT)).toBe('09:12')
  })

  it('预览抹掉 Markdown 记号：列表里要的是「这条讲什么」', () => {
    const text = '## 小标题\n\n- **重点**：看 [这篇](https://x)\n\n```js\ncode()\n```'
    expect(essayPreview(text)).toBe('小标题 重点：看 这篇')
  })

  it('预览过长截断并加省略号', () => {
    const out = essayPreview('字'.repeat(50), 10)
    expect(out).toBe('字'.repeat(10) + '…')
  })
})

describe('随笔：读盘归一化', () => {
  const raw = {
    g1: [
      { id: 'a', text: '第二条', createdAt: AT + 1000, updatedAt: AT + 1000 },
      { id: 'b', text: '第一条', createdAt: AT, updatedAt: AT },
      // 空文本：手改文件留下的，丢掉
      { id: 'c', text: '   ', createdAt: AT, updatedAt: AT },
      // 没有 id：补一个（不能因为手改就丢内容）
      { text: '手写的', createdAt: AT - 1000, updatedAt: AT - 1000 },
    ],
    gDead: [{ id: 'd', text: '死目标的', createdAt: AT, updatedAt: AT }],
  }

  it('死目标整本丢掉、空文本条目丢掉、没有 id 的补一个、读回来按时间倒序', () => {
    const out = normalizeEssays(raw, new Set(['g1']))
    expect(Object.keys(out)).toEqual(['g1'])
    expect(out.g1.map((e) => e.text)).toEqual(['第二条', '第一条', '手写的'])
    expect(out.g1[2].id).toBeTruthy()
  })

  it('完全认不出的输入给空账本', () => {
    expect(normalizeEssays(null, new Set(['g1']))).toEqual({})
    expect(normalizeEssays({ g1: 'nope' }, new Set(['g1']))).toEqual({})
  })
})

describe('随笔窗口几何的归一化', () => {
  it('认得出的原样保留（四舍五入）', () => {
    expect(normalizeEssayDock({ x: 10.4, y: 20.6, w: 600, h: 400 })).toEqual({ x: 10, y: 21, w: 600, h: 400 })
  })

  it('缺字段 / 不是数就当没存过（下次按默认位置摆）', () => {
    expect(normalizeEssayDock(null)).toBeUndefined()
    expect(normalizeEssayDock({ x: 1, y: 2 })).toBeUndefined()
    expect(normalizeEssayDock({ x: 'a', y: 2, w: 300, h: 200 })).toBeUndefined()
  })

  it('宽高抬到下限：存进来的窗口不该小到点不着', () => {
    const rect = normalizeEssayDock({ x: 0, y: 0, w: 10, h: 10 })!
    expect(rect.w).toBe(ESSAY_DOCK_MIN_W)
    expect(rect.h).toBe(ESSAY_DOCK_MIN_H)
  })
})
