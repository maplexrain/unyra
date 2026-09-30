/**
 * 阅读记录的崩溃兜底（见 learn/readingJournal.ts）。
 *
 * 这里要钉住的是「折不折、折几遍」：折多了是阅读时长凭空变长（打卡会被它骗过去），
 * 折少了就是被强杀时丢掉的那几十秒——两头都不该发生。
 */
import { describe, expect, it } from 'vitest'
import { emptyJournal, foldJournal, journalEmpty, parseJournal, upsertEntry } from '../src/learn/readingJournal'
import { applyReadingDelta, emptyReading, type ReadingDelta } from '../src/learn/reading'

const SESSION = 's-1'
const DAY = '2026-09-21'

function delta(at: number, activeMs: number, sectionMs = activeMs): ReadingDelta {
  return {
    sessionId: SESSION,
    nodeId: 'n-1',
    doc: 'teaching',
    day: DAY,
    at,
    activeMs,
    minuteIndex: 0,
    minutes: [{ ms: activeMs, chars: 100, marks: 0, gaps: 0 }],
    breaks: [],
    sections: [
      { key: '1 开头', text: '开头', index: 0, level: 1, ms: sectionMs, reach: 1, marks: ['select'], firstAt: at, lastAt: at },
    ],
  }
}

describe('parseJournal（坏文件当没有）', () => {
  it('不是对象 / 版本不对 / entries 不是数组：一律当空', () => {
    expect(parseJournal(null).entries).toEqual([])
    expect(parseJournal('{ 半截').entries).toEqual([])
    expect(parseJournal({ version: 99, entries: [] }).entries).toEqual([])
    expect(parseJournal({ version: 1, entries: 'x' }).entries).toEqual([])
  })

  it('缺字段的条目丢掉，好的留下', () => {
    const j = parseJournal({
      version: 1,
      entries: [
        { sessionId: '', live: delta(1, 1000) },
        { sessionId: 'a', live: { nodeId: 'n', doc: 'x' } },
        { sessionId: 'b', live: delta(10, 5000) },
      ],
    })
    expect(j.entries.map((e) => e.sessionId)).toEqual(['b'])
  })
})

describe('upsertEntry（一个会话一条，按 sessionId 覆盖）', () => {
  it('同 id 覆盖、不同 id 追加，只留最近几个', () => {
    let j = emptyJournal()
    for (let i = 0; i < 12; i++) {
      j = upsertEntry(j, { sessionId: 's-' + i, day: DAY, nodeId: 'n', doc: 'teaching', live: delta(i + 1, 1000), chunks: [] })
    }
    expect(j.entries.length).toBe(8)
    expect(j.entries[j.entries.length - 1].sessionId).toBe('s-11')
    j = upsertEntry(j, { sessionId: 's-11', day: DAY, nodeId: 'n', doc: 'teaching', live: null, chunks: [] })
    expect(j.entries.filter((e) => e.sessionId === 's-11').length).toBe(1)
  })

  it('空条目（live 与 chunks 都没有）不算「有东西要折」', () => {
    const j = upsertEntry(emptyJournal(), { sessionId: 's', day: DAY, nodeId: 'n', doc: 'teaching', live: null, chunks: [] })
    expect(journalEmpty(j)).toBe(true)
  })
})

describe('foldJournal（只折 store 里还没有的）', () => {
  it('live 一定折：它从来没结算过', () => {
    const out = foldJournal(emptyReading(), {
      version: 1,
      entries: [{ sessionId: SESSION, day: DAY, nodeId: 'n-1', doc: 'teaching', live: delta(1000, 7000), chunks: [] }],
    })
    expect(out.nodes['n-1'].docs['teaching'].activeMs).toBe(7000)
  })

  it('已落盘的 chunk 不再折（否则算两遍）', () => {
    // store 里那次会话的 to = 20000：说明 20000 那一刻（含）之前的结算都已经落盘
    const persisted = applyReadingDelta(emptyReading(), delta(20000, 30000))
    const out = foldJournal(persisted, {
      version: 1,
      entries: [
        {
          sessionId: SESSION,
          day: DAY,
          nodeId: 'n-1',
          doc: 'teaching',
          live: null,
          chunks: [
            { at: 20000, delta: delta(20000, 30000) }, // 已经落盘的那一段
            { at: 25000, delta: delta(25000, 5000) }, // 结算了但没落盘的
          ],
        },
      ],
    })
    expect(out.nodes['n-1'].docs['teaching'].activeMs).toBe(35000)
  })

  it('没有对应会话时，chunk 与 live 都折', () => {
    const out = foldJournal(emptyReading(), {
      version: 1,
      entries: [
        {
          sessionId: SESSION,
          day: DAY,
          nodeId: 'n-1',
          doc: 'teaching',
          live: delta(30000, 2000),
          chunks: [{ at: 25000, delta: delta(25000, 5000) }],
        },
      ],
    })
    expect(out.nodes['n-1'].docs['teaching'].activeMs).toBe(7000)
  })

  it('折出来的那一段也算进当天账本（打卡读的就是它）', () => {
    const out = foldJournal(emptyReading(), {
      version: 1,
      entries: [{ sessionId: SESSION, day: DAY, nodeId: 'n-1', doc: 'teaching', live: delta(1000, 9000), chunks: [] }],
    })
    expect(out.days[DAY]?.activeMs).toBe(9000)
    expect(out.days[DAY]?.nodes).toEqual(['n-1'])
  })

  it('空旁路：原样返回同一份对象（不做无谓的重建）', () => {
    const reading = emptyReading()
    expect(foldJournal(reading, emptyJournal())).toBe(reading)
  })
})
