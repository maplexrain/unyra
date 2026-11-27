import { describe, expect, it } from 'vitest'
import { devLogSnapshot, formatLogText, recordDevLog, subscribeDevLogs } from '../electron/app/devLogs'

describe('developer console log hub', () => {
  it('把 console 多参数折成可读文本，对象与 Error 不丢', () => {
    expect(formatLogText(['任务 %s', { id: 7 }])).toContain('任务')
    expect(formatLogText([new Error('boom')])).toContain('boom')
  })

  it('写入条目、保留来源与位置，并推送订阅者', () => {
    const seen: Array<{ id: number; text: string }> = []
    const off = subscribeDevLogs((entry) => seen.push({ id: entry.id, text: entry.text }))
    const entry = recordDevLog('renderer', 'warn', '写盘失败', 'storage.ts:42')
    expect(entry).toMatchObject({ source: 'renderer', level: 'warn', text: '写盘失败', origin: 'storage.ts:42' })
    expect(seen.some((item) => item.id === entry?.id && item.text === '写盘失败')).toBe(true)
    off()
    recordDevLog('main', 'log', '订阅取消后不应再收到')
    expect(seen.some((item) => item.text === '订阅取消后不应再收到')).toBe(false)
  })

  it('空日志不占缓冲，快照按写入顺序返回副本', () => {
    expect(recordDevLog('main', 'log', '   ')).toBeNull()
    const snapshot = devLogSnapshot()
    expect(Array.isArray(snapshot)).toBe(true)
    expect(snapshot.at(-1)?.id).toBeGreaterThan(0)
    snapshot.push({ ...snapshot[0]! })
    expect(devLogSnapshot()).toHaveLength(snapshot.length - 1)
  })

  it('环形缓冲最多保留 2000 条', () => {
    for (let i = 0; i < 2_050; i += 1) recordDevLog('main', 'log', `bulk ${i}`)
    const snapshot = devLogSnapshot()
    expect(snapshot).toHaveLength(2_000)
    expect(snapshot[0]?.text).toBe('bulk 50')
    expect(snapshot.at(-1)?.text).toBe('bulk 2049')
  })
})
