import { describe, expect, it } from 'vitest'
import {
  apiPathKey,
  capHeaders,
  flattenConsoleArgs,
  flattenStack,
  humanSize,
  isTextualMime,
  newWebLogBuffer,
  pushConsoleLog,
  pushNetLog,
  queryWebLogs,
  replayHeadersOf,
  sanitizeLogsQuery,
  webLogDetail,
  WEB_LOG_CONSOLE_CAP,
  WEB_LOG_NET_CAP,
} from '../shared/webLogs'

describe('webLogs：缓冲与容量', () => {
  it('seq 单调递增；两种各自封顶，挤掉最旧的', () => {
    const buf = newWebLogBuffer()
    for (let i = 0; i < WEB_LOG_CONSOLE_CAP + 10; i++) pushConsoleLog(buf, i, { level: 'error', text: 'e' + i })
    for (let i = 0; i < WEB_LOG_NET_CAP + 10; i++) {
      pushNetLog(buf, i, { method: 'GET', url: 'https://x.com/' + i, status: 200, type: 'XHR' })
    }
    expect(buf.console).toHaveLength(WEB_LOG_CONSOLE_CAP)
    expect(buf.network).toHaveLength(WEB_LOG_NET_CAP)
    // 最旧被挤掉，seq 仍然单调
    expect(buf.console[0].seq).toBe(11)
    expect(buf.network[0].seq).toBe(WEB_LOG_CONSOLE_CAP + 10 + 11)
    expect(buf.nextSeq).toBe(WEB_LOG_CONSOLE_CAP + WEB_LOG_NET_CAP + 21)
  })
})

describe('webLogs：清单折叠与过滤', () => {
  const seed = (): ReturnType<typeof newWebLogBuffer> => {
    const buf = newWebLogBuffer()
    pushConsoleLog(buf, 1, { level: 'error', text: 'TypeError: x is undefined' })
    pushConsoleLog(buf, 2, { level: 'warn', text: 'deprecated api' })
    pushConsoleLog(buf, 3, { level: 'error', text: 'TypeError: x is undefined' }) // 与 seq1 同文本 → ×2
    pushNetLog(buf, 4, { method: 'GET', url: 'https://api.x.com/feed?cursor=2&limit=20', status: 200, type: 'XHR', size: 84_000 })
    pushNetLog(buf, 5, { method: 'GET', url: 'https://api.x.com/feed?cursor=3&limit=20', status: 200, type: 'XHR', size: 84_500 })
    pushNetLog(buf, 6, { method: 'POST', url: 'https://api.x.com/like', status: 429, type: 'XHR' })
    pushNetLog(buf, 7, { method: 'GET', url: 'https://cdn.x.com/app.js', status: 200, type: 'Script', size: 4096 })
    return buf
  }

  it('console 同文本折 ×N（栈取第一条）；level 默认 error，warn 档含警告', () => {
    const v = queryWebLogs(seed(), { kind: 'console' })
    expect(v.lines).toEqual(['[c1] E TypeError: x is undefined ×2'])
    expect(v.totalConsole).toBe(2)
    const vAll = queryWebLogs(seed(), { kind: 'console', level: 'all' })
    expect(vAll.lines).toHaveLength(2)
    expect(vAll.lines[1]).toBe('[c2] W deprecated api')
  })

  it('网络：同 path 异 query 折 ×N（query 只留参数名）；失败永不折叠；静态资源压一行', () => {
    const v = queryWebLogs(seed(), { kind: 'network' })
    expect(v.lines).toHaveLength(3)
    expect(v.lines[0]).toBe('[n4] GET https://api.x.com/feed?cursor=2&limit=20 → 200 · 82KB ×2')
    expect(v.lines[1]).toBe('[n6] POST https://api.x.com/like → 429')
    expect(v.lines[2]).toBe('[static] 静态资源 ×1（已折叠，不看）')
    expect(v.totalNetwork).toBe(4)
  })

  it('afterSeq 是无状态分页游标：只看之后的；limit 截断并打 truncated 标', () => {
    const buf = seed()
    expect(queryWebLogs(buf, { afterSeq: 4 }).totalNetwork).toBe(3)
    const one = queryWebLogs(buf, { kind: 'network', limit: 1 })
    expect(one.shown).toBe(1)
    expect(one.truncated).toBe(true)
    // 重复查询一致（没有 drain 语义）
    expect(queryWebLogs(buf, {})).toEqual(queryWebLogs(buf, {}))
  })

  it('sanitized：认不出的落默认，limit/afterSeq 夹紧', () => {
    expect(sanitizeLogsQuery({ kind: 'banana', level: 'LOUD', afterSeq: -5 })).toEqual({})
    expect(sanitizeLogsQuery({ kind: 'network', level: 'warn', limit: 3.9, afterSeq: 7.9 })).toEqual({
      kind: 'network',
      level: 'warn',
      limit: 3,
      afterSeq: 7,
    })
    expect(sanitizeLogsQuery({ limit: 9999 })).toEqual({ limit: 200 })
  })
})

