import { describe, expect, it } from 'vitest'
import { normalizeWebInput } from '../src/learn/webUrl'

describe('normalizeWebInput：地址栏的一条输入，两种意思', () => {
  it('带协议的网址原样放行（http/https/file/about）', () => {
    expect(normalizeWebInput('https://x.com/a?b=1')).toBe('https://x.com/a?b=1')
    expect(normalizeWebInput('HTTP://X.COM')).toBe('HTTP://X.COM')
    expect(normalizeWebInput('file:///C:/a.html')).toBe('file:///C:/a.html')
    expect(normalizeWebInput('about:blank')).toBe('about:blank')
  })

  it('像域名的补 https；本机与纯 IP 补 http', () => {
    expect(normalizeWebInput('example.com')).toBe('https://example.com')
    expect(normalizeWebInput('example.com:8080/x?a=1')).toBe('https://example.com:8080/x?a=1')
    expect(normalizeWebInput('sub.domain-x.org/path#frag')).toBe('https://sub.domain-x.org/path#frag')
    expect(normalizeWebInput('localhost')).toBe('http://localhost')
    expect(normalizeWebInput('localhost:3000/api')).toBe('http://localhost:3000/api')
    expect(normalizeWebInput('127.0.0.1:9229')).toBe('http://127.0.0.1:9229')
  })

  it('其余一律交搜索；空输入返回空', () => {
    expect(normalizeWebInput('怎么学习极限')).toBe(
      'https://www.bing.com/search?q=' + encodeURIComponent('怎么学习极限'),
    )
    expect(normalizeWebInput('hello world')).toBe('https://www.bing.com/search?q=hello%20world')
    expect(normalizeWebInput('  ')).toBe('')
    expect(normalizeWebInput('')).toBe('')
  })

  it('危险 scheme 不直接执行，落进搜索', () => {
    expect(normalizeWebInput('javascript:alert(1)')).toBe(
      'https://www.bing.com/search?q=' + encodeURIComponent('javascript:alert(1)'),
    )
  })
})
