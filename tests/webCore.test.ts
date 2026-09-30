/**
 * 抓网页的三条硬规则（见 electron/web-core）：地址能不能抓、算什么内容、按什么编码读。
 *
 * 为什么单独钉：它们是**安全边界**（不给 agent 一个能读本机服务的口子）与
 * 「读不读得懂」（中文站一半不带 charset）的分界，而且完全不需要网络——
 * 一条用例就能把每个私网段的判定锁住，改了立刻红。
 */
import { describe, expect, it } from 'vitest'

import {
  WEB_MAX_BYTES,
  WEB_TIMEOUT_MS,
  charsetFromHtml,
  charsetOf,
  isPrivateHost,
  kindOfContentType,
  webUrlBlockReason,
} from '../electron/web-core'

describe('地址能不能抓', () => {
  it('正常的 http/https 放行', () => {
    for (const url of ['https://example.com/a?b=1#c', 'http://8.8.8.8/', 'http://172.32.0.1/x']) {
      expect(webUrlBlockReason(url), url).toBeNull()
    }
  })

  it('别的协议一律拒绝', () => {
    expect(webUrlBlockReason('ftp://example.com/a')).toContain('http')
    expect(webUrlBlockReason('file:///C:/Windows/win.ini')).toContain('http')
    expect(webUrlBlockReason('llm-proxy://example.com/a')).toContain('http')
    expect(webUrlBlockReason('随便写点什么')).toContain('完整地址')
    expect(webUrlBlockReason('')).toContain('完整地址')
  })

  it('本机与内网一律拒绝（agent 是模型写的代码，不能给它读本机服务的口子）', () => {
    for (const url of [
      'http://localhost:3080/',
      'http://127.0.0.1/',
      'http://0.0.0.0/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.1/',
      'http://172.31.255.254/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://nas.local/',
      'http://db.internal/',
    ]) {
      expect(webUrlBlockReason(url), url).toContain('内网')
    }
  })

  it('私网判定只认那几个网段（172.32 不是私网）', () => {
    expect(isPrivateHost('172.15.0.1')).toBe(false)
    expect(isPrivateHost('172.16.0.1')).toBe(true)
    expect(isPrivateHost('11.0.0.1')).toBe(false)
    expect(isPrivateHost('example.com')).toBe(false)
  })
})

describe('算什么内容', () => {
  it('html / text / 别的', () => {
    expect(kindOfContentType('text/html; charset=utf-8')).toBe('html')
    expect(kindOfContentType('application/xhtml+xml')).toBe('html')
    expect(kindOfContentType('text/plain')).toBe('text')
    expect(kindOfContentType('application/json')).toBe('text')
    expect(kindOfContentType('application/pdf')).toBe('other')
    expect(kindOfContentType('image/png')).toBe('other')
    // 没有 content-type：当网页试一次（不少静态站就是不给）
    expect(kindOfContentType(null)).toBe('html')
  })

  it('体积与时间都有硬上限', () => {
    expect(WEB_MAX_BYTES).toBe(4 * 1024 * 1024)
    expect(WEB_TIMEOUT_MS).toBe(20_000)
  })
})

describe('按什么编码读', () => {
  it('响应头里的 charset', () => {
    expect(charsetOf('text/html; charset=UTF-8')).toBe('utf-8')
    expect(charsetOf('text/html; charset=gb2312')).toBe('gb18030')
    expect(charsetOf('text/html; charset="GBK"')).toBe('gb18030')
    expect(charsetOf('text/html')).toBe('utf-8')
  })

  it('响应头没有就看 <meta charset>（中文站很常见）', () => {
    expect(charsetFromHtml('<html><head><meta charset="gbk"><title>x</title>')).toBe('gb18030')
    expect(charsetFromHtml('<meta http-equiv="Content-Type" content="text/html; charset=utf-8">')).toBe('utf-8')
    expect(charsetFromHtml('<html><head><title>x</title>')).toBe('utf-8')
  })
})