describe('webLogs：详情与重放原料', () => {
  it('webLogDetail：console 给文本与栈；network 给头/postData/响应体；认不出回 null', () => {
    const buf = newWebLogBuffer()
    pushConsoleLog(buf, 1, { level: 'error', text: 'boom', stack: 'fn @ /a.js:1:1' })
    pushNetLog(buf, 2, {
      method: 'POST',
      url: 'https://api.x.com/like',
      status: 200,
      type: 'XHR',
      headers: { 'content-type': 'application/json' },
      postData: '{"id":1}',
      body: { text: '{"ok":true}', truncated: false, mime: 'application/json' },
      cdpRequestId: 'cdp-1',
    })
    const c = webLogDetail(buf, 1)
    expect(c).toMatchObject({ kind: 'console', level: 'error', text: 'boom', stack: 'fn @ /a.js:1:1' })
    const n = webLogDetail(buf, 2)
    expect(n).toMatchObject({
      kind: 'network',
      method: 'POST',
      status: 200,
      requestHeaders: { 'content-type': 'application/json' },
      postData: '{"id":1}',
      responseBody: { text: '{"ok":true}', truncated: false },
    })
    expect(webLogDetail(buf, 99)).toBeNull()
  })

  it('replayHeadersOf：cookie/host/sec-* 这些浏览器自己管的头不抄', () => {
    expect(
      replayHeadersOf({
        'content-type': 'application/json',
        'x-csrf-token': 'abc',
        Cookie: 'session=1',
        host: 'api.x.com',
        'sec-ch-ua': '"Chromium"',
        'content-length': '12',
      }),
    ).toEqual({ 'content-type': 'application/json', 'x-csrf-token': 'abc' })
  })

  it('采集侧扁平化：args 按值/描述串起来并截断；栈取顶帧；头按键数截断', () => {
    expect(
      flattenConsoleArgs([
        { type: 'string', value: '加载失败' },
        { type: 'number', value: 42 },
        { type: 'object', description: 'TypeError: boom' },
      ]),
    ).toBe('加载失败 42 TypeError: boom')
    expect(flattenStack([{ functionName: 'onClick', url: 'https://x.com/a/b.js', lineNumber: 9, columnNumber: 2 }])).toBe(
      'onClick @ /a/b.js:9:2',
    )
    const big: Record<string, string> = {}
    for (let i = 0; i < 50; i++) big['h' + i] = 'v'
    expect(Object.keys(capHeaders(big) ?? {})).toHaveLength(40)
    expect(isTextualMime('application/json')).toBe(true)
    expect(isTextualMime('image/png')).toBe(false)
  })

  it('apiPathKey 与 humanSize', () => {
    expect(apiPathKey('https://api.x.com/feed?limit=20&cursor=2')).toBe('/feed?cursor&limit')
    expect(apiPathKey('https://api.x.com/like')).toBe('/like')
    expect(apiPathKey('不是网址')).toBe('不是网址')
    expect(humanSize(84000)).toBe('82KB')
    expect(humanSize(1024)).toBe('1.0KB')
    expect(humanSize(3 * 1024 * 1024)).toBe('3.0MB')
    expect(humanSize(undefined)).toBe('')
  })
})
